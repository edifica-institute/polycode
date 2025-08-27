// c-plugin.js — single-WS compile ➜ run with streamed output
import { WebSocketServer } from "ws";
import express from "express";
import { spawn } from "child_process";
import * as fs from "node:fs/promises";
import path from "node:path";

const JOB_ROOT = process.env.JOB_ROOT || "/tmp/polycode";
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Parse GCC lines into diagnostics (optional for Monaco markers)
function parseGcc(out) {
  const lines = String(out || "").split(/\r?\n/);
  const markers = [];
  for (const line of lines) {
    const m = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i);
    if (m) markers.push({ file:m[1], line:+m[2], column:+m[3], message:m[5], severity:m[4].toLowerCase() });
  }
  return markers;
}

export function register(app, { server }) {
  app.use("/api/c", (req,res,next)=>{ // CORS for completeness
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method==="OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/c", express.json({ limit:"2mb" }));

  // (kept for compatibility, not used by the page above)
  app.post("/api/c/prepare", (req,res)=> res.json({ ok:false, reason:"single-ws-only" }));

  // ---- WS: /term-c (single WebSocket protocol) ----
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    try{
      const { pathname } = new URL(req.url, "http://x");
      if (pathname !== "/term-c") return;
      wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
    }catch{ try{ socket.destroy(); }catch{} }
  });

  wss.on("connection", (ws) => {
    singleWsFlow(ws).catch(async (e)=>{
      try{ ws.send(JSON.stringify({ type:"stderr", data: String(e?.message||e) + "\n" })); }catch{}
      try{ ws.send(JSON.stringify({ type:"exit", code: 1 })); }catch{}
      try{ ws.close(); }catch{}
    });
  });

  console.log("[polycode] C plugin ready (WS: /term-c)");
}

/* ------------------- helpers ------------------- */

async function singleWsFlow(ws){
  let child=null, workdir=null;

  const cleanup = async ()=>{
    try{ child?.kill("SIGKILL"); }catch{}
    child=null;
    if (workdir){ try{ await fs.rm(workdir, { recursive:true, force:true }); }catch{} }
    workdir=null;
  };
  ws.on("close", cleanup);

  ws.on("message", async raw=>{
    let msg; try{ msg = JSON.parse(String(raw)); }catch{ return; }

    if (msg.type==="stdin" && child?.stdin?.writable){
      try{ child.stdin.write(msg.data); }catch{}
      return;
    }
    if (msg.type==="kill" && child){
      try{ child.kill("SIGKILL"); }catch{}
      return;
    }
    if (msg.type!=="start" || child) return;

    const files = Array.isArray(msg.files) ? msg.files : [];
    if (!files.length){ ws.send(JSON.stringify({type:"stderr", data:"No files to compile.\n"})); ws.send(JSON.stringify({type:"exit", code:1})); return; }

    // write workspace
    const id = uid();
    workdir = path.join(JOB_ROOT, "c", id);
    await fs.mkdir(workdir, { recursive:true });
    for (const f of files){
      const rel = (f?.path || "main.c").replace(/^\/*/, "");
      const full= path.join(workdir, rel);
      await fs.mkdir(path.dirname(full), { recursive:true });
      await fs.writeFile(full, f?.content ?? "", "utf8");
    }

    // compile and stream gcc output
    const cd = "cd '" + workdir.replace(/'/g,"'\\''") + "'";
    const bash = `
${cd}
set -e
shopt -s nullglob globstar
files=( ./**/*.c *.c )
declare -A seen; uniq=()
for f in "\${files[@]}"; do nf="\${f#./}"; [[ -n "\${seen[$nf]}" ]] && continue; seen[$nf]=1; uniq+=("$nf"); done
if (( \${#uniq[@]} == 0 )); then echo "No .c files found"; exit 1; fi
printf '$ gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main'
for f in "\${uniq[@]}"; do printf " %q" "$f"; done
printf ' -lm\\n'
gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main "\${uniq[@]}" -lm
`.trim();

    const compile = spawn("bash", ["-lc", bash], { stdio: ["ignore","pipe","pipe"] });
    let clog="";
    compile.stdout.on("data", d => { const s=d.toString(); clog+=s; safeSend(ws,{type:"stdout", data:s}); });
    compile.stderr.on("data", d => { const s=d.toString(); clog+=s; safeSend(ws,{type:"stdout", data:s}); });

    const code = await new Promise(resolve=>compile.on("close", resolve));
    const diagnostics = parseGcc(clog);
    if (diagnostics.length) safeSend(ws,{type:"diagnostics", data: diagnostics});
    if (code !== 0 || diagnostics.some(d=>d.severity==='error')){
      safeSend(ws,{type:"exit", code:1}); await cleanup(); return;
    }

    // run (no LD_PRELOAD dependency; input row is always visible on client)
    child = spawn("./main", [], { cwd: workdir, stdio: ["pipe","pipe","pipe"] });

    child.stdout.on("data", d => safeSend(ws, {type:"stdout", data:d.toString()}));
    child.stderr.on("data", d => safeSend(ws, {type:"stderr", data:d.toString()}));
    child.on("close", async rc => {
      safeSend(ws,{type:"exit", code: rc});
      try{ ws.close(); }catch{}
      await cleanup();
    });
  });
}

function safeSend(ws, obj){
  try{ if (ws.readyState===1) ws.send(JSON.stringify(obj)); }catch{}
}

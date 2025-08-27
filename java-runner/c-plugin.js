// c-plugin.js — compile over HTTP; run over WS (token) OR single-WS; robust + keepalive
import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";

const JOB_ROOT = process.env.JOB_ROOT || "/tmp/polycode";
const SESSIONS = new Map();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function parseGcc(out) {
  const lines = String(out || "").split(/\r?\n/);
  const markers = [];
  for (const line of lines) {
    const m = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i);
    if (m) markers.push({ file:m[1], line:+m[2]||1, column:+m[3]||1, message:m[5], severity:m[4].toLowerCase() });
  }
  return markers;
}

export function register(app, { server }) {
  // ---------- CORS + JSON ----------
  app.use("/api/c", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/c", express.json({ limit: "2mb" }));

  // ---------- HTTP compile (returns token if compile OK) ----------
  app.post("/api/c/prepare", async (req, res) => {
    try {
      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      if (!files.length) return res.status(400).json({ error: "No files" });

      const id  = uid();
      const dir = path.join(JOB_ROOT, "c", id);
      await fs.mkdir(dir, { recursive: true });

      for (const f of files) {
        const rel = (f?.path || "main.c").replace(/^\/*/, "");
        const full = path.join(dir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f?.content ?? "", "utf8");
      }

      const cd = "cd '" + dir.replace(/'/g, "'\\''") + "'";
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

      const proc = spawn("bash", ["-lc", bash], { stdio: ["ignore", "pipe", "pipe"] });
      let log = "";
      proc.stdout.on("data", d => (log += d.toString()));
      proc.stderr.on("data", d => (log += d.toString()));
      proc.on("close", async (code) => {
        const diagnostics = parseGcc(log);
        const ok = (code === 0) && !diagnostics.some(d => d.severity === "error" || /fatal/i.test(d.message));
        let token = null;
        if (ok) {
          token = uid();
          // run command (no LD_PRELOAD; keep it simple)
          let stdbuf = "";
          try { await fs.access("/usr/bin/stdbuf"); stdbuf = "stdbuf -o0 -eL "; } catch {}
          const cmd = `${stdbuf}timeout 60s ./main`;
          SESSIONS.set(token, { cwd: dir, cmd });
        }
        res.json({ ok, token, diagnostics, compileLog: log });
      });
    } catch (e) {
      console.error("[c-plugin] /prepare error", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ---------- WS: /term-c ----------
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    try {
      const { pathname } = new URL(req.url, "http://x");
      if (pathname !== "/term-c") return;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } catch { try { socket.destroy(); } catch {} }
  });

  wss.on("connection", (ws, req) => {
    // keepalive ping
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    const ka = setInterval(() => {
      if (ws.isAlive === false) { try{ ws.terminate(); }catch{} clearInterval(ka); return; }
      ws.isAlive = false; try { ws.ping(); } catch {}
    }, 25000);

    const url = new URL(req.url, "http://x");
    const token = url.searchParams.get("token") || url.searchParams.get("t");

    ws.on("close", () => clearInterval(ka));
    ws.on("error", () => {}); // prevent process crash

    if (token && SESSIONS.has(token)) {
      const sess = SESSIONS.get(token);
      runExisting(ws, sess.cwd, sess.cmd, () => { try { SESSIONS.delete(token); } catch {} });
      return;
    }

    // Single-WS path (optional)
    try { ws.send(JSON.stringify({ type:"stdout", data:"[c-runner] ready\n" })); } catch {}
    singleWsFlow(ws).catch((e) => {
      try { ws.send(JSON.stringify({ type:"stderr", data:String(e?.message||e)+"\n" })); } catch {}
      try { ws.send(JSON.stringify({ type:"exit", code:1 })); } catch {}
      try { ws.close(); } catch {}
    });
  });

  console.log("[polycode] C plugin loaded (/api/c/prepare + /term-c)");
}

// -------- helpers --------
function runExisting(ws, cwd, cmd, onFinish){
  const child = spawn("bash", ["-lc", cmd], { cwd, stdio: ["pipe", "pipe", "pipe"] });

  child.stdout.on("data", d => {
    try { ws.send(JSON.stringify({ type:"stdout", data:d.toString() })); } catch {}
  });

  let errBuf = "";
  child.stderr.on("data", d => {
    errBuf += d.toString();
    let i;
    while ((i = errBuf.indexOf("\n")) >= 0) {
      const line = errBuf.slice(0, i); errBuf = errBuf.slice(i + 1);
      if (line) { try { ws.send(JSON.stringify({ type:"stderr", data:line+"\n" })); } catch {} }
    }
  });

  child.on("close", code => {
    try { ws.send(JSON.stringify({ type:"exit", code })); } catch {}
    try { ws.close(); } catch {}
    try { onFinish?.(); } catch {}
  });

  ws.on("message", raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === "stdin") { try { child.stdin.write(m.data); } catch {} }
    if (m.type === "kill")  { try { child.kill("SIGKILL"); } catch {} }
  });

  ws.on("close", () => { try { child.kill("SIGKILL"); } catch {} });
}

async function singleWsFlow(ws){
  let started = false, child = null, workdir = null;

  const cleanup = async () => {
    try { child?.kill("SIGKILL"); } catch {}
    child = null;
    if (workdir) { try { await fs.rm(workdir, { recursive:true, force:true }); } catch {} }
    workdir = null;
  };
  ws.on("close", cleanup);

  ws.on("message", async (raw) => {
    // Protect the async handler so unhandled exceptions never crash Node
    try {
      let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === "stdin" && child?.stdin?.writable) { try { child.stdin.write(msg.data); } catch {} return; }
      if (msg.type === "kill" && child) { try { child.kill("SIGKILL"); } catch {} return; }
      if (msg.type !== "start" || started) return;
      started = true;

      const files = Array.isArray(msg.files) ? msg.files : [];
      if (!files.length) { try { ws.send(JSON.stringify({ type:"stderr", data:"No files to compile.\n" })); } catch {} ; try { ws.send(JSON.stringify({ type:"exit", code:1 })); } catch {}; return; }

      // write workspace
      const id = uid();
      workdir = path.join(JOB_ROOT, "c", id);
      await fs.mkdir(workdir, { recursive: true });
      for (const f of files) {
        const rel = (f?.path || "main.c").replace(/^\/*/, "");
        const full = path.join(workdir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f?.content ?? "", "utf8");
      }

      // compile (stream)
      const cd = "cd '" + workdir.replace(/'/g, "'\\''") + "'";
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

      const compile = spawn("bash", ["-lc", bash], { stdio: ["ignore", "pipe", "pipe"] });
      let clog = "";
      compile.stdout.on("data", d => { const s=d.toString(); clog+=s; try{ ws.send(JSON.stringify({type:"stdout", data:s})) }catch{} });
      compile.stderr.on("data", d => { const s=d.toString(); clog+=s; try{ ws.send(JSON.stringify({type:"stdout", data:s})) }catch{} });

      const code = await new Promise(resolve => compile.on("close", resolve));
      const diagnostics = parseGcc(clog);
      if (diagnostics.length) { try { ws.send(JSON.stringify({ type:"diagnostics", data: diagnostics })); } catch {} }
      const ok = (code === 0) && !diagnostics.some(d => d.severity === "error" || /fatal/i.test(d.message));
      if (!ok) { try { ws.send(JSON.stringify({ type:"exit", code:1 })); } catch {}; await cleanup(); return; }

      // run
      let stdbuf = ""; try { await fs.access("/usr/bin/stdbuf"); stdbuf = "stdbuf -o0 -eL "; } catch {}
      const cmd = `${stdbuf}timeout 60s ./main`;
      child = spawn("bash", ["-lc", cmd], { cwd: workdir, stdio: ["pipe", "pipe", "pipe"] });

      child.stdout.on("data", d => { try { ws.send(JSON.stringify({ type:"stdout", data:d.toString() })); } catch {} });
      let errBuf = "";
      child.stderr.on("data", d => {
        errBuf += d.toString();
        let i;
        while ((i = errBuf.indexOf("\n")) >= 0) {
          const line = errBuf.slice(0, i); errBuf = errBuf.slice(i + 1);
          if (line) { try { ws.send(JSON.stringify({ type:"stderr", data: line + "\n" })); } catch {} }
        }
      });
      child.on("close", async (rc) => { try { ws.send(JSON.stringify({ type:"exit", code: rc })); } catch {}; try { ws.close(); } catch {}; await cleanup(); });
    } catch (e) {
      try { ws.send(JSON.stringify({ type:"stderr", data:String(e)+"\n" })); } catch {}
      try { ws.send(JSON.stringify({ type:"exit", code:1 })); } catch {}
      try { ws.close(); } catch {}
    }
  });
}

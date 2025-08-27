// java-runner/c-plugin.js — ESM, single-WS compile+run (streams), legacy token kept
import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import * as fs from "node:fs/promises";
import path from "node:path";

const JOB_ROOT = process.env.JOB_ROOT || "/tmp/polycode";
const SESSIONS = new Map(); // legacy token sessions
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function parseGcc(out) {
  const lines = String(out || "").split(/\r?\n/);
  const markers = [];
  for (const line of lines) {
    const m = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i);
    if (m) {
      markers.push({
        file: m[1],
        line: Number(m[2]) || 1,
        column: Number(m[3]) || 1,
        message: m[5],
        severity: m[4].toLowerCase(),
      });
    }
  }
  return markers;
}

export function register(app, { server }) {
  // ---------- (optional) legacy HTTP prepare ----------
  app.use("/api/c", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/c", express.json({ limit: "2mb" }));

  app.post("/api/c/prepare", async (req, res) => {
    try {
      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      if (!files.length) return res.status(400).json({ error: "No files" });

      const id = uid();
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

      const proc = spawn("bash", ["-lc", bash]);
      let log = "";
      proc.stdout.on("data", d => (log += d.toString()));
      proc.stderr.on("data", d => (log += d.toString()));
      proc.on("close", async (code) => {
        const diagnostics = parseGcc(log);
        const compileOk = (code === 0) && !diagnostics.some(d => d.severity === "error" || /fatal/i.test(d.message));

        // run command (legacy token mode)
        let stdbufLib = "/usr/lib/coreutils/libstdbuf.so";
        try { await fs.access(stdbufLib); } catch { stdbufLib = ""; }
        const notifyLib = path.join(process.cwd(), "libstdin_notify.so").replace(/'/g, "'\\''");
        const preloadChain = stdbufLib ? `${stdbufLib}:${notifyLib}` : `${notifyLib}`;
        const cmd = [
          `export LD_PRELOAD='${preloadChain}'`,
          stdbufLib ? `export STDBUF='o0:eL'` : `:`,
          `exec timeout 60s ./main`
        ].join("; ");

        let token = null;
        if (compileOk) {
          token = uid();
          SESSIONS.set(token, { cwd: dir, cmd });
        }
        res.json({ token, ok: compileOk, diagnostics, compileLog: log });
      });
    } catch (e) {
      console.error("[c-plugin] prepare error", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ---------- WebSocket: /term-c (single WS + legacy token) ----------
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    try {
      const { pathname } = new URL(req.url, "http://x");
      if (pathname !== "/term-c") return;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } catch {
      try { socket.destroy(); } catch {}
    }
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://x");
    const token = url.searchParams.get("token") || url.searchParams.get("t");

    if (token && SESSIONS.has(token)) {
      const sess = SESSIONS.get(token);
      runExisting(ws, sess.cwd, sess.cmd, () => { try { SESSIONS.delete(token); } catch {} });
      return;
    }

    // single-WS: say hello so you always see *something* immediately
    try { ws.send(JSON.stringify({ type: "stdout", data: "[c-runner] ready\\n" })); } catch {}

    singleWsFlow(ws).catch((e) => {
      try { ws.send(JSON.stringify({ type: "stderr", data: String(e?.message || e) + "\\n" })); } catch {}
      try { ws.send(JSON.stringify({ type: "exit", code: 1 })); } catch {}
      try { ws.close(); } catch {}
    });
  });

  console.log("[polycode] C plugin loaded (HTTP: /api/c/prepare, WS: /term-c)");
}

/* ---------------- helpers ---------------- */

async function runExisting(ws, cwd, cmd, onFinish) {
  const child = spawn("bash", ["-lc", cmd], { cwd, stdio: ["pipe", "pipe", "pipe"] });

  child.stdout.on("data", d => {
    try { ws.send(JSON.stringify({ type: "stdout", data: d.toString() })); } catch {}
  });

  let errBuf = "";
  child.stderr.on("data", d => {
    errBuf += d.toString();
    let i;
    while ((i = errBuf.indexOf("\n")) >= 0) {
      const line = errBuf.slice(0, i); errBuf = errBuf.slice(i + 1);
      if (line === "[[CTRL]]:stdin_req") {
        try { ws.send(JSON.stringify({ type: "stdin_req" })); } catch {}
      } else if (line) {
        try { ws.send(JSON.stringify({ type: "stderr", data: line + "\n" })); } catch {}
      }
    }
  });

  child.on("close", code => {
    try { ws.send(JSON.stringify({ type: "exit", code })); } catch {}
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

async function singleWsFlow(ws) {
  let started = false;
  let child = null;
  let workdir = null;

  const cleanup = async () => {
    try { child?.kill("SIGKILL"); } catch {}
    child = null;
    if (workdir) { try { await fs.rm(workdir, { recursive: true, force: true }); } catch {} }
    workdir = null;
  };

  ws.on("close", cleanup);

  ws.on("message", async (raw) => {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }

    if (msg.type === "stdin" && child?.stdin?.writable) {
      try { child.stdin.write(msg.data); } catch {}
      return;
    }
    if (msg.type === "kill" && child) {
      try { child.kill("SIGKILL"); } catch {}
      return;
    }

    if (msg.type !== "start" || started) return;
    started = true;
try { ws.send(JSON.stringify({ type: "stdout", data: "[c-runner] start received\n" })); } catch {}

    
    const files = Array.isArray(msg.files) ? msg.files : [];
    if (!files.length) {
      try { ws.send(JSON.stringify({ type: "stderr", data: "No files to compile.\n" })); } catch {}
      try { ws.send(JSON.stringify({ type: "exit", code: 1 })); } catch {}
      return;
    }

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

    // compile (STREAM the output)
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

    compile.stdout.on("data", d => {
      const s = d.toString();
      clog += s;
      try { ws.send(JSON.stringify({ type: "stdout", data: s })); } catch {}
    });
    compile.stderr.on("data", d => {
      const s = d.toString();
      clog += s;
      try { ws.send(JSON.stringify({ type: "stdout", data: s })); } catch {} // show gcc lines the same way
    });

    const code = await new Promise(resolve => compile.on("close", resolve));
    const diagnostics = parseGcc(clog);
    if (diagnostics.length) { try { ws.send(JSON.stringify({ type: "diagnostics", data: diagnostics })); } catch {} }
    const ok = (code === 0) && !diagnostics.some(d => d.severity === "error" || /fatal/i.test(d.message));
    if (!ok) {
      try { ws.send(JSON.stringify({ type: "exit", code: 1 })); } catch {}
      await cleanup();
      return;
    }

    // run
    let stdbufLib = "/usr/lib/coreutils/libstdbuf.so";
    try { await fs.access(stdbufLib); } catch { stdbufLib = ""; }
    const notifyLib = path.join(process.cwd(), "libstdin_notify.so").replace(/'/g, "'\\''");
    const preloadChain = stdbufLib ? `${stdbufLib}:${notifyLib}` : `${notifyLib}`;
    const cmd = [
      `export LD_PRELOAD='${preloadChain}'`,
      stdbufLib ? `export STDBUF='o0:eL'` : `:`,
      `exec timeout 60s ./main`
    ].join("; ");

    child = spawn("bash", ["-lc", cmd], { cwd: workdir, stdio: ["pipe", "pipe", "pipe"] });

    child.stdout.on("data", d => {
      try { ws.send(JSON.stringify({ type: "stdout", data: d.toString() })); } catch {}
    });

    let errBuf = "";
    child.stderr.on("data", d => {
      errBuf += d.toString();
      let i;
      while ((i = errBuf.indexOf("\n")) >= 0) {
        const line = errBuf.slice(0, i); errBuf = errBuf.slice(i + 1);
        if (line === "[[CTRL]]:stdin_req") {
          try { ws.send(JSON.stringify({ type: "stdin_req" })); } catch {}
        } else if (line) {
          try { ws.send(JSON.stringify({ type: "stderr", data: line + "\n" })); } catch {}
        }
      }
    });

    child.on("close", async (rc) => {
      try { ws.send(JSON.stringify({ type: "exit", code: rc })); } catch {}
      try { ws.close(); } catch {}
      await cleanup();
    });
  });
}

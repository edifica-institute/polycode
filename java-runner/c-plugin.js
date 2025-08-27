// java-runner/c-plugin.js — ESM
import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import * as fs from "node:fs/promises";
import path from "node:path";

const JOB_ROOT = process.env.JOB_ROOT || "/tmp/polycode";
const SESSIONS = new Map(); // token -> { cwd, cmd }
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
  // ---------- HTTP: /api/c/prepare ----------
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
        const ok = (code === 0) && !diagnostics.some(d => d.severity === "error" || /fatal/i.test(d.message));

        // command for the run step (token session)
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
        if (ok) {
          token = uid();
          SESSIONS.set(token, { cwd: dir, cmd });
        }
        res.json({ token, ok, diagnostics, compileLog: log });
      });
    } catch (e) {
      console.error("[c-plugin] prepare error", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ---------- WS: /term-c?token=... ----------
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
    // keep-alive (works through most proxies)
    const keep = setInterval(() => {
      try { ws.send(JSON.stringify({ type: "hb" })); } catch {}
    }, 25000);
    ws.on("close", () => clearInterval(keep));

    const url = new URL(req.url, "http://x");
    const token = url.searchParams.get("token") || url.searchParams.get("t");

    if (!token || !SESSIONS.has(token)) {
      try { ws.close(1008, "invalid token"); } catch {}
      return;
    }
    const sess = SESSIONS.get(token);
    SESSIONS.delete(token);

    runExisting(ws, sess.cwd, sess.cmd);
  });

  console.log("[polycode] C plugin loaded (/api/c/prepare + /term-c)");
}

function runExisting(ws, cwd, cmd) {
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
    try { ws.close(1000); } catch {}
  });

  ws.on("message", raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === "stdin") child.stdin.write(m.data);
    if (m.type === "kill")  try { child.kill("SIGKILL"); } catch {}
  });

  ws.on("close", () => { try { child.kill("SIGKILL"); } catch {} });
}

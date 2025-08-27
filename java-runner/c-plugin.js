// java-runner/c-plugin.js — ESM, JSON WS, noServer
import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import * as fs from "node:fs/promises";
import path from "node:path";

const JOB_ROOT = process.env.JOB_ROOT || "/tmp/polycode";
const SESSIONS = new Map();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function parseGcc(out) {
  const lines = out.split(/\r?\n/);
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
  // ---------- CORS/JSON for /api/c ----------
  app.use("/api/c", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/c", express.json({ limit: "2mb" }));

  // ---------- Compile: POST /api/c/prepare ----------
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

      // Robust multiline compile script (no fragile '&&' seams)
      const cd = "cd '" + dir.replace(/'/g, "'\\''") + "'";
      const bash = `
${cd}
set -e
shopt -s nullglob globstar
files=( ./**/*.c *.c )

declare -A seen
uniq=()
for f in "\${files[@]}"; do
  nf="\${f#./}"
  [[ -n "\${seen[$nf]}" ]] && continue
  seen[$nf]=1
  uniq+=("$nf")
done

if (( \${#uniq[@]} == 0 )); then
  echo "No .c files found"
  exit 1
fi

printf '$ gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main'
for f in "\${uniq[@]}"; do printf " %q" "$f"; done
printf ' -lm\\n'

gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main "\${uniq[@]}" -lm
`.trim();

      const proc = spawn("bash", ["-lc", bash + " 2>&1"]);
      let log = "";
      proc.stdout.on("data", d => { log += d.toString(); });
      proc.stderr.on("data", d => { log += d.toString(); });

      proc.on("close", async (code) => {
  const diagnostics = parseGcc(log);
  const compileOk = (code === 0) && !diagnostics.some(
    d => d.severity === "error" || /fatal/i.test(d.message)
  );

        // --- Run command (NO `script`): combine stdbuf + stdin-notify ---
        // Debian/Ubuntu path for libstdbuf:
       // --- Run command: preload stdbuf + stdin-notify, no `script` ---
let stdbufLib = "/usr/lib/coreutils/libstdbuf.so";      // Debian/Ubuntu path
try {
  // If the lib isn't there (different distro), fall back gracefully
  await fs.access(stdbufLib);
} catch {
  stdbufLib = ""; // we'll skip stdbuf if not present
}

const notifyLib = path
  .join(process.cwd(), "libstdin_notify.so")
  .replace(/'/g, "'\\''");

const preloadChain = stdbufLib
  ? `${stdbufLib}:${notifyLib}`
  : `${notifyLib}`;

const cmd = [
  `export LD_PRELOAD='${preloadChain}'`,
  stdbufLib ? `export STDBUF='o0:eL'` : `:`,   // unbuffer stdout if stdbuf is available
  `exec timeout 60s ./main`
].join("; ");


        const token = uid();
        SESSIONS.set(token, { cwd: dir, cmd });

        res.json({ token, ok: compileOk, diagnostics, compileLog: log });
      });
    } catch (e) {
      console.error("[c-plugin] prepare error", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ---------- Run: WS on /term-c (auto-start after connect) ----------
  const wssC = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req, socket, head) => {
    try {
      const { pathname } = new URL(req.url, "http://x");
      if (pathname !== "/term-c") return;
      wssC.handleUpgrade(req, socket, head, (ws) => {
        wssC.emit("connection", ws, req);
      });
    } catch {
      try { socket.destroy(); } catch {}
    }
  });

  wssC.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://x");
    const token = url.searchParams.get("token") || url.searchParams.get("t");
    const sess = token && SESSIONS.get(token);
    if (!sess) { try { ws.close(); } catch {} return; }

    // Start immediately (no handshake needed)
    const child = spawn("bash", ["-lc", sess.cmd], {
      cwd: sess.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

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
    });

    ws.on("message", raw => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === "stdin") { try { child.stdin.write(m.data); } catch {} }
      if (m.type === "kill")  { try { child.kill("SIGKILL"); } catch {} }
    });

    ws.on("close", () => { try { child.kill("SIGKILL"); } catch {} });
  });

  console.log("[polycode] C plugin loaded (HTTP: /api/c/prepare, WS: /term-c)");
}

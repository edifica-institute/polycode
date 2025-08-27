// java-runner/c-plugin.js — ESM, JSON WS, noServer (single-WS compile+run)
import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import * as fs from "node:fs/promises";
import path from "node:path";

const JOB_ROOT = process.env.JOB_ROOT || "/tmp/polycode";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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
  // CORS/JSON (kept for future HTTP endpoints if needed)
  app.use("/api/c", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/c", express.json({ limit: "2mb" }));

  // ---- WebSocket run endpoint (/term-c)
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

  wssC.on("connection", (ws) => {
    let child = null;
    let workdir = null;

    async function cleanup() {
      try { child?.kill("SIGKILL"); } catch {}
      child = null;
      if (workdir) {
        try { await fs.rm(workdir, { recursive: true, force: true }); } catch {}
        workdir = null;
      }
    }

    ws.on("close", cleanup);

    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }

      // ---------- Kill current run
      if (msg.type === "kill") {
        try { child?.kill("SIGKILL"); } catch {}
        return;
      }

      // ---------- Stdin passthrough
      if (msg.type === "stdin") {
        if (child?.stdin?.writable) { try { child.stdin.write(msg.data); } catch {} }
        return;
      }

      // ---------- Start: compile + run (single WS flow)
      if (msg.type === "start") {
        await cleanup();

        const files = Array.isArray(msg.files) ? msg.files : [];
        if (!files.length) {
          // Provide a trivial main if none sent
          files.push({ path: "main.c", content: "#include <stdio.h>\nint main(){puts(\"hi\");}\n" });
        }

        // Prepare workspace
        const id = uid();
        workdir = path.join(JOB_ROOT, "c", id);
        await fs.mkdir(workdir, { recursive: true });

        for (const f of files) {
          const rel = String(f?.path || "main.c").replace(/^\/*/, "");
          const full = path.join(workdir, rel);
          await fs.mkdir(path.dirname(full), { recursive: true });
          await fs.writeFile(full, f?.content ?? "", "utf8");
        }

        // ---- Compile (stream compile log to client)
        const cd = "cd '" + workdir.replace(/'/g, "'\\''") + "'";
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
if (( \${#uniq[@]} == 0 )); then echo "No .c files found"; exit 1; fi

printf '$ gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main'
for f in "\${uniq[@]}"; do printf " %q" "$f"; done
printf ' -lm\\n'

gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main "\${uniq[@]}" -lm
`.trim();

        const compile = spawn("bash", ["-lc", bash + " 2>&1"]);
        let clog = "";

        compile.stdout.on("data", d => {
          const s = d.toString();
          clog += s;
          try { ws.send(JSON.stringify({ type: "stdout", data: s })); } catch {}
        });
        compile.stderr.on("data", d => {
          const s = d.toString();
          clog += s;
          try { ws.send(JSON.stringify({ type: "stderr", data: s })); } catch {}
        });

        compile.on("close", async (code) => {
          const diags = parseGcc(clog);
          try { ws.send(JSON.stringify({ type: "diagnostics", data: diags })); } catch {}

          if (code !== 0 || diags.some(d => d.severity === "error" || /fatal/i.test(d.message))) {
            try { ws.send(JSON.stringify({ type: "exit", code: code || 1 })); } catch {}
            await cleanup();
            return;
          }

          // ---- Run with LD_PRELOAD (libstdin_notify + libstdbuf when available)
          const notifyLibAbs = path.resolve(process.cwd(), "libstdin_notify.so");
          const notifyLibQ = notifyLibAbs.replace(/'/g, "'\\''");

          async function firstExisting(paths) {
            for (const p of paths) { try { await fs.access(p); return p; } catch {} }
            return "";
          }
          const stdbufFound = await firstExisting([
            "/usr/lib/coreutils/libstdbuf.so",
            "/usr/lib/x86_64-linux-gnu/coreutils/libstdbuf.so",
            "/usr/lib/x86_64-linux-gnu/libstdbuf.so",
            "/lib/x86_64-linux-gnu/libstdbuf.so",
          ]);
          const stdbufQ = stdbufFound ? stdbufFound.replace(/'/g, "'\\''") : "";

          const preload = stdbufQ ? `${stdbufQ}:${notifyLibQ}` : `${notifyLibQ}`;
          const cmd = [
            `export LD_PRELOAD='${preload}'`,
            stdbufQ ? `export STDBUF='o0:eL'` : `:`,
            `echo "[dbg] stdbufLib=${stdbufFound || "(none)"} notifyLib=${notifyLibAbs} LD_PRELOAD=$LD_PRELOAD STDBUF=$STDBUF" 1>&2`,
            `ls -l '${notifyLibQ}' 1>&2 || true`,
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

          child.on("close", async (ecode) => {
            try { ws.send(JSON.stringify({ type: "exit", code: ecode })); } catch {}
            await cleanup();
          });
        });

        return;
      }
    });
  });

  console.log("[polycode] C plugin loaded (WS: /term-c, single-WS compile+run)");
}

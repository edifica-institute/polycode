// java-runner/c-plugin.js — C runner (ESM)
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const JOB_ROOT = process.env.JOB_ROOT || '/tmp/polycode';
const SESSIONS = new Map();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Parse gcc/clang single-line diagnostics for Monaco markers */
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
  // CORS + JSON for /api/c
  app.use('/api/c', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/api/c', express.json({ limit: '2mb' }));

  // ---- Compile: POST /api/c/prepare ----
  app.post('/api/c/prepare', async (req, res) => {
    try {
      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      if (!files.length) return res.status(400).json({ error: 'No files' });

      const id = uid();
      const dir = path.join(JOB_ROOT, 'c', id);
      await fs.mkdir(dir, { recursive: true });

      // Write incoming files (usually just main.c)
      for (const f of files) {
        const rel = (f?.path || 'main.c').replace(/^\/*/, '');
        const full = path.join(dir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f?.content ?? '', 'utf8');
      }

      // Build a newline bash script. IMPORTANT: we dedupe *.c files.
      const cd = dir.replace(/'/g, "'\\''");
      const script = `
set -euo pipefail
cd '${cd}'
shopt -s nullglob globstar

# Gather raw matches then dedupe to avoid "./main.c" appearing twice
raw=( ./**/*.c ./*.c )
declare -A seen
uniq=()
for f in "\${raw[@]}"; do
  [[ -e "$f" ]] || continue
  [[ -n "\${seen[$f]:-}" ]] && continue
  seen[$f]=1
  uniq+=("$f")
done

if (( \${#uniq[@]} == 0 )); then
  echo 'No .c files found'
  exit 1
fi

# Pretty-print the exact gcc command we’ll run
printf '$ gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main'
for f in "\${uniq[@]}"; do printf ' %q' "$f"; done
printf ' -lm\\n'

# Compile & link in one shot
gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main "\${uniq[@]}" -lm
`;

      const proc = spawn('bash', ['-lc', script + ' 2>&1']);
      let log = '';
      proc.stdout.on('data', d => { log += d.toString(); });
      proc.stderr.on('data', d => { log += d.toString(); });

      proc.on('close', (code) => {
        const diagnostics = parseGcc(log);
        const ok = code === 0 && !diagnostics.some(d => d.severity === 'error' || /fatal/i.test(d.message));

        const token = uid();

        // Only use LD_PRELOAD if the .so is present (won’t error if missing)
        const preload = path.join(process.cwd(), 'libstdin_notify.so').replace(/'/g, "'\\''");
        const cmd =
          `PRELOAD='${preload}'; ` +
          `[[ -f "$PRELOAD" ]] && export LD_PRELOAD="$PRELOAD"; ` +
          `timeout 10s stdbuf -oL -eL ./main`;

        SESSIONS.set(token, { cwd: dir, cmd });
        res.json({ token, ok, diagnostics, compileLog: log });
      });
    } catch (e) {
      console.error('[c-plugin] prepare error', e);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ---- Run: JSON WS (noServer) on /term-c ----
  const wssC = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      if (pathname !== '/term-c') return;
      wssC.handleUpgrade(req, socket, head, (ws) => {
        wssC.emit('connection', ws, req);
      });
    } catch {
      try { socket.destroy(); } catch {}
    }
  });

  wssC.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token') || url.searchParams.get('t');
    const sess = token && SESSIONS.get(token);
    if (!sess) { try { ws.close(); } catch {} return; }

    const child = spawn('bash', ['-lc', sess.cmd], { cwd: sess.cwd });

    child.stdout.on('data', d => {
      try { ws.send(JSON.stringify({ type: 'stdout', data: d.toString() })); } catch {}
    });

    let errBuf = '';
    child.stderr.on('data', d => {
      errBuf += d.toString();
      let i;
      while ((i = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, i); errBuf = errBuf.slice(i + 1);
        if (line === '[[CTRL]]:stdin_req') {
          try { ws.send(JSON.stringify({ type: 'stdin_req' })); } catch {}
        } else if (line) {
          try { ws.send(JSON.stringify({ type: 'stderr', data: line + '\n' })); } catch {}
        }
      }
    });

    child.on('close', code => {
      try { ws.send(JSON.stringify({ type: 'exit', code })); } catch {}
      try { ws.close(); } catch {}
    });

    ws.on('message', raw => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'stdin') { try { child.stdin.write(m.data); } catch {} }
      if (m.type === 'kill')  { try { child.kill('SIGKILL'); } catch {} }
    });

    ws.on('close', () => { try { child.kill('SIGKILL'); } catch {} });
  });

  console.log('[polycode] C plugin loaded (HTTP: /api/c/prepare, WS: /term-c)');
}

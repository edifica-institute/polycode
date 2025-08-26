// java-runner/c-plugin.js  (ESM, no extra deps)
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const JOB_ROOT = process.env.JOB_ROOT || '/tmp/polycode';
const SESSIONS = new Map();

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
  // CORS + JSON only for /api/c
  app.use('/api/c', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/api/c', express.json({ limit: '2mb' }));

  // Compile endpoint
  app.post('/api/c/prepare', async (req, res) => {
    try {
      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      if (!files.length) return res.status(400).json({ error: 'No files' });

      const id = uid();
      const dir = path.join(JOB_ROOT, 'c', id);
      await fs.mkdir(dir, { recursive: true });

      // write sources
      for (const f of files) {
        const rel = (f?.path || 'main.c').replace(/^\/*/, '');
        const full = path.join(dir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f?.content ?? '', 'utf8');
      }

      // compile all .c
     const bash = [
  `cd '${dir.replace(/'/g, "'\\''")}'`,
  `shopt -s nullglob`,
  // collect paths WITHOUT adding quotes into the strings
  `mapfile -t files < <(find . -type f -name '*.c' -print)`,
  `if (( \${#files[@]} )); then gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main "\${files[@]}" -lm; else echo 'No .c files'; false; fi`,
].join(' && ');

      const proc = spawn('bash', ['-lc', `${bash} 2>&1`]);
      let log = '';
      proc.stdout.on('data', d => (log += d.toString()));
      proc.stderr.on('data', d => (log += d.toString()));
      proc.on('close', (code) => {
        const diagnostics = parseGcc(log);
        const ok = code === 0 && !diagnostics.some(d => d.severity === 'error' || /fatal/i.test(d.message));
        const token = uid();
        SESSIONS.set(token, { cwd: dir, cmd: `timeout 10s ./main` });
        res.json({ token, ok, diagnostics, compileLog: log });
      });
    } catch (e) {
      console.error('[c-plugin] prepare error', e);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // WebSocket endpoint for C runs (separate from Java's `/java`)
  const wssC = new WebSocketServer({ server, path: '/term' });
  wssC.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x'); // dummy base to parse
    const token = url.searchParams.get('token') || url.searchParams.get('t');
    const sess = token && SESSIONS.get(token);
    if (!sess) { try { ws.close(); } catch {} return; }

    const child = spawn('bash', ['-lc', sess.cmd], { cwd: sess.cwd });
    child.stdout.on('data', d => { try { ws.send(d); } catch {} });
    child.stderr.on('data', d => { try { ws.send(d); } catch {} });
    ws.on('message', m => { try { child.stdin.write(m); } catch {} });
    child.on('close', () => { try { ws.close(); } catch {} });
    ws.on('close', () => { try { child.kill('SIGKILL'); } catch {} });
  });

  console.log('[polycode] C plugin loaded (HTTP: /api/c/prepare, WS: /term)');
}

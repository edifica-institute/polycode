// java-runner/c-plugin.js — ESM, JSON WS, noServer (doesn't touch /java)
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const JOB_ROOT = process.env.JOB_ROOT || '/tmp/polycode';
const SESSIONS = new Map();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function parseGcc(out) {
  const lines = out.split(/\r?\n/);
  const markers = [];
  for (const line of lines) {
    const m = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i);
    if (m) markers.push({
      file: m[1],
      line: Number(m[2]) || 1,
      column: Number(m[3]) || 1,
      message: m[5],
      severity: m[4].toLowerCase(),
    });
  }
  return markers;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout.on('data', d => out += d.toString());
    p.stderr.on('data', d => err += d.toString());
    p.on('close', code => resolve({ code, out, err }));
  });
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

  // ---- Compile: POST /api/c/prepare ----
  app.post('/api/c/prepare', async (req, res) => {
    try {
      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      if (!files.length) return res.status(400).json({ error: 'No files' });

      const id  = uid();
      const dir = path.join(JOB_ROOT, 'c', id);
      await fs.mkdir(dir, { recursive: true });

      // Write uploaded files (sanitize relative paths)
      const writtenPaths = [];
      for (const f of files) {
        const rel = String(f?.path || 'main.c')
          .replace(/^\/+/, '')                      // strip leading slashes
          .replace(/(\.\.(\/|\\|$))/g, '');         // drop any parent traversals
        const full = path.join(dir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f?.content ?? '', 'utf8');
        writtenPaths.push(rel);
      }

      // Build a **unique** list of .c sources strictly from the upload
      const cSources = [...new Set(
        writtenPaths.filter(p => /\.c$/i.test(p))
      )];

      let compileLog = '';
      const logCmd = (cmd, args) => { compileLog += `$ ${cmd} ${args.join(' ')}\n`; };

      if (cSources.length === 0) {
        return res.json({ ok: false, diagnostics: [], compileLog: 'No .c files were provided.\n' });
      }

      // Compile each translation unit to an object file
      const objs = [];
      for (const src of cSources) {
        const obj = src.replace(/\.c$/i, '.o');
        const args = ['-std=c17', '-O2', '-pipe', '-Wall', '-Wextra', '-Wno-unused-result', '-c', src, '-o', obj];
        logCmd('gcc', args);
        const { code, out, err } = await run('gcc', args, { cwd: dir });
        compileLog += out + err;
        if (code !== 0) {
          const diagnostics = parseGcc(compileLog);
          return res.json({ ok: false, diagnostics, compileLog });
        }
        objs.push(obj);
      }

      // Link once (objects only)
      const linkArgs = ['-o', 'main', ...objs, '-lm'];
      logCmd('gcc', linkArgs);
      const linkRes = await run('gcc', linkArgs, { cwd: dir });
      compileLog += linkRes.out + linkRes.err;

      const diagnostics = parseGcc(compileLog);
      const ok = linkRes.code === 0 && !diagnostics.some(d => d.severity === 'error' || /fatal/i.test(d.message));

      if (!ok) {
        return res.json({ ok: false, diagnostics, compileLog });
      }

      // Prepare session for interactive run
      const token   = uid();
      const preload = path.join(process.cwd(), 'libstdin_notify.so');
      // Keep your existing bash chain for timeout/stdout line buffering + stdin notifications
      const cmd = "LD_PRELOAD='" + preload.replace(/'/g, "'\\''") + "' timeout 10s stdbuf -oL -eL ./main";
      SESSIONS.set(token, { cwd: dir, cmd });

      res.json({ token, ok: true, diagnostics, compileLog });
    } catch (e) {
      console.error('[c-plugin] prepare error', e);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ---- Run: JSON WS via noServer so we NEVER intercept /java ----
  const wssC = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      if (pathname !== '/term') return; // only claim /term
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

  console.log('[polycode] C plugin loaded (HTTP: /api/c/prepare, WS: /term)');
}

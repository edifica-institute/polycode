// c-plugin.js
import { WebSocketServer } from 'ws';
import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

function lineSplitStream(cb) {
  let buf = '';
  return chunk => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      cb(line);
    }
  };
}

async function writeFiles(base, files) {
  await fs.ensureDir(base);
  for (const f of files || []) {
    const p = path.join(base, f.path.replace(/^\/+/, ''));
    await fs.ensureDir(path.dirname(p));
    await fs.writeFile(p, f.content ?? '', 'utf8');
  }
}

async function runCompileAndExecute(ws, msg) {
  const startTs = Date.now();

  // pick tmpfs if available (fast)
  const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
  const work = await fs.mkdtemp(path.join(base, 'poly-c-'));
  const mainOut = path.join(work, 'a.out');

  let child = null;
  let closed = false;

  const hardLimitMs = Math.min(Number(msg?.timeLimitMs || process.env.C_TIMEOUT_MS || 15000), 600000);
  const inputWaitMs = Math.min(Number(msg?.inputWaitMs || process.env.INPUT_WAIT_MS || 300000), 3600000);

  function send(json) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(json)); } catch {}
    }
  }

  function cleanup() {
    if (child) { try { child.kill('SIGKILL'); } catch {} child = null; }
    fs.remove(work).catch(() => {});
  }

  ws.on('close', () => { closed = true; cleanup(); });
  ws.on('error', () => { cleanup(); });

  // 1) write files
  try {
    await writeFiles(work, msg.files);
  } catch (e) {
    send({ type:'stderr', data: `write error: ${String(e)}\n` });
    send({ type:'exit', code: 1, metrics: { totalMs: Date.now() - startTs, compileMs: 0, startMs: 0, execMs: 0 } });
    cleanup();
    return;
  }

  // figure out main file (default: main.c)
  const mainFile = (msg.files?.find(f => /(^|\/)main\.c$/.test(f.path))?.path) || 'main.c';

  // 2) compile
  let tCompileStart = Date.now();
  let tRunStart = 0;

  const gcc = spawn('bash', ['-lc',
    // use -pipe, unbuffered prog later via stdbuf; no -static to keep image small
    `set -e
     cd ${work@Q}
     gcc -std=c17 -O2 -pipe -Wall -Wextra -o a.out ${mainFile@Q}
    `
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  gcc.stdout.on('data', d => send({ type:'stdout', data: d.toString() }));
  gcc.stderr.on('data', d => send({ type:'stderr', data: d.toString() }));

  gcc.on('close', code => {
    const tCompileEnd = Date.now();
    if (code !== 0) {
      send({ type:'diagnostics', data: [] }); // placeholder if you ever map gcc errors to Monaco markers
      send({ type:'exit', code, metrics:{
        compileMs: tCompileEnd - tCompileStart, startMs: 0, execMs: 0, totalMs: tCompileEnd - startTs
      }});
      cleanup();
      return;
    }

    // 3) run
    if (closed) { cleanup(); return; }

    // Use LD_PRELOAD hook to detect blocking reads and notify the UI
    const env = {
      PATH: process.env.PATH,
      HOME: '/tmp',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      LD_PRELOAD: '/app/libstdin_notify.so',   // built in your Dockerfile
    };

    // stdbuf => unbuffered stdout/stderr so prompts show immediately
    child = spawn('bash', ['-lc', `cd ${work@Q}; stdbuf -o0 -e0 ./a.out`], {
      env, stdio: ['pipe', 'pipe', 'pipe']
    });

    tRunStart = Date.now();

    let hardTimer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} }, hardLimitMs);
    let inputTimer = null;
    const armInput = () => {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        send({ type:'stderr', data: 'Input wait timed out.\n' });
        try { child?.kill('SIGKILL'); } catch {}
      }, inputWaitMs);
    };

    // stdout
    child.stdout.on('data', d => send({ type:'stdout', data: d.toString() }));

    // stderr: detect control lines from libstdin_notify.so
    const onErrLine = line => {
      if (line === '[[CTRL]]:stdin_req') {
        clearTimeout(hardTimer);
        armInput();
        send({ type:'stdin_req' });
      } else if (line) {
        send({ type:'stderr', data: line + '\n' });
      }
    };
    child.stderr.on('data', lineSplitStream(onErrLine));

    // accept stdin from client
    function onMsg(raw) {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'stdin' && child?.stdin?.writable) {
        // when user provides input, re-arm hard limit and cancel input timer
        clearTimeout(inputTimer);
        hardTimer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} }, hardLimitMs);
        try { child.stdin.write(m.data); } catch {}
      } else if (m.type === 'kill') {
        try { child?.kill('SIGKILL'); } catch {}
      } else if (m.type === 'ping') {
        send({ type:'pong' });
      }
    }
    ws.on('message', onMsg);

    child.on('close', code2 => {
      clearTimeout(hardTimer);
      clearTimeout(inputTimer);
      const tEnd = Date.now();
      send({ type:'exit', code: code2, metrics:{
        compileMs: tCompileEnd - tCompileStart,
        startMs:   tRunStart - tCompileEnd,
        execMs:    tEnd - tRunStart,
        totalMs:   tEnd - startTs
      }});
      cleanup();
    });
  });
}

export function register(app, { server }) {
  // small HTTP helper to keep your existing /api/c/prepare endpoint alive (optional)
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));
  router.post('/prepare', async (req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });
  app.use('/api/c', router);

  // WebSocket runner
  const wss = new WebSocketServer({
    server,
    path: '/term-c',
    // Disable compression to avoid Cloudflare issues; we'll keep frames tiny anyway.
    perMessageDeflate: false,
    // Let proxies pass through
    clientTracking: true,
  });

  // Heartbeats so Cloudflare doesn’t idle the socket
  function heartbeat() { this.isAlive = true; }
  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    console.log('[c-plugin] WS /term-c connected');

    // banner
    try { ws.send(JSON.stringify({ type:'stdout', data: '[c-runner] ready\\n' })); } catch {}

    ws.on('message', async raw => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }

      if (msg.type === 'start') {
        console.log('[c-plugin] start received with', (msg.files||[]).length, 'file(s)');
        try {
          await runCompileAndExecute(ws, msg);
        } catch (e) {
          try { ws.send(JSON.stringify({ type:'stderr', data: `internal error: ${String(e)}\\n` })); } catch {}
          try { ws.send(JSON.stringify({ type:'exit', code: 1, metrics:{ totalMs: 0, compileMs: 0, startMs: 0, execMs: 0 } })); } catch {}
        }
      } else if (msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type:'pong' })); } catch {}
      }
    });

    ws.on('close', (code, reason) => {
      console.log('[c-plugin] WS close', code, reason?.toString?.() || '');
    });
    ws.on('error', (err) => console.log('[c-plugin] WS error', err?.message || err));
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 15000);

  wss.on('close', () => clearInterval(interval));

  console.log('[polycode] C plugin loaded (HTTP: /api/c/prepare, WS: /term-c)');
}

export { register as registerC };

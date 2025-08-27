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
  const t0 = Date.now();

  // prefer tmpfs for speed
  const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
  const work = await fs.mkdtemp(path.join(base, 'poly-c-'));
  const exe  = path.join(work, 'a.out');

  let child = null;
  let closed = false;

  const hardLimitMs = Math.min(Number(msg?.timeLimitMs || process.env.C_TIMEOUT_MS || 15000), 600000);
  const inputWaitMs = Math.min(Number(msg?.inputWaitMs || process.env.INPUT_WAIT_MS || 300000), 3600000);

  function send(obj) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch {}
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
    send({ type:'stderr', data:`write error: ${String(e)}\n` });
    send({ type:'exit', code:1, metrics:{ totalMs: Date.now()-t0, compileMs:0, startMs:0, execMs:0 }});
    cleanup();
    return;
  }

  const mainFile = (msg.files?.find(f => /(^|\/)main\.c$/.test(f.path))?.path) || 'main.c';

  // 2) compile
  const tC0 = Date.now();
  const gcc = spawn('bash', ['-lc',
    `set -e
     cd "${work}"
     gcc -std=c17 -O2 -pipe -Wall -Wextra -o a.out "${mainFile}"`
  ], { stdio: ['ignore','pipe','pipe'] });

  gcc.stdout.on('data', d => send({ type:'stdout', data: d.toString() }));
  gcc.stderr.on('data', d => send({ type:'stderr', data: d.toString() }));

  gcc.on('close', code => {
    const tC1 = Date.now();
    if (code !== 0) {
      send({ type:'diagnostics', data: [] });
      send({ type:'exit', code, metrics:{
        compileMs: tC1 - tC0, startMs: 0, execMs: 0, totalMs: tC1 - t0
      }});
      cleanup();
      return;
    }

    if (closed) { cleanup(); return; }

    // 3) run
    const env = {
      PATH: process.env.PATH,
      HOME: '/tmp',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      LD_PRELOAD: '/app/libstdin_notify.so'
    };

    child = spawn('bash', ['-lc', `cd "${work}"; stdbuf -o0 -e0 ./a.out`], {
      env, stdio: ['pipe','pipe','pipe']
    });

    const tR0 = Date.now();

    let hardTimer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} }, hardLimitMs);
    let inputTimer = null;
    const armInputTimer = () => {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        send({ type:'stderr', data:'Input wait timed out.\n' });
        try { child?.kill('SIGKILL'); } catch {}
      }, inputWaitMs);
    };

    child.stdout.on('data', d => send({ type:'stdout', data: d.toString() }));

    const onErrLine = line => {
      if (line === '[[CTRL]]:stdin_req') {
        clearTimeout(hardTimer);
        armInputTimer();
        send({ type:'stdin_req' });
      } else if (line) {
        send({ type:'stderr', data: line + '\n' });
      }
    };
    child.stderr.on('data', lineSplitStream(onErrLine));

    function onClientMsg(raw) {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'stdin' && child?.stdin?.writable) {
        clearTimeout(inputTimer);
        hardTimer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} }, hardLimitMs);
        try { child.stdin.write(m.data); } catch {}
      } else if (m.type === 'kill') {
        try { child?.kill('SIGKILL'); } catch {}
      } else if (m.type === 'ping') {
        send({ type:'pong' });
      }
    }
    ws.on('message', onClientMsg);

    child.on('close', code2 => {
      clearTimeout(hardTimer);
      clearTimeout(inputTimer);
      const tR1 = Date.now();
      send({ type:'exit', code: code2, metrics:{
        compileMs: tC1 - tC0,
        startMs:   tR0 - tC1,
        execMs:    tR1 - tR0,
        totalMs:   tR1 - t0
      }});
      cleanup();
    });
  });
}

export function register(app, { server }) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));
  router.post('/prepare', async (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });
  app.use('/api/c', router);

  const wss = new WebSocketServer({
    server,
    path: '/term-c',
    perMessageDeflate: false,   // important with Cloudflare
    clientTracking: true,
  });

  function heartbeat() { this.isAlive = true; }
  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    console.log('[c-plugin] WS /term-c connected');

    try { ws.send(JSON.stringify({ type:'stdout', data:'[c-runner] ready\n' })); } catch {}

    ws.on('message', async raw => {
      let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === 'start') {
        console.log('[c-plugin] start received with', (msg.files||[]).length, 'file(s)');
        try { await runCompileAndExecute(ws, msg); }
        catch (e) {
          try { ws.send(JSON.stringify({ type:'stderr', data:`internal error: ${String(e)}\n` })); } catch {}
          try { ws.send(JSON.stringify({ type:'exit', code:1, metrics:{ totalMs:0, compileMs:0, startMs:0, execMs:0 } })); } catch {}
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

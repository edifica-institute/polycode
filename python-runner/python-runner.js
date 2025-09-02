// python-runner.js — Python 3 runner with WebSocket control + stdin_req signaling
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const app = express();

// Basic health + root (both 200 OK)
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Be explicit about 0.0.0.0 binding for Render
const PORT = Number(process.env.PORT) || 8082;
const HOST = '0.0.0.0';

// Start HTTP server first
const server = app.listen(PORT, HOST, () => {
  console.log(`Python runner on :${PORT}`);
});

// Attach WebSocket endpoint on /python
const wss = new WebSocketServer({ server, path: '/python' });

// Helper: timers for hard kill and input wait
function armTimer(ms, fn) {
  if (!isFinite(ms) || ms <= 0) return null;
  return setTimeout(() => {
    try { fn(); } catch {}
  }, ms);
}

wss.on('connection', (ws, req) => {
  console.log('WS connect', { ip: req.socket?.remoteAddress, ua: req.headers['user-agent'] });

  let proc = null;
  let workdir = null;
  let closed = false;

  let hardTimer = null;
  let inputTimer = null;
  let hardLimitMs = Math.min(Number(process.env.PY_TIMEOUT_MS || 15000), 600000); // cap at 10 min
  let inputWaitMs = Math.min(Number(process.env.INPUT_WAIT_MS || 300000), 3600000); // cap at 60 min

  async function cleanup() {
    if (hardTimer) clearTimeout(hardTimer), hardTimer = null;
    if (inputTimer) clearTimeout(inputTimer), inputTimer = null;
    try { proc?.kill('SIGKILL'); } catch {}
    proc = null;
    if (workdir) {
      try { await fs.remove(workdir); } catch {}
      workdir = null;
    }
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    // heartbeat
    if (msg.type === 'ping') {
      try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
      return;
    }

    if (msg.type === 'kill') {
      try { proc?.kill('SIGKILL'); } catch {}
      return;
    }

    if (msg.type === 'stdin') {
  if (proc?.stdin?.writable) {
    try { proc.stdin.write(String(msg.data ?? '')); } catch {}
  }
  // User provided input → pause "input wait" timer, re-arm hard timer
  try { if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; } } catch {}
  try { if (hardTimer) { clearTimeout(hardTimer); } } catch {}
  hardTimer = armTimer(hardLimitMs, () => { try { proc?.kill('SIGKILL'); } catch {} });
  return;
}


    if (msg.type === 'run') {
      await cleanup();

      const code = String(msg.code ?? '');
      const args = Array.isArray(msg.args) ? msg.args.map(String) : [];

      hardLimitMs = Math.min(Number(msg.timeLimitMs || process.env.PY_TIMEOUT_MS || 15000), 600000);
      inputWaitMs = Math.min(Number(msg.inputWaitMs || process.env.INPUT_WAIT_MS || 300000), 3600000);

      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polypy-'));
      const userFile = path.join(workdir, 'main.py');
      await fs.writeFile(userFile, code, 'utf8');

      // Wrapper to signal stdin requests via stderr control line
      const runnerSrc = `
import sys, runpy, builtins
def _pc_input(prompt=''):
    try:
        sys.stderr.write('[[CTRL]]:stdin_req\\n'); sys.stderr.flush()
    except: pass
    if prompt:
        try:
            sys.stdout.write(str(prompt)); sys.stdout.flush()
        except: pass
    line = sys.stdin.readline()
    if not line:
        return ''
    return line.rstrip('\\r\\n')
builtins.input = _pc_input
runpy.run_path('main.py', run_name='__main__')
      `.trim();

      const runnerFile = path.join(workdir, 'pc_runner.py');
      await fs.writeFile(runnerFile, runnerSrc, 'utf8');

      const t0 = Date.now();
      try {
        // -u: unbuffered stdio so prompts show immediately
        proc = spawn('python3', ['-u', runnerFile, ...args], { cwd: workdir });
      } catch (e) {
        try { ws.send(JSON.stringify({ type: 'stderr', data: `spawn error: ${e?.message || e}\n` })); } catch {}
        try { ws.send(JSON.stringify({ type: 'exit', code: 1, metrics: { execMs: 0, totalMs: 0 } })); } catch {}
        await cleanup();
        return;
      }

      // Timers
      if (hardTimer) clearTimeout(hardTimer);
      hardTimer = armTimer(hardLimitMs, () => { try { proc?.kill('SIGKILL'); } catch {} });
      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = armTimer(inputWaitMs, () => {
        try { ws.send(JSON.stringify({ type: 'stderr', data: 'Input wait timed out.\n' })); } catch {}
        try { proc?.kill('SIGKILL'); } catch {}
      });

      // Streams
      proc.stdout.on('data', (d) => {
        try { ws.send(JSON.stringify({ type: 'stdout', data: d.toString() })); } catch {}
      });

      let stderrBuf = '';
      proc.stderr.on('data', (d) => {
        const s = d.toString();
        stderrBuf += s;
        const lines = s.split(/\r?\n/);
        for (const line of lines) {
          if (!line) continue;
        if (/\[\[CTRL\]\]:stdin_req/.test(line)) {
  // Blocked on input → pause hard timer, arm input-wait timer
  try { if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; } } catch {}
  try { if (inputTimer) { clearTimeout(inputTimer); } } catch {}
  inputTimer = armTimer(inputWaitMs, () => {
    try { ws.send(JSON.stringify({ type: 'stderr', data: 'Input wait timed out.\n' })); } catch {}
    try { proc?.kill('SIGKILL'); } catch {}
  });
  try { ws.send(JSON.stringify({ type: 'stdin_req' })); } catch {}
  continue;
}

          try { ws.send(JSON.stringify({ type: 'stderr', data: line + '\n' })); } catch {}
        }
      });

      proc.on('close', (code) => {
        const t1 = Date.now();
        try {
          ws.send(JSON.stringify({
            type: 'exit',
            code,
            metrics: { compileMs: 0, startMs: 0, execMs: (t1 - t0), totalMs: (t1 - t0) }
          }));
        } catch {}
        cleanup();
      });

      return;
    }
  });

  ws.on('close', async () => {
    closed = true;
    await cleanup();
    console.log('WS close');
  });

  ws.on('error', (e) => {
    console.warn('WS error', e?.message || e);
  });
});

// python-runner.js — Python 3 runner with WebSocket control, stdin_req signaling,
// and inline Matplotlib image streaming (plt.show() => <img> over WS).

import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

// --- Matplotlib + atexit bootstrap (headless) ---
// - Forces Agg backend
// - Replaces plt.show() to save all open figures and print a sentinel line
// - Also saves any remaining figures at process exit
const PY_BOOTSTRAP = `
import os, sys, atexit
import matplotlib
matplotlib.use("Agg")
try:
    import matplotlib.pyplot as plt
except Exception:
    plt = None

def _pc_emit_images():
    if not plt:
        return
    try:
        tmpdir = os.environ.get("POLY_TMP", ".")
        # Save all open figures as numbered PNGs
        for i, num in enumerate(plt.get_fignums(), start=1):
            fig = plt.figure(num)
            path = os.path.join(tmpdir, f"plot_{i}.png")
            fig.savefig(path, bbox_inches='tight')
            # print a sentinel on stdout; the Node side will pick it up
            print(f"__POLY_IMG__:{path}", flush=True)
        plt.close('all')
    except Exception as e:
        print(f"[polycode image export error] {e}", file=sys.stderr, flush=True)

if plt:
    def _pc_show(*args, **kwargs):
        _pc_emit_images()
    plt.show = _pc_show
    atexit.register(_pc_emit_images)
`.trim();

// --- input() override that notifies browser to show input row ---
const PY_INPUT_PATCH = `
import sys, builtins
def _pc_input(prompt=''):
    try:
        sys.stderr.write('[[CTRL]]:stdin_req\\n'); sys.stderr.flush()
    except: 
        pass
    if prompt:
        try:
            sys.stdout.write(str(prompt)); sys.stdout.flush()
        except:
            pass
    line = sys.stdin.readline()
    if not line:
        return ''
    return line.rstrip('\\r\\n')
builtins.input = _pc_input
`.trim();

const app = express();

// Basic health + root (both 200 OK)
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';

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

  let hardTimer = null;
  let inputTimer = null;
  let hardLimitMs = Math.min(Number(process.env.PY_TIMEOUT_MS || 15000), 600000); // cap 10 min
  let inputWaitMs = Math.min(Number(process.env.INPUT_WAIT_MS || 300000), 3600000); // cap 60 min

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

    // Heartbeat
    if (msg.type === 'ping') {
      try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
      return;
    }

    // Client requested kill
    if (msg.type === 'kill') {
      try { proc?.kill('SIGKILL'); } catch {}
      return;
    }

    // Stdin from user
    if (msg.type === 'stdin') {
      if (proc?.stdin?.writable) {
        try { proc.stdin.write(String(msg.data ?? '')); } catch {}
      }
      return;
    }

    if (msg.type === 'run') {
      await cleanup();

      const userCode = String(msg.code ?? '');
      const args = Array.isArray(msg.args) ? msg.args.map(String) : [];

      hardLimitMs = Math.min(Number(msg.timeLimitMs || process.env.PY_TIMEOUT_MS || 15000), 600000);
      inputWaitMs = Math.min(Number(msg.inputWaitMs || process.env.INPUT_WAIT_MS || 300000), 3600000);

      // Workspace
      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polypy-'));
      const mainFile = path.join(workdir, 'main.py');

      // Compose a single script:
      //   [bootstrap for plots] + [input patch] + [user code]
      const combined = PY_BOOTSTRAP + '\n\n' + PY_INPUT_PATCH + '\n\n# --- user code ---\n' + userCode;
      await fs.writeFile(mainFile, combined, 'utf8');

      const t0 = Date.now();

      let stdoutBuf = '';  // to handle partial lines
      let stderrBuf = '';

      try {
        // -u: unbuffered stdio for immediate prompt/print
        proc = spawn('python3', ['-u', mainFile, ...args], {
          cwd: workdir,
          env: { ...process.env, POLY_TMP: workdir }
        });
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

      // stdout: forward lines; intercept image sentinel lines
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', async (chunk) => {
        stdoutBuf += String(chunk);
        let idx;
        while ((idx = stdoutBuf.search(/\r?\n/)) !== -1) {
          const line = stdoutBuf.slice(0, idx);
          stdoutBuf = stdoutBuf.slice(idx + (stdoutBuf[idx] === '\r' && stdoutBuf[idx + 1] === '\n' ? 2 : 1));

          if (line.startsWith('__POLY_IMG__:')) {
            const filePath = line.slice('__POLY_IMG__:'.length).trim();
            try {
              const buf = await fs.readFile(filePath);
              const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
              ws.send(JSON.stringify({ type: 'image', name: path.basename(filePath), data: dataUrl }));
            } catch (e) {
              ws.send(JSON.stringify({ type: 'stderr', data: `[polycode] failed to read image ${filePath}: ${e.message}\n` }));
            }
          } else {
            try { ws.send(JSON.stringify({ type: 'stdout', data: line + '\n' })); } catch {}
          }
        }
      });

      // stderr: pass through; detect control lines for stdin
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => {
        stderrBuf += String(chunk);
        let idx;
        while ((idx = stderrBuf.search(/\r?\n/)) !== -1) {
          const line = stderrBuf.slice(0, idx);
          stderrBuf = stderrBuf.slice(idx + (stderrBuf[idx] === '\r' && stderrBuf[idx + 1] === '\n' ? 2 : 1));

          if (line === '[[CTRL]]:stdin_req') {
            try { ws.send(JSON.stringify({ type: 'stdin_req' })); } catch {}
          } else {
            try { ws.send(JSON.stringify({ type: 'stderr', data: line + '\n' })); } catch {}
          }
        }
      });

      proc.on('close', async (code) => {
        // Flush any trailing partial lines
        if (stdoutBuf) {
          try { ws.send(JSON.stringify({ type: 'stdout', data: stdoutBuf })); } catch {}
          stdoutBuf = '';
        }
        if (stderrBuf) {
          try { ws.send(JSON.stringify({ type: 'stderr', data: stderrBuf })); } catch {}
          stderrBuf = '';
        }

        const t1 = Date.now();
        try {
          ws.send(JSON.stringify({
            type: 'exit',
            code: Number.isFinite(code) ? Number(code) : 1,
            metrics: { compileMs: 0, startMs: 0, execMs: (t1 - t0), totalMs: (t1 - t0) }
          }));
        } catch {}

        // Best-effort cleanup
        try {
          await fs.remove(workdir);
        } catch {}
        workdir = null;
        proc = null;

        if (hardTimer) clearTimeout(hardTimer), hardTimer = null;
        if (inputTimer) clearTimeout(inputTimer), inputTimer = null;
      });

      return;
    }
  });

  ws.on('close', async () => {
    await cleanup();
    console.log('WS close');
  });

  ws.on('error', (e) => {
    console.warn('WS error', e?.message || e);
  });
});

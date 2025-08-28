// python-runner.js — Python 3 runner with WebSocket control, stdin prompts, and Matplotlib image export
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const app = express();

// health
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Render binds PORT
const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`Python runner on :${PORT}`);
});

// WS endpoint
const wss = new WebSocketServer({ server, path: '/python' });

// small helper
function armTimer(ms, fn) {
  if (!isFinite(ms) || ms <= 0) return null;
  return setTimeout(() => { try { fn(); } catch {} }, ms);
}

// Python bootstrap: use Agg and export plots on plt.show()/atexit
const PY_BOOTSTRAP = `
import os, sys, atexit
os.environ.setdefault("MPLBACKEND", "Agg")
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except Exception:
    plt = None

def _pc_emit_images():
    if not plt: return
    try:
        tmpdir = os.environ.get("POLY_TMP", ".")
        for i, num in enumerate(plt.get_fignums(), start=1):
            fig = plt.figure(num)
            pth = os.path.join(tmpdir, f"plot_{i}.png")
            fig.savefig(pth, bbox_inches='tight')
            print(f"__POLY_IMG__:{pth}", flush=True)
        plt.close('all')
    except Exception as e:
        try:
            print(f"[polycode image export error] {e}", file=sys.stderr, flush=True)
        except:
            pass

if 'plt' in globals() and plt is not None:
    def _pc_show(*args, **kwargs):
        _pc_emit_images()
    plt.show = _pc_show
    atexit.register(_pc_emit_images)
`.trim();

wss.on('connection', (ws, req) => {
  console.log('WS connect', { ip: req.socket?.remoteAddress, ua: req.headers['user-agent'] });

  let proc = null;
  let workdir = null;

  let hardTimer = null;
  let inputTimer = null;
  let hardLimitMs = Math.min(Number(process.env.PY_TIMEOUT_MS || 15000), 600000);    // cap 10 min
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

  ws.on('message', async raw => {
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
      return;
    }

    if (msg.type === 'run') {
      await cleanup();

      const userCode = String(msg.code ?? '');
      const args = Array.isArray(msg.args) ? msg.args.map(String) : [];

      hardLimitMs = Math.min(Number(msg.timeLimitMs || process.env.PY_TIMEOUT_MS || 15000), 600000);
      inputWaitMs = Math.min(Number(msg.inputWaitMs || process.env.INPUT_WAIT_MS || 300000), 3600000);

      // temp dir (prefer shm)
      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polypy-'));
      const tmpForImgs = workdir;

      // write main.py with bootstrap + user code so tracebacks point to main.py
      const userFile = path.join(workdir, 'main.py');
      const code = `${PY_BOOTSTRAP}\n# --- user code below ---\n${userCode}`;
      await fs.writeFile(userFile, code, 'utf8');

      // runner: intercept input() and send a control line carrying the prompt (base64)
      // NOTE: the "\\n" is DOUBLE-ESCAPED so Python receives a literal \n in the string.
      const runnerSrc = `
import os, sys, runpy, builtins, base64
os.environ['POLY_TMP'] = ${JSON.stringify(tmpForImgs)}

def _pc_input(prompt=''):
    try:
        b64 = base64.b64encode(str(prompt).encode('utf-8')).decode('ascii')
        sys.stderr.write(f"[[CTRL]]:stdin_req:{b64}\\n"); sys.stderr.flush()
    except:
        pass
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
        proc = spawn('python3', ['-u', runnerFile, ...args], { cwd: workdir });
      } catch (e) {
        try { ws.send(JSON.stringify({ type: 'stderr', data: `spawn error: ${e?.message || e}\n` })); } catch {}
        try { ws.send(JSON.stringify({ type: 'exit', code: 1, metrics: { execMs: 0, totalMs: 0 } })); } catch {}
        await cleanup();
        return;
      }

      // time limits
      if (hardTimer) clearTimeout(hardTimer);
      hardTimer = armTimer(hardLimitMs, () => { try { proc?.kill('SIGKILL'); } catch {} });

      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = armTimer(inputWaitMs, () => {
        try { ws.send(JSON.stringify({ type: 'stderr', data: 'Input wait timed out.\n' })); } catch {}
        try { proc?.kill('SIGKILL'); } catch {}
      });

      // helper: send a PNG as data URL
      async function sendImage(pth) {
        try {
          const buf = await fs.readFile(pth);
          const b64 = `data:image/png;base64,${buf.toString('base64')}`;
          ws.send(JSON.stringify({ type: 'image', name: path.basename(pth), data: b64 }));
        } catch (e) {
          try { ws.send(JSON.stringify({ type: 'stderr', data: `[polycode] image send failed: ${e?.message || e}\n` })); } catch {}
        }
      }

      // stdout: forward text, and intercept __POLY_IMG__: lines
      let stdoutBuf = '';
      proc.stdout.on('data', async d => {
        const s = d.toString();
        stdoutBuf += s;
        let idx;
        while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, idx);
          stdoutBuf = stdoutBuf.slice(idx + 1);
          const m = /^__POLY_IMG__:(.+)$/.exec(line.trim());
          if (m) {
            await sendImage(m[1]);
          } else {
            try { ws.send(JSON.stringify({ type: 'stdout', data: line + '\n' })); } catch {}
          }
        }
      });

      // stderr: forward lines; detect control [[CTRL]]:stdin_req(:b64)?
      proc.stderr.on('data', d => {
        const s = d.toString();
        const lines = s.split(/\r?\n/);
        for (const line of lines) {
          if (!line) continue;
          const m = line.match(/^\[\[CTRL\]\]:stdin_req(?::([A-Za-z0-9+/=]+))?$/);
          if (m) {
            let prompt = '';
            if (m[1]) {
              try { prompt = Buffer.from(m[1], 'base64').toString('utf-8'); } catch {}
            }
            try { ws.send(JSON.stringify({ type: 'stdin_req', prompt })); } catch {}
            continue;
          }
          try { ws.send(JSON.stringify({ type: 'stderr', data: line + '\n' })); } catch {}
        }
      });

      proc.on('close', async code => {
        const t1 = Date.now();

        // last sweep for images created by atexit
        try {
          const files = await fs.readdir(tmpForImgs);
          const pngs = files.filter(f => /^plot_\d+\.png$/.test(f));
          for (const f of pngs) await sendImage(path.join(tmpForImgs, f));
        } catch {}

        try {
          ws.send(JSON.stringify({
            type: 'exit',
            code,
            metrics: { compileMs: 0, startMs: 0, execMs: (t1 - t0), totalMs: (t1 - t0) }
          }));
        } catch {}
        await cleanup();
      });

      return;
    }
  });

  ws.on('close', async () => {
    await cleanup();
    console.log('WS close');
  });

  ws.on('error', e => {
    console.warn('WS error', e?.message || e);
  });
});

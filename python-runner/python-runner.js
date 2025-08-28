// python-runner.js — Python 3 runner with WebSocket control + stdin_req + image export
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

// Render binds PORT; default for local dev
const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`Python runner on :${PORT}`);
});

// Attach WebSocket endpoint on /python
const wss = new WebSocketServer({ server, path: '/python' });

function armTimer(ms, fn) {
  if (!isFinite(ms) || ms <= 0) return null;
  return setTimeout(() => { try { fn(); } catch {} }, ms);
}

// ---- Python bootstrap (separate module so user line numbers stay correct) ----
//  - Force Agg backend
//  - Wrap plt.show() to save figures in POLY_TMP and print control lines to stdout
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

  let hardLimitMs = Math.min(Number(process.env.PY_TIMEOUT_MS || 15000), 600000);   // cap 10 min
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

      // temp workspace (prefer shm)
      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polypy-'));
      const tmpForImgs = workdir;

      // write user program (no bootstrap prepended)
      const userFile = path.join(workdir, 'main.py');
      await fs.writeFile(userFile, userCode, 'utf8');

      // write bootstrap as its own module so we can import it
      const bootstrapFile = path.join(workdir, 'pc_bootstrap.py');
      await fs.writeFile(bootstrapFile, PY_BOOTSTRAP, 'utf8');

      // small runner that:
      //  - sets POLY_TMP
      //  - installs an input() shim that emits [[CTRL]]:stdin_req:<b64>\n on stderr
      //  - imports bootstrap (matplotlib tweaks)
      //  - runpy.run_path('main.py', ...)
      const runnerSrc = `
import os, sys, runpy, builtins, base64
os.environ['POLY_TMP'] = ${JSON.stringify(tmpForImgs)}

# Import bootstrap side-effects (Agg backend, plt.show hook, atexit saver)
import pc_bootstrap  # noqa: F401

def _pc_input(prompt=''):
    # 1) print prompt so it appears in stdout immediately
    try:
        if prompt:
            sys.stdout.write(str(prompt)); sys.stdout.flush()
    except:
        pass

    # 2) send a control line with the prompt so UI can render input row pre-filled
    try:
        b64 = base64.b64encode(str(prompt).encode('utf-8')).decode('ascii')
        sys.stderr.write(f"[[CTRL]]:stdin_req:{b64}\\n"); sys.stderr.flush()
    except:
        pass

    # 3) read a line from stdin
    line = sys.stdin.readline()
    if not line:
        return ''
    return line.rstrip('\\r\\n')

builtins.input = _pc_input

# Run the user's code
runpy.run_path('main.py', run_name='__main__')
      `.trim();

      const runnerFile = path.join(workdir, 'pc_runner.py');
      await fs.writeFile(runnerFile, runnerSrc, 'utf8');

      const t0 = Date.now();
      try {
        // -u: unbuffered stdio so prompts/output stream immediately
        proc = spawn('python3', ['-u', runnerFile, ...args], { cwd: workdir });
      } catch (e) {
        try { ws.send(JSON.stringify({ type: 'stderr', data: `spawn error: ${e?.message || e}\n` })); } catch {}
        try { ws.send(JSON.stringify({ type: 'exit', code: 1, metrics: { execMs: 0, totalMs: 0 } })); } catch {}
        await cleanup();
        return;
      }

      // timers
      if (hardTimer) clearTimeout(hardTimer);
      hardTimer = armTimer(hardLimitMs, () => { try { proc?.kill('SIGKILL'); } catch {} });
      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = armTimer(inputWaitMs, () => {
        try { ws.send(JSON.stringify({ type: 'stderr', data: 'Input wait timed out.\n' })); } catch {}
        try { proc?.kill('SIGKILL'); } catch {}
      });

      // helper: send a PNG file to the client
      async function sendImage(pth) {
        try {
          const data = await fs.readFile(pth);
          const b64  = `data:image/png;base64,${data.toString('base64')}`;
          const name = path.basename(pth);
          ws.send(JSON.stringify({ type: 'image', name, data: b64 }));
        } catch (e) {
          try { ws.send(JSON.stringify({ type: 'stderr', data: `[polycode] image send failed: ${e?.message || e}\n` })); } catch {}
        }
      }

      // stdout: forward lines; catch __POLY_IMG__ control lines
      let stdoutBuffer = '';
      proc.stdout.on('data', async (d) => {
        const s = d.toString();
        stdoutBuffer += s;

        let idx;
        while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
          const line = stdoutBuffer.slice(0, idx);
          stdoutBuffer = stdoutBuffer.slice(idx + 1);

          const m = /^__POLY_IMG__:(.+)$/.exec(line.trim());
          if (m) {
            await sendImage(m[1]);
          } else {
            try { ws.send(JSON.stringify({ type: 'stdout', data: line + '\n' })); } catch {}
          }
        }
      });

      // stderr: forward; detect control message for stdin prompt
      proc.stderr.on('data', (d) => {
        const s = d.toString();
        const lines = s.split(/\r?\n/);
        for (const line of lines) {
          if (!line) continue;

          const mReq = line.match(/^\[\[CTRL\]\]:stdin_req(?::([A-Za-z0-9+/=]+))?$/);
          if (mReq) {
            let prompt = '';
            if (mReq[1]) {
              try { prompt = Buffer.from(mReq[1], 'base64').toString('utf-8'); } catch {}
            }
            try { ws.send(JSON.stringify({ type: 'stdin_req', prompt })); } catch {}
            continue;
          }

          try { ws.send(JSON.stringify({ type: 'stderr', data: line + '\n' })); } catch {}
        }
      });

      // process close
      proc.on('close', async (code) => {
        const t1 = Date.now();

        // one last sweep for any atexit-generated images
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

  ws.on('error', (e) => {
    console.warn('WS error', e?.message || e);
  });
});

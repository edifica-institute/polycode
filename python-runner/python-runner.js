// python-runner.js — Python 3 runner with WebSocket control, input prompts, and image export
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const app = express();

// Health
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`Python runner on :${PORT}`);
});

const wss = new WebSocketServer({ server, path: '/python' });

function armTimer(ms, fn) {
  if (!isFinite(ms) || ms <= 0) return null;
  return setTimeout(() => { try { fn(); } catch {} }, ms);
}

/**
 * sitecustomize.py is auto-imported by Python when on sys.path.
 * We use it to:
 *  - Force matplotlib Agg backend
 *  - Override plt.show() to save images to POLY_TMP and print "__POLY_IMG__:<path>"
 *  - Override builtins.input() to (a) print prompt to stdout, (b) signal UI on stderr with base64 prompt,
 *    then (c) read a line from stdin.
 *
 * NOTE: We do NOT modify the user's main.py, so traceback line numbers stay correct.
 */
const SITE_CUSTOMIZE = `
import os, sys, atexit, base64, builtins

# ----- Matplotlib headless -----
try:
    os.environ.setdefault("MPLBACKEND", "Agg")
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
            # Control line on stdout that the Node side will parse:
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

# ----- Input override -----
def _pc_input(prompt=''):
    # 1) Show prompt to the user on stdout immediately
    try:
        if prompt:
            sys.stdout.write(str(prompt))
            sys.stdout.flush()
    except:
        pass

    # 2) Notify host (stderr control line) including prompt payload
    try:
        b64 = base64.b64encode(str(prompt).encode('utf-8')).decode('ascii')
        sys.stderr.write(f"[[CTRL]]:stdin_req:{b64}\\n")
        sys.stderr.flush()
    except:
        pass

    # 3) Read input
    line = sys.stdin.readline()
    if not line:
        return ''
    return line.rstrip('\\r\\n')

builtins.input = _pc_input
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

      // temp workspace
      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polypy-'));
      const userFile = path.join(workdir, 'main.py');
      const siteFile = path.join(workdir, 'sitecustomize.py');

      await fs.writeFile(userFile, userCode, 'utf8');
      await fs.writeFile(siteFile, SITE_CUSTOMIZE, 'utf8');

      const env = { ...process.env, POLY_TMP: workdir, PYTHONPATH: `${workdir}${path.delimiter}${process.env.PYTHONPATH || ''}` };

      const t0 = Date.now();
      try {
        // -u => unbuffered stdio
        proc = spawn('python3', ['-u', userFile, ...args], { cwd: workdir, env });
      } catch (e) {
        try { ws.send(JSON.stringify({ type: 'stderr', data: `spawn error: ${e?.message || e}\n` })); } catch {}
        try { ws.send(JSON.stringify({ type: 'exit', code: 1, metrics: { execMs: 0, totalMs: 0 } })); } catch {}
        await cleanup();
        return;
      }

      // Hard timeout
      if (hardTimer) clearTimeout(hardTimer);
      hardTimer = armTimer(hardLimitMs, () => { try { proc?.kill('SIGKILL'); } catch {} });

      // Input-wait timeout
      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = armTimer(inputWaitMs, () => {
        try { ws.send(JSON.stringify({ type: 'stderr', data: 'Input wait timed out.\n' })); } catch {}
        try { proc?.kill('SIGKILL'); } catch {}
      });

      // Helper to push a PNG up to the client
      async function sendImage(pth) {
        try {
          const data = await fs.readFile(pth);
          const b64 = `data:image/png;base64,${data.toString('base64')}`;
          const name = path.basename(pth);
          ws.send(JSON.stringify({ type: 'image', name, data: b64 }));
        } catch (e) {
          try { ws.send(JSON.stringify({ type: 'stderr', data: `[polycode] image send failed: ${e?.message || e}\n` })); } catch {}
        }
      }

      // Parse stdout line-by-line to catch __POLY_IMG__ markers
      let stdoutBuffer = '';
      proc.stdout.on('data', async (d) => {
        const s = d.toString();
        stdoutBuffer += s;

        let idx;
        while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
          const line = stdoutBuffer.slice(0, idx);
          stdoutBuffer = stdoutBuffer.slice(idx + 1);

          const mImg = /^__POLY_IMG__:(.+)$/.exec(line.trim());
          if (mImg) {
            await sendImage(mImg[1]);
          } else {
            try { ws.send(JSON.stringify({ type: 'stdout', data: line + '\n' })); } catch {}
          }
        }
      });

      // Stderr — look for control lines & forward the rest
      let stderrBuf = '';
      proc.stderr.on('data', (d) => {
        const s = d.toString();
        stderrBuf += s;

        const lines = s.split(/\r?\n/);
        for (const line of lines) {
          if (!line) continue;

          // Control: [[CTRL]]:stdin_req[:<b64prompt>]
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

      proc.on('close', async (code) => {
        const t1 = Date.now();

        // Sweep any images written in atexit
        try {
          const files = await fs.readdir(workdir);
          const pngs = files.filter(f => /^plot_\d+\.png$/.test(f));
          for (const f of pngs) await sendImage(path.join(workdir, f));
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

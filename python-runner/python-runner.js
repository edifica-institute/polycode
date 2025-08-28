// python-runner.js — Python 3 runner with WebSocket control + stdin_req + image export
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const app = express();

// Health endpoints
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

// --- Matplotlib bootstrap ---
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
        try: print(f"[polycode image export error] {e}", file=sys.stderr, flush=True)
        except: pass

if 'plt' in globals() and plt is not None:
    def _pc_show(*a, **k): _pc_emit_images()
    plt.show = _pc_show
    atexit.register(_pc_emit_images)
`.trim();

wss.on('connection', (ws, req) => {
  console.log('WS connect', { ip: req.socket?.remoteAddress, ua: req.headers['user-agent'] });

  let proc = null, workdir = null;
  let hardTimer = null, inputTimer = null;

  async function cleanup() {
    if (hardTimer) clearTimeout(hardTimer), hardTimer = null;
    if (inputTimer) clearTimeout(inputTimer), inputTimer = null;
    try { proc?.kill('SIGKILL'); } catch {}
    proc = null;
    if (workdir) { try { await fs.remove(workdir); } catch {} workdir = null; }
  }

  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }

    if (msg.type === 'ping') { try { ws.send(JSON.stringify({type:'pong'})); } catch{}; return; }
    if (msg.type === 'kill') { try { proc?.kill('SIGKILL'); } catch {}; return; }

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

      workdir = await fs.mkdtemp(path.join((await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir(), 'polypy-'));
      const tmpForImgs = workdir;
      const userFile   = path.join(workdir, 'main.py');

      // prepend bootstrap
      await fs.writeFile(userFile, `${PY_BOOTSTRAP}\n# --- user code ---\n${userCode}`, 'utf8');

      // wrapper runner
      const runnerSrc = `
import os, sys, runpy, builtins, base64
os.environ['POLY_TMP'] = ${JSON.stringify(tmpForImgs)}

def _pc_input(prompt=''):
    try:
        if prompt:
            sys.stdout.write(str(prompt)); sys.stdout.flush()
        b64 = base64.b64encode(str(prompt).encode()).decode()
        sys.stderr.write(f"[[CTRL]]:stdin_req:{b64}\\n"); sys.stderr.flush()
    except: pass
    line = sys.stdin.readline()
    if not line: return ''
    return line.rstrip('\\r\\n')

builtins.input = _pc_input
runpy.run_path('main.py', run_name='__main__')
      `.trim();
      const runnerFile = path.join(workdir, 'pc_runner.py');
      await fs.writeFile(runnerFile, runnerSrc, 'utf8');

      const t0 = Date.now();
      try { proc = spawn('python3', ['-u', runnerFile, ...args], { cwd: workdir }); }
      catch (e) {
        ws.send(JSON.stringify({ type:'stderr', data:`spawn error: ${e?.message}\n` }));
        ws.send(JSON.stringify({ type:'exit', code:1, metrics:{execMs:0,totalMs:0} }));
        await cleanup(); return;
      }

      hardTimer = armTimer(15000, () => { try { proc?.kill('SIGKILL'); } catch {} });

      // stdout
      let buf = '';
      proc.stdout.on('data', async d => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx); buf = buf.slice(idx+1);
          const m = /^__POLY_IMG__:(.+)$/.exec(line.trim());
          if (m) {
            try {
              const data = await fs.readFile(m[1]);
              ws.send(JSON.stringify({ type:'image', name:path.basename(m[1]), data:`data:image/png;base64,${data.toString('base64')}` }));
            } catch {}
          } else {
            ws.send(JSON.stringify({ type:'stdout', data: line+'\n' }));
          }
        }
      });

      // stderr — send whole block (not per line) so tracebacks stay intact
      proc.stderr.on('data', d => {
        const s = d.toString();
        // detect stdin_req
        const mReq = /^\[\[CTRL\]\]:stdin_req(?::([A-Za-z0-9+/=]+))?$/.exec(s.trim());
        if (mReq) {
          let prompt = ''; if (mReq[1]) try { prompt = Buffer.from(mReq[1], 'base64').toString(); } catch {}
          ws.send(JSON.stringify({ type:'stdin_req', prompt }));
        } else {
          ws.send(JSON.stringify({ type:'stderr', data: s }));
        }
      });

      proc.on('close', async (code) => {
        const t1 = Date.now();
        try { ws.send(JSON.stringify({ type:'exit', code, metrics:{execMs:(t1-t0), totalMs:(t1-t0)} })); } catch {}
        await cleanup();
      });
    }
  });

  ws.on('close', cleanup);
});

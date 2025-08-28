// python-runner.js — Python 3 runner with WebSocket control
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const app = express();
app.get('/health', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 8082;
const server = app.listen(PORT, () => console.log('Python runner on :' + PORT));

// WebSocket endpoint
const wss = new WebSocketServer({ server, path: '/python' });

wss.on('connection', (ws) => {
  let proc = null;
  let workdir = null;
  let closed = false;

  // Timers + limits
  let hardTimer = null;
  let inputTimer = null;
  let hardLimitMs = 15000; // default 15s
  let inputWaitMs = 5 * 60 * 1000; // default 5 min

  function clearTimers() {
    if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
    if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; }
  }
  function armHardKill(ms) {
    if (hardTimer) clearTimeout(hardTimer);
    if (!isFinite(ms)) return;
    hardTimer = setTimeout(() => { try { proc?.kill('SIGKILL'); } catch {} }, ms);
  }
  function armInputKill(ms) {
    if (inputTimer) clearTimeout(inputTimer);
    if (!isFinite(ms)) return;
    inputTimer = setTimeout(() => {
      try { ws.send(JSON.stringify({ type:'stderr', data:'Input wait timed out.\n' })); } catch {}
      try { proc?.kill('SIGKILL'); } catch {}
    }, ms);
  }

  async function cleanup() {
    clearTimers();
    try { proc?.kill('SIGKILL'); } catch {}
    proc = null;
    if (workdir) {
      try { await fs.remove(workdir); } catch {}
      workdir = null;
    }
  }

  ws.on('message', async (raw) => {
    if (closed) return;
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    // Heartbeat
    if (msg.type === 'ping') {
      try { ws.send(JSON.stringify({ type:'pong' })); } catch {}
      return;
    }

    // Kill current run
    if (msg.type === 'kill') {
      try { proc?.kill('SIGKILL'); } catch {}
      return;
    }

    // Stdin
    if (msg.type === 'stdin' && proc?.stdin?.writable) {
      try { proc.stdin.write(msg.data); } catch {}
      return;
    }

    // Run
    if (msg.type === 'run') {
      await cleanup();

      const code = String(msg.code ?? '');
      const args = Array.isArray(msg.args) ? msg.args.map(String) : [];

      hardLimitMs = Math.min(Number(msg.timeLimitMs || process.env.PY_TIMEOUT_MS || 15000), 600000);
      inputWaitMs = Math.min(Number(msg.inputWaitMs || process.env.INPUT_WAIT_MS || 300000), 3600000);

      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polypy-'));
      const file = path.join(workdir, 'main.py');
      await fs.writeFile(file, code, 'utf8');

      // Write a tiny wrapper that signals input requests
const wrapper = `
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
await fs.writeFile(runnerFile, wrapper, 'utf8');

      
      const t0 = Date.now();

      // -u for unbuffered stdio to surface prompts without fflush
      //proc = spawn('python3', ['-u', file, ...args], { cwd: workdir });

      proc = spawn('python3', ['-u', runnerFile, ...args], { cwd: workdir });


      
      let accErr = '';
      let exitSent = false;

      // forward stdout/stderr
      proc.stdout.on('data', (d) => {
        try { ws.send(JSON.stringify({ type:'stdout', data: d.toString() })); } catch {}
      });
      
      
      
    let errBuf = '';
proc.stderr.on('data', (d) => {
  const s = d.toString();
  errBuf += s;

  // Scan for control lines [[CTRL]]:something
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    if (/\[\[CTRL\]\]:stdin_req/.test(line)) {
      try { ws.send(JSON.stringify({ type: 'stdin_req' })); } catch {}
      continue; // do NOT forward the control line to the browser stderr
    }
    // Normal stderr passthrough
    try { ws.send(JSON.stringify({ type: 'stderr', data: line + '\n' })); } catch {}
  }
});




      
      // Basic heuristic: if program reads from input, the browser will show input UI itself.
      // We still enforce an input wait cap to avoid hanging containers.
      armHardKill(hardLimitMs);
      armInputKill(inputWaitMs);

      proc.on('close', (code) => {
        const t1 = Date.now();
        if (!exitSent) {
          try {
            ws.send(JSON.stringify({
              type: 'exit',
              code,
              metrics: { compileMs: 0, startMs: 0, execMs: t1 - t0, totalMs: t1 - t0 }
            }));
          } catch {}
          exitSent = true;
        }
        cleanup();
      });

      return;
    }
  });

  ws.on('close', async () => { closed = true; await cleanup(); });
});

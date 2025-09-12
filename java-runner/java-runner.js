import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import net from 'net';


process.env.DISPLAY = process.env.DISPLAY || ':99';

const app = express();

app.use('/novnc', express.static('/usr/share/novnc'));
app.get('/vnc', (req, res) => {
  // Opens noVNC and points it at our WS proxy on /novnc/ws
  res.redirect('/novnc/vnc.html?autoconnect=true&resize=scale&path=/novnc/ws');
});


app.get('/health', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 8081; // Render sets this (often 10000)
const server = app.listen(PORT, () => console.log('Java runner on :' + PORT));

const wss = new WebSocketServer({ server, path: '/java' });


const vncWss = new WebSocketServer({ server, path: '/novnc/ws' });

vncWss.on('connection', (ws) => {
  // connect to the local VNC server started by entrypoint.sh (x11vnc on :99 → port 5900)
  const sock = net.connect(5900, '127.0.0.1');

  // browser → VNC
  ws.on('message', (data) => {
    sock.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
  });

  // VNC → browser
  sock.on('data', (chunk) => {
    try { ws.send(chunk); } catch {}
  });

  // tidy up on either side closing/erroring
  const cleanup = () => {
    try { sock.destroy(); } catch {}
    try { ws.close(); } catch {}
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
  sock.on('close', cleanup);
  sock.on('error', cleanup);
});






// ---- NEW: shared classpath pieces ----
const CP_SEP = process.platform === 'win32' ? ';' : ':';
const RUNNER_JAR = path.join(process.cwd(), 'runner.jar');
const LIBS_GLOB  = path.join(process.cwd(), 'libs', '*');

wss.on('connection', (ws) => {
  // Per-connection mutable state
  let proc = null;
  let workdir = null;
  let closed = false;

  // Per-run timing + timeout state
  let t0 = 0, t1 = 0, t2 = 0;
  let phase = 'idle';              // 'idle' | 'running' | 'waitingInput'
  let hardTimer = null;
  let inputTimer = null;
  let hardLimitMs = 15000;
  let inputWaitMs = 300000;        // default 5 min

  function clearTimers(){
    if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
    if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; }
  }
  function armHardKill(ms){
    if (hardTimer) clearTimeout(hardTimer);
    if (!isFinite(ms)) return;
    hardTimer = setTimeout(() => { try { proc?.kill('SIGKILL'); } catch {} }, ms);
  }
  function armInputKill(ms){
    if (inputTimer) clearTimeout(inputTimer);
    if (!isFinite(ms)) return;
    inputTimer = setTimeout(() => {
      try { ws.send(JSON.stringify({ type:'stderr', data:'Input wait timed out.\n' })); } catch {}
      try { proc?.kill('SIGKILL'); } catch {}
    }, ms);
  }

  async function cleanup(){
    clearTimers();
    if (proc) { try { proc.kill('SIGKILL'); } catch {} proc = null; }
    if (workdir) { try { await fs.remove(workdir); } catch {} workdir = null; }
    phase = 'idle';
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

    // Stop current run
    if (msg.type === 'kill') {
      try { proc?.kill('SIGKILL'); } catch {}
      return;
    }

    // Send stdin into running process
    if (msg.type === 'stdin' && proc?.stdin?.writable) {
      if (phase === 'waitingInput') {
        phase = 'running';
        if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; }
        // Re-arm the overall hard limit fresh (simple policy)
        armHardKill(hardLimitMs);
      }
      try { proc.stdin.write(msg.data); } catch {}
      return;
    }

    // Run request
    if (msg.type === 'run') {
      await cleanup();

      const cls = (msg.className || 'Main');

      // Limits (bounded)
      hardLimitMs = Math.min(Number(msg.timeLimitMs || process.env.JAVA_TIMEOUT_MS || 15000), 600000); // 10 min cap
      inputWaitMs = Math.min(Number(msg.inputWaitMs || process.env.INPUT_WAIT_MS || 300000), 3600000); // 60 min cap

      // Use tmpfs if available for faster I/O
      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polyjava-'));
      const file = path.join(workdir, cls + '.java');
      await fs.writeFile(file, msg.code, 'utf8');

      t0 = Date.now();

      // ---- compile (NOW with libs on classpath) ----
      const javac = spawn('javac', [
        '-J-Xms16m','-J-Xmx128m',
        '-proc:none','-g:none','-encoding','UTF-8',
        '-cp', `${LIBS_GLOB}${CP_SEP}${workdir}`,     // <<< important
        path.basename(file)
      ], { cwd: workdir });

      let cerr = '';
      javac.stderr.on('data', d => cerr += d.toString());
      javac.on('close', (code) => {
        t1 = Date.now();

        if (code !== 0) {
          ws.send(JSON.stringify({ type:'compileErr', data: cerr }));
          ws.send(JSON.stringify({
            type:'exit', code,
            metrics: { compileMs: t1 - t0, startMs: 0, execMs: 0, totalMs: t1 - t0 }
          }));
          cleanup();
          return;
        }

        // ---- run via launcher.jar (emits [[CTRL]]:stdin_req when blocked on input) ----
        const classpath = `${RUNNER_JAR}${CP_SEP}${LIBS_GLOB}${CP_SEP}${workdir}`;

        const heapMb = Math.max(32, Math.min(Number(msg.heapMb || 128), 512));
        const jvmFlags = [
          `-Xss16m`, `-Xmx${heapMb}m`,
          '-XX:+UseSerialGC',
          '-XX:TieredStopAtLevel=1',
          '-Xshare:auto'
        ];

        const runArgs = Array.isArray(msg.args) ? msg.args : [];

        proc = spawn('java', [
          ...jvmFlags, '-cp', classpath, 'io.polycode.Launch', cls, ...runArgs
        ], { cwd: workdir });

        t2 = Date.now();
        phase = 'running';
        armHardKill(hardLimitMs);

        // stdout → browser
        proc.stdout.on('data', d => {
          try { ws.send(JSON.stringify({ type:'stdout', data: d.toString() })); } catch {}
        });

        // stderr → detect control line OR forward as stderr (line-buffered)
        let errBuf = '';
        proc.stderr.on('data', d => {
          errBuf += d.toString();
          let i;
          while ((i = errBuf.indexOf('\n')) >= 0) {
            const line = errBuf.slice(0, i);
            errBuf = errBuf.slice(i + 1);

            if (line === '[[CTRL]]:stdin_req') {
              // Blocked on input → pause hard timer, arm input-wait timer
              phase = 'waitingInput';
              if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
              armInputKill(inputWaitMs);
              try { ws.send(JSON.stringify({ type:'stdin_req' })); } catch {}
            } else if (line) {
              try { ws.send(JSON.stringify({ type:'stderr', data: line + '\n' })); } catch {}
            }
          }
        });

        // done
        proc.on('close', code => {
          clearTimers();
          const t3 = Date.now();
          try {
            ws.send(JSON.stringify({
              type:'exit', code,
              metrics: {
                compileMs: t1 - t0,
                startMs:   t2 - t1,
                execMs:    t3 - t2,
                totalMs:   t3 - t0
              }
            }));
          } catch {}
          cleanup();
        });
      });

      return;
    }
  });

  ws.on('close', async () => { closed = true; await cleanup(); });
});

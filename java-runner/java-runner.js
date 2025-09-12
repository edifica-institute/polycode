import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import net from 'net';

// Ensure a display is set for Swing/AWT
process.env.DISPLAY = process.env.DISPLAY || ':99';

const app = express();

// Serve noVNC assets and a simple launcher
app.use('/novnc', express.static('/usr/share/novnc'));
app.get('/vnc', (_req, res) => {
  // Open noVNC pointing at our WS proxy below
  res.redirect('/novnc/vnc.html?autoconnect=true&resize=scale&path=/novnc/ws');
});

app.get('/health', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 8081;
const server = app.listen(PORT, () => {
  console.log(`[runner] listening on :${PORT}`);
});

// ---------- VNC WS proxy (browser <-> local x11vnc on 127.0.0.1:5900) ----------
const vncWss = new WebSocketServer({ server, path: '/novnc/ws' });

vncWss.on('connection', (ws) => {
  const sock = net.connect(5900, '127.0.0.1');
  const cleanup = () => { try { sock.destroy(); } catch {} try { ws.close(); } catch {} };

  ws.on('message', (data) => { try { sock.write(Buffer.isBuffer(data) ? data : Buffer.from(data)); } catch {} });
  sock.on('data', (chunk) => { try { ws.send(chunk); } catch {} });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
  sock.on('close', cleanup);
  sock.on('error', cleanup);
});

// ---------- Java code runner over WebSocket (/java) ----------
const wss = new WebSocketServer({ server, path: '/java' });

const CP_SEP = process.platform === 'win32' ? ';' : ':';
const RUNNER_JAR = path.join(process.cwd(), 'runner.jar');
const LIBS_GLOB = path.join(process.cwd(), 'libs', '*'); // javac/java support "dir/*"

wss.on('connection', (ws) => {
  let proc = null;
  let workdir = null;
  let closed = false;

  // Timing + timeout state
  let t0 = 0, t1 = 0, t2 = 0;
  let phase = 'idle'; // 'idle' | 'running' | 'waitingInput'
  let hardTimer = null;
  let inputTimer = null;
  let hardLimitMs = 15000;
  let inputWaitMs = 300000;

  const send = (obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };

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
      send({ type: 'stderr', data: 'Input wait timed out.\n' });
      try { proc?.kill('SIGKILL'); } catch {}
    }, ms);
  }

  async function cleanup() {
    clearTimers();
    if (proc) { try { proc.kill('SIGKILL'); } catch {} proc = null; }
    if (workdir) { try { await fs.remove(workdir); } catch {} workdir = null; }
    phase = 'idle';
  }

  ws.on('message', async (raw) => {
    if (closed) return;
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }

    // Heartbeat
    if (msg.type === 'ping') { send({ type: 'pong' }); return; }

    // Kill current run
    if (msg.type === 'kill') { try { proc?.kill('SIGKILL'); } catch {} return; }

    // Stdin to running process
    if (msg.type === 'stdin' && proc?.stdin?.writable) {
      if (phase === 'waitingInput') {
        phase = 'running';
        if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; }
        armHardKill(hardLimitMs);
      }
      try { proc.stdin.write(msg.data); } catch {}
      return;
    }

    // Compile & run
    if (msg.type === 'run') {
      await cleanup();

      const cls = (msg.className || 'Main');

      // Limits with caps
      hardLimitMs = Math.min(Number(msg.timeLimitMs || process.env.JAVA_TIMEOUT_MS || 15000), 600000); // ≤ 10 min
      inputWaitMs = Math.min(Number(msg.inputWaitMs || process.env.INPUT_WAIT_MS || 300000), 3600000); // ≤ 60 min

      // Fast tmp dir if available
      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polyjava-'));
      const file = path.join(workdir, cls + '.java');
      await fs.writeFile(file, msg.code ?? '', 'utf8');

      t0 = Date.now();
      send({ type: 'status', data: 'compiling' });

      // ---- compile (classpath includes libs and workdir) ----
      const javac = spawn('javac', [
        '-J-Xms16m','-J-Xmx128m',
        '-proc:none','-g:none','-encoding','UTF-8',
        '-cp', `${LIBS_GLOB}${CP_SEP}${workdir}`,
        path.basename(file)
      ], { cwd: workdir });

      let cerr = '';
      javac.stderr.on('data', d => cerr += d.toString());

      javac.on('error', (err) => {
        t1 = Date.now();
        console.error('[runner] javac spawn error:', err);
        send({ type: 'compileErr', data: `javac error: ${err.message}\n` });
        send({ type: 'exit', code: 127, metrics: { compileMs: t1 - t0, startMs: 0, execMs: 0, totalMs: t1 - t0 } });
        cleanup();
      });

      javac.on('close', (code) => {
        t1 = Date.now();
        if (code !== 0) {
          send({ type: 'compileErr', data: cerr || '(no compiler output)\n' });
          send({ type: 'exit', code, metrics: { compileMs: t1 - t0, startMs: 0, execMs: 0, totalMs: t1 - t0 } });
          cleanup();
          return;
        }

        // ---- run via launcher (handles stdin control line) ----
        const classpath = `${RUNNER_JAR}${CP_SEP}${LIBS_GLOB}${CP_SEP}${workdir}`;
        const heapMb = Math.max(32, Math.min(Number(msg.heapMb || 128), 512));
        const jvmFlags = [
          `-Xss16m`, `-Xmx${heapMb}m`,
          '-XX:+UseSerialGC',
          '-XX:TieredStopAtLevel=1',
          '-Xshare:auto'
        ];
        const runArgs = Array.isArray(msg.args) ? msg.args : [];

        send({ type: 'status', data: 'starting-jvm' });
        proc = spawn('java', [
          ...jvmFlags, '-cp', classpath, 'io.polycode.Launch', cls, ...runArgs
        ], { cwd: workdir });

        proc.on('error', (err) => {
          console.error('[runner] java spawn error:', err);
          send({ type: 'stderr', data: `java error: ${err.message}\n` });
          send({
            type: 'exit', code: 127,
            metrics: { compileMs: t1 - t0, startMs: 0, execMs: 0, totalMs: Date.now() - t0 }
          });
          cleanup();
        });

        t2 = Date.now();
        phase = 'running';
        armHardKill(hardLimitMs);
        send({ type: 'status', data: 'running' });

        proc.stdout.on('data', d => send({ type: 'stdout', data: d.toString() }));

        // line-buffer stderr to catch control messages
        let errBuf = '';
        proc.stderr.on('data', d => {
          errBuf += d.toString();
          let i;
          while ((i = errBuf.indexOf('\n')) >= 0) {
            const line = errBuf.slice(0, i);
            errBuf = errBuf.slice(i + 1);

            if (line === '[[CTRL]]:stdin_req') {
              phase = 'waitingInput';
              if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
              armInputKill(inputWaitMs);
              send({ type: 'stdin_req' });
            } else if (line) {
              send({ type: 'stderr', data: line + '\n' });
            }
          }
        });

        proc.on('close', code => {
          clearTimers();
          const t3 = Date.now();
          send({
            type: 'exit', code,
            metrics: {
              compileMs: t1 - t0,
              startMs:   t2 - t1,
              execMs:    t3 - t2,
              totalMs:   t3 - t0
            }
          });
          cleanup();
        });
      });

      return;
    }
  });

  ws.on('close', async () => { closed = true; await cleanup(); });
});

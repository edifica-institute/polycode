import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const app = express();
app.get('/health', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 8081; // Render will set PORT (e.g., 10000)
const server = app.listen(PORT, () => console.log('Java runner on :' + PORT));

const wss = new WebSocketServer({ server, path: '/java' });

wss.on('connection', (ws) => {
  let proc = null, workdir = null, closed = false;

  async function cleanup(){
    if (proc) { try{ proc.kill('SIGKILL'); } catch {} proc = null; }
    if (workdir) { try{ await fs.remove(workdir); } catch {} workdir = null; }
  }

  ws.on('message', async (raw) => {
    if (closed) return;

    // Parse once, then branch on msg.type
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    // ✅ Ping/Pong MUST be inside message handler, after parsing
    if (msg.type === 'ping') {
      try { ws.send(JSON.stringify({ type:'pong' })); } catch {}
      return;
    }

    // Allow client to stop current run
    if (msg.type === 'kill') {
      if (proc) { try { proc.kill('SIGKILL'); } catch {} }
      return;
    }

    if (msg.type === 'run') {
      await cleanup();

      const cls = (msg.className || 'Main');

      // Use tmpfs (/dev/shm) if available
      const base = (await fs.pathExists('/dev/shm')) ? '/dev/shm' : os.tmpdir();
      workdir = await fs.mkdtemp(path.join(base, 'polyjava-'));
      const file = path.join(workdir, cls + '.java');
      await fs.writeFile(file, msg.code, 'utf8');

      const t0 = Date.now();

      // ---- compile ----
      const javac = spawn('javac', [
        '-J-Xms16m','-J-Xmx128m',
        '-proc:none','-g:none','-encoding','UTF-8',
        path.basename(file)
      ], { cwd: workdir });

      let cerr = '';
      javac.stderr.on('data', d => cerr += d.toString());
      javac.on('close', (code) => {
        const t1 = Date.now();

        if (code !== 0) {
          ws.send(JSON.stringify({ type:'compileErr', data: cerr }));
          ws.send(JSON.stringify({
            type:'exit', code,
            metrics: { compileMs: t1 - t0, startMs: 0, execMs: 0, totalMs: t1 - t0 }
          }));
          cleanup();
          return;
        }

        // ---- run via launcher.jar (emits stdin_req on blocking reads) ----
        const timeoutMs = Math.min(Number(msg.timeLimitMs || process.env.JAVA_TIMEOUT_MS || 15000), 60000);
        const cpSep = process.platform === 'win32' ? ';' : ':';
        const runnerJar = path.join(process.cwd(), 'runner.jar');
        const classpath = `${runnerJar}${cpSep}${workdir}`;

        const heapMb = Math.max(32, Math.min(Number(msg.heapMb || 128), 512));
        const jvmFlags = [
          `-Xss16m`, `-Xmx${heapMb}m`,
          '-XX:+UseSerialGC',
          '-XX:TieredStopAtLevel=1',
          '-Xshare:auto'
        ];

        const runArgs = Array.isArray(msg.args) ? msg.args : [];

        const procStart = Date.now();
        proc = spawn('java', [
          ...jvmFlags, '-cp', classpath, 'io.polycode.Launch', cls, ...runArgs
        ], { cwd: workdir });

        const t2 = Date.now();
        const timer = setTimeout(() => { try{ proc.kill('SIGKILL'); }catch{} }, timeoutMs);

        proc.stdout.on('data', d =>
          ws.send(JSON.stringify({ type:'stdout', data: d.toString() }))
        );

        let errBuf = '';
        proc.stderr.on('data', d => {
          errBuf += d.toString();
          let i;
          while ((i = errBuf.indexOf('\n')) >= 0) {
            const line = errBuf.slice(0, i);
            errBuf = errBuf.slice(i + 1);
            if (line === '[[CTRL]]:stdin_req') {
              ws.send(JSON.stringify({ type:'stdin_req' }));
            } else if (line) {
              ws.send(JSON.stringify({ type:'stderr', data: line + '\n' }));
            }
          }
        });

        proc.on('close', code => {
          clearTimeout(timer);
          const t3 = Date.now();
          ws.send(JSON.stringify({
            type:'exit', code,
            metrics: {
              compileMs: t1 - t0,
              startMs:   t2 - t1,
              execMs:    t3 - t2,
              totalMs:   t3 - t0
            }
          }));
          cleanup();
        });
      });
    }

    // browser → child's stdin
    if (msg.type === 'stdin' && proc?.stdin?.writable) {
      proc.stdin.write(msg.data);
    }
  });

  ws.on('close', async () => { closed = true; await cleanup(); });
});

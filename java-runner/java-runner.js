import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const app = express();
app.get('/health', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 8081;
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
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }

    if (msg.type === 'run') {
      await cleanup();

      const cls = (msg.className || 'Main');
      workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'polyjava-'));
      const file = path.join(workdir, cls + '.java');
      await fs.writeFile(file, msg.code, 'utf8');

      // ---- compile ----
      const javac = spawn('javac', [path.basename(file)], { cwd: workdir });
      let cerr = '';
      javac.stderr.on('data', d => cerr += d.toString());
      javac.on('close', (code) => {
        if (code !== 0) {
          ws.send(JSON.stringify({ type:'compileErr', data: cerr }));
          ws.send(JSON.stringify({ type:'exit', code }));
          cleanup();
          return;
        }

        // ---- run via launcher.jar (emits stdin_req on blocking reads) ----
        const timeoutMs = Number(process.env.JAVA_TIMEOUT_MS || 15000);
        const cpSep = process.platform === 'win32' ? ';' : ':';   // Render/Linux → ':'
        const runnerJar = path.join(process.cwd(), 'runner.jar'); // built in Dockerfile
        const classpath = `${runnerJar}${cpSep}${workdir}`;

        proc = spawn('java',
          ['-Xss16m', '-Xmx128m', '-cp', classpath, 'io.polycode.Launch', cls],
          { cwd: workdir }
        );

        const timer = setTimeout(() => { try{ proc.kill('SIGKILL'); }catch{} }, timeoutMs);

        // stdout → browser
        proc.stdout.on('data', d =>
          ws.send(JSON.stringify({ type:'stdout', data: d.toString() }))
        );

        // stderr → detect control line OR forward as stderr (line-buffered)
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

        // done
        proc.on('close', code => {
          clearTimeout(timer);
          ws.send(JSON.stringify({ type:'exit', code }));
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

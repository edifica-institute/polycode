// server/core/term.js (CommonJS)
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { SESSIONS, USE_DOCKER } = require('./utils');

function createTermServer(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/term') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else socket.destroy();
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const sess = SESSIONS.get(token);
    if (!sess) { ws.close(); return; }
    const { jobDir, runCmd, dockerImage } = sess;

    let term;
    const cmd = runCmd || 'echo No runCmd';
    if (USE_DOCKER) {
      // On Render, SANDBOX=local, so this branch won’t run
      const args = ['run','--rm','-i','--network','none','--cpus','1.0','--memory','512m','--pids-limit','256',
        '-v', `${jobDir}:/workspace:rw`, '-w', '/workspace', dockerImage || 'oc-java:17', 'bash','-lc', cmd ];
      term = pty.spawn('docker', args, { cols: 80, rows: 24 });
    } else {
      term = pty.spawn('bash', ['-lc', `cd "${jobDir}"; ${cmd}`], { cols: 80, rows: 24 });
    }

    term.onData(d => { try { ws.send(d); } catch {} });
    ws.on('message', (m) => {
      try {
        const msg = JSON.parse(m.toString());
        if (msg.type === 'stdin') term.write(msg.data);
        if (msg.type === 'resize') term.resize(msg.cols || 80, msg.rows || 24);
      } catch {}
    });
    ws.on('close', () => { try { term.kill(); } catch {} });
  });
}

module.exports = { createTermServer };

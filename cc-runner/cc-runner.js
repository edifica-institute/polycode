import express from "express";
import { WebSocketServer } from "ws";
import * as fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 8083;
const JOB_ROOT = process.env.JOB_ROOT || "/tmp/ccjobs";
const app = express();
app.use(express.json({ limit: "1mb" }));

const SESSIONS = new Map(); // token -> { dir, exePath }

async function ensureDir(p){ await fs.mkdir(p,{recursive:true}); }
function execCapture(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts });
    let out = "", err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", code => resolve({ code, stdout: out, stderr: err }));
  });
}
function parseGcc(out) {
  const ds=[], re=/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i;
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) ds.push({ file:m[1], line:+m[2], column:+m[3], severity:m[4].toLowerCase(), message:m[5] });
  }
  return ds;
}
function detectEntry(files, entry) {
  if (entry) return entry;
  // prefer main.* with int main(..)
  const mainCandidates = files
    .map(f => f.path)
    .filter(p => /(?:^|\/)main\.(c|cc|cpp|cxx|c\+\+)$/i.test(p));
  return mainCandidates[0] || files[0]?.path;
}
function compilerFor(lang, entry) {
  if (lang === "c") return { cc: "gcc", std: "c11" };
  if (lang === "cpp") return { cc: "g++", std: "c++17" };
  // infer from extension
  const isCpp = /\.(cc|cpp|cxx|c\+\+)$/i.test(entry || "");
  return isCpp ? { cc: "g++", std: "c++17" } : { cc: "gcc", std: "c11" };
}
function runWithLimits(cmd, args, cwd) {
  // CPU 10s, ~256MB vmem, 1GB file size; hard timeout 10s
  const bash = `ulimit -t 10 -v 262144 -f 1048576; timeout 10s ${[cmd, ...args].map(a=>`'${a.replace(/'/g,"'\\''")}'`).join(' ')}`;
  return spawn("bash", ["-lc", bash], { cwd });
}

/* ---------- PREPARE: compile C or C++ ---------- */
app.post("/api/cc/prepare", async (req, res) => {
  try {
    const { files = [], lang, entry, std, output = "a.out" } = req.body || {};
    if (!Array.isArray(files) || files.length === 0)
      return res.status(400).json({ error: "No files" });

    const id = nanoid();
    const dir = path.join(JOB_ROOT, id);
    await ensureDir(dir);

    await Promise.all(files.map(async f => {
      const full = path.join(dir, path.normalize(f.path));
      await ensureDir(path.dirname(full));
      await fs.writeFile(full, f.content ?? "", "utf8");
    }));

    const entryFile = detectEntry(files, entry);
    if (!entryFile) return res.status(400).json({ error: "No entry file" });

    const { cc, std: defStd } = compilerFor(lang, entryFile);
    const stdFlag = std ? (cc === "g++" ? `-std=${std}` : `-std=${std}`) : `-std=${defStd}`;

    // collect all .c/.cpp/.cc in the job dir (multi-file projects)
    const srcs = files
      .map(f => f.path)
      .filter(p => /\.(c|cc|cpp|cxx|c\+\+)$/i.test(p))
      .map(p => path.join(dir, p));

    const outPath = path.join(dir, output);
    const args = [ ...srcs, "-O2", stdFlag, "-o", outPath ];

    const comp = await execCapture(cc, args, { cwd: dir });
    const compileLog = comp.stdout + (comp.stderr ? `\n${comp.stderr}` : "");
    const ok = comp.code === 0;

    if (!ok) {
      return res.json({ token: null, ok, compileLog, diagnostics: parseGcc(compileLog) });
    }

    const token = nanoid();
    SESSIONS.set(token, { dir, exePath: outPath, createdAt: Date.now() });
    res.json({ token, ok, compileLog, diagnostics: [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "internal error" });
  }
});

/* ---------- WS: run compiled program ---------- */
const wss = new WebSocketServer({ noServer: true });
const server = app.listen(PORT, () => console.log(`[cc-runner] listening on :${PORT}`));
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/cc") {
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  } else socket.destroy();
});
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  const sess = token && SESSIONS.get(token);
  if (!sess) return ws.close(1008, "invalid token");
  const { dir, exePath } = sess;

  const child = runWithLimits(exePath, [], dir);
  child.stdout.on("data", d => { try { ws.send(d.toString()); } catch {} });
  child.stderr.on("data", d => { try { ws.send(d.toString()); } catch {} });
  child.on("close", (code) => {
    try { ws.send(`\n[process exited with code ${code}]\n`); } catch {}
    try { ws.close(); } catch {}
    cleanup();
  });
  ws.on("message", (m) => {
    try {
      const msg = JSON.parse(m.toString());
      if (msg.type === "stdin") child.stdin.write(msg.data);
    } catch {}
  });
  ws.on("close", () => { try { child.kill("SIGKILL"); } catch {}; cleanup(); });

  function cleanup() {
    try { fssync.rmSync(dir, { recursive: true, force: true }); } catch {}
    SESSIONS.delete(token);
  }
});

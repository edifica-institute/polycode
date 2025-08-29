// cc-runner.js — C & C++ runner with CORS + WebSocket
import express from "express";
import cors from "cors";                  // <= must exist in package.json
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 8083;
const JOB_ROOT = process.env.JOB_ROOT || "/tmp/ccjobs";

const app = express();

// ---- CORS allowlist ----
const ALLOW_ORIGINS = [
 "https://www.polycode.in",
  "https://polycode.in",
  "https://polycode.pages.dev",
  "https://edifica-polycode.pages.dev",
  "https://polycode.cc",
  "http://localhost:3000",   // dev
];


const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / health checks
    if (ALLOW_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Requested-With"],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));  // use SAME options for preflight




app.use(express.json({ limit: "1mb" }));

// ---- Health check ----
app.get("/health", (_, res) => res.json({ ok: true }));

// ---- helpers ----
async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
function parseGcc(out) {
  const lines = out.split(/\r?\n/), ds = [];
  for (const line of lines) {
    const m = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i);
    if (m) ds.push({ file:m[1], line:+m[2], column:+m[3], severity:m[4].toLowerCase(), message:m[5] });
  }
  return ds;
}
function runWithLimits(cmd, args, cwd) {
  // CPU 10s, ~256MB vmem, 1GB file size; hard timeout 30s
  // stdbuf -o0 -e0 => unbuffer stdout/stderr so prompts appear immediately
  const bash = `
    ulimit -t 10 -v 262144 -f 1048576;
    timeout 30s stdbuf -o0 -e0 ${[cmd, ...args].map(a => `'${a.replace(/'/g,"'\\''")}'`).join(' ')}
  `;
  return spawn("bash", ["-lc", bash], { cwd });
}

function compilerFor(lang, entry) {
  if (lang === "c") return { cc: "gcc", std: "-std=c11" };
  if (lang === "cpp") return { cc: "g++", std: "-std=c++17" };
  const isCpp = /\.(cc|cpp|cxx|c\+\+)$/i.test(entry || "");
  return isCpp ? { cc: "g++", std: "-std=c++17" } : { cc: "gcc", std: "-std=c11" };
}

// ---- in-memory sessions ----
const SESSIONS = new Map();

// ---- compile endpoint ----
app.post("/api/cc/prepare", async (req, res) => {
  try {
    const { files = [], lang, entry, output = "a.out" } = req.body || {};
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

    const entryFile = entry || files[0].path;
    const { cc, std } = compilerFor(lang, entryFile);
    const srcs = files.map(f => path.join(dir, f.path));
    const exePath = path.join(dir, output);

    const child = spawn(cc, [...srcs, std, "-O2", "-o", exePath], { cwd: dir });
    let out="", err="";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", (code) => {
      const compileLog = out + (err ? "\n"+err : "");
      if (code !== 0) {
        res.json({ token:null, ok:false, compileLog, diagnostics: parseGcc(compileLog) });
        return;
      }
      const token = nanoid();
      SESSIONS.set(token, { dir, exePath });
      res.json({ token, ok:true, compileLog, diagnostics: [] });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "internal error" });
  }
});

// ---- WebSocket run endpoint ----
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
  child.on("close", code => {
    try { ws.send(`\n[process exited with code ${code}]\n`); } catch {}
    try { ws.close(); } catch {}
    cleanup();
  });

  ws.on("message", m => {
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

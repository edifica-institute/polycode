// cc-runner.js — C & C++ runner with CORS + WebSocket (hardened)
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import crypto from "crypto";

const PORT = process.env.PORT || 8083;
const JOB_ROOT = process.env.JOB_ROOT || "/tmp/ccjobs";

// Limits (env-overridable)
const CC_CPU_SECS = Number(process.env.CC_CPU_SECS || 10);                 // per-process CPU seconds
const CC_VMEM_KB  = Number(process.env.CC_VMEM_KB  || 262144);             // ~256MB
const CC_FSIZE_KB = Number(process.env.CC_FSIZE_KB || 1048576);            // 1GB output cap
const CC_TIMEOUT_S = Number(process.env.CC_TIMEOUT_S || 300);              // hard kill (run)
const CC_COMPILE_TIMEOUT_S = Number(process.env.CC_COMPILE_TIMEOUT_S || 60); // hard kill (compile)
const CC_TOKEN_TTL_MS = Number(process.env.CC_TOKEN_TTL_MS || 5 * 60 * 1000); // unused token TTL

// ----------------------------------------------------------------------------
// Express
// ----------------------------------------------------------------------------
const app = express();

// ---- CORS allowlist ----
const ALLOW_ORIGINS = [
  "https://www.polycode.in",
  "https://polycode.in",
  "https://polycode.pages.dev",
  "https://edifica-polycode.pages.dev",
  "https://polycode.cc",
  "http://localhost:3000", // dev
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
app.options("*", cors(corsOptions)); // preflight with same options

app.use(express.json({ limit: "1mb" }));

// --- Artifacts (images) static route with CORS ---
const PUBLIC_ROOT = "/tmp/polycode-artifacts";
try { fssync.mkdirSync(PUBLIC_ROOT, { recursive: true }); } catch {}
app.use(
  "/artifacts",
  (req, res, next) => {
    const o = req.headers.origin;
    if (!o || ALLOW_ORIGINS.includes(o)) {
      res.setHeader("Access-Control-Allow-Origin", o || "*");
    }
    next();
  },
  express.static(PUBLIC_ROOT, { maxAge: "5m", fallthrough: true })
);

// ---- Health check ----
app.get("/health", (_, res) => res.json({ ok: true }));

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
async function collectImagesFrom(dir, limit = 6, maxBytes = 5 * 1024 * 1024) {
  const allow = new Set([".png", ".bmp", ".ppm"]);
  const names = await fs.readdir(dir);
  const picks = [];

  for (const name of names) {
    const full = path.join(dir, name);
    const st = await fs.stat(full).catch(() => null);
    if (!st || !st.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (!allow.has(ext)) continue;
    if (st.size > maxBytes) continue;
    picks.push({ name, full, mtime: st.mtimeMs });
  }

  picks.sort((a, b) => b.mtime - a.mtime); // newest first
  return picks.slice(0, limit);
}

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

// Guard against ../ traversal; returns absolute path inside root
function safeJoin(root, relPath) {
  const base = path.resolve(root) + path.sep;
  const full = path.resolve(root, relPath);
  if (!full.startsWith(base)) throw new Error("Bad path");
  return full;
}

function parseGcc(out) {
  const lines = out.split(/\r?\n/), ds = [];
  for (const line of lines) {
    const m = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i);
    if (m) ds.push({ file: m[1], line: +m[2], column: +m[3], severity: m[4].toLowerCase(), message: m[5] });
  }
  return ds;
}

// Merge stdout/stderr without duplicating identical blocks
function mergeStreams(a, b) {
  const A = String(a || "").trim();
  const B = String(b || "").trim();
  if (!A) return B;
  if (!B) return A;
  return A === B ? A : (A + "\n" + B);
}

// Run a command with ulimits + hard timeout; unbuffer with stdbuf if available.
// Run a command with ulimits and a PTY (via `script`) so prompts flush.
// We avoid stdbuf (LD_PRELOAD) and pass a single string to `script -c`.
function runWithLimits(cmd, args, cwd, { timeoutSec } = {}) {
  const hardTimeout = Math.max(1, Number(timeoutSec ?? CC_TIMEOUT_S));

  const shQ = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const cmdStr = [cmd, ...args].map(shQ).join(" ");

  // Keep CPU and file-size limits. No VMEM cap (ASan needs big shadow mapping).
  const limits = `ulimit -t ${CC_CPU_SECS}; ulimit -f ${CC_FSIZE_KB};`;

  // Disable echo so user input isn’t printed; restore on exit no matter what.
  const inner = `if command -v stty >/dev/null 2>&1; then stty -echo; trap 'stty echo' EXIT INT TERM HUP; fi; ${cmdStr}; rc=$?; if command -v stty >/dev/null 2>&1; then stty echo; fi; exit $rc`;

  // Prefer a PTY so prompts flush immediately; fall back to plain bash.
  const ptyCmd   = `script -qefc ${shQ(`bash -lc ${shQ(inner)}`)} /dev/null`;
  const fallback = `bash -lc ${shQ(cmdStr)}`;
  const runner   = `if command -v script >/dev/null 2>&1; then ${ptyCmd}; else ${fallback}; fi`;

  const bash = `${limits} ${runner}`;

  // Keep sanitizers happy & output clean
  const env = { ...process.env, LD_PRELOAD: "", TERM: "dumb" };

  const child = spawn("bash", ["-lc", bash], { cwd, env });
  const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, hardTimeout * 1000);
  child.on("close", () => { try { clearTimeout(killer); } catch {} });
  return child;
}





function compilerFor(lang, entry) {
  if (lang === "c")   return { cc: "gcc", std: "-std=c17" };
  if (lang === "cpp") return { cc: "g++", std: "-std=c++20" };
  const isCpp = /\.(cc|cpp|cxx|c\+\+)$/i.test(entry || "");
  return isCpp ? { cc: "g++", std: "-std=c++20" } : { cc: "gcc", std: "-std=c17" };
}

// Make sure root exists
try { fssync.mkdirSync(JOB_ROOT, { recursive: true }); } catch {}

// ----------------------------------------------------------------------------
// In-memory sessions: token → { dir, exePath, tmr? }
// ----------------------------------------------------------------------------
const SESSIONS = new Map();

// ----------------------------------------------------------------------------
// Compile endpoint
// ----------------------------------------------------------------------------
app.post("/api/cc/prepare", async (req, res) => {
  try {
    const { files = [], lang, entry, output = "a.out" } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files" });
    }

    // Create job dir
    const id = nanoid();
    const dir = path.join(JOB_ROOT, id);
    await ensureDir(dir);

    // Write files (safe paths)
    await Promise.all(files.map(async f => {
      if (!f?.path || typeof f.content !== "string") throw new Error("Bad file");
      const full = safeJoin(dir, f.path);
      await ensureDir(path.dirname(full));
      await fs.writeFile(full, f.content, "utf8");
    }));

    // Decide compiler/flags
    const entryFile = entry || files[0].path;
    const { cc, std } = compilerFor(lang, entryFile);
    const srcs   = files.map(f => safeJoin(dir, f.path));
    const exePath = safeJoin(dir, output);

    const isCpp = /\.(cc|cpp|cxx|c\+\+)$/i.test(entryFile) || (lang === "cpp");
    const isC   = /\.c$/i.test(entryFile) || (lang === "c");

    // Pull flags from environment (Dockerfile provides them)
    const envFlagsRaw = (isCpp ? process.env.CXXFLAGS : process.env.CFLAGS) || "";
    const envFlags = envFlagsRaw.trim().split(/\s+/).filter(Boolean);

    // Detect if env already sets some knobs
    const hasOpt    = envFlags.some(f => /^-O\d\b/.test(f));
    const hasWall   = envFlags.includes("-Wall");
    const hasWextra = envFlags.includes("-Wextra");
    const hasFmt2   = envFlags.includes("-Wformat=2");

    // Build compiler argv.
    // Order: sources, standard, minimal defaults, libs, then ENV flags (last wins).
    const args = [
       ...srcs,
       std,
       ...(hasOpt ? [] : ["-O2"]),
       "-D_POSIX_C_SOURCE=200809L",
       ...(hasWall   ? [] : ["-Wall"]),
       ...(hasWextra ? [] : ["-Wextra"]),
       ...(hasFmt2   ? [] : ["-Wformat=2"]),
      // extra beginner-friendly warnings (remain as warnings)
      "-Wuninitialized",
      "-Wmaybe-uninitialized",
      "-Wnull-dereference",
      "-Wreturn-type",
      // keep logs clean & plain (also set in env, harmless to repeat)
      "-fdiagnostics-color=never",
      "-fno-diagnostics-show-caret",
       "-pthread",
       "-o", exePath,
       "-lm",
       ...(isCpp ? ["-lgmp", "-lgmpxx"] : ["-lgmp"]),
       ...envFlags, // Dockerfile’s CFLAGS/CXXFLAGS appended last
     ];

    const child = runWithLimits(cc, args, dir, { timeoutSec: CC_COMPILE_TIMEOUT_S });

    let out = "", err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());

child.on("close", (code) => {
    const compileLog = mergeStreams(out, err);
    const diagnostics = parseGcc(compileLog);   // ← collect warnings & notes either way

    if (code !== 0) {
      try { fssync.rmSync(dir, { recursive: true, force: true }); } catch {}
      return res.json({ token: null, ok: false, compileLog, diagnostics });
    }

    // Successful compile → still return diagnostics (warnings) to the UI
    const token = nanoid();
    const tmr = setTimeout(() => {
      try { fssync.rmSync(dir, { recursive: true, force: true }); } catch {}
      SESSIONS.delete(token);
    }, CC_TOKEN_TTL_MS);

    SESSIONS.set(token, { dir, exePath, tmr });
    res.json({ token, ok: true, compileLog, diagnostics });
  });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "internal error" });
  }
});

// ----------------------------------------------------------------------------
// WebSocket run endpoint
// ----------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
const server = app.listen(PORT, () => console.log(`[cc-runner] listening on :${PORT}`));

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/cc") {
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  const sess = token && SESSIONS.get(token);
  if (!sess) return ws.close(1008, "invalid token");

  // Token is being consumed → cancel TTL timer
  if (sess.tmr) { try { clearTimeout(sess.tmr); } catch {} sess.tmr = null; }

  const { dir, exePath } = sess;
  const child = runWithLimits(exePath, [], dir, { timeoutSec: CC_TIMEOUT_S });

  // Stream output
  child.stdout.on("data", d => { try { ws.send(d.toString()); } catch {} });
  child.stderr.on("data", d => { try { ws.send(d.toString()); } catch {} });

  // Close handler: publishes images, then cleanup
  child.on("close", async (code) => {
    try { ws.send(`\n[process exited with code ${code}]\n`); } catch {}

    try {
      const found = await collectImagesFrom(dir);
      if (found.length) {
        const tokenDir = crypto.randomUUID();
        const outDir = path.join(PUBLIC_ROOT, tokenDir);
        try { fssync.mkdirSync(outDir, { recursive: true }); } catch {}

        const urls = [];
        for (const f of found) {
          const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const dest = path.join(outDir, safeName);
          await fs.copyFile(f.full, dest);
          urls.push(`/artifacts/${tokenDir}/${safeName}`);
        }

        try { ws.send(JSON.stringify({ type: "images", urls })); } catch {}
        for (const u of urls) { try { ws.send(`[image] ${u}\n`); } catch {} }

        setTimeout(() => { try { fssync.rmSync(outDir, { recursive: true, force: true }); } catch {} }, 5 * 60 * 1000);
      }
    } catch (e) { console.error("artifact publish error:", e); }

    try { ws.close(); } catch {}
    cleanup();
  });

  ws.on("message", m => {
    try {
      const msg = JSON.parse(m.toString());
      if (msg?.type === "stdin") {
        child.stdin.write(String(msg.data));
      }
    } catch {
      // ignore non-JSON messages
    }
  });

  ws.on("close", () => { try { child.kill("SIGKILL"); } catch {}; cleanup(); });
  ws.on("error", () => { try { child.kill("SIGKILL"); } catch {}; cleanup(); });

  function cleanup() {
    try { fssync.rmSync(dir, { recursive: true, force: true }); } catch {}
    SESSIONS.delete(token);
  }
});

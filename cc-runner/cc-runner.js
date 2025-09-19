// cc-runner.js — C & C++ runner with CORS + WebSocket (hardened + friendly analysis)
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
const CC_CPU_SECS = Number(process.env.CC_CPU_SECS || 10);
const CC_VMEM_KB  = Number(process.env.CC_VMEM_KB  || 262144); // ~256MB (unused by ASan)
const CC_FSIZE_KB = Number(process.env.CC_FSIZE_KB || 1048576); // 1GB output cap
const CC_TIMEOUT_S = Number(process.env.CC_TIMEOUT_S || 300);
const CC_COMPILE_TIMEOUT_S = Number(process.env.CC_COMPILE_TIMEOUT_S || 60);
const CC_TOKEN_TTL_MS = Number(process.env.CC_TOKEN_TTL_MS || 5 * 60 * 1000);

const app = express();

// CORS allowlist
const ALLOW_ORIGINS = [
  "https://www.polycode.in",
  "https://polycode.in",
  "https://polycode.pages.dev",
  "https://edifica-polycode.pages.dev",
  "https://polycode.cc",
  "http://localhost:3000",
];

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOW_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Requested-With"],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Static artifacts (images)
const PUBLIC_ROOT = "/tmp/polycode-artifacts";
try { fssync.mkdirSync(PUBLIC_ROOT, { recursive: true }); } catch {}
app.use(
  "/artifacts",
  (req, res, next) => {
    const o = req.headers.origin;
    if (!o || ALLOW_ORIGINS.includes(o)) res.setHeader("Access-Control-Allow-Origin", o || "*");
    next();
  },
  express.static(PUBLIC_ROOT, { maxAge: "5m", fallthrough: true })
);

// Health
app.get("/health", (_, res) => res.json({ ok: true }));

// Helpers
async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
function safeJoin(root, relPath) {
  const base = path.resolve(root) + path.sep;
  const full = path.resolve(root, relPath);
  if (!full.startsWith(base)) throw new Error("Bad path");
  return full;
}
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
  picks.sort((a, b) => b.mtime - a.mtime);
  return picks.slice(0, limit);
}

function parseGcc(out) {
  const lines = String(out || "").split(/\r?\n/);
  const ds = [];
  for (const line of lines) {
    const m = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i);
    if (m) ds.push({ file: m[1], line: +m[2], column: +m[3], severity: m[4].toLowerCase(), message: m[5] });
  }
  return ds;
}

function mergeStreams(a, b) {
  const A = String(a || "").trim();
  const B = String(b || "").trim();
  if (!A) return B;
  if (!B) return A;
  return A === B ? A : A + "\n" + B;
}

// Build friendly compile-time “Polycode Analysis” items from diagnostics
function friendlyCompileItems(diags) {
  const items = [];
  const hasFmt = diags.find(d => /format.*expects argument/i.test(d.message));
  if (hasFmt) {
    items.push({
      title: "Mismatched printf/scanf format",
      bullets: [
        "You used a format specifier that does not match the argument type.",
        "Fix: For double use %f (e.g. printf(\"%.2f\\n\", d);). For scanf of int use %d with &x.",
      ],
    });
  }
  const hasScanfAddr = diags.find(d => /scanf.*expects.*int \*/i.test(d.message));
  if (hasScanfAddr) {
    items.push({
      title: "scanf missing '&'",
      bullets: [
        "scanf needs the address of the variable (a pointer).",
        "Fix: use &x for ints, &d for doubles, etc. (e.g. scanf(\"%d\", &x);).",
      ],
    });
  }
  const hasIntConv = diags.find(d => /incompatible pointer.*integer|makes pointer from integer/i.test(d.message));
  if (hasIntConv) {
    items.push({
      title: "Pointer/integer mismatch",
      bullets: [
        "You are storing a pointer (like a string literal) into an int, or vice-versa.",
        "Fix: use the correct type, e.g. char const *s = \"hello\"; or int x = 42;",
      ],
    });
  }
  const hasNoReturn = diags.find(d => /control reaches end of non-void function|no return statement/i.test(d.message));
  if (hasNoReturn) {
    items.push({
      title: "Function may not return a value",
      bullets: [
        "A non-void function has a path without 'return'.",
        "Fix: ensure every path returns a value.",
      ],
    });
  }
  const hasUninit = diags.find(d => /may be used uninitialized|is used uninitialized/i.test(d.message));
  if (hasUninit) {
    items.push({
      title: "Variable may be used before set",
      bullets: [
        "A variable is read before it’s given a value.",
        "Fix: initialize it (e.g. int x = 0;).",
      ],
    });
  }
  return items;
}

// Which compile warnings should block execution?
function hasDangerousCompileIssues(diags) {
  return diags.some(d =>
    d.severity !== "note" && (
      /format.*expects argument/i.test(d.message) ||
      /scanf.*expects.*\*/i.test(d.message) ||
      /incompatible pointer.*integer|makes pointer from integer/i.test(d.message) ||
      /control reaches end of non-void function|no return statement/i.test(d.message) ||
      /may be used uninitialized|is used uninitialized/i.test(d.message)
    )
  );
}

// Parse sanitizer output → friendly runtime analysis
function friendlyRuntimeItems(allOut) {
  const txt = String(allOut || "");
  const items = [];

  const hasDiv0 = /integer-divide-by-zero/i.test(txt);
  if (hasDiv0) {
    items.push({
      title: "Division by zero",
      bullets: [
        "A division had 0 as the denominator.",
        "Fix: check the denominator before dividing.",
      ],
    });
  }

  const hasNull = /null[- ]pointer[- ](use|dereference)|null pointer/i.test(txt);
  if (hasNull) {
    items.push({
      title: "Null pointer dereference",
      bullets: [
        "Code dereferenced a NULL pointer.",
        "Fix: validate pointers before use; ensure memory is allocated and initialized.",
      ],
    });
  }

  const hasOOB = /out[- ]of[- ]bounds|out[- ]of[- ]bounds[- ]index|index out of bounds/i.test(txt);
  if (hasOOB) {
    items.push({
      title: "Array index out of bounds",
      bullets: [
        "An array was accessed with an invalid index.",
        "Fix: check index ranges 0..size-1.",
      ],
    });
  }

  const hasUAF = /use[- ]after[- ]free/i.test(txt);
  if (hasUAF) {
    items.push({
      title: "Use-after-free",
      bullets: [
        "Memory was used after it was freed.",
        "Fix: set pointer to NULL after free; don’t access freed memory.",
      ],
    });
  }

  const hasDoubleFree = /double[- ]free/i.test(txt);
  if (hasDoubleFree) {
    items.push({
      title: "Double free",
      bullets: [
        "The same pointer was freed twice.",
        "Fix: free each allocation exactly once; set pointer to NULL after free.",
      ],
    });
  }

  const hasStackOverflow = /stack-overflow/i.test(txt);
  if (hasStackOverflow) {
    items.push({
      title: "Stack overflow (likely infinite recursion)",
      bullets: [
        "The program exhausted the stack, often due to unbounded recursion.",
        "Fix: add a base case or convert to an iterative approach.",
      ],
    });
  }

  return items;
}

// Runner with ulimits + PTY (for prompt flush) + input echo disabled
function runWithLimits(cmd, args, cwd, { timeoutSec } = {}) {
  const hardTimeout = Math.max(1, Number(timeoutSec ?? CC_TIMEOUT_S));
  const shQ = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const cmdStr = [cmd, ...args].map(shQ).join(" ");

  const limits = `ulimit -t ${CC_CPU_SECS}; ulimit -f ${CC_FSIZE_KB};`;
  const inner = `if command -v stty >/dev/null 2>&1; then stty -echo; trap 'stty echo' EXIT INT TERM HUP; fi; ${cmdStr}; rc=$?; if command -v stty >/dev/null 2>&1; then stty echo; fi; exit $rc`;
  const ptyCmd = `script -qefc ${shQ(`bash -lc ${shQ(inner)}`)} /dev/null`;
  const fallback = `bash -lc ${shQ(cmdStr)}`;
  const runner = `if command -v script >/dev/null 2>&1; then ${ptyCmd}; else ${fallback}; fi`;
  const bash = `${limits} ${runner}`;

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

try { fssync.mkdirSync(JOB_ROOT, { recursive: true }); } catch {}

const SESSIONS = new Map();

// ---------------------- Compile endpoint ----------------------
app.post("/api/cc/prepare", async (req, res) => {
  try {
    const { files = [], lang, entry, output = "a.out" } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files" });
    }

    const id = nanoid();
    const dir = path.join(JOB_ROOT, id);
    await ensureDir(dir);

    await Promise.all(files.map(async f => {
      if (!f?.path || typeof f.content !== "string") throw new Error("Bad file");
      const full = safeJoin(dir, f.path);
      await ensureDir(path.dirname(full));
      await fs.writeFile(full, f.content, "utf8");
    }));

    const entryFile = entry || files[0].path;
    const { cc, std } = compilerFor(lang, entryFile);
    const srcs   = files.map(f => safeJoin(dir, f.path));
    const exePath = safeJoin(dir, output);

    const isCpp = /\.(cc|cpp|cxx|c\+\+)$/i.test(entryFile) || (lang === "cpp");
    const envFlagsRaw = (isCpp ? process.env.CXXFLAGS : process.env.CFLAGS) || "";
    const envFlags = envFlagsRaw.trim().split(/\s+/).filter(Boolean);
    const hasOpt    = envFlags.some(f => /^-O\d\b/.test(f));
    const hasWall   = envFlags.includes("-Wall");
    const hasWextra = envFlags.includes("-Wextra");
    const hasFmt2   = envFlags.includes("-Wformat=2");

    const args = [
      ...srcs,
      std,
      ...(hasOpt ? [] : ["-O2"]),
      "-D_POSIX_C_SOURCE=200809L",
      ...(hasWall   ? [] : ["-Wall"]),
      ...(hasWextra ? [] : ["-Wextra"]),
      ...(hasFmt2   ? [] : ["-Wformat=2"]),
      // extra beginner-friendly (remain warnings)
      "-Wuninitialized",
      "-Wmaybe-uninitialized",
      "-Wnull-dereference",
      "-Wreturn-type",
      "-fdiagnostics-color=never",
      "-fno-diagnostics-show-caret",
      "-pthread",
      "-o", exePath,
      "-lm",
      ...(isCpp ? ["-lgmp", "-lgmpxx"] : ["-lgmp"]),
      ...envFlags,
    ];

    const child = runWithLimits(cc, args, dir, { timeoutSec: CC_COMPILE_TIMEOUT_S });
    let out = "", err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());

    child.on("close", (code) => {
      const compileLog = mergeStreams(out, err);
      const diagnostics = parseGcc(compileLog);
      const friendly = friendlyCompileItems(diagnostics);
      // Attach friendly items into diagnostics as notes so your UI can show them in Polycode Analysis
      for (const it of friendly) {
        diagnostics.push({
          file: "(analysis)",
          line: 0,
          column: 0,
          severity: "note",
          message: `[${it.title}] ${it.bullets.join(" ")}`
        });
      }

      // If the compiler failed OR we found dangerous mistakes, block run.
      if (code !== 0 || hasDangerousCompileIssues(diagnostics)) {
        try { fssync.rmSync(dir, { recursive: true, force: true }); } catch {}
        return res.json({
          token: null,
          ok: false,
          blockedByAnalysis: code === 0,   // true when we blocked despite successful compile
          compileLog,
          diagnostics
        });
      }

      // Success → issue token
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

// ---------------------- WebSocket run endpoint ----------------------
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

  if (sess.tmr) { try { clearTimeout(sess.tmr); } catch {} sess.tmr = null; }

  const { dir, exePath } = sess;
  const child = runWithLimits(exePath, [], dir, { timeoutSec: CC_TIMEOUT_S });

  // Capture output for analysis while streaming to the UI
  let runOut = "", runErr = "";
  child.stdout.on("data", d => {
    const s = d.toString();
    runOut += s;
    try { ws.send(s); } catch {}
  });
  child.stderr.on("data", d => {
    const s = d.toString();
    runErr += s;
    try { ws.send(s); } catch {}
  });

  child.on("close", async (code) => {
    // Friendly runtime analysis
    const items = friendlyRuntimeItems(runOut + "\n" + runErr);
    if (items.length) {
      try {
        ws.send(JSON.stringify({ type: "analysis", where: "runtime", items }));
      } catch {}
      // also print a plain text version so something appears even if UI ignores JSON
      const bullets = items.map(it => `• ${it.title}\n  - ${it.bullets.join("\n  - ")}`).join("\n");
      try { ws.send(`\n[runtime analysis]\n${bullets}\n`); } catch {}
    }

    try { ws.send(`\n[process exited with code ${code}]\n`); } catch {}

    // Publish images if any
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
    } catch (e) {
      console.error("artifact publish error:", e);
    }

    try { ws.close(); } catch {}
    cleanup();
  });

  ws.on("message", m => {
    try {
      const msg = JSON.parse(m.toString());
      if (msg?.type === "stdin") child.stdin.write(String(msg.data));
    } catch { /* ignore */ }
  });

  ws.on("close", () => { try { child.kill("SIGKILL"); } catch {}; cleanup(); });
  ws.on("error", () => { try { child.kill("SIGKILL"); } catch {}; cleanup(); });

  function cleanup() {
    try { fssync.rmSync(dir, { recursive: true, force: true }); } catch {}
    SESSIONS.delete(token);
  }
});

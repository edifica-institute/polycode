// cc-runner.js — C & C++ runner with sanitizers (warnings stay warnings)
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 8083;
const JOB_ROOT = process.env.JOB_ROOT || "/tmp/ccjobs";

// Limits (env-overridable)
const CC_CPU_SECS = Number(process.env.CC_CPU_SECS || 10);                 // runtime cap
const CC_OUTPUT_MAX = Number(process.env.CC_OUTPUT_MAX || 256 * 1024);     // bytes
const CC_STDIN_MAX = Number(process.env.CC_STDIN_MAX || 128 * 1024);       // bytes
const CC_FILE_MAX = Number(process.env.CC_FILE_MAX || 256 * 1024);         // source size

// Toolchain (override if you prefer clang)
const CC = process.env.CC || "gcc";
const CXX = process.env.CXX || "g++";

// Base compile flags: keep warnings as warnings; enable runtime sanitizers
const COMMON_FLAGS = [
  "-O1", "-g", "-fno-omit-frame-pointer",
  "-Wall", "-Wextra", "-Wpedantic",
  "-Wformat=2", "-Wshadow", "-Wconversion",
  "-Wnull-dereference", "-Wdouble-promotion", "-Wundef",
  "-fanalyzer",
  "-fsanitize=address,undefined"
];
const C_STD = process.env.C_STD || "-std=c17";
const CXX_STD = process.env.CXX_STD || "-std=c++17";

// Link sanitizers too
const LINK_FLAGS = ["-fsanitize=address,undefined"];

// Runtime sanitizer behavior: fail hard on UB
const RUN_ENV_SAN = {
  ASAN_OPTIONS: "detect_leaks=1:halt_on_error=1:abort_on_error=1:allocator_may_return_null=1",
  UBSAN_OPTIONS: "print_stacktrace=1:halt_on_error=1"
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const ok = (res, extra={}) => res.json({ ok: true, service: "cc-runner", ...extra });

app.get ("/health",            (_req, res) => ok(res));
app.get ("/api/cc/health",     (_req, res) => ok(res));
app.post("/api/cc/health",     (_req, res) => ok(res));
app.get ("/cc/health",         (_req, res) => ok(res));

app.get ("/api/cc/prepare",    (_req, res) => ok(res));
app.post("/api/cc/prepare",    (_req, res) => ok(res));
app.get ("/cc/prepare",        (_req, res) => ok(res));
app.post("/cc/prepare",        (_req, res) => ok(res));

/** utils */
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function spawnLogged(cmd, args, opts = {}) {
  // Wrap in bash -lc to set ulimit for CPU time; keeps portability.
  const bashCmd = [
    "bash", "-lc",
    [
      // CPU time cap (seconds); prevents runaway loops
      `ulimit -t ${clamp(CC_CPU_SECS, 1, 60)};`,
      // No core files
      "ulimit -c 0;",
      // Reasonable file size/output caps (soft)
      `ulimit -f ${Math.ceil(CC_OUTPUT_MAX / 1024)};`,
      // exec
      [cmd, ...args].map(x => `'${x.replace(/'/g, `'\\''`)}'`).join(" ")
    ].join(" ")
  ];

  return spawn(bashCmd[0], bashCmd.slice(1), opts);
}

async function writeLimitedFile(p, content, maxBytes) {
  const buf = Buffer.from(content ?? "", "utf8");
  if (buf.length > maxBytes) throw new Error(`Source too large (> ${maxBytes} bytes)`);
  await fs.writeFile(p, buf);
}

function collect(child, { max = CC_OUTPUT_MAX }) {
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);

  child.stdout.on("data", (d) => {
    stdout = Buffer.concat([stdout, d]);             // <-- no slice
    if (stdout.length > max) stdout = stdout.subarray(0, max);
  });
  child.stderr.on("data", (d) => {
    stderr = Buffer.concat([stderr, d]);             // <-- no slice
    if (stderr.length > max) stderr = stderr.subarray(0, max);
  });

  return new Promise((resolve) => {
    child.on("close", (code, sig) => resolve({ code, sig, stdout, stderr }));
  });
}


/** compile one file (C or C++) */
async function compileJob(jobDir, lang) {
  const out = path.join(jobDir, "a.out");
  const src = path.join(jobDir, lang === "cpp" ? "main.cpp" : "main.c");

  const isCpp = lang === "cpp";
  const compiler = isCpp ? CXX : CC;
  const std = isCpp ? CXX_STD : C_STD;

  const args = [
    std,
    ...COMMON_FLAGS,
    src,
    "-o", out,
    ...LINK_FLAGS
  ];

  const proc = spawnLogged(compiler, args, { cwd: jobDir });
  const { code, stdout, stderr } = await collect(proc, { max: CC_OUTPUT_MAX });

  return { code, stdout: stdout.toString(), stderr: stderr.toString(), exe: out };
}

/** run compiled artifact */
async function runJob(jobDir, stdin = "") {
  const exe = path.join(jobDir, "a.out");
  if (!fssync.existsSync(exe)) throw new Error("Executable missing");

  const env = { ...process.env, ...RUN_ENV_SAN };
  const child = spawnLogged(exe, [], { cwd: jobDir, env });

  // feed stdin with length cap
  const inBuf = Buffer.from(stdin ?? "", "utf8");
  if (inBuf.length > CC_STDIN_MAX) throw new Error(`stdin too large (> ${CC_STDIN_MAX} bytes)`);
  child.stdin.end(inBuf);

  // hard timeout (CPU time is also capped by ulimit)
  const killTimer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
  }, (CC_CPU_SECS + 1) * 1000);

  const res = await collect(child, { max: CC_OUTPUT_MAX });
  clearTimeout(killTimer);

  return {
    exitCode: res.code,
    signal: res.sig,
    stdout: res.stdout.toString(),
    stderr: res.stderr.toString()
  };
}

/** REST: compile+run
 *  POST /api/cc/run  { lang: "c"|"cpp", code: string, stdin?: string }
 */
app.post("/api/cc/run", async (req, res) => {
  try {
    const { lang, code, stdin } = req.body || {};
    if (!["c", "cpp"].includes(lang)) return res.status(400).json({ error: "lang must be 'c' or 'cpp'" });
    if (typeof code !== "string" || !code.trim()) return res.status(400).json({ error: "code missing" });

    const id = nanoid(10);
    const jobDir = path.join(JOB_ROOT, id);
    await ensureDir(jobDir);

    // write source
    const srcName = lang === "cpp" ? "main.cpp" : "main.c";
    await writeLimitedFile(path.join(jobDir, srcName), code, CC_FILE_MAX);

    // compile
    const comp = await compileJob(jobDir, lang);

    // If compilation failed (exit code != 0), return immediately with stderr (warnings remain warnings)
    if (comp.code !== 0) {
      return res.json({
        phase: "compile",
        exitCode: comp.code,
        stdout: comp.stdout,
        stderr: comp.stderr,
      });
    }

    // run
    const run = await runJob(jobDir, stdin);

    // Combine and cap outputs
    return res.json({
      phase: "run",
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      // expose compile warnings too, if any
      compileStdout: comp.stdout,
      compileStderr: comp.stderr
    });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
});

/** Minimal WS passthrough if your UI expects a socket; it mirrors the HTTP route.
 *  Client can send: {lang, code, stdin}
 */
const server = app.listen(PORT, () => {
  console.log(`[cc-runner] listening on :${PORT}`);
});
const wss = new WebSocketServer({ server, path: "/ws/cc" });
wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(String(raw || "{}"));
      const fakeReq = { body: msg };
      const out = await new Promise((resolve) => {
        const resShim = {
          status: (_s) => resShim,
          json: (o) => resolve(o)
        };
        app._router.handle({ ...fakeReq, method: "POST", url: "/api/cc/run" }, resShim, () => {});
      });
      ws.send(JSON.stringify(out));
    } catch (e) {
      ws.send(JSON.stringify({ error: String(e && e.message || e) }));
    }
  });
});

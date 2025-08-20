// server/core/utils.js (CommonJS)
const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const { spawn: cpSpawn } = require('child_process');

const __dirname = __dirname || path.resolve(); // harmless in Node 20, but retained for clarity

const USE_DOCKER = process.env.SANDBOX !== 'local';
const JOB_ROOT = path.join(__dirname, '..', '.jobs');

// NO top-level await. Ensure dir inside loadPlugins.
async function ensureJobRoot() {
  try { await fs.mkdir(JOB_ROOT, { recursive: true }); } catch {}
}

function execCapture(cmd, args) {
  return new Promise((resolve) => {
    const cp = cpSpawn(cmd, args, { stdio: ['ignore','pipe','pipe'] });
    let out = '', err = '';
    cp.stdout.on('data', d => out += d.toString());
    cp.stderr.on('data', d => err += d.toString());
    cp.on('close', code => resolve({ stdout: out + err, exitCode: code ?? 0 }));
  });
}

function parseJavac(stderr) {
  const re = /^(.+?):(\d+):(?:(\d+):)?\s+(error|warning):\s+(.*)$/gm;
  const out = []; let m;
  while ((m = re.exec(stderr)) !== null) {
    out.push({ file:m[1], line:Number(m[2]), column:m[3]?Number(m[3]):1,
      severity:m[4]==='warning'?'warning':'error', message:(m[5]||'').trim() });
  }
  return out;
}
function parseGcc(stderr) {
  const re = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/gm;
  const out = []; let m;
  while ((m = re.exec(stderr)) !== null) {
    out.push({ file:m[1], line:Number(m[2])||1, column:Number(m[3])||1,
      severity:/warn/i.test(m[4])?'warning':(/note/i.test(m[4])?'note':'error'),
      message:(m[5]||'').trim() });
  }
  return out;
}

async function loadPlugins(app) {
  await ensureJobRoot();
  const langsDir = path.join(__dirname, '..', 'langs');
  if (!fssync.existsSync(langsDir)) return;
  const entries = await fs.readdir(langsDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const plugPath = path.join(langsDir, ent.name, 'plugin.js');
    if (!fssync.existsSync(plugPath)) continue;
    // Use dynamic import to load either CJS or ESM transparently
    const mod = await import(plugPath.startsWith('/') ? `file://${plugPath}` : plugPath);
    const register = mod.register || (mod.default && mod.default.register);
    if (typeof register !== 'function') continue;
    await register(app, { USE_DOCKER, JOB_ROOT, execCapture, parseJavac, parseGcc });
    console.log('[polycode] plugin loaded:', ent.name);
  }
}

const SESSIONS = new Map();

module.exports = { USE_DOCKER, JOB_ROOT, execCapture, parseJavac, parseGcc, loadPlugins, SESSIONS };

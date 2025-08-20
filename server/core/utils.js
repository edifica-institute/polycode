// server/core/utils.js
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn as cpSpawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const USE_DOCKER = process.env.SANDBOX !== 'local';
export const JOB_ROOT = path.join(__dirname, '..', '.jobs');

await fs.mkdir(JOB_ROOT, { recursive: true });

export function execCapture(cmd, args){
  return new Promise((resolve) => {
    const cp = cpSpawn(cmd, args, { stdio: ['ignore','pipe','pipe'] });
    let out = '', err = '';
    cp.stdout.on('data', d => out += d.toString());
    cp.stderr.on('data', d => err += d.toString());
    cp.on('close', code => resolve({ stdout: out + err, exitCode: code ?? 0 }));
  });
}

export function parseJavac(stderr){
  const javacRegex = /^(.+?):(\d+):(?:(\d+):)?\s+(error|warning):\s+(.*)$/gm;
  const out = []; let m;
  while((m = javacRegex.exec(stderr)) !== null){
    out.push({ file:m[1], line:Number(m[2]), column:m[3]?Number(m[3]):1, severity:m[4]==='warning'?'warning':'error', message:(m[5]||'').trim() });
  }
  return out;
}
export function parseGcc(stderr){
  const gccRegex = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/gm;
  const out = []; let m;
  while((m = gccRegex.exec(stderr)) !== null){
    out.push({ file:m[1], line:Number(m[2])||1, column:Number(m[3])||1, severity:/warn/i.test(m[4])?'warning':(/note/i.test(m[4])?'note':'error'), message:(m[5]||'').trim() });
  }
  return out;
}

// Plugin loader
export async function loadPlugins(app){
  const langsDir = path.join(__dirname, '..', 'langs');
  if (!fssync.existsSync(langsDir)) return;
  const entries = await fs.readdir(langsDir, { withFileTypes: true });
  for (const ent of entries){
    if (!ent.isDirectory()) continue;
    const plugPath = path.join(langsDir, ent.name, 'plugin.js');
    if (!fssync.existsSync(plugPath)) continue;
    const mod = await import(plugPath);
    if (typeof mod.register !== 'function') continue;
    await mod.register(app, { USE_DOCKER, JOB_ROOT, execCapture, parseJavac, parseGcc });
    console.log('[polycode] plugin loaded:', ent.name);
  }
}

export const SESSIONS = new Map();

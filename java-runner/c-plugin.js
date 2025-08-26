// java-runner/c-plugin.js
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const { nanoid } = require('nanoid');

const SESSIONS = global.SESSIONS || new Map();
global.SESSIONS = SESSIONS;

const JOB_ROOT = process.env.JOB_ROOT || '/tmp/polycode';

async function execCapture(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function parseGcc(out) {
  const lines = out.split(/\r?\n/);
  const markers = [];
  for (const line of lines) {
    const m = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/i);
    if (m) markers.push({
      file: m[1], line: +m[2] || 1, column: +m[3] || 1,
      message: m[5], severity: m[4].toLowerCase()
    });
  }
  return markers;
}

function sh(str){ return ['bash','-lc',str]; }

function register(app, { server }) {
  app.post('/api/c/prepare', async (req, res) => {
    try {
      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      if (!files.length) return res.status(400).json({ error:'No files' });

      const id = require('nanoid').nanoid();
      const dir = path.join(JOB_ROOT, 'c', id);
      await fs.mkdir(dir, { recursive: true });

      for (const f of files) {
        const rel = (f?.path || 'main.c').replace(/^\/*/, '');
        const full = path.join(dir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f?.content ?? '', 'utf8');
      }

      const cmd = (
        "cd '" + dir.replace(/'/g,"'\\''") + "' && " +
        "shopt -s nullglob && files=( $(find . -type f -name '*.c' -printf '"%p" ') ); " +
        "if (( ${#files[@]} )); then gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main ${files[@]} -lm; " +
        "else echo 'No .c files'; false; fi"
      );
      const out = await execCapture(...sh(cmd));
      const compileLog = (out.stdout || '') + (out.stderr || '');
      const diagnostics = parseGcc(compileLog);
      const ok = out.code === 0 && !diagnostics.some(d => d.severity === 'error' || /fatal/i.test(d.message));

      const token = require('nanoid').nanoid();
      SESSIONS.set(token, { cwd: dir, cmd: `timeout 10s ./main` });

      res.json({ token, ok, diagnostics, compileLog });
    } catch (e) {
      console.error('[c-plugin] prepare error', e);
      res.status(500).json({ error:'Server error' });
    }
  });

  // If your server already upgrades to /term elsewhere, keep it.
  // Otherwise, you can implement a minimal /term here (commented out in README).
}

module.exports = { register, SESSIONS };

/*const fs = require('fs').promises;
const path = require('path');
const { nanoid } = require('nanoid');
const { SESSIONS } = require('../../core/utils');

async function register(app, core) {
  const { JOB_ROOT, execCapture, parseGcc } = core;
  app.post('/api/c/prepare', async (req, res, next) => {
    try {
      const { files = [] } = req.body || {};
      if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'No files' });

      const id = nanoid(); const dir = path.join(JOB_ROOT, id);
      await fs.mkdir(dir, { recursive: true });
      await Promise.all(files.map(async f => {
        const full = path.join(dir, path.normalize(f.path));
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f.content ?? '', 'utf8');
      }));

     const out = await execCapture('bash', ['-lc',
  'cd "' + dir + '"; ' +
  'shopt -s nullglob; files=( *.c ); ' +
  'if (( ${#files[@]} )); then gcc -O2 -pipe -o main "${files[@]}" 2>&1; ' +
  'else echo "No .c files"; fi; true'
]);

      const compileLog = out.stdout;
      const diagnostics = parseGcc(compileLog);
      const ok = diagnostics.every(d => !/error|fatal/i.test(d.severity));

      const token = nanoid();
      SESSIONS.set(token, { jobDir: dir, runCmd: `timeout 10s ./main` });
      res.json({ token, ok, diagnostics, compileLog });
    } catch (e) { next(e); }
  });
}

module.exports = { register };*/




// server/langs/c/plugin.js
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const { SESSIONS } = require('../../core/utils');

function safeJoin(root, p) {
  const norm = path.normalize(p || '');
  if (path.isAbsolute(norm) || norm.startsWith('..')) throw new Error('Unsafe path');
  return path.join(root, norm);
}

async function register(app, core) {
  const { JOB_ROOT, execCapture, parseGcc } = core;

  // Prepare a C job: write files, compile, return a token
  app.post('/api/c/prepare', async (req, res, next) => {
    try {
      const { files = [] } = req.body || {};
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'No files' });
      }

      const id = nanoid();
      const dir = path.join(JOB_ROOT, id);
      await fs.mkdir(dir, { recursive: true });

      // Write provided files
      for (const f of files) {
        const rel = f?.path || 'main.c';
        const full = safeJoin(dir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f?.content ?? '', 'utf8');
      }

      // Compile all .c files in the job directory (including subfolders)
      const compileCmd = [
        `cd '${dir.replace(/'/g, "'\\''")}'`,
        `gcc -std=c17 -O2 -pipe -Wall -Wextra -Wno-unused-result -o main $(find . -type f -name '*.c' -printf '"%p" ') -lm`
      ].join(' && ') + ' 2>&1';

      const out = await execCapture('bash', ['-lc', compileCmd]);
      const compileLog = out.stdout || '';
      const diagnostics = parseGcc ? parseGcc(compileLog) : [];
      const ok = out.code === 0 && diagnostics.every(d => !/error|fatal/i.test(String(d.severity||'')));

      // Register a run session
      const token = nanoid();
      SESSIONS.set(token, { jobDir: dir, runCmd: `timeout 10s ./main` });

      return res.json({ token, ok, diagnostics, compileLog });
    } catch (e) {
      return next(e);
    }
  });
}

module.exports = { register };


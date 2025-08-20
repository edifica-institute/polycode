const fs = require('fs/promises');
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
        `cd "${dir}"; shopt -s nullglob; files=( *.c ); ` +
        `if (( \\${#files[@]} )); then gcc -O2 -pipe -o main "\\${files[@]}" 2>&1; else echo "No .c files"; fi; true`
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

module.exports = { register };

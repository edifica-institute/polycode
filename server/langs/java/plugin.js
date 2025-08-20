const fs = require('fs/promises');
const path = require('path');
const { nanoid } = require('nanoid');
const { SESSIONS } = require('../../core/utils');

async function register(app, core) {
  const { USE_DOCKER, JOB_ROOT, execCapture, parseJavac } = core;
  app.post('/api/java/prepare', async (req, res, next) => {
    try {
      const { files = [], mainClass = 'Main' } = req.body || {};
      if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'No files' });

      const id = nanoid(); const dir = path.join(JOB_ROOT, id);
      await fs.mkdir(dir, { recursive: true });
      await Promise.all(files.map(async f => {
        const full = path.join(dir, path.normalize(f.path));
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f.content ?? '', 'utf8');
      }));

      let compileLog = '', diagnostics = [], ok = false;
      const out = await execCapture('bash', ['-lc',
        `cd "${dir}"; shopt -s nullglob; files=( *.java ); ` +
        `if (( \\${#files[@]} )); then javac -Xlint:unchecked -verbose "\\${files[@]}" 2>&1; else echo "No .java files"; fi; true`
      ]);
      compileLog = out.stdout;
      diagnostics = parseJavac(compileLog);
      ok = diagnostics.every(d => d.severity !== 'error');

      const token = nanoid();
      SESSIONS.set(token, { jobDir: dir, runCmd: `timeout 10s java ${mainClass}` });
      res.json({ token, ok, diagnostics, compileLog });
    } catch (e) { next(e); }
  });
}

module.exports = { register };

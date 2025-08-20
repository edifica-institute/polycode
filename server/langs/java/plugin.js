// server/langs/java/plugin.js
import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import { SESSIONS } from '../../core/utils.js';

export async function register(app, core){
  const { USE_DOCKER, JOB_ROOT, execCapture, parseJavac } = core;
  app.post('/api/java/prepare', async (req, res, next) => {
    try{
      const { files = [], mainClass = 'Main' } = req.body || {};
      if (!Array.isArray(files) || files.length === 0) return res.status(400).json({ error:'No files' });
      const jobId = nanoid(); const jobDir = path.join(JOB_ROOT, jobId); await fs.mkdir(jobDir, { recursive:true });
      await Promise.all(files.map(async f => {
        const full = path.join(jobDir, path.normalize(f.path)); await fs.mkdir(path.dirname(full), { recursive:true }); await fs.writeFile(full, f.content ?? '', 'utf8');
      }));
      let compileLog = '', diagnostics = [], ok = false;
      if (USE_DOCKER){
        const out = await execCapture('docker', ['run','--rm','--network','none','--cpus','1.0','--memory','512m','--pids-limit','256','-v', `${jobDir}:/workspace:rw`,'-w','/workspace','oc-java:17','bash','-lc','shopt -s nullglob; files=( *.java ); if (( ${#files[@]} )); then javac -Xlint:unchecked -verbose "${files[@]}" 2>&1; else echo "No .java files"; fi; true']);
        compileLog = out.stdout; diagnostics = parseJavac(compileLog); ok = diagnostics.every(d => d.severity !== 'error');
      } else {
        const out = await execCapture('bash', ['-lc', `cd "${jobDir}"; shopt -s nullglob; files=( *.java ); if (( \${#files[@]} )); then javac -Xlint:unchecked -verbose "\${files[@]}" 2>&1; else echo "No .java files"; fi; true`]);
        compileLog = out.stdout; diagnostics = parseJavac(compileLog); ok = diagnostics.every(d => d.severity !== 'error');
      }
      const token = nanoid();
      SESSIONS.set(token, { jobDir, runCmd: `java ${mainClass}`, dockerImage: 'oc-java:17' });
      res.json({ token, ok, diagnostics, compileLog });
    }catch(e){ next(e); }
  });
}

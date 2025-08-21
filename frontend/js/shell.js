/* ---------- Status + spinner ---------- */
function setStatus(text, cls){
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.className = (cls || '');
}
function spin(on){ const s=document.getElementById('spinner'); if (s) s.style.display = on?'inline-block':'none'; }

/* ---------- Collapse left "About" ---------- */
(function(){
  const pane = document.getElementById('aboutPane');
  const btn = document.getElementById('aboutToggle');
  if (!pane || !btn) return;
  btn.addEventListener('click', ()=> {
    pane.classList.toggle('collapsed');
    btn.textContent = pane.classList.contains('collapsed') ? 'Expand' : 'Collapse';
  });
})();

/* ---------- Resize (drag between center & right) ---------- */
(function(){
  const handle = document.getElementById('dragHandle');
  const center = document.getElementById('editorPane');
  if (!handle || !center) return;
  let drag=false, startX=0, startW=0;
  handle.addEventListener('mousedown', e=>{
    drag=true; startX=e.clientX; startW=center.getBoundingClientRect().width;
    document.body.style.userSelect='none';
  });
  window.addEventListener('mousemove', e=>{
    if (!drag) return;
    const dx=e.clientX-startX;
    center.style.width = Math.max(260, startW + dx) + 'px';
  });
  window.addEventListener('mouseup', ()=>{ drag=false; document.body.style.userSelect=''; });
})();

/* ---------- Monaco bootstrap ---------- */
function initMonaco({value, language}){
  return new Promise(resolve=>{
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function(){
      window.editor = monaco.editor.create(document.getElementById('editor'), {
        value, language, theme: document.body.classList.contains('light') ? 'vs' : 'vs-dark',
        automaticLayout:true
      });
      resolve();
    });
  });
}

/* ---------- Error markers in editor ---------- */
function showEditorError(message, line=1, column=1){
  if (!window.editor || !window.monaco) return;
  const model = editor.getModel();
  monaco.editor.setModelMarkers(model, 'polycode', [{
    startLineNumber: line, startColumn: column,
    endLineNumber: line, endColumn: column+1,
    message: message, severity: monaco.MarkerSeverity.Error
  }]);
}
function clearEditorErrors(){
  if (!window.editor || !window.monaco) return;
  monaco.editor.setModelMarkers(editor.getModel(), 'polycode', []);
}

/* ---------- Freeze/Unfreeze UI ---------- */
let RUNNING = false;
function freezeUI(){
  RUNNING = true;
  const run = document.getElementById('btnRun');
  const clr = document.getElementById('btnClear');
  const sel = document.getElementById('langSelect');
  if (run) run.disabled = true;
  if (sel) sel.disabled = true;
  if (clr) clr.disabled = false;
  if (window.editor) editor.updateOptions({ readOnly: true });
  document.getElementById('output')?.classList.remove('screen-dim');
}
function unfreezeUI(){
  RUNNING = false;
  const run = document.getElementById('btnRun');
  const clr = document.getElementById('btnClear');
  const sel = document.getElementById('langSelect');
  if (run) run.disabled = false;
  if (sel) sel.disabled = false;
  if (clr) clr.disabled = true;
  if (window.editor) editor.updateOptions({ readOnly: false });
  document.getElementById('output')?.classList.add('screen-dim');
}

/* initial: Clear disabled, output dimmed */
window.addEventListener('DOMContentLoaded', ()=> unfreezeUI());

/* ---------- Wire buttons (run/clear provided by page) ---------- */
(function(){
  const runBtn = document.getElementById('btnRun');
  const clrBtn = document.getElementById('btnClear');
  if (runBtn) runBtn.addEventListener('click', async ()=>{
    try{
      clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();
      await window.runLang(); setStatus('OK','ok');
    }catch(e){
      setStatus('Error','err');
      // If error message contains "line:col", try to mark it
      const m = /line\s*(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i.exec(e?.message||'');
      showEditorError((e?.message)||String(e), m?Number(m[1]):1, m?Number(m[2]||1):1);
    }finally{ spin(false); }
  });
  if (clrBtn) clrBtn.addEventListener('click', ()=>{
    try{ window.clearLang && window.clearLang(); }catch{}
    clearEditorErrors(); setStatus('Cleared','ok'); unfreezeUI();
  });
})();

/* ---------- Theme toggle ---------- */
(function(){
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', ()=>{
    const toLight = !document.body.classList.contains('light');
    document.body.classList.toggle('light', toLight);
    btn.textContent = toLight ? 'Dark' : 'Light';
    if (window.editor && window.monaco){
      monaco.editor.setTheme(toLight ? 'vs' : 'vs-dark');
    }
  });
})();

window.PolyShell = { initMonaco, setStatus, spin, showEditorError, clearEditorErrors, freezeUI, unfreezeUI };

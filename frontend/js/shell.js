<script>
/* Shared UI helpers */
function setStatus(text, cls){ const s=document.querySelector('.toolbar .status .label'); s.textContent=text; s.className='label ' + (cls||''); }
function spin(on){ document.querySelector('.toolbar .spin').style.display = on ? 'inline-block' : 'none'; }

/* Collapsible left pane */
(function(){
  const root = document.documentElement, app = document.querySelector('.app');
  const btn = document.getElementById('aboutToggle');
  if (btn) btn.addEventListener('click', ()=> app.classList.toggle('collapsed'));
})();

/* Draggable resizer between center and right panes */
(function(){
  const resizer = document.getElementById('dragHandle');
  if (!resizer) return;
  let dragging = false, startX=0, startW=0;
  resizer.addEventListener('mousedown', (e)=>{ dragging=true; startX=e.clientX; startW=resizer.previousElementSibling.getBoundingClientRect().width; document.body.style.userSelect='none';});
  window.addEventListener('mousemove', (e)=>{
    if (!dragging) return;
    const dx = e.clientX - startX;
    const center = resizer.previousElementSibling;
    center.style.width = Math.max(200, startW + dx) + 'px';
  });
  window.addEventListener('mouseup', ()=>{ dragging=false; document.body.style.userSelect=''; });
})();

/* Monaco bootstrap (shared) */
function initMonaco({value, language}){
  return new Promise(resolve=>{
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function(){
      window.editor = monaco.editor.create(document.getElementById('editor'), {
        value, language, theme:'vs-dark', automaticLayout:true
      });
      resolve();
    });
  });
}

/* Wire toolbar buttons – language page provides window.runLang / window.clearLang */
(function(){
  const runBtn = document.getElementById('btnRun');
  const clrBtn = document.getElementById('btnClear');
  if (runBtn) runBtn.addEventListener('click', async ()=>{ try{ spin(true); setStatus('Running…'); await window.runLang(); setStatus('OK','ok'); }catch(e){ console.error(e); setStatus('Error','err'); } finally{ spin(false);} });
  if (clrBtn) clrBtn.addEventListener('click', ()=>{ try{ window.clearLang && window.clearLang(); setStatus('Cleared','ok'); }catch(e){ console.error(e); } });
})();

window.PolyShell = { initMonaco, setStatus, spin };
</script>

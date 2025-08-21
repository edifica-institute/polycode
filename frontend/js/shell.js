/* --- status + spinner --- */
function setStatus(text, cls){ const el=document.getElementById('status'); if(!el) return; el.textContent=text; el.className=(cls||''); }
function spin(on){ const s=document.getElementById('spinner'); if(s) s.style.display=on?'inline-block':'none'; }

/* --- Monaco bootstrap (minimap disabled) --- */
function initMonaco({value, language}){
  return new Promise(resolve=>{
    require.config({ paths:{ vs:'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }});
    require(['vs/editor/editor.main'], function(){
      window.editor = monaco.editor.create(document.getElementById('editor'), {
        value, language,
        theme: document.body.classList.contains('light') ? 'vs' : 'vs-dark',
        automaticLayout:true, minimap:{ enabled:false }
      });
      resolve();
    });
  });
}

/* --- error markers --- */
function showEditorError(message, line=1, column=1){
  if (!window.editor || !window.monaco) return;
  const model = editor.getModel();
  monaco.editor.setModelMarkers(model, 'polycode', [{
    startLineNumber: line, startColumn: column,
    endLineNumber: line, endColumn: column+1,
    message, severity: monaco.MarkerSeverity.Error
  }]);
}
function clearEditorErrors(){
  if (!window.editor || !window.monaco) return;
  monaco.editor.setModelMarkers(editor.getModel(), 'polycode', []);
}

/* --- freeze/unfreeze visual + controls --- */
let RUNNING=false;
function setFrozen(left, center, right, frozen){
  [left,center,right].forEach(p=>p && p.classList.toggle('frozen', frozen));
}
function freezeUI(){
  RUNNING=true;
  document.getElementById('btnRun')?.setAttribute('disabled','');
  document.getElementById('btnReset')?.removeAttribute('disabled');
  document.getElementById('langSelect')?.setAttribute('disabled','');
  if (window.editor) editor.updateOptions({ readOnly:true });
  document.getElementById('output')?.classList.remove('screen-dim');
  setFrozen(document.getElementById('leftPanel'), document.getElementById('centerPanel'), document.getElementById('rightPanel'), true);
}
function unfreezeUI(){
  RUNNING=false;
  document.getElementById('btnRun')?.removeAttribute('disabled');
  document.getElementById('btnReset')?.setAttribute('disabled','');
  document.getElementById('langSelect')?.removeAttribute('disabled');
  if (window.editor) editor.updateOptions({ readOnly:false });
  document.getElementById('output')?.classList.add('screen-dim');
  setFrozen(document.getElementById('leftPanel'), document.getElementById('centerPanel'), document.getElementById('rightPanel'), false);
}
window.addEventListener('DOMContentLoaded', ()=> unfreezeUI());

/* --- resizers (flex-basis) --- */
(function(){
  const leftPanel = document.getElementById('leftPanel');
  const centerPanel = document.getElementById('centerPanel');
  const rightPanel = document.getElementById('rightPanel');
  const dragLeft = document.getElementById('dragLeft');
  const dragRight = document.getElementById('dragRight');

  function startDrag(e, side){
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftPanel.getBoundingClientRect().width;
    const startCenter = centerPanel.getBoundingClientRect().width;
    const startRight = rightPanel.getBoundingClientRect().width;

    function move(ev){
      const dx = ev.clientX - startX;
      if (side==='left'){
        const newLeft = Math.max(220, startLeft + dx);
        leftPanel.style.flexBasis = newLeft + 'px';
        leftPanel.style.width = newLeft + 'px';
      }else{
        const newCenter = Math.max(300, startCenter + dx);
        centerPanel.style.flexBasis = newCenter + 'px';
        centerPanel.style.width = newCenter + 'px';
      }
    }
    function up(){ window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.userSelect=''; }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.userSelect='none';
  }

  dragLeft?.addEventListener('mousedown', e=> startDrag(e,'left'));
  dragRight?.addEventListener('mousedown', e=> startDrag(e,'right'));
})();

/* --- floating chevron (toggle left panel) --- */
(function(){
  const tab = document.getElementById('chevronTab');
  const left = document.getElementById('leftPanel');
  let collapsed = false;

  function setChevronDir(){
    tab.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24"><path d="M14.71 17.29a1 1 0 01-1.42 0L9 13l4.29-4.29a1 1 0 011.42 1.42L10.83 13l3.88 3.88a1 1 0 010 1.41z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>';
  }
  setChevronDir();

  tab.addEventListener('click', ()=>{
    collapsed = !collapsed;
    left.style.display = collapsed ? 'none' : 'block';
    setChevronDir();
  });
})();

/* --- theme toggle --- */
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

/* --- wire buttons (page provides runLang/clearLang) --- */
(function(){
  const runBtn = document.getElementById('btnRun');
  const resetBtn = document.getElementById('btnReset');

  runBtn?.addEventListener('click', async ()=>{
    try{
      clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();
      await window.runLang(); setStatus('OK','ok');
    }catch(e){
      setStatus('Error','err');
      const m = /line\s*(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i.exec(e?.message||'');
      showEditorError((e?.message)||String(e), m?Number(m[1]):1, m?Number(m[2]||1):1);
    }finally{
      spin(false);
    }
  });

  resetBtn?.addEventListener('click', ()=>{
    try{ window.clearLang && window.clearLang(); }catch{}
    clearEditorErrors(); setStatus('Reset','ok'); unfreezeUI();
  });
})();

/* --- load left pane content from /content/<lang>.html --- */
async function loadLeftContent(lang){
  const el = document.getElementById('leftContent');
  if (!el) return;
  try{
    const res = await fetch(`./content/${lang}.html`, { cache:'no-store' });
    el.innerHTML = res.ok ? await res.text() : '';
  }catch{ el.innerHTML = ''; }
}

window.PolyShell = { initMonaco, setStatus, spin, showEditorError, clearEditorErrors, freezeUI, unfreezeUI, loadLeftContent };

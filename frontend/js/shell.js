/* status + spinner */
function setStatus(t,c){ const e=document.getElementById('status'); if(!e) return; e.textContent=t; e.className=(c||''); }
function spin(on){ const s=document.getElementById('spinner'); if(s) s.style.display=on?'inline-block':'none'; }

/* monaco (minimap disabled) */
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







/* helpers to get/set grid columns */
function parseCols(str){
  // returns numeric pixel widths for [left, spacer, center, spacer, right]
  return str.split(' ').map(s=>{
    if(s.endsWith('px')) return parseFloat(s);
    return s; // keep 'minmax(...)' / '1fr' etc
  });
}
function setCols(app, L, C, R){
  app.style.gridTemplateColumns = `${L}px 8px ${C}px 8px ${R}px`;
}

/* initialize widths once */
function initCols(){
  const app = document.querySelector('.app');
  const rect = app.getBoundingClientRect();
  // If no inline style yet, compute from panel rects
  const L = document.getElementById('leftPanel').getBoundingClientRect().width;
  const C = document.getElementById('centerPanel').getBoundingClientRect().width;
  const R = document.getElementById('rightPanel').getBoundingClientRect().width;
  setCols(app, Math.max(200,L), Math.max(360,C), Math.max(320,R));
}

/* resizers (only center<->right resize; left resizer only adjusts left) */
(function(){
  const app = document.querySelector('.app');
  const dragLeft = document.getElementById('dragLeft');
  const dragRight = document.getElementById('dragRight');

  function startDrag(e, side){
    e.preventDefault();
    const rectC = document.getElementById('centerPanel').getBoundingClientRect();
    const rectR = document.getElementById('rightPanel').getBoundingClientRect();
    const rectL = document.getElementById('leftPanel').getBoundingClientRect();
    const startX = e.clientX;

    // current inline columns
    const [L, , C, , R] = parseCols(getComputedStyle(app).gridTemplateColumns);

    function move(ev){
      const dx = ev.clientX - startX;

      if(side==='left'){
        const newL = Math.max(200, L + dx);
        setCols(app, newL, C, R);
      }else{
        // grow right when dragging left (<-), shrink when dragging right (->)
        let newR = Math.max(300, R - dx);
        let newC = Math.max(360, C + dx);
        const totalCR = C + R;
        // maintain total width to avoid shift
        if(newC + newR !== totalCR){
          // lock total and clamp mins
          newC = Math.max(360, totalCR - newR);
          newR = totalCR - newC;
        }
        setCols(app, L, newC, newR);
      }
    }
    function up(){ window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.userSelect=''; }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.userSelect='none';
  }

  dragLeft?.addEventListener('mousedown', e=> startDrag(e,'left'));
  dragRight?.addEventListener('mousedown', e=> startDrag(e,'right'));
  window.addEventListener('load', initCols);
  window.addEventListener('resize', initCols);
})();


(function(){
  const app = document.querySelector('.app');
  const tab = document.getElementById('chevronTab');
  let collapsed = false;

  function icon(){
    tab.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24"><path d="M14.71 17.29a1 1 0 01-1.42 0L9 13l4.29-4.29a1 1 0 011.42 1.42L10.83 13l3.88 3.88a1 1 0 010 1.41z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>';
  }
  icon();

  tab.addEventListener('click', ()=>{
    collapsed = !collapsed;
    app.classList.toggle('collapsed-left', collapsed);

    // when collapsing, push width to center; when expanding, restore default init
    const [L, , C, , R] = parseCols(getComputedStyle(app).gridTemplateColumns);
    if(collapsed){
      setCols(app, 0, C + L, R);
    }else{
      const newL = Math.max(240, 280); // default left
      setCols(app, newL, Math.max(360, C - newL), R);
    }
    icon();
  });
})();





















/* markers */
function showEditorError(msg, line=1, col=1){
  if(!window.editor || !window.monaco) return;
  monaco.editor.setModelMarkers(editor.getModel(), 'polycode', [{
    startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: col+1,
    message: msg, severity: monaco.MarkerSeverity.Error
  }]);
}
function clearEditorErrors(){
  if(!window.editor || !window.monaco) return;
  monaco.editor.setModelMarkers(editor.getModel(), 'polycode', []);
}

/* freeze/unfreeze + visual tone */
function panels(){ return {
  left:document.getElementById('leftPanel'),
  center:document.getElementById('centerPanel'),
  right:document.getElementById('rightPanel')
};}
function setFrozen(all, frozen){
  ['left','center','right'].forEach(k=> all[k]?.classList.toggle('frozen', frozen));
}
function freezeUI(){
  const {left,center,right}=panels();
  document.getElementById('btnRun')?.setAttribute('disabled','');
  document.getElementById('btnReset')?.removeAttribute('disabled');
  document.getElementById('langSelect')?.setAttribute('disabled','');
  editor?.updateOptions({ readOnly:true });
  document.getElementById('output')?.classList.remove('screen-dim');
  setFrozen({left,center,right}, true);
}
function unfreezeUI(){
  const {left,center,right}=panels();
  document.getElementById('btnRun')?.removeAttribute('disabled');
  document.getElementById('btnReset')?.setAttribute('disabled','');
  document.getElementById('langSelect')?.removeAttribute('disabled');
  editor?.updateOptions({ readOnly:false });
  document.getElementById('output')?.classList.add('screen-dim');
  setFrozen({left,center,right}, false);
}
window.addEventListener('DOMContentLoaded', ()=> unfreezeUI());

/* collapse/expand left (13) – grid reflows widths */
(function(){
  const app = document.querySelector('.app');
  const tab = document.getElementById('chevronTab');
  let collapsed = false;
  function icon(){
    tab.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24"><path d="M14.71 17.29a1 1 0 01-1.42 0L9 13l4.29-4.29a1 1 0 011.42 1.42L10.83 13l3.88 3.88a1 1 0 010 1.41z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>';
  }
  icon();
  tab.addEventListener('click', ()=>{ collapsed=!collapsed; app.classList.toggle('collapsed-left', collapsed); icon(); });
})();

/* resizers – left handle sets left width; right handle adjusts RIGHT (14) */
(function(){
  const app = document.querySelector('.app');
  const leftPanel = document.getElementById('leftPanel');
  const centerPanel = document.getElementById('centerPanel');
  const rightPanel = document.getElementById('rightPanel');
  const dragLeft = document.getElementById('dragLeft');
  const dragRight = document.getElementById('dragRight');

  function startDrag(e, side){
    e.preventDefault();
    const startX = e.clientX;
    const rectCenter = centerPanel.getBoundingClientRect();
    const rectRight  = rightPanel.getBoundingClientRect();
    const rectLeft   = leftPanel.getBoundingClientRect();
    const totalCR = rectCenter.width + rectRight.width;

    function move(ev){
      const dx = ev.clientX - startX;

      if(side==='left'){
        const newLeft = Math.max(200, rectLeft.width + dx);
        leftPanel.style.width = newLeft+'px';
        leftPanel.style.flexBasis = newLeft+'px';
      }else{
        // Grow/shrink right; center gets the rest
        let newRight = Math.max(300, Math.min(totalCR - 320, rectRight.width - dx));
        let newCenter = totalCR - newRight;
        rightPanel.style.width = newRight+'px';
        rightPanel.style.flexBasis = newRight+'px';
        centerPanel.style.width = newCenter+'px';
        centerPanel.style.flexBasis = newCenter+'px';
      }
    }
    function up(){
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.userSelect='';
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.userSelect='none';
  }
  dragLeft?.addEventListener('mousedown', e=> startDrag(e,'left'));
  dragRight?.addEventListener('mousedown', e=> startDrag(e,'right'));
})();

/* theme toggle (icon) */
(function(){
  const btn = document.getElementById('themeToggle');
  const ico = document.getElementById('themeIcon');
  if(!btn || !ico) return;
  btn.addEventListener('click', ()=>{
    const toLight = !document.body.classList.contains('light');
    document.body.classList.toggle('light', toLight);
    // swap icon: moon ↔ sun
    ico.innerHTML = toLight
      ? '<path d="M6.76 4.84l-1.8-1.79L3.17 4.84l1.8 1.79L6.76 4.84zM1 10.5H4v3H1v-3zm9.5 9.5h3v-3h-3v3zM20 10.5h3v3h-3v-3zM17.24 4.84l1.79-1.79 1.79 1.79-1.79 1.79-1.79-1.79zM12 5a7 7 0 100 14 7 7 0 000-14z"/>'
      : '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
    if(window.editor && window.monaco){
      monaco.editor.setTheme(toLight ? 'vs' : 'vs-dark');
    }
  });
})();

/* run/reset handlers with animations (7) */
(function(){
  const runBtn = document.getElementById('btnRun');
  const rstBtn = document.getElementById('btnReset');

  runBtn?.addEventListener('click', async ()=>{
    try{
      runBtn.classList.add('is-running');
      clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();
      await window.runLang(); setStatus('OK','ok');
    }catch(e){
      setStatus('Error','err');
      const m = /line\s*(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i.exec(e?.message||'');
      showEditorError((e?.message)||String(e), m?Number(m[1]):1, m?Number(m[2]||1):1);
    }finally{
      spin(false);
      runBtn.classList.remove('is-running');
    }
  });

  rstBtn?.addEventListener('click', ()=>{
    try{ window.clearLang && window.clearLang(); }catch{}
    rstBtn.classList.add('is-resetting');
    setTimeout(()=> rstBtn.classList.remove('is-resetting'), 900);
    clearEditorErrors(); setStatus('Reset','ok'); unfreezeUI();
  });
})();

/* load left content helper (unchanged) */
async function loadLeftContent(lang){
  const el = document.getElementById('leftContent');
  if (!el) return;
  try{
    const res = await fetch(`./content/${lang}.html`, { cache:'no-store' });
    el.innerHTML = res.ok ? await res.text() : '';
  }catch{ el.innerHTML = ''; }
}

window.PolyShell = { initMonaco, setStatus, showEditorError, clearEditorErrors, loadLeftContent };

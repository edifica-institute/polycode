/* =========================================================
   PolyCode — Shell JS (full file)
   - Grid-based resizing (no overlap)
   - Left collapse/expand with chevron
   - Theme toggle (dark default, .light class toggled)
   - Per-panel bottom bars (live status)
   - Glow animations for Run / Reset
   - Frozen state styling
   - Monaco editor bootstrap with minimap disabled
   - Error markers in editor
   - Loads left pane content from /content/<lang>.html
   - Page must define: window.runLang() and window.clearLang()
   ========================================================= */

/* ---------- Quick DOM helpers ---------- */
function $(sel){ return document.querySelector(sel); }
function byId(id){ return document.getElementById(id); }

/* Keep refs centralized */
function panels(){
  return {
    app: $('.app'),
    left: byId('leftPanel'),
    center: byId('centerPanel'),
    right: byId('rightPanel'),
    dragLeft: byId('dragLeft'),
    dragRight: byId('dragRight'),
    chevron: byId('chevronTab'),
    themeBtn: byId('themeToggle'),
    themeIcon: byId('themeIcon'),
    langSelect: byId('langSelect'),
    editorHost: byId('editor'),
    outputHost: byId('output'),
    footLeft: byId('leftFoot'),
    footCenter: byId('centerFoot'),
    footRight: byId('rightFoot'),
    runBtn: byId('btnRun'),
    resetBtn: byId('btnReset'),
  };
}

/* Footer text helper */
function foot(id, text){ const el = byId(id); if(el) el.textContent = text; }

/* =========================================================
   Monaco Editor
========================================================= */
function initMonaco({ value, language }) {
  return new Promise(resolve=>{
    // AMD loader path
    window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }});
    window.require(['vs/editor/editor.main'], function(){
      window.editor = monaco.editor.create(byId('editor'), {
        value, language,
        automaticLayout: true,
        minimap: { enabled: false },
        theme: document.body.classList.contains('light') ? 'vs' : 'vs-dark'
      });
      resolve();
    });
  });
}

/* Editor markers */
function showEditorError(message, line=1, column=1){
  if(!window.editor || !window.monaco) return;
  const model = editor.getModel();
  monaco.editor.setModelMarkers(model, 'polycode', [{
    startLineNumber: line, startColumn: column,
    endLineNumber: line, endColumn: column+1,
    message, severity: monaco.MarkerSeverity.Error
  ]]);
}
function clearEditorErrors(){
  if(!window.editor || !window.monaco) return;
  monaco.editor.setModelMarkers(editor.getModel(), 'polycode', []);
}

/* =========================================================
   Frozen / Active states
========================================================= */
function setFrozen(all, frozen){
  ['left','center','right'].forEach(k => all[k]?.classList.toggle('frozen', frozen));
  // Controls
  all.runBtn?.toggleAttribute('disabled', frozen);
  all.resetBtn?.toggleAttribute('disabled', !frozen);
  all.langSelect?.toggleAttribute('disabled', frozen);
  if(window.editor) editor.updateOptions({ readOnly: frozen });
  // Bottom bars
  if (frozen){
    foot('centerFoot','Click Reset for your next code');
    foot('rightFoot','Executing…');
  } else {
    foot('centerFoot','Ready for Execution');
    foot('rightFoot','Waiting for Execution');
  }
}

/* =========================================================
   Grid Column Resizing (no overlap)
   Columns: [Left] [8px] [Center] [8px] [Right]
========================================================= */
function parseCols(str){
  return str.split(' ').map(s=>{
    const x = s.trim();
    if (x.endsWith('px')) return parseFloat(x);
    return x; // keep minmax/fr for safety (we override with px later)
  });
}
function setCols(app, L, C, R){
  app.style.gridTemplateColumns =
    `${Math.max(0,Math.round(L))}px 8px ${Math.max(0,Math.round(C))}px 8px ${Math.max(0,Math.round(R))}px`;
}
function initCols(){
  const { app, left, center, right } = panels();
  if(!app || !left || !center || !right) return;
  const L = left.getBoundingClientRect().width || 280;
  const C = center.getBoundingClientRect().width || 560;
  const R = right.getBoundingClientRect().width || 360;
  setCols(app, Math.max(200, L), Math.max(360, C), Math.max(300, R));
}

function wireResizers(){
  const { app, dragLeft, dragRight } = panels();
  if(!app) return;

  function startDrag(e, side){
    e.preventDefault();
    const styles = getComputedStyle(app);
    const [L,,C,,R] = parseCols(styles.gridTemplateColumns);
    const startX = e.clientX;
    const totalCR = (typeof C === 'number' ? C : 600) + (typeof R === 'number' ? R : 360);

    function move(ev){
      const dx = ev.clientX - startX;

      if(side==='left'){
        const newL = Math.max(200, (typeof L==='number'? L:280) + dx);
        setCols(app, newL, (typeof C==='number'? C:560), (typeof R==='number'? R:360));
      } else {
        // Right handle: trade width between Center and Right; keep total constant
        let newR = Math.max(300, (typeof R==='number'? R:360) - dx);
        let newC = totalCR - newR;
        newC = Math.max(360, newC);
        newR = totalCR - newC;
        setCols(app, (typeof L==='number'? L:280), newC, newR);
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

  window.addEventListener('load', initCols);
  window.addEventListener('resize', initCols);
}

/* =========================================================
   Collapse / Expand Left Pane
========================================================= */
function wireChevron(){
  const { app, chevron } = panels();
  if(!app || !chevron) return;

  let collapsed = false;
  function setIcon(){
    chevron.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24"><path d="M14.71 17.29a1 1 0 01-1.42 0L9 13l4.29-4.29a1 1 0 011.42 1.42L10.83 13l3.88 3.88a1 1 0 010 1.41z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>';
  }
  setIcon();

  chevron.addEventListener('click', ()=>{
    collapsed = !collapsed;
    app.classList.toggle('collapsed-left', collapsed);

    // When collapsing: give Left width to Center so Editor shifts left.
    const [L,,C,,R] = parseCols(getComputedStyle(app).gridTemplateColumns);
    if (collapsed) {
      const l = (typeof L==='number'? L:280);
      const c = (typeof C==='number'? C:560) + l;
      const r = (typeof R==='number'? R:360);
      setCols(app, 0, c, r);
    } else {
      const defL = 280;
      const c = Math.max(360, (typeof C==='number'? C:560) - defL);
      const r = (typeof R==='number'? R:360);
      setCols(app, defL, c, r);
    }
    setIcon();
  });
}

/* =========================================================
   Theme Toggle (icon button)
========================================================= */
function wireTheme(){
  const { themeBtn, themeIcon } = panels();
  if(!themeBtn) return;

  function setEditorTheme(){
    if (window.editor && window.monaco){
      monaco.editor.setTheme(document.body.classList.contains('light') ? 'vs' : 'vs-dark');
    }
  }
  function setIconLight(isLight){
    if(!themeIcon) return;
    // Sun icon for light, moon-ish for dark
    themeIcon.innerHTML = isLight
      ? '<path d="M6.76 4.84l-1.8-1.79L3.17 4.84l1.8 1.79L6.76 4.84zM1 10.5H4v3H1v-3zm9.5 9.5h3v-3h-3v3zM20 10.5h3v3h-3v-3zM17.24 4.84l1.79-1.79 1.79 1.79-1.79 1.79-1.79-1.79zM12 5a7 7 0 100 14 7 7 0 000-14z"/>'
      : '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  }

  themeBtn.addEventListener('click', ()=>{
    const toLight = !document.body.classList.contains('light');
    document.body.classList.toggle('light', toLight);
    setEditorTheme();
    setIconLight(toLight);
  });

  // initial icon state
  setIconLight(document.body.classList.contains('light'));
}

/* =========================================================
   Run / Reset wiring (glow + footers + freeze)
========================================================= */
function wireRunReset(){
  const { runBtn, resetBtn } = panels();
  if(runBtn){
    runBtn.addEventListener('click', async ()=>{
      runBtn.classList.add('is-running');
      try{
        clearEditorErrors();
        setFrozen(panels(), true);            // freeze + bottom bars update
        await window.runLang?.();             // page implements this
        foot('rightFoot', 'Execution Success');
      }catch(e){
        foot('rightFoot', 'Executed with Error');
        // parse "line X, col Y" if present
        const m = /line\s*(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i.exec(e?.message||'');
        showEditorError(e?.message || String(e), m?Number(m[1]):1, m?Number(m[2]||1):1);
      }finally{
        runBtn.classList.remove('is-running');
      }
    });
  }

  if(resetBtn){
    resetBtn.setAttribute('disabled','');     // disabled until a run happens
    resetBtn.addEventListener('click', ()=>{
      resetBtn.classList.add('is-resetting');
      setTimeout(()=> resetBtn.classList.remove('is-resetting'), 900);
      try{ window.clearLang?.(); }catch{}
      clearEditorErrors();
      setFrozen(panels(), false);             // unfreeze + reset bottom bars
    });
  }
}

/* =========================================================
   Left Content Loader
========================================================= */
async function loadLeftContent(lang){
  const el = byId('leftContent');
  if (!el) return;
  try{
    const res = await fetch(`./content/${lang}.html`, { cache:'no-store' });
    el.innerHTML = res.ok ? await res.text() : '';
  }catch{
    el.innerHTML = '';
  }
}

/* =========================================================
   Init
========================================================= */
window.addEventListener('DOMContentLoaded', ()=>{
  // initial bottom bars
  foot('leftFoot','About selected language');
  foot('centerFoot','Ready for Execution');
  foot('rightFoot','Waiting for Execution');

  wireResizers();
  wireChevron();
  wireTheme();
  wireRunReset();
  // Note: Monaco is initialized by each page after setting its language + sample code
});

/* Public API for pages */
window.PolyShell = {
  initMonaco,
  showEditorError,
  clearEditorErrors,
  loadLeftContent
};

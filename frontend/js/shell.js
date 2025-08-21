
// Start idle animation immediately on page load
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnRun')?.classList.add('idle-attract');
  document.getElementById('btnReset')?.classList.add('idle-attract');
});



/* ===========================
   theme toggle (dark <-> light)
=========================== */
(function(){
  const btn = document.getElementById('themeToggle');
  const ico = document.getElementById('themeIcon');
  if (!btn || !ico) return;

  function setIcon(isLight){
    // sun for light, moon for dark
    ico.innerHTML = isLight
      ? '<path d="M6.76 4.84l-1.8-1.79L3.17 4.84l1.8 1.79L6.76 4.84zM1 10.5H4v3H1v-3zm9.5 9.5h3v-3h-3v3zM20 10.5h3v3h-3v-3zM17.24 4.84l1.79-1.79 1.79 1.79-1.79 1.79-1.79-1.79zM12 5a7 7 0 100 14 7 7 0 000-14z"/>'
      : '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  }

  btn.addEventListener('click', () => {
    const toLight = !document.body.classList.contains('light');
    document.body.classList.toggle('light', toLight);
    setIcon(toLight);
    if (window.editor && window.monaco) {
      monaco.editor.setTheme(toLight ? 'vs' : 'vs-dark');
    }
  });

  // set initial icon based on current body class
  setIcon(document.body.classList.contains('light'));
})();



/* ===========================
   status + spinner
=========================== */
function setStatus(t, c) {
  const e = document.getElementById('status');
  if (!e) return;
  e.textContent = t;
  e.className = (c || '');
}
function spin(on) {
  const s = document.getElementById('spinner');
  if (s) s.style.display = on ? 'inline-block' : 'none';
}

/* ===========================
   monaco (minimap disabled)
=========================== */
function initMonaco({ value, language }) {
  return new Promise(resolve => {
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
      window.editor = monaco.editor.create(document.getElementById('editor'), {
        value, language,
        theme: document.body.classList.contains('light') ? 'vs' : 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false }
      });
      resolve();
    });
  });
}

/* ===========================
   grid column helpers
=========================== */
function parseCols(str) {
  // returns numeric pixel widths for [left, spacer, center, spacer, right]
  return str.split(' ').map(s => {
    if (s.endsWith('px')) return parseFloat(s);
    return s; // keep 'minmax(...)' / '1fr' etc
  });
}
function setCols(app, L, C, R) {
  app.style.gridTemplateColumns = `${L}px 8px ${C}px 8px ${R}px`;
}

function initCols() {
  const app = document.querySelector('.app');
  if (!app) return;
  // compute from current panel rects
  const L = document.getElementById('leftPanel')?.getBoundingClientRect().width || 280;
  const C = document.getElementById('centerPanel')?.getBoundingClientRect().width || 720;
  const R = document.getElementById('rightPanel')?.getBoundingClientRect().width || 360;
  setCols(app, Math.max(200, L), Math.max(360, C), Math.max(300, R));
}

/* ===========================
   resizers (left and right)
   - grid-based; keeps total C+R constant
=========================== */
(function () {
  const app = document.querySelector('.app');
  const dragLeft = document.getElementById('dragLeft');
  const dragRight = document.getElementById('dragRight');
  if (!app) return;

  function startDrag(e, side) {
    e.preventDefault();
    const startX = e.clientX;

    // current inline columns
    const [L, , C, , R] = parseCols(getComputedStyle(app).gridTemplateColumns);
    const totalCR = C + R;

    function move(ev) {
      const dx = ev.clientX - startX;

      if (side === 'left') {
        const newL = Math.max(200, L + dx);
        setCols(app, newL, C, R);
      } else {
        // right handle: adjust C and R but preserve total
        let newR = Math.max(300, R - dx);
        let newC = totalCR - newR;
        // clamp center minimum
        if (newC < 360) {
          newC = 360;
          newR = totalCR - newC;
        }
        setCols(app, L, newC, newR);
      }
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.userSelect = 'none';
  }

  dragLeft?.addEventListener('mousedown', e => startDrag(e, 'left'));
  dragRight?.addEventListener('mousedown', e => startDrag(e, 'right'));

  window.addEventListener('load', initCols);
  window.addEventListener('resize', initCols);
})();

/* ===========================
   collapse/expand left panel
=========================== */
(function () {
  const app = document.querySelector('.app');
  const tab = document.getElementById('chevronTab');
  if (!app || !tab) return;

  let collapsed = false;

  function icon() {
    tab.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24"><path d="M14.71 17.29a1 1 0 01-1.42 0L9 13l4.29-4.29a1 1 0 011.42 1.42L10.83 13l3.88 3.88a1 1 0 010 1.41z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>';
  }
  icon();

  tab.addEventListener('click', () => {
    collapsed = !collapsed;
    app.classList.toggle('collapsed-left', collapsed);

    const [L, , C, , R] = parseCols(getComputedStyle(app).gridTemplateColumns);
    if (collapsed) {
      // push left width into center
      setCols(app, 0, C + L, R);
    } else {
      const desiredL = 280;
      const newL = Math.max(240, desiredL);
      const spaceForCenter = Math.max(360, C - (newL - L));
      setCols(app, newL, spaceForCenter, R);
    }
    icon();
  });
})();

/* ===========================
   footer helpers
=========================== */
function foot(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ===========================
   editor markers
=========================== */
function showEditorError(msg, line = 1, col = 1) {
  if (!window.editor || !window.monaco) return;
  monaco.editor.setModelMarkers(editor.getModel(), 'polycode', [{
    startLineNumber: line, startColumn: col,
    endLineNumber: line, endColumn: col + 1,
    message: msg, severity: monaco.MarkerSeverity.Error
  }]);
}
function clearEditorErrors() {
  if (!window.editor || !window.monaco) return;
  monaco.editor.setModelMarkers(editor.getModel(), 'polycode', []);
}

/* ===========================
   freeze/unfreeze + visual tone
=========================== */
function panels() {
  return {
    left: document.getElementById('leftPanel'),
    center: document.getElementById('centerPanel'),
    right: document.getElementById('rightPanel')
  };
}
function setFrozen(all, frozen) {
  ['left', 'center', 'right'].forEach(k => all[k]?.classList.toggle('frozen', frozen));
}

function freezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.setAttribute('disabled', '');
  document.getElementById('btnReset')?.removeAttribute('disabled');
  document.getElementById('langSelect')?.setAttribute('disabled', '');
  window.editor?.updateOptions({ readOnly: true });
  document.getElementById('output')?.classList.remove('screen-dim');
  setFrozen(all, true);

  // bottom-bar messages
  foot('centerFoot', 'Click Reset for your next code');
  foot('rightFoot', 'Executing…');
}
function unfreezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.removeAttribute('disabled');
  document.getElementById('btnReset')?.setAttribute('disabled', '');
  document.getElementById('langSelect')?.removeAttribute('disabled');
  window.editor?.updateOptions({ readOnly: false });
  document.getElementById('output')?.classList.add('screen-dim');
  setFrozen(all, false);

  foot('centerFoot', 'Ready for Execution');
  foot('rightFoot', 'Waiting for Execution');
}

/* ===========================
   initial footer state
=========================== */
window.addEventListener('DOMContentLoaded', () => {
  foot('centerFoot', 'Ready for Execution');
  foot('rightFoot', 'Waiting for Execution');
  unfreezeUI();
});

/* ===========================
   run/reset handlers with animations
=========================== */
(function () {
  const runBtn = document.getElementById('btnRun');
  const rstBtn = document.getElementById('btnReset');

  // RUN
runBtn?.addEventListener('click', async () => {
  try{
    runBtn.classList.add('is-running');
    // optional: keep idle class; active rules have higher specificity
    // or remove idle if you don’t want stacked animations:
    // runBtn.classList.remove('idle-attract');

    clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();
    await window.runLang();
    setStatus('OK','ok'); foot('rightFoot','Execution Success');
  }catch(e){
    setStatus('Error','err'); foot('rightFoot','Executed with Error');
    const m=/line\s*(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i.exec(e?.message||'');
    showEditorError((e?.message)||String(e), m?Number(m[1]):1, m?Number(m[2]||1):1);
  }finally{
    spin(false);
    runBtn.classList.remove('is-running');
    // optional: re-enable idle attract after completing
    runBtn.classList.add('idle-attract');
  }
});

// RESET
rstBtn?.addEventListener('click', () => {
  try{ window.clearLang && window.clearLang(); }catch{}
  rstBtn.classList.add('is-resetting');
  // optional: rstBtn.classList.remove('idle-attract');

  setTimeout(()=>{
    rstBtn.classList.remove('is-resetting');
    // optional: re-enable idle attract after the pulse
    rstBtn.classList.add('idle-attract');
  }, 1500);

  clearEditorErrors(); setStatus('Reset','ok'); unfreezeUI();
});

/* ===========================
   load left content helper
=========================== */
async function loadLeftContent(lang) {
  const el = document.getElementById('leftContent');
  if (!el) return;
  try {
    const res = await fetch(`./content/${lang}.html`, { cache: 'no-store' });
    el.innerHTML = res.ok ? await res.text() : '';
  } catch {
    el.innerHTML = '';
  }
}

/* ===========================
   export minimal API
=========================== */
window.PolyShell = {
  initMonaco,
  setStatus,
  showEditorError,
  clearEditorErrors,
  loadLeftContent
};

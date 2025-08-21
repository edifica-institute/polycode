// Start idle animation immediately on page load

/* ===========================
   load left content helper (scoped)
=========================== */



async function loadLeftContent(lang){
  const el = document.getElementById('leftContent');
  if (!el) return;

  try{
    const res = await fetch(`./content/${lang}.html`, { cache:'no-store' });
    if(!res.ok){ el.innerHTML = ''; return; }

    const raw = await res.text();

    // pull out body content if present
    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const innerHTML = bodyMatch ? bodyMatch[1] : raw;

    // scope any <style> blocks so html/body rules don’t leak
    const styleBlocks = [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
    const scopedCSS = styleBlocks.map(css =>
      css
        .replace(/(^|[}\s;])\s*html\b/g,  '$1 #leftContent')
        .replace(/(^|[}\s;])\s*body\b/g,  '$1 #leftContent')
        .replace(/(^|[}\s;])\s*:root\b/g, '$1 #leftContent')
    ).join('\n');

    el.innerHTML = '';
    if (scopedCSS){
      const styleEl = document.createElement('style');
      styleEl.textContent = scopedCSS;
      el.appendChild(styleEl);
    }

    const host = document.createElement('div');
    host.className = 'left-doc';
    host.innerHTML = innerHTML;
    el.appendChild(host);

    // belt & suspenders: ensure the scroll container is active
    const paneBody = el.closest('.pane-body');
    if (paneBody){
      paneBody.style.height = 'auto';
      paneBody.style.minHeight = '0';
      paneBody.style.overflowY = 'auto';
    }
  }catch{
    el.innerHTML = '';
  }
}





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

   if (window.innerWidth <= 1024) return; // stacked mode; no grid math
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
/* ===========================
   resizers (left & right) — safe clamps
   - Left handle: redistribute between LEFT <-> CENTER (keep L+C constant)
   - Right handle: redistribute between CENTER <-> RIGHT (keep C+R constant)
=========================== */
(function () {
  // Disable resizers on small screens (stacked layout)
  if (window.innerWidth <= 1024) return;

  const app = document.querySelector('.app');
  const dragLeft  = document.getElementById('dragLeft');
  const dragRight = document.getElementById('dragRight');
  if (!app) return;

  function startDrag(e, side) {
    e.preventDefault();
    const startX = e.clientX;

    // Get current numeric px widths from the computed grid
    const [L, , C, , R] = parseCols(getComputedStyle(app).gridTemplateColumns);

    // Totals to preserve depending on the handle
    const totalLC = L + C;   // left handle redistributes L <-> C
    const totalCR = C + R;   // right handle redistributes C <-> R

    // Minimum widths (px)
    const minL = 200, minC = 360, minR = 300;

    function move(ev) {
      const dx = ev.clientX - startX;

      if (side === 'left') {
        // Keep L + C constant; only shift between them
        let newL = L + dx;
        let newC = totalLC - newL;

        // Clamp so neither collapses nor overgrows
        if (newL < minL) { newL = minL; newC = totalLC - newL; }
        if (newC < minC) { newC = minC; newL = totalLC - newC; }
        // Prevent making left too big: max left is totalLC - minC
        if (newL > totalLC - minC) { newL = totalLC - minC; newC = minC; }

        setCols(app, newL, newC, R);
      } else {
        // Right handle: keep C + R constant
        let newR = R - dx;          // dragging left increases R, right decreases R
        let newC = totalCR - newR;

        // Clamp to minimums
        if (newR < minR) { newR = minR; newC = totalCR - newR; }
        if (newC < minC) { newC = minC; newR = totalCR - newC; }

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
})();


/* ===========================
   collapse/expand left panel
=========================== */
(function () {
  const app = document.querySelector('.app');
  const tab = document.getElementById('chevronTab');
  if (!app || !tab) return;

  let collapsed = window.innerWidth <= 1024;

  function icon() {
    tab.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24"><path d="M14.71 17.29a1 1 0 01-1.42 0L9 13l4.29-4.29a1 1 0 011.42 1.42L10.83 13l3.88 3.88a1 1 0 010 1.41z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>';
  }
  icon();
 if (collapsed) app.classList.add('collapsed-left');

   
  tab.addEventListener('click', () => {
    collapsed = !collapsed;
    app.classList.toggle('collapsed-left', collapsed);

     if (window.innerWidth > 1024){
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
function setFrozen(all, frozen, { excludeRight = false } = {}){
  ['left','center','right'].forEach(k => {
    if (excludeRight && k === 'right') return;
    all[k]?.classList.toggle('frozen', frozen);
  });
}



/*window.addEventListener('DOMContentLoaded', () => {
  foot('centerFoot', 'Ready for Execution');
  foot('rightFoot', 'Waiting for Execution');
  unfreezeUI();
  setAttention({ run: true }); // highlight Run initially
   //setFootStatus('centerFoot','ready');
  //setFootStatus('rightFoot','waiting');
});*/


function setAttention({run=false, reset=false}={}){
  const runBtn = document.getElementById('btnRun');
  const rstBtn = document.getElementById('btnReset');
  // clear both
  runBtn?.classList.remove('attn');
  rstBtn?.classList.remove('attn');
  // set desired
  if(run)  runBtn?.classList.add('attn');
  if(reset) rstBtn?.classList.add('attn');
}




function setFootStatus(id, state){
  const host = document.getElementById(id);
  if (!host) return;

  const label = {
    ready:   'Ready for Execution',
    waiting: 'Waiting for Execution',
    running: 'Executing…',
    success: 'Execution Success',
    error:   'Executed with Error'
  }[state] || '';

  // Build dots only for waiting
  const dots = state === 'waiting'
    ? '<span class="dots"><span></span><span></span><span></span></span>'
    : '';

  host.className = 'msg status ' + state;
  host.innerHTML = `<span class="icon" aria-hidden="true"></span><span class="text">${label}${dots}</span>`;
}



function freezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.setAttribute('disabled','');
  document.getElementById('btnReset')?.removeAttribute('disabled');
  document.getElementById('langSelect')?.setAttribute('disabled','');
  window.editor?.updateOptions({ readOnly:true });

  // Output should be LIVE during run
  document.getElementById('output')?.classList.remove('screen-dim');

  // Freeze only left + center (keep right active)
  setFrozen(all, true, { excludeRight: true });

  // Center footer can be plain text if you like:
  foot('centerFoot','Click Reset for your next code');

  // Right footer should use the animated status markup
  setFootStatus('rightFoot','running');

  // Next action: Reset
  setAttention({ reset: true });
}

function unfreezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.removeAttribute('disabled');
  document.getElementById('btnReset')?.setAttribute('disabled','');
  document.getElementById('langSelect')?.removeAttribute('disabled');
  window.editor?.updateOptions({ readOnly:false });

  // Dim the output when idle
  document.getElementById('output')?.classList.add('screen-dim');

  setFrozen(all, false);

  // Use animated statuses for both feet on idle
  setFootStatus('centerFoot','ready');
  setFootStatus('rightFoot','waiting');

  // Next action: Run
  setAttention({ run: true });
}






/*function freezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.setAttribute('disabled','');
  document.getElementById('btnReset')?.removeAttribute('disabled');
  document.getElementById('langSelect')?.setAttribute('disabled','');
  window.editor?.updateOptions({ readOnly:true });

  // Output should be LIVE during run
  document.getElementById('output')?.classList.remove('screen-dim');

  // Freeze only left + center (exclude the right/output panel)
  setFrozen(all, true, { excludeRight: true });

  foot('centerFoot','Click Reset for your next code');
  foot('rightFoot','Executing…');

  setAttention({ reset: true }); // highlight Reset as next action
   setFootStatus('rightFoot','running');
}


function unfreezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.removeAttribute('disabled');
  document.getElementById('btnReset')?.setAttribute('disabled','');
  document.getElementById('langSelect')?.removeAttribute('disabled');
  window.editor?.updateOptions({ readOnly:false });
  document.getElementById('output')?.classList.add('screen-dim');
  setFrozen(all, false);

  foot('centerFoot','Ready for Execution');
  foot('rightFoot','Waiting for Execution');

  setAttention({ run: true }); // << show Run as the next action
   setFootStatus('centerFoot','ready');
  setFootStatus('rightFoot','waiting');
}*/


/* ===========================
   initial footer state
=========================== */
/*window.addEventListener('DOMContentLoaded', () => {
  foot('centerFoot', 'Ready for Execution');
  foot('rightFoot', 'Waiting for Execution');
  unfreezeUI();
});*/

/*
window.addEventListener('DOMContentLoaded', () => {
  unfreezeUI();                 // this calls setFootStatus('ready'/'waiting')
  setAttention({ run: true });  // glow on the Run button
});*/


/* ===========================
   run/reset handlers with animations
=========================== */
/*(function () {
  const runBtn = document.getElementById('btnRun');
  const rstBtn = document.getElementById('btnReset');

  // RUN
  runBtn?.addEventListener('click', async () => {
    try{
      runBtn.classList.add('is-running');
      // optional: runBtn.classList.remove('idle-attract');

      clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();
      await window.runLang();
      setStatus('OK','ok'); foot('rightFoot','Execution Success');
       setFootStatus('rightFoot','success');
    }catch(e){
      setStatus('Error','err'); foot('rightFoot','Executed with Error');
       setFootStatus('rightFoot','error');
      const m=/line\s*(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i.exec(e?.message||'');
      showEditorError((e?.message)||String(e), m?Number(m[1]):1, m?Number(m[2]||1):1);
    }finally{
      spin(false);
      runBtn.classList.remove('is-running');
      // optional: re-enable idle attract
      //runBtn.classList.add('idle-attract');
    }
  });

  // RESET
  rstBtn?.addEventListener('click', () => {
    try{ window.clearLang && window.clearLang(); }catch{}
    rstBtn.classList.add('is-resetting');
    // optional: rstBtn.classList.remove('idle-attract');

    setTimeout(()=>{
      rstBtn.classList.remove('is-resetting');
      // optional: re-enable idle attract
      //rstBtn.classList.add('idle-attract');
    }, 1500);

    clearEditorErrors(); setStatus('Reset','ok'); unfreezeUI();
  });
})(); // <-- ✅ this line was missing*/


(function () {
  const runBtn = document.getElementById('btnRun');
  const rstBtn = document.getElementById('btnReset');

  // RUN
  runBtn?.addEventListener('click', async () => {
    try {
      runBtn.classList.add('is-running');
      clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();

      await window.runLang();

      setStatus('OK','ok');
      setFootStatus('rightFoot','success');  // animated ✓
    } catch(e) {
      setStatus('Error','err');
      setFootStatus('rightFoot','error');    // animated ✕
      const m = /line\s*(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i.exec(e?.message||'');
      showEditorError((e?.message)||String(e), m?Number(m[1]):1, m?Number(m[2]||1):1);
    } finally {
      spin(false);
      runBtn.classList.remove('is-running');
    }
  });

  // RESET
  rstBtn?.addEventListener('click', () => {
    try { window.clearLang && window.clearLang(); } catch {}
    rstBtn.classList.add('is-resetting');
    setTimeout(()=> rstBtn.classList.remove('is-resetting'), 1500);

    setStatus('Reset','ok');
    unfreezeUI(); // will set animated 'ready' + 'waiting'
  });
})();





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





// 🔧 Ensure footer animations + Run glow start on first paint
(function bootUIOnFirstPaint(){
  const init = () => {
    // Defer to the first fully painted frame so animations start
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Build the animated chips
        setFootStatus('centerFoot','ready');
        setFootStatus('rightFoot','waiting');

        // Make sure the output panel is dimmed while idle, etc.
        document.getElementById('output')?.classList.add('screen-dim');

        // Re-arm the Run button glow
        const runBtn = document.getElementById('btnRun');
        if (runBtn){
          runBtn.classList.remove('attn');
          // force a reflow so the animation restarts cleanly
          void runBtn.offsetWidth;
          runBtn.classList.add('attn');
        }

        // Panel interactivity/readonly state
        const all = panels?.();
        if (all){
          setFrozen(all, false);
          document.getElementById('btnRun')?.removeAttribute('disabled');
          document.getElementById('btnReset')?.setAttribute('disabled','');
          document.getElementById('langSelect')?.removeAttribute('disabled');
          window.editor?.updateOptions?.({ readOnly:false });
        }
      });
    });
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }
})();




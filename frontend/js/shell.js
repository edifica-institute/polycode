// SHELL.JSS Start idle animation immediately on page load

// Disable right-click globally
/*(function () {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  }, { capture: true });
})();*/

// ---- Reload/close confirmation (covers toolbar refresh, Cmd/Ctrl+R, tab close, back) ----
/*(() => {
  let armed = true; // set false if you ever want to disable globally

  function onBeforeUnload(e) {
    if (!armed) return;
    // NOTE: custom text is ignored by modern browsers; setting returnValue is enough.
    e.preventDefault();
    e.returnValue = '';
  }

  window.enableReloadConfirm  = () => { armed = true;  window.addEventListener('beforeunload', onBeforeUnload, { capture:true }); };
  window.disableReloadConfirm = () => { armed = false; window.removeEventListener('beforeunload', onBeforeUnload, { capture:true }); };

  // arm it now
  window.enableReloadConfirm();
})();*/


// Chrome/Edge: catch toolbar Reload without prompting on tab close
if ('navigation' in window && typeof navigation.addEventListener === 'function') {
  navigation.addEventListener('navigate', (e) => {
    // Only act on real reloads (toolbar button, menu -> Reload, etc.)
    if (e.navigationType === 'reload') {
      // decide if you want to bother the user
      const shouldAsk = true; // or check your own flags (running/unsaved/etc.)
      if (!shouldAsk) return;

      if (!confirm('Your Data will be Lost.\nStill Reload the Page?')) {
        e.preventDefault();   // cancel the reload
      }
    }
  });
}







// Block Ctrl/Cmd+C & "copy" everywhere EXCEPT editor/console/inputs
(function () {
  const allow = (el) =>
    el.closest('#editor') || el.closest('#jconsole') ||
    el.closest('input,textarea,[contenteditable="true"]');

  // Keyboard copy (Ctrl/Cmd+C, Ctrl+Insert)
  document.addEventListener('keydown', (e) => {



    
    const isCopyKey =
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') ||
      ((e.ctrlKey || e.metaKey) && e.key === 'Insert'); // Ctrl+Insert
    if (isCopyKey && !allow(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Any copy attempt (menu, execCommand('copy'), etc.)
  document.addEventListener('copy', (e) => {
    if (!allow(e.target)) {
      e.preventDefault();               // cancel copy
      try { e.clipboardData?.setData('text/plain', ''); } catch {}
    }
  }, true);

  // (Optional) discourage selection on the left panel
  const left = document.getElementById('leftPanel');
  if (left) left.style.userSelect = 'none';
})();






// When RUN starts, enable interaction on the output
function enableOutput(){
  const out = document.getElementById('output');
  out && out.classList.remove('screen-dim');   // keep dim style but no pointer-block
  out && out.classList.remove('error');
  out && out.removeAttribute('aria-busy');
}
function disableOutput(){  // only if you really want to block it temporarily
  const out = document.getElementById('output');
  if (!out) return;
  // If you want a “disabled” phase, add a separate blocker overlay instead of pointer-events:none
  // out.classList.add('screen-dim'); // visual only; DO NOT block pointer-events
  out.setAttribute('aria-busy','true');
}

// Call these in your existing handlers:
document.getElementById('btnRun')?.addEventListener('click', enableOutput);
document.getElementById('btnReset')?.addEventListener('click', enableOutput);

// Keep Monaco sized correctly after window drag/orientation change
addEventListener('resize', () => {
  if (window.editor?.layout) {
    const el = document.getElementById('editor');
    requestAnimationFrame(() =>
      window.editor.layout({ width: el.clientWidth, height: el.clientHeight })
    );
  }
}, { passive:true });








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
/*(function(){
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
document.getElementById('output')?.style.setProperty('background','transparent','important');
document.getElementById('preview')?.style.setProperty('background','transparent','important');

})();*/


/* ===========================
   theme (apply, not just toggle)
=========================== */
(function () {
  const btn = document.getElementById('themeToggle');
  const ico = document.getElementById('themeIcon');

  const isLight = () => document.body.classList.contains('light');

  function setIcon(isLightMode){
    if (!ico) return;
    ico.innerHTML = isLightMode
      ? '<path d="M6.76 4.84l-1.8-1.79L3.17 4.84l1.8 1.79L6.76 4.84zM1 10.5H4v3H1v-3zm9.5 9.5h3v-3h-3v3zM20 10.5h3v3h-3v-3zM17.24 4.84l1.79-1.79 1.79 1.79-1.79 1.79-1.79-1.79zM12 5a7 7 0 100 14 7 7 0 000-14z"/>'
      : '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  }

  function setTheme(mode /* 'light' | 'dark' */){
    const toLight = mode === 'light';
    document.body.classList.toggle('light', toLight);
    setIcon(toLight);

 
    
    // Monaco
    if (window.monaco && window.editor) {
      monaco.editor.setTheme(toLight ? 'vs' : 'vs-dark');
    }

    // Keep host output areas transparent
    document.getElementById('output')
      ?.style.setProperty('background','transparent','important');

    // If a preview iframe exists, try to enforce transparent bg without wiping content
    const ifr = document.getElementById('preview');
    if (ifr && ifr.contentDocument) {
      try {
        const d = ifr.contentDocument;
        let s = d.getElementById('polycode-theme-css');
        if (!s) { s = d.createElement('style'); s.id = 'polycode-theme-css'; d.head.appendChild(s); }
        s.textContent = `
          :root{ color-scheme:${mode}; }
          html,body{ background:transparent !important; color:inherit; }
        `;
      } catch {}
    }

    try { localStorage.setItem('polycode_theme', mode); } catch {}
  }

  // Toggle button uses the API (but reset will *not* toggle; it calls setTheme with current)
  btn?.addEventListener('click', () => setTheme(isLight() ? 'dark' : 'light'));

  // expose
  window.PolyShell = window.PolyShell || {};
  window.PolyShell.setTheme = setTheme;
  window.PolyShell.getTheme = () => (isLight() ? 'light' : 'dark');
  window.PolyShell.reapplyTheme = () => setTheme(isLight() ? 'light' : 'dark');

 
    try {
  const saved = localStorage.getItem('polycode_theme');
  if (saved === 'light' || saved === 'dark') setTheme(saved);
} catch {}

 // initial icon
  setIcon(isLight());

  
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
/*function initMonaco({ value, language }) {
  return new Promise(resolve => {
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
      window.editor = monaco.editor.create(document.getElementById('editor'), {
        value, language,
        theme: document.body.classList.contains('light') ? 'vs' : 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
         padding: { top: 20, bottom: 12 },   // <= add this
  scrollBeyondLastLine: false         // optional: trims extra space at bottom
      });
      resolve();
    });
  });
}*/


function ensureMonacoLoader(){
  return new Promise((resolve, reject) => {
    if (typeof require !== 'undefined' && typeof require.config === 'function') {
      return resolve();
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load Monaco loader'));
    document.head.appendChild(s);
  });
}

function initMonaco({ value, language }) {
  return ensureMonacoLoader().then(() => {
    if (!window.__monacoConfigured) {
      require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
      window.__monacoConfigured = true;
    }
    return new Promise(resolve => {
      require(['vs/editor/editor.main'], function () {
        window.editor = monaco.editor.create(document.getElementById('editor'), {
          value, language,
          theme: document.body.classList.contains('light') ? 'vs' : 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          padding: { top: 20, bottom: 12 },
          scrollBeyondLastLine: false
        });
        resolve();
      });
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




/*function setFootStatus(id, state){
  const host = document.getElementById(id);
  if (!host) return;

  const label = {
    ready:   'Ready for Execution',
    waiting: 'Waiting for Execution',
    running: 'Execution in Progress',
    success: 'Executed Successfully',
    error:   'Executed with Error'
  }[state] || '';

  // Build dots only for waiting
  const dots = (state === 'waiting' || state === 'running')
    ? '<span class="dots"><span></span><span></span><span></span></span>'
    : '';

  host.className = 'msg status ' + state;
  host.innerHTML = `<span class="icon" aria-hidden="true"></span><span class="text">${label}${dots}</span>`;
}*/

function setFootStatus(id, state, opts = {}){
  const host = document.getElementById(id);
  if (!host) return;

  const label = {
    ready:   'Ready for Execution',
    waiting: (state === 'waiting' && opts?.forceInputLabel) ? 'Waiting for Input' : 'Waiting for Execution',
    //waiting: 'Waiting for Execution',
    running: 'Execution in Progress',
    success: 'Executed Successfully',
    error:   'Executed with Error'
  }[state] || '';

  const dots = (state === 'waiting' || state === 'running')
    ? '<span class="dots"><span></span><span></span><span></span></span>'
    : '';

  const detail = opts.detail ? `<span class="detail">${opts.detail}</span>` : '';

  host.className = 'msg status ' + state;
  host.innerHTML = `<span class="icon" aria-hidden="true"></span><span class="text">${label}${dots}${detail}</span>`;
}



function freezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.setAttribute('disabled','');
  document.getElementById('btnReset')?.removeAttribute('disabled');
  document.getElementById('langSelect')?.setAttribute('disabled','');
  window.editor?.updateOptions({ readOnly:true });

  // Output should be LIVE during run
  document.getElementById('output')?.classList.remove('screen-dim');
 document.getElementById('output')?.style.setProperty('background','transparent','important');

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

  const out = document.getElementById('output');
if (out) {
  out.style.setProperty('background','transparent','important');
}

  
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
  /*runBtn?.addEventListener('click', async () => {
    try {
      runBtn.classList.add('is-running');
      clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();
 
      t0 = performance.now();   
      await window.runLang();
 const elapsed = fmtDuration(performance.now() - t0);

      
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
  });*/


  runBtn?.addEventListener('click', async () => {
  let t0;
  try {
    runBtn.classList.add('is-running');
    clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();

    t0 = performance.now();                      // start timing
    await window.runLang();
    const elapsed = fmtDuration(performance.now() - t0);  // end timing

    setStatus('OK','ok');
    setFootStatus('rightFoot','success', { detail: `Time: ${elapsed}` });
  } catch(e) {
    setStatus('Error','err');
    if (t0) {
      const elapsed = fmtDuration(performance.now() - t0);
      setFootStatus('rightFoot','error', { detail: `Time: ${elapsed}` });
    } else {
      setFootStatus('rightFoot','error');
    }
    const m = /line\s*(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i.exec(e?.message||'');
    showEditorError((e?.message)||String(e), m?Number(m[1]):1, m?Number(m[2]||1):1);
  } finally {
    spin(false);
    runBtn.classList.remove('is-running');
  }
});

  // RESET
  /*rstBtn?.addEventListener('click', () => {
    try { window.clearLang && window.clearLang(); } catch {}
    rstBtn.classList.add('is-resetting');
    setTimeout(()=> rstBtn.classList.remove('is-resetting'), 1500);

    setStatus('Reset','ok');
    unfreezeUI(); // will set animated 'ready' + 'waiting'
  });*/

 rstBtn?.addEventListener('click', () => {
  try { window.clearLang && window.clearLang(); } catch {}
  window.PolyShell?.reapplyTheme?.();   // <-- re-apply current theme to everything
  setStatus('Reset','ok');
  unfreezeUI();
});

  
})();





/* ===========================
   load left content helper
=========================== */


/* ===========================
   export minimal API
==========================
window.PolyShell = {
  initMonaco,
  setStatus,
  showEditorError,
  clearEditorErrors,
  loadLeftContent
}; */

Object.assign(window.PolyShell || (window.PolyShell = {}), {
  initMonaco,
  setStatus,
  showEditorError,
  clearEditorErrors,
  loadLeftContent
});


function fmtDuration(ms){
  const s = ms / 1000;        // always convert to seconds
  return `${s.toFixed(2)} second(s)`; 
}


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







// ---------- Window resize/orientation robustness -------------------
(function(){
  let raf = 0, endTimer = 0;

  function applyResizeFixes(){
    // 1) Reset any inline grid widths to CSS defaults (if resizers set them)
    const app = document.querySelector('.app');
    if (app) app.style.gridTemplateColumns = '';

    // 2) Re-layout Monaco
    if (window.editor?.layout) {
      const edEl = document.getElementById('editor');
      if (edEl) window.editor.layout({ width: edEl.clientWidth, height: edEl.clientHeight });
    }

    // 3) Clear temporary states that can remain after a resize/drag
    document.getElementById('centerPanel')?.removeAttribute('aria-busy');
    document.getElementById('rightPanel')?.removeAttribute('aria-busy');
    document.getElementById('output')?.classList.remove('screen-dim');

    // don’t remove the persistent .attn cue; only clear active run/reset states
    document.querySelectorAll('.btn.is-running, .btn.is-resetting')
      .forEach(b => { b.classList.remove('is-running','is-resetting'); });
  }

  function onResize(){
    cancelAnimationFrame(raf);
    clearTimeout(endTimer);

    // Do light work during live resize via RAF
    raf = requestAnimationFrame(applyResizeFixes);

    // Run once more 200ms after the user stops dragging, for safety
    endTimer = setTimeout(applyResizeFixes, 200);
  }

  addEventListener('resize', onResize, { passive:true });
  addEventListener('orientationchange', onResize, { passive:true });

  // If you have a custom resizer, also call on drag end:
  ['mouseup','touchend','pointerup'].forEach(evt =>
    addEventListener(evt, () => setTimeout(applyResizeFixes, 0), { passive:true })
  );
})();






// Put where you create the editor
try {
  const ro = new ResizeObserver(() => {
    if (window.editor?.layout) {
      const el = document.getElementById('editor');
      window.editor.layout({ width: el.clientWidth, height: el.clientHeight });
    }
  });
  ro.observe(document.getElementById('editor'));
} catch {}













// ===== Global hotkeys for Polycode ==================================
(function initPolycodeHotkeys(){
  function click(id){ document.getElementById(id)?.click(); }

  // Global fallbacks (works even when focus isn't in Monaco)
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;

    // Run: Ctrl/Cmd+Enter or F9
    if ((mod && e.key === 'Enter') || e.key === 'F9') {
      e.preventDefault();
      click('btnRun');
      return;
    }

    if (e.key === 'F5') {
      if(!confirm("Are you sure you want to reload the page?"))
      e.preventDefault();
      return;
    }

    
    
    // Clear: Ctrl/Cmd+Shift+L or F10
    if ((mod && e.shiftKey && (e.key === 'L' || e.key === 'l')) || e.key === 'F10') {
      e.preventDefault();
      click('btnReset');
      return;
    }

    // Run selection: Ctrl/Cmd+Shift+Enter
    if (mod && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      if (window.editor) {
        const sel = window.editor.getModel().getValueInRange(window.editor.getSelection());
        const code = (sel && sel.trim()) ? sel : null;
        if (window.runLang) window.runLang(code); // pages accept optional override
      } else {
        click('btnRun');
      }
    }
  }, { passive: false });

  // Monaco-accurate bindings (work when focus IS in the editor)
  function bindMonaco(){
    if (!window.monaco || !window.editor) return;
    const m = monaco;

    // Run
    window.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => {
      document.getElementById('btnRun')?.click();
    });

    // Run selection
    window.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.Enter, () => {
      const sel = window.editor.getModel().getValueInRange(window.editor.getSelection());
      if (window.runLang) window.runLang(sel && sel.trim() ? sel : null);
    });

    // Clear
    window.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.KeyL, () => {
      document.getElementById('btnReset')?.click();
    });
  }

  // Try now; also rebind when the editor element resizes (editor created after loader)
  const tryBind = () => setTimeout(bindMonaco, 0);
  tryBind();

  // If your page creates the editor later, run again then:
  window.addEventListener('polycode-editor-ready', tryBind);
})();






// --- footer driver for runner phases ---
(function(){
  let footTick = null; // for live updates like mm:ss

 function setRunnerPhase(phase, opts = {}) {
  // phase: 'waiting', 'waiting_input', 'running', 'success', 'error'
  // opts.detail: text to show after the label (e.g., " — 02:41")

  // Stop any input ticker once we leave the input-wait phase
  if (typeof footTick !== 'undefined' && footTick && phase !== 'waiting_input') {
    clearInterval(footTick);
    footTick = null;
  }

  // For the footer chip, we render "waiting_input" as "waiting"
  const state = (phase === 'waiting_input') ? 'waiting' : phase;

  // Use detail verbatim; INDEX can pass " — mm:ss"
  const detail = opts.detail ?? '';

  // When we're specifically waiting for user input,
  // switch the footer label to "Waiting for Input"
  const extra = (phase === 'waiting_input') ? { forceInputLabel: true } : {};

  setFootStatus('rightFoot', state, { detail, ...extra });
}


  // expose for INDEX-JAVA to call
  window.PolyShell = window.PolyShell || {};
  window.PolyShell.setRunnerPhase = setRunnerPhase;

  // optional: allow INDEX to provide a ticker callback for mm:ss
  window.PolyShell.startInputTicker = (fnGetDetail, ms=500) => {
    clearInterval(footTick);
    footTick = setInterval(() => {
      const d = fnGetDetail?.();
      setRunnerPhase('waiting_input', { detail: d ? d : '' });
    }, ms);
  };
  window.PolyShell.stopInputTicker = () => { clearInterval(footTick); footTick = null; };
})();





























(() => {
  const WHATSAPP_CC = '91';
  const WHATSAPP_NUM = '9836313636';

  function getLangInfo(){
    const id = window.editor?.getModel?.()?.getLanguageId?.() || 'text';
    switch (id) {
      case 'sql':        return { ext:'sql',  mime:'application/sql',     langLabel:'SQL' };
      case 'html':       return { ext:'html', mime:'text/html',           langLabel:'Web' };
      case 'javascript': return { ext:'js',   mime:'text/javascript',     langLabel:'JS'  };
      case 'css':        return { ext:'css',  mime:'text/css',            langLabel:'CSS' };
      default:           return { ext:'txt',  mime:'text/plain',          langLabel:id    };
    }
  }

  async function saveFile(){
    const { ext, mime, langLabel } = getLangInfo();
    const code = window.editor ? window.editor.getValue() : '';
    const suggested = `polycode-${langLabel.toLowerCase()}.${ext}`;
    const name = prompt('Save file as:', suggested) || suggested;
    const blob = new Blob([code], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }










// --- Lazy loaders (safe if libs already present) ---
let _h2cReady = null;

async function ensureHtml2Canvas() {
  // already present?
  if (typeof window.html2canvas === 'function') return window.html2canvas;
  if (_h2cReady) return _h2cReady;

  _h2cReady = (async () => {
    // 1) Try ESM first — avoids AMD/RequireJS conflicts
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js');
      const fn = mod?.default || mod?.html2canvas || mod;
      if (typeof fn === 'function') return fn;
    } catch (_) { /* fall through */ }

    // 2) UMD fallback, but temporarily mask AMD 'define' so it attaches to window
    if (typeof window.html2canvas === 'function') return window.html2canvas;

    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.async = true;

      const prevDefine = window.define;
      const hadAMD = !!(prevDefine && prevDefine.amd);
      if (hadAMD) window.define = undefined;

      s.onload = () => {
        if (hadAMD) window.define = prevDefine;
        res();
      };
      s.onerror = () => {
        if (hadAMD) window.define = prevDefine;
        rej(new Error('Failed to load html2canvas'));
      };
      document.head.appendChild(s);
    });

    if (typeof window.html2canvas === 'function') return window.html2canvas;
    throw new Error('html2canvas not available after loading');
  })();

  return _h2cReady;
}



// Put these near the top of your PDF helpers file (outside the function) so we never double-load:
let _jspdfReady = null;

async function ensureJsPDF() {
  if (_jspdfReady) return _jspdfReady;

  _jspdfReady = (async () => {
    // 1) Native ESM path (bypasses AMD/RequireJS entirely)
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js');
      if (mod?.jsPDF) return mod.jsPDF;
    } catch (_) { /* fall through */ }

    // 2) UMD fallback BUT guard against AMD + double-loads
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;

    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
      s.async = true;

      // temporarily disable AMD 'define' so UMD attaches to window.jspdf
      const prevDefine = window.define;
      const hadAMD = !!(prevDefine && prevDefine.amd);
      if (hadAMD) window.define = undefined;

      s.onload = () => {
        if (hadAMD) window.define = prevDefine;
        res();
      };
      s.onerror = () => {
        if (hadAMD) window.define = prevDefine;
        rej(new Error('Failed to load jsPDF UMD'));
      };
      document.head.appendChild(s);
    });

    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    throw new Error('jsPDF not available after loading');
  })();

  return _jspdfReady;
}


// --- Your functions (patched) ---
async function captureOutputImageDataURL() {
  const html2canvas = await ensureHtml2Canvas();
  const out = document.getElementById('output');
  if (!out) throw new Error('#output not found');

  // Temporarily force output to render at full scroll height
  const prev = {
    height: out.style.height,
    overflowY: out.style.overflowY
  };
  out.style.height = out.scrollHeight + 'px';
  out.style.overflowY = 'visible';

  const HIDE_IN_CLONE_CSS = `
    /* Hide Monaco completely in the clone */
    .monaco-editor, .monaco-editor * { visibility: hidden !important; }
    /* Hide all canvas to prevent taint warnings (charts will be handled separately if needed) */
    canvas { visibility: hidden !important; }
  `;

  try {
    const canvas = await html2canvas(out, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      allowTaint: false,
      onclone: (doc) => {
        const style = doc.createElement('style');
        style.textContent = HIDE_IN_CLONE_CSS;
        doc.head.appendChild(style);
        // Also ensure the cloned #output expands fully
        const clonedOut = doc.getElementById('output');
        if (clonedOut) {
          clonedOut.style.height = clonedOut.scrollHeight + 'px';
          clonedOut.style.overflowY = 'visible';
        }
      },
      ignoreElements: (el) =>
        el.tagName === 'CANVAS' ||
        el.classList?.contains('monaco-editor') ||
        el.closest?.('.monaco-editor')
    });
    return canvas.toDataURL('image/png');
  } finally {
    // restore styles
    out.style.height = prev.height;
    out.style.overflowY = prev.overflowY;
  }
}




// ====== PDF helpers: watermark, header, footer, paging ======
function extractTitle(code){
  if (!code) return 'Sample Program';
  const first = String(code).split('\n')[0].trim();
  if (/^title\s*:/i.test(first)) {
    const t = first.replace(/^title\s*:/i, '').trim();
    return t || 'Sample Program';
  }
  return 'Sample Program';
}

function addWatermark(pdf, watermarkLogoBase64){
  if (!watermarkLogoBase64) return;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const w = pageW * 0.6, h = pageH * 0.6;
  const x = (pageW - w) / 2, y = (pageH - h) / 2;
  // fade watermark
  if (pdf.GState) pdf.setGState(new pdf.GState({ opacity: 0.08 }));
  pdf.addImage(watermarkLogoBase64, 'PNG', x, y, w, h, undefined, 'FAST');
  if (pdf.GState) pdf.setGState(new pdf.GState({ opacity: 1 }));
}

function addHeader(pdf, y, opts){
  const margin = 40;
  const pageW = pdf.internal.pageSize.getWidth();

  // Left: Polycode (with logo if provided)
  const textY = y + 12;
  let cursorX = margin;

  if (opts?.headerLogoBase64) {
    const h = 16, w = 16; // tiny logo
    pdf.addImage(opts.headerLogoBase64, 'PNG', cursorX, y, w, h, undefined, 'FAST');
    cursorX += w + 8;
  }

  pdf.setFont('helvetica','bold'); pdf.setFontSize(12);
  pdf.text('Polycode', cursorX, textY);

  // Right: powered by Edifica
  pdf.setFont('helvetica','normal'); pdf.setFontSize(11);
  pdf.text('powered by Edifica', pageW - margin, textY, { align:'right' });

  // Horizontal rule
  const hrY = y + 22;
  pdf.setDrawColor(180);
  pdf.line(margin, hrY, pageW - margin, hrY);
  return hrY + 10; // next y
}

function addFooter(pdf){
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.setFont('helvetica','normal'); pdf.setFontSize(9);

  pdf.text('learn.code.execute', 40, pageH - 18, { align:'left' });
  pdf.text('www.polycode.in', pageW - 40, pageH - 18, { align:'right' });

  // (Optional) page number centered
  const page = pdf.internal.getNumberOfPages?.() || 1;
  pdf.text(String(page), pageW / 2, pageH - 18, { align: 'center' });
}

// draw HR and advance Y
function drawHR(pdf, y){
  const margin = 40;
  const pageW = pdf.internal.pageSize.getWidth();
  pdf.setDrawColor(200);
  pdf.line(margin, y, pageW - margin, y);
  return y + 12;
}

function ensureSpace(pdf, y, need, opts){
  // If not enough space, close footer + add page + watermark + header
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 40;
  if (y + need <= pageH - margin) return y;

  addFooter(pdf);
  pdf.addPage();
  addWatermark(pdf, opts?.watermarkLogoBase64);
  return addHeader(pdf, margin, { headerLogoBase64: opts?.headerLogoBase64 });
}

function writeLabel(pdf, y, text){
  pdf.setFont('helvetica','bold'); pdf.setFontSize(12);
  pdf.text(text, 40, y);
  return y + 14;
}

function writeWrappedText(pdf, y, text, opts){
  const margin = 40;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const maxW = pageW - margin*2;
  const lh = opts?.lineHeight || 12;

  const lines = pdf.splitTextToSize(text || '', maxW);
  pdf.setFont(opts?.font || 'helvetica', opts?.style || 'normal');
  pdf.setFontSize(opts?.fontSize || 10);

  for (const line of lines){
    if (y > pageH - margin - lh) {
      // new page
      addFooter(pdf);
      pdf.addPage();
      addWatermark(pdf, opts?.watermarkLogoBase64);
      y = addHeader(pdf, margin, { headerLogoBase64: opts?.headerLogoBase64 });
      pdf.setFont(opts?.font || 'helvetica', opts?.style || 'normal');
      pdf.setFontSize(opts?.fontSize || 10);
    }
    pdf.text(line, margin, y);
    y += lh;
  }
  return y;
}

// ====== DROP-IN: buildPdfBlob with your exact layout ======
async function buildPdfBlob(userTitle, logos = {}){
  const jsPDF = await ensureJsPDF();

  const pdf = new jsPDF({ unit:'pt', format:'a4' });
  const margin = 40;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // Watermark on first page
  addWatermark(pdf, logos.watermarkLogoBase64);

  // Header
  let y = addHeader(pdf, margin, { headerLogoBase64: logos.headerLogoBase64 });

  // Gather meta
  const { langLabel } = getLangInfo();
  const code = window.editor?.getValue?.() || '';
  const titleFromCode = extractTitle(code);
  const title = (userTitle && userTitle.trim()) || 'Polycode Session';
  const when = new Date().toLocaleString();

  // Sub-heading / meta block
  pdf.setFont('helvetica','normal'); pdf.setFontSize(11);
  y = ensureSpace(pdf, y, 60, { watermarkLogoBase64: logos.watermarkLogoBase64, headerLogoBase64: logos.headerLogoBase64 });
  pdf.text(`Date: ${when}`, margin, y); y += 14;
  pdf.text(`Language Used: ${langLabel}`, margin, y); y += 14;
  pdf.text(`Program Code/Question: ${titleFromCode || 'Sample Program'}`, margin, y); y += 16;
  y = drawHR(pdf, y);

  // Section 4: The code
  y = ensureSpace(pdf, y, 26, { watermarkLogoBase64: logos.watermarkLogoBase64, headerLogoBase64: logos.headerLogoBase64 });
  y = writeLabel(pdf, y, 'Code');

  // Code as text (Courier)
  pdf.setFont('courier','normal'); pdf.setFontSize(10);
  y = writeWrappedText(pdf, y, code || '(empty)', {
    lineHeight: 12,
    font: 'courier',
    fontSize: 10,
    watermarkLogoBase64: logos.watermarkLogoBase64,
    headerLogoBase64: logos.headerLogoBase64
  });

  y += 8;
  y = drawHR(pdf, y);

  // Section 5: Output label
  y = ensureSpace(pdf, y, 26, { watermarkLogoBase64: logos.watermarkLogoBase64, headerLogoBase64: logos.headerLogoBase64 });
  y = writeLabel(pdf, y, 'Output');

  // Section 6: Output as TEXT (full content)
  const outText = document.getElementById('output')?.innerText || '(no output)';
  pdf.setFont('helvetica','normal'); pdf.setFontSize(10);
  y = writeWrappedText(pdf, y, outText, {
    lineHeight: 12,
    font: 'helvetica',
    fontSize: 10,
    watermarkLogoBase64: logos.watermarkLogoBase64,
    headerLogoBase64: logos.headerLogoBase64
  });

  y += 8;
  y = drawHR(pdf, y);

  // Footer on the last page
  addFooter(pdf);

  // Done
  return pdf.output('blob');
}















async function urlToDataURL(url){
  const res = await fetch(url, { mode:'cors' });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// At startup (before building the PDF)
(async () => {
  try {
    window.POLYCODE_HEADER_LOGO  = await urlToDataURL('/assets/PC-Logo.png');
    window.POLYCODE_WATERMARK    = window.POLYCODE_HEADER_LOGO; // reuse if same
  } catch (e) {
    console.warn('Logo load failed:', e);
    window.POLYCODE_HEADER_LOGO = window.POLYCODE_WATERMARK = null;
  }
})();



  


async function savePdfToDisk(e){
  e?.preventDefault?.(); e?.stopPropagation?.();

  const { langLabel } = getLangInfo();
  const name = prompt('Enter a title for the PDF:', 'Untitled') || 'Untitled';
  const fileName = `Polycode-${langLabel}-${name.replace(/[^\w-]+/g,'_')}.pdf`;

  const blob = await buildPdfBlob(name, {
    watermarkLogoBase64:  window.POLYCODE_WATERMARK , // base64 PNG or null
    headerLogoBase64: window.POLYCODE_HEADER_LOGO  // base64 PNG or null
  });

  // Try native Save dialog (Chromium File System Access API)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // user cancelled -> fall back to normal download
    }
  }

  // Fallback: <a download> to default folder
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.type = 'application/pdf';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}


async function sharePdf() {
  try {
    const { langLabel } = getLangInfo();
    const title = `${langLabel} Session`;
    const blob = await buildPdfBlob(title);
    const file = new File([blob], `Polycode-${langLabel}.pdf`, { type: 'application/pdf' });
    const text = `Polycode ${langLabel} — ${title}`;

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ title, text, files: [file] }); return; } catch {}
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Polycode-${langLabel}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);

    const wa = `https://wa.me/91${WHATSAPP_NUM}?text=${encodeURIComponent(text + ' — PDF downloaded; please attach in WhatsApp.')}`;
    window.open(wa, '_blank', 'noopener');
  } catch (err) {
    console.error(err);
    alert('Failed to share PDF. Please check console for details.');
  }
}










async function buildCodeImageDataURL() {
  const html2canvas = await ensureHtml2Canvas();
  const code = (window.editor && typeof window.editor.getValue === 'function')
    ? window.editor.getValue()
    : (document.getElementById('code')?.textContent || ''); // fallback if no Monaco

  // Offscreen iframe with styled <pre> (no Monaco, so no canvas taint)
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:10px;visibility:hidden';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.srcdoc = `
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  :root{ color-scheme: light; }
  html,body{ margin:0; background:#ffffff; }
  .wrap{
    padding:24px; box-sizing:border-box; width:1200px; 
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    color:#222;
  }
  .title{ font: 600 16px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif; margin-bottom: 10px; }
  pre{
    margin:0; white-space:pre; overflow:visible; 
    tab-size:2; -moz-tab-size:2; -o-tab-size:2;
  }
  /* Optional: simple line numbers (not required) */
  .code{ counter-reset: ln; }
  .code > div{ counter-increment: ln; }
  .code > div::before{
    content: counter(ln);
    display:inline-block; width:3ch; margin-right:12px; text-align:right; color:#888;
  }
</style>
</head><body>
  <div class="wrap">
    <div class="title">Code</div>
    <pre class="code">${
      // Escape HTML safely and split into <div> lines for line numbers
      (code || '(empty)')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .split('\n').map(l => `<div>${l || '&nbsp;'}</div>`).join('\n')
    }</pre>
  </div>
</body></html>`;
  document.body.appendChild(iframe);

  await new Promise(r => iframe.onload = r);

  // Expand iframe height to content for full capture
  const b = iframe.contentDocument.body;
  const contentHeight = Math.max(b.scrollHeight, b.offsetHeight);
  iframe.style.height = contentHeight + 'px';

  const canvas = await html2canvas(iframe.contentDocument.documentElement, {
    backgroundColor:'#ffffff',
    scale: 2,
    useCORS: true,
    allowTaint: false
  });

  const url = canvas.toDataURL('image/png');
  document.body.removeChild(iframe);
  return url;
}


  


async function buildCodeImageDataURL() {
  const html2canvas = await ensureHtml2Canvas();
  const code = (window.editor && typeof window.editor.getValue === 'function')
    ? window.editor.getValue()
    : (document.getElementById('code')?.textContent || ''); // fallback if no Monaco

  // Offscreen iframe with styled <pre> (no Monaco, so no canvas taint)
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:10px;visibility:hidden';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.srcdoc = `
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  :root{ color-scheme: light; }
  html,body{ margin:0; background:#ffffff; }
  .wrap{
    padding:24px; box-sizing:border-box; width:1200px; 
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    color:#222;
  }
  .title{ font: 600 16px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif; margin-bottom: 10px; }
  pre{
    margin:0; white-space:pre; overflow:visible; 
    tab-size:2; -moz-tab-size:2; -o-tab-size:2;
  }
  /* Optional: simple line numbers (not required) */
  .code{ counter-reset: ln; }
  .code > div{ counter-increment: ln; }
  .code > div::before{
    content: counter(ln);
    display:inline-block; width:3ch; margin-right:12px; text-align:right; color:#888;
  }
</style>
</head><body>
  <div class="wrap">
    <div class="title">Code</div>
    <pre class="code">${
      // Escape HTML safely and split into <div> lines for line numbers
      (code || '(empty)')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .split('\n').map(l => `<div>${l || '&nbsp;'}</div>`).join('\n')
    }</pre>
  </div>
</body></html>`;
  document.body.appendChild(iframe);

  await new Promise(r => iframe.onload = r);

  // Expand iframe height to content for full capture
  const b = iframe.contentDocument.body;
  const contentHeight = Math.max(b.scrollHeight, b.offsetHeight);
  iframe.style.height = contentHeight + 'px';

  const canvas = await html2canvas(iframe.contentDocument.documentElement, {
    backgroundColor:'#ffffff',
    scale: 2,
    useCORS: true,
    allowTaint: false
  });

  const url = canvas.toDataURL('image/png');
  document.body.removeChild(iframe);
  return url;
}









  












  
  // Hook up buttons when the page is ready
  window.addEventListener('load', () => {
    document.getElementById('btnSaveFile')?.addEventListener('click', saveFile);
    document.getElementById('btnSharePdf')?.addEventListener('click', savePdfToDisk); // or sharePdf
  });

  // Ctrl/Cmd+S to save file
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveFile();
    }
  }, { passive:false });
})();




















// ===== PolyCode: Global connect guard & session gate (drop-in) =====
(() => {
  // ---- Config: tweak as needed ----
  const CONNECT_MODAL_SELECTOR = '#connectModal';   // must exist for auto-detect
  const MODAL_HIDDEN_CLASS = 'hide';
  const PREPARE_PATH_REGEX = /\/api\/cc\/prepare(?:$|\?)/; // detect prepare POSTs
  const WS_TOKEN_REGEX = /\/cc(?:$|\?)|token=/;            // detect runner WS

  // App shortcuts you want to disable while connecting:
  const SHORTCUT_KEYS = new Set(['F10']); // add 'F9','F5' etc. if used

  // ---- State ----
  const PC = (window.PC ||= {});
  let uiLock = false;
  let sessionSeq = 0;
  let current = null; // { id, state: 'connecting'|'running'|'stopped'|'cancelled', ws }
  let pendingAbort = null;

  // ---- Helpers (public API if you need manual control) ----
  PC.lockUI   = () => { uiLock = true; };
  PC.unlockUI = () => { uiLock = false; };

  PC.cancelCurrentSession = function(reason = 'user') {
    // Abort prepare (if in-flight)
    try { pendingAbort?.abort(); } catch {}
    pendingAbort = null;

    // Invalidate/gate session
    if (current) {
      current.state = 'cancelled';
      try { current.ws?.close(); } catch {}
      current.ws = null;
      current = null;
    }
  };

  // ---- Auto-lock based on modal visibility (no changes to pages) ----
  const connectModal = document.querySelector(CONNECT_MODAL_SELECTOR);
  if (connectModal) {
    const updateLockFromModal = () => {
      const visible = !connectModal.classList.contains(MODAL_HIDDEN_CLASS);
      uiLock = visible;
    };
    updateLockFromModal();

    // Observe class changes to toggle lock automatically
    const mo = new MutationObserver(updateLockFromModal);
    mo.observe(connectModal, { attributes: true, attributeFilter: ['class'] });
  }

  // ---- Global keyboard guard (capture) ----
  document.addEventListener('keydown', (ev) => {
    if (!uiLock) return;

    // swallow app shortcuts while connecting
    const key = ev.key;
    const isShortcut =
      SHORTCUT_KEYS.has(key) ||
      (ev.ctrlKey && key.toLowerCase() === 'enter') || // Run
      (ev.ctrlKey && key.toLowerCase() === 's');       // Save

    if (isShortcut) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, { capture: true });

  // Also provide a universal F10 handler that cancels connect/run
 // Only intercept F10 while CONNECTING (modal lock), otherwise let your app handle it
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'F10') return;

  // If UI is locked (i.e., Connecting modal visible), we intercept and cancel the connect
  if (uiLock || (current && current.state === 'connecting')) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    PC.cancelCurrentSession('user');     // abort fetch + gate WS
    // uiLock = false; // optionally unlock/hide modal here if you don’t elsewhere
    return;
  }

  // Not locked: DO NOT preventDefault—let your existing F10 handler run.
  // (If you want a centralized stop here too, expose one:)
  // if (current && current.state === 'running') PC.cancelCurrentSession('user');
}, { capture: true });


  // ---- Wrap fetch to make /prepare abortable & tied to session ----
  const _fetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    try {
      const url = (typeof input === 'string' ? input : (input?.url || '')) || '';
      const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();

      // Only intercept POST .../api/cc/prepare
      if (method === 'POST' && PREPARE_PATH_REGEX.test(url)) {
        // New connect session
        const id = ++sessionSeq;
        current = { id, state: 'connecting', ws: null };

        // Ensure an AbortController is attached
        if (pendingAbort) { try { pendingAbort.abort(); } catch {} }
        pendingAbort = new AbortController();

        const patchedInit = { ...init, signal: init.signal || pendingAbort.signal };

        // Let page code show modal however it wants; we hard-lock via observer
        const res = await _fetch(input, patchedInit);

        // If user cancelled mid-flight, gate right here
        if (!current || current.id !== id || current.state === 'cancelled') {
          // Drop result; caller might still await it, but session is invalid
          return res;
        }

        // Mark as prepared; page will open WS next. We keep state = 'connecting'
        // until WS onopen (handled by patched WebSocket below).
        return res;
      }

      // non-prepare requests pass through untouched
      return await _fetch(input, init);
    } catch (e) {
      // If aborted, keep state consistent
      if (current && current.state === 'connecting') {
        current.state = 'cancelled';
      }
      throw e;
    }
  };

  // ---- Wrap WebSocket for runner channel; gate late output ----
  const _WS = window.WebSocket;
  class PCWebSocket {
    constructor(url, protocols) {
      this._real = new _WS(url, protocols);
      this._url = String(url || '');
      this._sid = (current ? current.id : null);

      // If this looks like the runner socket, tie it to the session
      this._isRunner = WS_TOKEN_REGEX.test(this._url);
      if (this._isRunner && current && current.state === 'connecting') {
        current.ws = this._real;
      }

      // Proxy properties
      Object.defineProperty(this, 'readyState', { get: () => this._real.readyState });
      Object.defineProperty(this, 'url', { get: () => this._real.url });
      Object.defineProperty(this, 'binaryType', {
        get: () => this._real.binaryType,
        set: (v) => { this._real.binaryType = v; }
      });

      // Handlers (we wrap them)
      this._onopen = null;
      this._onmessage = null;
      this._onerror = null;
      this._onclose = null;

      // Wire through with gating
      this._real.addEventListener('open', (ev) => {
        if (this._isRunner) {
          // If session invalidated, close immediately
          if (!current || current.id !== this._sid || current.state === 'cancelled') {
            try { this._real.close(); } catch {}
            return;
          }
          current.state = 'running';      // go live
          // Let page hide modal / enable UI; our keyboard guard auto-unlocks when modal hides
        }
        this._onopen && this._onopen.call(this, ev);
      });

      this._real.addEventListener('message', (ev) => {
        if (this._isRunner) {
          // Gate late output
          if (!current || current.id !== this._sid || current.state !== 'running') {
            return; // stale or cancelled — drop output
          }
        }
        this._onmessage && this._onmessage.call(this, ev);
      });

      this._real.addEventListener('error', (ev) => {
        this._onerror && this._onerror.call(this, ev);
      });

      this._real.addEventListener('close', (ev) => {
        if (this._isRunner && current && current.id === this._sid) {
          current.state = 'stopped';
          current = null;
        }
        this._onclose && this._onclose.call(this, ev);
      });
    }

    // Standard WS surface
    send(data) { this._real.send(data); }
    close(code, reason) { this._real.close(code, reason); }

    // on* props
    get onopen() { return this._onopen; }
    set onopen(fn) { this._onopen = fn; }

    get onmessage() { return this._onmessage; }
    set onmessage(fn) { this._onmessage = fn; }

    get onerror() { return this._onerror; }
    set onerror(fn) { this._onerror = fn; }

    get onclose() { return this._onclose; }
    set onclose(fn) { this._onclose = fn; }

    // EventTarget passthrough
    addEventListener(...args) { return this._real.addEventListener(...args); }
    removeEventListener(...args) { return this._real.removeEventListener(...args); }
    dispatchEvent(...args) { return this._real.dispatchEvent(...args); }
  }

  // Only patch once
  if (!_WS.__pcWrapped) {
    PC._NativeWebSocket = _WS;
    PC.WebSocket = PCWebSocket;
    PC.cancel = PC.cancelCurrentSession;

    // Replace global WebSocket with our wrapper
    PCWebSocket.prototype = _WS.prototype;
    window.WebSocket = PCWebSocket;
    window.WebSocket.__pcWrapped = true;
  }
})();











// ===== POLYCODE overlay / collapse wiring =====
document.addEventListener('DOMContentLoaded', () => {
  const app   = document.querySelector('.app');
  if (!app) return;

  const $ = (sel) => document.querySelector(sel);
  const btnLeft   = $('#btnLeftToggle');
  const btnRight  = $('#btnRightToggle');
  const btnRun    = $('#btnRun');    // keep these ids consistent across pages
  const btnReset  = $('#btnReset');
const clearInlineGrid = () => { app.style.gridTemplateColumns = ''; };


// --- ADD: chevron SVGs + sync helpers (reuse your exact SVG paths) ---
const CHEV_LEFT  = '<svg viewBox="0 0 24 24"><path d="M14.71 17.29a1 1 0 01-1.42 0L9 13l4.29-4.29a1 1 0 011.42 1.42L10.83 13l3.88 3.88a1 1 0 010 1.41z"/></svg>'; // «
const CHEV_RIGHT = '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>'; // »


  function syncChevronState(){
  const overlay = isOverlay();
  const leftOpen  = overlay ? app.classList.contains('show-left')
                            : !app.classList.contains('collapsed-left');
  const rightOpen = overlay ? app.classList.contains('show-right')
                            : !app.classList.contains('collapsed-right');

  // Just reflect state; CSS will rotate the arrows
  btnLeft?.setAttribute('aria-expanded', String(leftOpen));
  btnRight?.setAttribute('aria-expanded', String(rightOpen));
}

// 1) Normalize icons once (single right-facing SVG in both buttons)
function ensureChevronSVG(btn){
  if (!btn) return;
  const already = btn.querySelector('svg');
  if (already) return;
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>';
}



  
function syncChevronIcons(){
  // collapsed = panel hidden
  const leftCollapsed  = isOverlay()
    ? !app.classList.contains('show-left')
    :  app.classList.contains('collapsed-left');

  const rightCollapsed = isOverlay()
    ? !app.classList.contains('show-right')
    :  app.classList.contains('collapsed-right');

  // Use your exact SVGs — collapsed → LEFT btn shows «, RIGHT btn shows »
  if (btnLeft)  btnLeft.innerHTML  = leftCollapsed  ? CHEV_LEFT  : CHEV_RIGHT;
  if (btnRight) btnRight.innerHTML = rightCollapsed ? CHEV_RIGHT : CHEV_LEFT;
syncChevronState();
  // aria-expanded = visible?
  btnLeft?.setAttribute('aria-expanded',  String(!leftCollapsed));
  btnRight?.setAttribute('aria-expanded', String(!rightCollapsed));
}


// Keep chevrons clickable above any scrim/overlay in small screens
function bringChevronsToFront(){
  const top = isOverlay() ? '9999' : '';
  [btnLeft, btnRight].forEach(b => {
    if (!b) return;
    b.style.zIndex = top;
    b.style.pointerEvents = 'auto';
  });
}













  
  // Match the CSS var (--bp-overlay) if present, else 1500px fallback
  const getOverlayQuery = () => {
    const cssVal = getComputedStyle(document.documentElement)
      .getPropertyValue('--bp-overlay').trim();
    return `(max-width: ${cssVal || '1500px'})`;
  };
  let mql = window.matchMedia(getOverlayQuery());
  function isOverlay(){ return mql.matches; }





    // ADD: use your exact SVGs; just swap based on actual open/closed state
  function renderToggleIcons() {
    const overlay = isOverlay();

    // open means panel is visible
    const leftOpen  = overlay
      ? app.classList.contains('show-left')
      : !app.classList.contains('collapsed-left');

    const rightOpen = overlay
      ? app.classList.contains('show-right')
      : !app.classList.contains('collapsed-right');

    // Your original paths (unchanged)
    const SVG_LEFT  = '<svg viewBox="0 0 24 24"><path d="M14.71 17.29a1 1 0 01-1.42 0L9 13l4.29-4.29a1 1 0 011.42 1.42L10.83 13l3.88 3.88a1 1 0 010 1.41z"/></svg>'; // ◀
    const SVG_RIGHT = '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 011.42 0L15 11l-4.29 4.29a1 1 0 11-1.42-1.42L12.17 11 9.29 8.12a1 1 0 010-1.41z"/></svg>'; // ▶

    // LEFT button: when panel is open, show ◀ (collapse); when closed, show ▶ (expand)
    if (btnLeft) {
      btnLeft.setAttribute('aria-expanded', String(leftOpen));
      btnLeft.innerHTML = leftOpen ? SVG_LEFT : SVG_RIGHT;
    }

    // RIGHT button: mirror the logic (open -> ▶ to collapse to the right, closed -> ◀ to expand from right)
    if (btnRight) {
      btnRight.setAttribute('aria-expanded', String(rightOpen));
      btnRight.innerHTML = rightOpen ? SVG_RIGHT : SVG_LEFT;
    }
  }




  


  // Recompute when the CSS var changes or window resizes (rare but safe)
/*window.addEventListener('resize', () => {
  if (editor && editor.layout) editor.layout();   // relayout Monaco
  mql = window.matchMedia(getOverlayQuery());     // declare mql with let/var somewhere
  syncChevronIcons();
  bringChevronsToFront();
});*/

  window.addEventListener('resize', () => {
  // relayout Monaco if present
  if (window.editor?.layout) window.editor.layout();

  // if your overlay breakpoint is a CSS var, rebind the media query on resize
  const q = getOverlayQuery();            // from your file
  if (mql.media !== q) {                  // mql was created from getOverlayQuery()
    mql.removeEventListener?.('change', onMQChange);
    mql = window.matchMedia(q);
    mql.addEventListener?.('change', onMQChange);
  }

  syncChevronIcons();
  bringChevronsToFront();
});



if (typeof mql.addEventListener === 'function') {
  mql.addEventListener('change', () => { clearInlineGrid(); syncChevronIcons(); bringChevronsToFront(); });
} else {
  mql.addListener(() => { clearInlineGrid(); syncChevronIcons(); bringChevronsToFront(); });
}

ensureChevronSVG(btnLeft);
ensureChevronSVG(btnRight);
  // Left toggle
  btnLeft?.addEventListener('click', () => {
    if (isOverlay()) {
      app.classList.toggle('show-left');
      app.classList.remove('show-right');
    } else {
      clearInlineGrid();    
      app.classList.toggle('collapsed-left');   // desktop: collapse column
    }
    syncChevronIcons();
  });

  // Right toggle
  btnRight?.addEventListener('click', () => {
    if (isOverlay()) {
      app.classList.toggle('show-right');
      app.classList.remove('show-left');
    } else {
      clearInlineGrid();    
      app.classList.toggle('collapsed-right');  // desktop: collapse column
    }
    syncChevronIcons(); 
  });

  // Auto-open Output on Run (overlay mode)
  btnRun?.addEventListener('click', () => {
    if (isOverlay()) {
      app.classList.add('show-right');
      app.classList.remove('show-left');
          }
    else {
    // large screens: if right panel is collapsed, uncollapse it
    clearInlineGrid?.(); // keep your resizer math from pinning widths
    app.classList.remove('collapsed-right');
  }
    syncChevronIcons();
  });

  // Auto-close Output on Reset (overlay mode)
  btnReset?.addEventListener('click', () => {
    if (isOverlay()) {
      app.classList.remove('show-right');}
      syncChevronIcons();
    
  });

  // ESC closes any open drawer (overlay mode)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOverlay()) {
      app.classList.remove('show-left', 'show-right');
      syncChevronIcons();
    }
  });
 syncChevronIcons();
bringChevronsToFront();
});

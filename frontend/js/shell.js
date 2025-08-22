// Start idle animation immediately on page load


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
document.getElementById('output')?.style.setProperty('background','transparent','important');
document.getElementById('preview')?.style.setProperty('background','transparent','important');

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

  async function captureOutputImageDataURL(){
    const preview = document.getElementById('preview');
    if (preview && window.editor) {
      const code = window.editor.getValue();
      const tmp = document.createElement('iframe');
      tmp.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;visibility:hidden';
      tmp.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      tmp.srcdoc = code;
      document.body.appendChild(tmp);
      await new Promise(r => tmp.onload = () => setTimeout(r, 80));
      const canvas = await html2canvas(tmp.contentDocument.body, { backgroundColor:'#ffffff', scale:2 });
      const url = canvas.toDataURL('image/png');
      document.body.removeChild(tmp);
      return url;
    }
    const out = document.getElementById('output');
    const canvas = await html2canvas(out, { backgroundColor:'#ffffff', scale:2 });
    return canvas.toDataURL('image/png');
  }

  async function buildPdfBlob(userTitle){
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit:'pt', format:'a4' });
    const margin = 40, pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    let y = margin;

    const { langLabel } = getLangInfo();
    const title = (userTitle && userTitle.trim()) || 'Polycode Session';
    const when = new Date().toLocaleString();

    pdf.setFont('helvetica','bold'); pdf.setFontSize(16);
    pdf.text(`${langLabel} — ${title}`, margin, y); y += 18;
    pdf.setFont('helvetica','normal'); pdf.setFontSize(10);
    pdf.text(when, margin, y); y += 16;
    pdf.setDrawColor(180); pdf.line(margin, y, pageW - margin, y); y += 12;

    pdf.setFont('courier','normal'); pdf.setFontSize(10);
    const code = window.editor ? window.editor.getValue() : '';
    const lines = pdf.splitTextToSize(code || '(empty)', pageW - margin*2);
    const lh = 12;
    for (const line of lines){
      if (y + lh > pageH - margin){ pdf.addPage(); y = margin; }
      pdf.text(line, margin, y); y += lh;
    }

    y += 12;
    const img = await captureOutputImageDataURL().catch(()=>null);
    if (img){
      if (y > pageH - margin - 120){ pdf.addPage(); y = margin; }
      pdf.setFont('helvetica','bold'); pdf.setFontSize(12);
      pdf.text('Screen', margin, y); y += 10;
      const w = pageW - margin*2, h = Math.min(520, pageH - margin - y);
      pdf.addImage(img, 'PNG', margin, y, w, h, undefined, 'FAST');
    }
    return new Promise(res => pdf.output('blob', b => res(b)));
  }

  async function savePdfToDisk(){
    const { langLabel } = getLangInfo();
    const name = prompt('Enter a title for the PDF:', 'Untitled') || 'Untitled';
    const blob = await buildPdfBlob(name);
    const fileName = `Polycode-${langLabel}-${name.replace(/[^\w-]+/g,'_')}.pdf`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function sharePdf(){
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

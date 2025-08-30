// Start idle animation immediately on page load

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
// ============================
// polycode shell.js (full)
// ============================

// ---- Optional reload confirm for toolbar Reload only
if ('navigation' in window && typeof navigation.addEventListener === 'function') {
  navigation.addEventListener('navigate', (e) => {
    if (e.navigationType === 'reload') {
      const shouldAsk = true;
      if (!shouldAsk) return;
      if (!confirm('Your Data will be Lost.\nStill Reload the Page?')) {
        e.preventDefault();
      }
    }
  });
}

// ===========================
// Copy guard (everywhere except editor/console/inputs)
// ===========================
(function () {
  const allow = (el) =>
    el.closest('#editor') || el.closest('#jconsole') ||
    el.closest('input,textarea,[contenteditable="true"]');

  document.addEventListener('keydown', (e) => {
    const isCopyKey =
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') ||
      ((e.ctrlKey || e.metaKey) && e.key === 'Insert');
    if (isCopyKey && !allow(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.addEventListener('copy', (e) => {
    if (!allow(e.target)) {
      e.preventDefault();
      try { e.clipboardData?.setData('text/plain', ''); } catch {}
    }
  }, true);

  const left = document.getElementById('leftPanel');
  if (left) left.style.userSelect = 'none';
})();

// ===========================
// Output interactivity helpers
// ===========================
function enableOutput(){
  const out = document.getElementById('output');
  out && out.classList.remove('screen-dim');
  out && out.classList.remove('error');
  out && out.removeAttribute('aria-busy');
}
function disableOutput(){
  const out = document.getElementById('output');
  if (!out) return;
  out.setAttribute('aria-busy','true');
}
document.getElementById('btnRun')?.addEventListener('click', enableOutput);
document.getElementById('btnReset')?.addEventListener('click', enableOutput);

// Keep Monaco sized after window changes
addEventListener('resize', () => {
  if (window.editor?.layout) {
    const el = document.getElementById('editor');
    requestAnimationFrame(() =>
      window.editor.layout({ width: el.clientWidth, height: el.clientHeight })
    );
  }
}, { passive:true });

// ===========================
// Load left reference content (scoped)
// ===========================
async function loadLeftContent(lang){
  const el = document.getElementById('leftContent');
  if (!el) return;

  try{
    const res = await fetch(`./content/${lang}.html`, { cache:'no-store' });
    if(!res.ok){ el.innerHTML = ''; return; }

    const raw = await res.text();

    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const innerHTML = bodyMatch ? bodyMatch[1] : raw;

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

// ===========================
// Theme (apply, persist, sync Monaco & previews)
// ===========================
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

  function setTheme(mode){
    const toLight = mode === 'light';
    document.body.classList.toggle('light', toLight);
    setIcon(toLight);

    if (window.monaco && window.editor) {
      monaco.editor.setTheme(toLight ? 'vs' : 'vs-dark');
    }
    document.getElementById('output')
      ?.style.setProperty('background','transparent','important');

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

  btn?.addEventListener('click', () => setTheme(isLight() ? 'dark' : 'light'));

  window.PolyShell = window.PolyShell || {};
  window.PolyShell.setTheme = setTheme;
  window.PolyShell.getTheme = () => (isLight() ? 'light' : 'dark');
  window.PolyShell.reapplyTheme = () => setTheme(isLight() ? 'light' : 'dark');

  try {
    const saved = localStorage.getItem('polycode_theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  } catch {}

  setIcon(isLight());
})();

// ===========================
// Status + spinner chips
// ===========================
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

// ===========================
// Monaco loader + init
// ===========================
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
Object.assign(window.PolyShell || (window.PolyShell = {}), {
  initMonaco,
  setStatus,
  showEditorError,
  clearEditorErrors,
  loadLeftContent
});

// ===========================
// Grid helpers & resizers (desktop only)
// ===========================
function getOverlayQuery(){
  const cssVal = getComputedStyle(document.documentElement)
    .getPropertyValue('--bp-overlay').trim();
  return `(max-width: ${cssVal || '1500px'})`;
}
function isOverlayMode(){
  return window.matchMedia(getOverlayQuery()).matches;
}

function parseCols(str) {
  return str.split(' ').map(s => (s.endsWith('px') ? parseFloat(s) : s));
}
function setCols(app, L, C, R) {
  app.style.gridTemplateColumns = `${L}px 8px ${C}px 8px ${R}px`;
}
function initCols() {
  if (isOverlayMode()) return;
  const app = document.querySelector('.app');
  if (!app) return;
  const L = document.getElementById('leftPanel')?.getBoundingClientRect().width || 280;
  const C = document.getElementById('centerPanel')?.getBoundingClientRect().width || 720;
  const R = document.getElementById('rightPanel')?.getBoundingClientRect().width || 360;
  setCols(app, Math.max(200, L), Math.max(360, C), Math.max(300, R));
}
(function () {
  if (isOverlayMode()) return;
  const app = document.querySelector('.app');
  const dragLeft  = document.getElementById('dragLeft');
  const dragRight = document.getElementById('dragRight');
  if (!app) return;

  function startDrag(e, side) {
    e.preventDefault();
    const startX = e.clientX;
    const [L, , C, , R] = parseCols(getComputedStyle(app).gridTemplateColumns);
    const totalLC = L + C;
    const totalCR = C + R;
    const minL = 200, minC = 360, minR = 300;

    function move(ev) {
      const dx = ev.clientX - startX;
      if (side === 'left') {
        let newL = L + dx;
        let newC = totalLC - newL;
        if (newL < minL) { newL = minL; newC = totalLC - newL; }
        if (newC < minC) { newC = minC; newL = totalLC - newC; }
        if (newL > totalLC - minC) { newL = totalLC - minC; newC = minC; }
        setCols(app, newL, newC, R);
      } else {
        let newR = R - dx;
        let newC = totalCR - newR;
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

// ===========================
// Footer chips + attention
// ===========================
function foot(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
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
function setAttention({run=false, reset=false}={}){
  const runBtn = document.getElementById('btnRun');
  const rstBtn = document.getElementById('btnReset');
  runBtn?.classList.remove('attn');
  rstBtn?.classList.remove('attn');
  if(run)  runBtn?.classList.add('attn');
  if(reset) rstBtn?.classList.add('attn');
}
function setFootStatus(id, state, opts = {}){
  const host = document.getElementById(id);
  if (!host) return;
  const label = {
    ready:   'Ready for Execution',
    waiting: (state === 'waiting' && opts?.forceInputLabel) ? 'Waiting for Input' : 'Waiting for Execution',
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

// Freeze/unfreeze during run
function freezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.setAttribute('disabled','');
  document.getElementById('btnReset')?.removeAttribute('disabled');
  document.getElementById('langSelect')?.setAttribute('disabled','');
  window.editor?.updateOptions({ readOnly:true });

  document.getElementById('output')?.classList.remove('screen-dim');
  document.getElementById('output')?.style.setProperty('background','transparent','important');

  setFrozen(all, true, { excludeRight: true });
  foot('centerFoot','Click Reset for your next code');
  setFootStatus('rightFoot','running');
  setAttention({ reset: true });
}
function unfreezeUI() {
  const all = panels();
  document.getElementById('btnRun')?.removeAttribute('disabled');
  document.getElementById('btnReset')?.setAttribute('disabled','');
  document.getElementById('langSelect')?.removeAttribute('disabled');
  window.editor?.updateOptions({ readOnly:false });

  const out = document.getElementById('output');
  if (out) out.style.setProperty('background','transparent','important');
  document.getElementById('output')?.classList.add('screen-dim');

  setFrozen(all, false);
  setFootStatus('centerFoot','ready');
  setFootStatus('rightFoot','waiting');
  setAttention({ run: true });
}

// Run / Reset handlers
(function () {
  const runBtn = document.getElementById('btnRun');
  const rstBtn = document.getElementById('btnReset');

  runBtn?.addEventListener('click', async () => {
    let t0;
    try {
      runBtn.classList.add('is-running');
      clearEditorErrors(); spin(true); setStatus('Running…'); freezeUI();
      t0 = performance.now();
      await window.runLang();
      const elapsed = fmtDuration(performance.now() - t0);
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

  rstBtn?.addEventListener('click', () => {
    try { window.clearLang && window.clearLang(); } catch {}
    window.PolyShell?.reapplyTheme?.();
    setStatus('Reset','ok');
    unfreezeUI();
  });
})();

// Initial footer state + run glow after first paint
(function bootUIOnFirstPaint(){
  const init = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFootStatus('centerFoot','ready');
        setFootStatus('rightFoot','waiting');
        document.getElementById('output')?.classList.add('screen-dim');

        const runBtn = document.getElementById('btnRun');
        if (runBtn){
          runBtn.classList.remove('attn');
          void runBtn.offsetWidth;
          runBtn.classList.add('attn');
        }

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

// Robustness on resize/orientation
(function(){
  let raf = 0, endTimer = 0;
  function applyResizeFixes(){
    const app = document.querySelector('.app');
    if (app) app.style.gridTemplateColumns = '';
    if (window.editor?.layout) {
      const edEl = document.getElementById('editor');
      if (edEl) window.editor.layout({ width: edEl.clientWidth, height: edEl.clientHeight });
    }
    document.getElementById('centerPanel')?.removeAttribute('aria-busy');
    document.getElementById('rightPanel')?.removeAttribute('aria-busy');
    document.getElementById('output')?.classList.remove('screen-dim');
    document.querySelectorAll('.btn.is-running, .btn.is-resetting')
      .forEach(b => { b.classList.remove('is-running','is-resetting'); });
  }
  function onResize(){
    cancelAnimationFrame(raf);
    clearTimeout(endTimer);
    raf = requestAnimationFrame(applyResizeFixes);
    endTimer = setTimeout(applyResizeFixes, 200);
  }
  addEventListener('resize', onResize, { passive:true });
  addEventListener('orientationchange', onResize, { passive:true });
  ['mouseup','touchend','pointerup'].forEach(evt =>
    addEventListener(evt, () => setTimeout(applyResizeFixes, 0), { passive:true })
  );
})();

// Keep Monaco fresh if editor container resizes
try {
  const ro = new ResizeObserver(() => {
    if (window.editor?.layout) {
      const el = document.getElementById('editor');
      window.editor.layout({ width: el.clientWidth, height: el.clientHeight });
    }
  });
  ro.observe(document.getElementById('editor'));
} catch {}

// Hotkeys
(function initPolycodeHotkeys(){
  function click(id){ document.getElementById(id)?.click(); }
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;

    if ((mod && e.key === 'Enter') || e.key === 'F9') {
      e.preventDefault();
      click('btnRun');
      return;
    }
    if (e.key === 'F5') {
      if(!confirm("Are you sure you want to reload the page?")) e.preventDefault();
      return;
    }
    if ((mod && e.shiftKey && (e.key === 'L' || e.key === 'l')) || e.key === 'F10') {
      e.preventDefault();
      click('btnReset');
      return;
    }
    if (mod && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      if (window.editor) {
        const sel = window.editor.getModel().getValueInRange(window.editor.getSelection());
        const code = (sel && sel.trim()) ? sel : null;
        if (window.runLang) window.runLang(code);
      } else {
        click('btnRun');
      }
    }
  }, { passive: false });

  function bindMonaco(){
    if (!window.monaco || !window.editor) return;
    const m = monaco;
    window.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => {
      document.getElementById('btnRun')?.click();
    });
    window.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.Enter, () => {
      const sel = window.editor.getModel().getValueInRange(window.editor.getSelection());
      if (window.runLang) window.runLang(sel && sel.trim() ? sel : null);
    });
    window.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.KeyL, () => {
      document.getElementById('btnReset')?.click();
    });
  }
  const tryBind = () => setTimeout(bindMonaco, 0);
  tryBind();
  window.addEventListener('polycode-editor-ready', tryBind);
})();

// Footer driver for runner phases
(function(){
  let footTick = null;
  function setRunnerPhase(phase, opts = {}) {
    if (typeof footTick !== 'undefined' && footTick && phase !== 'waiting_input') {
      clearInterval(footTick);
      footTick = null;
    }
    const state = (phase === 'waiting_input') ? 'waiting' : phase;
    const detail = opts.detail ?? '';
    const extra = (phase === 'waiting_input') ? { forceInputLabel: true } : {};
    setFootStatus('rightFoot', state, { detail, ...extra });
  }
  window.PolyShell = window.PolyShell || {};
  window.PolyShell.setRunnerPhase = setRunnerPhase;
  window.PolyShell.startInputTicker = (fnGetDetail, ms=500) => {
    clearInterval(footTick);
    footTick = setInterval(() => {
      const d = fnGetDetail?.();
      setRunnerPhase('waiting_input', { detail: d ? d : '' });
    }, ms);
  };
  window.PolyShell.stopInputTicker = () => { clearInterval(footTick); footTick = null; };
})();

// Save/share helpers (works when libs present; otherwise graceful)
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
    if (window.html2canvas) {
      const out = document.getElementById('output');
      const canvas = await html2canvas(out, { backgroundColor:'#ffffff', scale:2 });
      return canvas.toDataURL('image/png');
    }
    return null;
  }

  async function buildPdfBlob(userTitle){
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');
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
    try{
      const { langLabel } = getLangInfo();
      const name = prompt('Enter a title for the PDF:', 'Untitled') || 'Untitled';
      const blob = await buildPdfBlob(name);
      const fileName = `Polycode-${langLabel}-${name.replace(/[^\w-]+/g,'_')}.pdf`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
    }catch(e){
      alert('PDF features require jsPDF/html2canvas on the page.');
    }
  }

  window.addEventListener('load', () => {
    document.getElementById('btnSaveFile')?.addEventListener('click', saveFile);
    document.getElementById('btnSharePdf')?.addEventListener('click', savePdfToDisk);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveFile();
    }
  }, { passive:false });
})();

// ===== Global connect guard & session gate (fetch/WS) =====
(() => {
  const CONNECT_MODAL_SELECTOR = '#connectModal';
  const MODAL_HIDDEN_CLASS = 'hide';
  const PREPARE_PATH_REGEX = /\/api\/cc\/prepare(?:$|\?)/;
  const WS_TOKEN_REGEX = /\/cc(?:$|\?)|token=/;
  const SHORTCUT_KEYS = new Set(['F10']);

  const PC = (window.PC ||= {});
  let uiLock = false;
  let sessionSeq = 0;
  let current = null;
  let pendingAbort = null;

  PC.lockUI   = () => { uiLock = true; };
  PC.unlockUI = () => { uiLock = false; };

  PC.cancelCurrentSession = function(reason = 'user') {
    try { pendingAbort?.abort(); } catch {}
    pendingAbort = null;
    if (current) {
      current.state = 'cancelled';
      try { current.ws?.close(); } catch {}
      current.ws = null;
      current = null;
    }
  };

  const connectModal = document.querySelector(CONNECT_MODAL_SELECTOR);
  if (connectModal) {
    const updateLockFromModal = () => {
      const visible = !connectModal.classList.contains(MODAL_HIDDEN_CLASS);
      uiLock = visible;
    };
    updateLockFromModal();
    const mo = new MutationObserver(updateLockFromModal);
    mo.observe(connectModal, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('keydown', (ev) => {
    if (!uiLock) return;
    const key = ev.key;
    const isShortcut =
      SHORTCUT_KEYS.has(key) ||
      (ev.ctrlKey && key.toLowerCase() === 'enter') ||
      (ev.ctrlKey && key.toLowerCase() === 's');
    if (isShortcut) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, { capture: true });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'F10') return;
    if (uiLock || (current && current.state === 'connecting')) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      PC.cancelCurrentSession('user');
      return;
    }
  }, { capture: true });

  const _fetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    try {
      const url = (typeof input === 'string' ? input : (input?.url || '')) || '';
      const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();

      if (method === 'POST' && PREPARE_PATH_REGEX.test(url)) {
        const id = ++sessionSeq;
        current = { id, state: 'connecting', ws: null };
        if (pendingAbort) { try { pendingAbort.abort(); } catch {} }
        pendingAbort = new AbortController();
        const patchedInit = { ...init, signal: init.signal || pendingAbort.signal };
        const res = await _fetch(input, patchedInit);
        if (!current || current.id !== id || current.state === 'cancelled') {
          return res;
        }
        return res;
      }
      return await _fetch(input, init);
    } catch (e) {
      if (current && current.state === 'connecting') {
        current.state = 'cancelled';
      }
      throw e;
    }
  };

  const _WS = window.WebSocket;
  class PCWebSocket {
    constructor(url, protocols) {
      this._real = new _WS(url, protocols);
      this._url = String(url || '');
      this._sid = (current ? current.id : null);
      this._isRunner = WS_TOKEN_REGEX.test(this._url);
      if (this._isRunner && current && current.state === 'connecting') {
        current.ws = this._real;
      }
      Object.defineProperty(this, 'readyState', { get: () => this._real.readyState });
      Object.defineProperty(this, 'url', { get: () => this._real.url });
      Object.defineProperty(this, 'binaryType', {
        get: () => this._real.binaryType,
        set: (v) => { this._real.binaryType = v; }
      });
      this._onopen = null;
      this._onmessage = null;
      this._onerror = null;
      this._onclose = null;

      this._real.addEventListener('open', (ev) => {
        if (this._isRunner) {
          if (!current || current.id !== this._sid || current.state === 'cancelled') {
            try { this._real.close(); } catch {}
            return;
          }
          current.state = 'running';
        }
        this._onopen && this._onopen.call(this, ev);
      });
      this._real.addEventListener('message', (ev) => {
        if (this._isRunner) {
          if (!current || current.id !== this._sid || current.state !== 'running') {
            return;
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
    send(data) { this._real.send(data); }
    close(code, reason) { this._real.close(code, reason); }
    get onopen() { return this._onopen; }   set onopen(fn) { this._onopen = fn; }
    get onmessage() { return this._onmessage; } set onmessage(fn) { this._onmessage = fn; }
    get onerror() { return this._onerror; } set onerror(fn) { this._onerror = fn; }
    get onclose() { return this._onclose; } set onclose(fn) { this._onclose = fn; }
    addEventListener(...args) { return this._real.addEventListener(...args); }
    removeEventListener(...args) { return this._real.removeEventListener(...args); }
    dispatchEvent(...args) { return this._real.dispatchEvent(...args); }
  }
  if (!_WS.__pcWrapped) {
    PC._NativeWebSocket = _WS;
    PC.WebSocket = PCWebSocket;
    PC.cancel = PC.cancelCurrentSession;
    PCWebSocket.prototype = _WS.prototype;
    window.WebSocket = PCWebSocket;
    window.WebSocket.__pcWrapped = true;
  }
})();



// === Chevron controller (desktop + overlay) — drop-in replacement ===
document.addEventListener('DOMContentLoaded', () => {
  const app     = document.querySelector('.app');
  const leftBtn = document.querySelector('.chevron-tab.left');
  const rightBtn= document.querySelector('.chevron-tab.right');
  const runBtn  = document.getElementById('btnRun');
  const resetBtn= document.getElementById('btnReset');
  if (!app || !leftBtn || !rightBtn) return;

  const mql = matchMedia(getOverlayQuery());
  const isOverlay = () => mql.matches;

  // Provide default labels if HTML didn't set data-label-* already
  function ensureLabels(btn, openLabel, closedLabel){
    if (!btn) return;
    if (btn.dataset.labelOpen   == null) btn.dataset.labelOpen   = openLabel;
    if (btn.dataset.labelClosed == null) btn.dataset.labelClosed = closedLabel;
  }
  ensureLabels(leftBtn,  'Hide Reference Panel',   'Show Reference Panel');
  ensureLabels(rightBtn, 'Hide Output Console', 'Show Output Console');

  function getOpen(which){
    if (isOverlay()){
      return app.classList.contains(which === 'left' ? 'show-left' : 'show-right');
    }
    return !app.classList.contains(which === 'left' ? 'collapsed-left' : 'collapsed-right');
  }

  function setOpen(which, open){
    const btn = which === 'left' ? leftBtn : rightBtn;

    if (isOverlay()){
      const cls = which === 'left' ? 'show-left' : 'show-right';
      app.classList.toggle(cls, open);
      // On overlay, only one side visible at a time
      if (open) app.classList.remove(which === 'left' ? 'show-right' : 'show-left');
    } else {
      const cls = which === 'left' ? 'collapsed-left' : 'collapsed-right';
      app.classList.toggle(cls, !open);
    }

    // Keep accessibility + CSS hooks in sync (drives text/icon/glow)
    if (btn) {
      btn.setAttribute('aria-expanded', String(open));
      const label = open ? btn.dataset.labelOpen : btn.dataset.labelClosed;
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }

  function sync(){
    // Reflect current classes into aria-expanded/labels without changing layout
    setOpen('left',  getOpen('left'));
    setOpen('right', getOpen('right'));
  }

  // Initial sync + on breakpoint change
  sync();
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', sync);
  } else {
    mql.addListener(sync); // older browsers
  }

  // Also resync if any other code toggles classes on .app
  const mo = new MutationObserver((muts) => {
    if (muts.some(m => m.attributeName === 'class')) sync();
  });
  mo.observe(app, { attributes:true, attributeFilter:['class'] });

  // Single delegated click handler for both chevrons (prevents old handler conflicts)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.chevron-tab.left, .chevron-tab.right');
    if (!btn) return;
    e.preventDefault();
    const which = btn.classList.contains('left') ? 'left' : 'right';
    setOpen(which, !getOpen(which));
  }, { capture:true });

  // Nice-to-have: auto show output on Run; hide on Reset in overlay
  runBtn?.addEventListener('click', () => setOpen('right', true));
  resetBtn?.addEventListener('click', () => { if (isOverlay()) setOpen('right', false); });
});








// ===========================
// Small helpers
// ===========================
function fmtDuration(ms){
  const s = ms / 1000;
  return `${s.toFixed(2)} second(s)`; 
}



// === Chevron controller v3 — mobile hang fix + label/icon sync ===
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const app      = document.querySelector('.app');
    const leftBtn  = document.querySelector('.chevron-tab.left');
    const rightBtn = document.querySelector('.chevron-tab.right');
    const runBtn   = document.getElementById('btnRun');
    const resetBtn = document.getElementById('btnReset');
    if (!app || !leftBtn || !rightBtn) return;

    const mql = matchMedia(getOverlayQuery());
    const isOverlay = () => mql.matches;

    // Ensure we have labels for both states (used for aria + optional text node)
    function ensureLabels(btn, openLabel, closedLabel) {
      if (!btn) return;
      if (btn.dataset.labelOpen   == null) btn.dataset.labelOpen   = openLabel;
      if (btn.dataset.labelClosed == null) btn.dataset.labelClosed = closedLabel;
    }
    ensureLabels(leftBtn,  'Hide Docs',   'Show Docs');
    ensureLabels(rightBtn, 'Hide Output', 'Show Output');

    function getOpen(which) {
      if (isOverlay()) {
        return app.classList.contains(which === 'left' ? 'show-left' : 'show-right');
      }
      return !app.classList.contains(which === 'left' ? 'collapsed-left' : 'collapsed-right');
    }

    function reflectButton(btn, open) {
      // Update attributes that your CSS/arrow relies on
      btn.setAttribute('aria-expanded', String(open));
      btn.dataset.open = open ? 'true' : 'false';
      const label = open ? (btn.dataset.labelOpen || '') : (btn.dataset.labelClosed || '');
      if (label) {
        btn.setAttribute('aria-label', label);
        btn.title = label;
        const txtEl = btn.querySelector('.label, .text, [data-slot="label"]');
        if (txtEl && txtEl.textContent !== label) txtEl.textContent = label;
      }
    }

    function reflect() {
      // Read current layout classes and only update button attributes (no writes to .app here)
      reflectButton(leftBtn,  getOpen('left'));
      reflectButton(rightBtn, getOpen('right'));
    }

    function setOpen(which, open) {
      if (isOverlay()) {
        const showCls  = which === 'left' ? 'show-left'  : 'show-right';
        const otherCls = which === 'left' ? 'show-right' : 'show-left';
        app.classList.toggle(showCls, open);
        if (open) app.classList.remove(otherCls); // only one side visible on overlay
      } else {
        const collCls = which === 'left' ? 'collapsed-left' : 'collapsed-right';
        app.classList.toggle(collCls, !open);
      }
      // After mutating, just reflect attributes/text
      reflect();
    }

    // Initial reflect and keep synced on breakpoint changes
    reflect();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', reflect);
    } else {
      mql.addListener(reflect);
    }

    // Observe .app class changes from anywhere else (reads only → no loop)
    const mo = new MutationObserver(() => reflect());
    mo.observe(app, { attributes: true, attributeFilter: ['class'] });

    // Single delegated handler (capture) — blocks older/bubbling handlers to avoid double toggles
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chevron-tab.left, .chevron-tab.right');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      const which = btn.classList.contains('left') ? 'left' : 'right';
      setOpen(which, !getOpen(which));
    }, { capture: true });

    // Auto-show/hide output in overlay on Run/Reset
    runBtn?.addEventListener('click', () => setOpen('right', true));
    resetBtn?.addEventListener('click', () => { if (isOverlay()) setOpen('right', false); });
  });
})();






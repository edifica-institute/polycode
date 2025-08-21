// ===== THEME ================================================================
(function Theme(){
  const btn = document.getElementById('btn-theme');
  const root = document.body;
  const KEY = 'polycode-theme';

  const set = (mode) => {
    root.classList.toggle('theme-dark', mode === 'dark');
    root.classList.toggle('theme-light', mode !== 'dark');
    btn.textContent = (mode === 'dark') ? '☀️' : '🌙';
    btn.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
    localStorage.setItem(KEY, mode);
  };

  const saved = localStorage.getItem(KEY);
  set(saved || 'light');

  btn.addEventListener('click', () => {
    const now = root.classList.contains('theme-dark') ? 'light' : 'dark';
    set(now);
  });
})();

// ===== RUN / RESET glow + demo execution ===================================
(function Runner(){
  const btnRun = document.getElementById('btn-run');
  const btnReset = document.getElementById('btn-reset');
  const out = document.getElementById('screen-output');
  const estatus = document.getElementById('editor-status');
  const sstatus = document.getElementById('screen-status');
  const textarea = document.getElementById('sql-editor');

  function setGlow(which){
    btnRun.dataset.glow = (which === 'run') ? 'on' : 'off';
    btnReset.dataset.glow = (which === 'reset') ? 'on' : 'off';
  }

  btnRun.addEventListener('click', async () => {
    setGlow('run');
    estatus.textContent = 'Executing…';
    sstatus.textContent = 'Running SQL…';
    out.textContent = '';

    // DEMO: Fake “execution”
    await new Promise(r => setTimeout(r, 500));
    const q = textarea.value.trim() || "SELECT 'Hello, POLYCODE!' AS greeting;";
    out.textContent =
      `Query:\n${q}\n\nResult (demo):\n┌──────────┬───────────────┐\n│ row_num  │ greeting      │\n├──────────┼───────────────┤\n│ 1        │ Hello, POLYCODE! │\n└──────────┴───────────────┘`;
    estatus.textContent = 'Done';
    sstatus.textContent = 'Complete';
    setGlow('off');
  });

  btnReset.addEventListener('click', () => {
    setGlow('reset');
    textarea.value = '';
    out.textContent = '';
    estatus.textContent = 'Cleared';
    sstatus.textContent = 'Idle';
    setTimeout(()=>setGlow('off'), 500);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    out.textContent = '';
    sstatus.textContent = 'Cleared';
  });
})();

// ===== LEFT PANEL collapse ==================================================
(function LeftPane(){
  const left = document.getElementById('pane-left');
  const btn = document.getElementById('btn-left-toggle');

  btn.addEventListener('click', () => {
    left.classList.toggle('collapsed');
    // NOTE: When left is collapsed, editor simply shifts left via CSS grid.
    // This matches your requirement that the editor only moves left if the left panel is collapsed.
  });
})();

// ===== RESIZER between Editor and Screen ===================================
// (1) Drag should only resize editor vs screen; left panel never changes.
// This splitter respects min widths and updates grid columns inline.
(function Splitter(){
  const shell = document.querySelector('.shell');
  const splitter = document.getElementById('splitter');

  let dragging = false;
  let startX = 0;
  let startEditorPx = 0;
  let startScreenPx = 0;

  // Compute current pixel widths of editor & screen columns
  function getCols(){
    const cs = getComputedStyle(shell);
    const cols = cs.gridTemplateColumns.split(' ');
    // Expected: [left, editor, splitter, screen]
    const left = parseFloat(cols[0]);
    const editor = parseFloat(cols[1]);
    const split = parseFloat(cols[2]);
    const screen = parseFloat(cols[3]);
    return { left, editor, split, screen, cols };
  }

  function setCols(editorPx, screenPx){
    // Keep constraints
    const editorMin = 360;        // don’t let editor be too small
    const screenMin = 320;        // don’t let screen be too small
    const e = Math.max(editorMin, editorPx);
    const s = Math.max(screenMin, screenPx);
    shell.style.gridTemplateColumns = `${getCols().left}px ${e}px 6px ${s}px`;
  }

  splitter.addEventListener('mousedown', (e)=>{
    dragging = true;
    startX = e.clientX;
    const { editor, screen } = getCols();
    startEditorPx = editor;
    startScreenPx = screen;
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e)=>{
    if(!dragging) return;
    const dx = e.clientX - startX;
    // Increase editor, decrease screen (and vice versa)
    setCols(startEditorPx + dx, startScreenPx - dx);
  });

  window.addEventListener('mouseup', ()=>{
    if(!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
  });

  // Touch support
  splitter.addEventListener('touchstart', (e)=>{
    const t = e.touches[0];
    dragging = true; startX = t.clientX;
    const { editor, screen } = getCols();
    startEditorPx = editor; startScreenPx = screen;
  }, {passive:true});

  window.addEventListener('touchmove', (e)=>{
    if(!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    setCols(startEditorPx + dx, startScreenPx - dx);
  }, {passive:true});

  window.addEventListener('touchend', ()=>{ dragging = false; });
})();

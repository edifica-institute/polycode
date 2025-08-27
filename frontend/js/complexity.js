(function () {
  'use strict';

  /* =================== Utilities & Normalization =================== */

  // Strip strings + comments (Java/C/C++)
  function stripNoise(src) {
    let s = String(src);
    s = s.replace(/"(?:\\.|[^"\\])*"/g, '""')
         .replace(/'(?:\\.|[^'\\])'/g, "''");
    s = s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')); // keep line count
    s = s.replace(/\/\/.*$/gm, '');
    return s;
  }

  const simplify = {
    mult(a, b) {
      if (a === '1') return b;
      if (b === '1') return a;
      const parts = (txt) => txt.split(/\s+/).filter(Boolean);
      const all = parts(a).concat(parts(b));
      const count = {};
      for (const t of all) count[t] = (count[t] || 0) + 1;

      const mk = (sym, p) => (p === 1 ? sym : `${sym}^${p}`);
      const out = [];
      // normalize 'log' → 'log n'
      const keys = Object.keys(count);
      for (const k of keys) {
        if (k === 'log') { count['log n'] = (count['log n'] || 0) + count[k]; delete count[k]; }
      }
      // n first
      if (count['n']) { out.push(mk('n', count['n'])); delete count['n']; }
      if (count['log n']) { out.push(mk('log n', count['log n'])); delete count['log n']; }
      // rest
      for (const [k, p] of Object.entries(count)) out.push(mk(k, p));
      return out.length ? out.join(' ') : '1';
    },
    max(a, b) {
      if (a === '1') return b;
      if (b === '1') return a;
      const weight = (v) => {
        v = v.replace(/\s+/g,'');
        if (/2\^n|n!/.test(v)) return 7;
        if (/n\^3/.test(v))    return 6;
        if (/n\^2/.test(v))    return 5;
        if (/nlogn|nlog/.test(v)) return 4;
        if (/n(?!\^)/.test(v)) return 3;
        if (/logn|log/.test(v)) return 2;
        return 1; // constant/unknown
      };
      return weight(a) >= weight(b) ? a : b;
    }
  };

  /* =================== Loop Body Discovery (Nesting) =================== */

  function matchBrace(src, openIdx){
    let depth = 0;
    for (let i=openIdx; i<src.length; i++){
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}'){ depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function findLoopsWithBodies(code){
    const out = [];
    const re = /\b(for|while)\s*\(/g;
    let m;
    while ((m = re.exec(code))){
      const headStart = m.index;
      // scan to header end ')'
      let i = re.lastIndex, par=1;
      while (i < code.length && par){
        if (code[i] === '(') par++;
        else if (code[i] === ')') par--;
        i++;
      }
      const headEnd = i; // right after ')'
      // skip spaces/newlines
      while (i < code.length && /\s/.test(code[i])) i++;
      let bodyStart = -1, bodyEnd = -1;
      if (code[i] === '{'){
        bodyStart = i;
        bodyEnd   = matchBrace(code, i);
      } else {
        const semi  = code.indexOf(';', i);
        const brace = code[i] === '{' ? matchBrace(code, i) : -1;
        if (semi !== -1 && (brace === -1 || semi < brace)){
          bodyStart = i; bodyEnd = semi;
        } else if (brace !== -1){
          bodyStart = i; bodyEnd = brace;
        }
      }
      if (bodyStart !== -1 && bodyEnd !== -1){
        out.push({ headStart, headEnd, bodyStart, bodyEnd });
      }
      re.lastIndex = headEnd;
    }
    out.sort((a,b)=> a.bodyStart - b.bodyStart);
    const stack = [];
    for (const node of out){
      node.children = [];
      while (stack.length && !(node.bodyStart >= stack.at(-1).bodyStart && node.bodyEnd <= stack.at(-1).bodyEnd)){
        stack.pop();
      }
      if (stack.length) stack.at(-1).children.push(node);
      stack.push(node);
    }
    const isChild = new Set(out.flatMap(p => p.children));
    return out.filter(n => !isChild.has(n));
  }

  function posToLineMap(src){
    const lines = src.split(/\r?\n/);
    const acc = []; let pos=0;
    for (let i=0;i<lines.length;i++){
      acc.push({line:i+1, start:pos, end:pos+lines[i].length});
      pos += lines[i].length + 1;
    }
    return acc;
  }
  function lineFromPos(map, idx){
    let lo=0, hi=map.length-1, ans=1;
    while (lo<=hi){
      const mid = (lo+hi)>>1;
      if (idx < map[mid].start){ hi=mid-1; }
      else if (idx > map[mid].end){ lo=mid+1; }
      else { ans = map[mid].line; break; }
      ans = Math.max(1, Math.min(map.length, mid+1));
    }
    return ans;
  }

  /* =================== Loop Cost Heuristics =================== */

  function loopCost(header, body){
    const h = header.replace(/\s+/g,' ');
    const b = (body || '').replace(/\s+/g,' ');

    const looksLikeBS =
      /while\s*\(\s*\w+\s*<=\s*\w+\s*\)/i.test(h) &&
      /\bmid\s*=\s*\w+\s*\+\s*\(\s*\w+\s*-\s*\w+\s*\)\s*\/\s*2\b/i.test(b) &&
      (/\b(low|left)\s*=\s*mid\s*\+\s*1\b/i.test(b) || /\b(high|right)\s*=\s*mid\s*-\s*1\b/i.test(b) || /\b(low|left)\s*=\s*mid\b/i.test(b) || /\b(high|right)\s*=\s*mid\b/i.test(b));
    if (looksLikeBS) return 'log n';

    if (/[*/]\s*2\b|<<\s*1\b|>>\s*1\b/.test(h)) return 'log n';

    const twoPtr = /\bwhile\s*\(\s*\w+\s*<\s*\w+\s*\)/.test(h) &&
                   /\b\w+\s*\+\+/.test(b) && /\b\w+\s*--/.test(b);
    if (twoPtr) return 'n';

    if (/for\s*\([^;]*;\s*[^;]*\b(length|size\(\)|n)\b[^;]*;/.test(h)) return 'n';

    if (/while\s*\(\s*\w+\s*[<≤]\s*(\w+|n|\.length|size\(\))\s*\)/.test(h)) return 'n';

    return 'n';
  }

  /* =================== Analyzer (Nested, Library-aware) =================== */

  function analyzeJavaComplexity(src){
    const code = stripNoise(src);
    const lines = code.split(/\r?\n/);
    const linemap = posToLineMap(code);

    const notes = [];
    const pushNote = (line, type, cx, reason) => notes.push({ line, type, cx: `O(${cx})`, reason });

    // Space: detect allocations
    let spaceTerms = [];
    function scanSpace(lineTxt, ln){
      const arr2 = lineTxt.match(/new\s+\w+\s*\[\s*([^\]]+)\s*\]\s*\[\s*([^\]]+)\s*\]/);
      const arr1 = lineTxt.match(/new\s+\w+\s*\[\s*([^\]]+)\s*\]/);
      if (arr2){
        const a = /n|length|size\(\)/.test(arr2[1]) ? 'n' : '1';
        const b = /n|length|size\(\)/.test(arr2[2]) ? 'n' : '1';
        const cx = (a==='n' && b==='n') ? 'n^2' : (a==='n' || b==='n') ? 'n' : '1';
        if (cx !== '1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'2D array allocation'); }
      } else if (arr1){
        const cx = /n|length|size\(\)/.test(arr1[1]) ? 'n' : '1';
        if (cx !== '1'){ spaceTerms.push('n'); pushNote(ln,'alloc','n','array allocation'); }
      }
      const col = lineTxt.match(/new\s+(ArrayList|LinkedList|HashMap|HashSet)\s*<[^>]*>\s*\(\s*([^)]+)\s*\)/);
      if (col){
        const cap = col[2]; const cx = /n|length|size\(\)/.test(cap) ? 'n' : '1';
        if (cx !== '1'){ spaceTerms.push('n'); pushNote(ln,'alloc','n',`${col[1]} capacity ~ ${cap.trim()}`); }
      }
    }
    lines.forEach((t,i)=> scanSpace(t, i+1));

    const roots = findLoopsWithBodies(code);

    function costOfLoop(node){
      const header = code.slice(node.headStart, node.headEnd);
      const body   = code.slice(node.bodyStart, node.bodyEnd+1);

      let bodyCost = '1';
      if (node.children.length){
        let best = '1';
        for (const ch of node.children){
          const c = costOfLoop(ch);
          best = simplify.max(best, c);
        }
        bodyCost = best;
      }

      const selfTrip = loopCost(header, body);
      const total = simplify.mult(selfTrip, bodyCost);

      const ln = lineFromPos(linemap, node.headStart);
      pushNote(ln, 'loop', selfTrip, `loop header: ${header.trim().slice(0,100)}`);

      return total;
    }

    let finalTimeCore = '1';
    for (const root of roots){
      const c = costOfLoop(root);
      finalTimeCore = simplify.max(finalTimeCore, c);
    }

    const libCosts = [];
    if (/Arrays\.sort\s*\(/.test(code)) libCosts.push('n log n');
    if (/Collections\.sort\s*\(/.test(code)) libCosts.push('n log n');
    if (/System\.arraycopy\s*\(/.test(code)) libCosts.push('n');
    if (/Arrays\.binarySearch\s*\(/.test(code)) libCosts.push('log n');

    const libTime = libCosts.reduce((acc,cur)=> simplify.max(acc, cur), '1');

    const finalTime = simplify.max(finalTimeCore, libTime);

    const finalSpace = spaceTerms.length
      ? spaceTerms.reduce((acc,cur)=> simplify.max(acc, cur), '1')
      : '1';

    return {
      notes,
      finalTime: `O(${finalTime})`,
      finalSpace: finalSpace === '1' ? 'O(1)' : `O(${finalSpace})`,
    };
  }

  /* =================== Modal: inject on demand =================== */

  const PARTIAL_PATH = './partials/complexity-modal.html';

  async function ensureModalInserted() {
    if (document.getElementById('complexityModal')) return 'exists';
    try {
      const r = await fetch(PARTIAL_PATH, { cache: 'no-store' });
      const html = await r.text();
      document.body.insertAdjacentHTML('beforeend', html);
      // wire close buttons
      const modal = document.getElementById('complexityModal');
      if (modal) {
        modal.addEventListener('click', (e) => {
          const t = e.target;
          if (t && t.hasAttribute && t.hasAttribute('data-close')) {
            closeModal();
          }
        });
      }
      return 'inserted';
    } catch (e) {
      console.warn('[PolyComplexity] Could not load modal partial:', e);
      return 'failed';
    }
  }

  function openModal() {
    const m = document.getElementById('complexityModal');
    if (m) m.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    const m = document.getElementById('complexityModal');
    if (m) m.setAttribute('aria-hidden', 'true');
  }

  /* =================== UI Binding =================== */

  async function handleAnalyzeClick(getCode) {
    // Get code from Monaco/editor/textarea
    const code =
      (window.editor && window.editor.getValue && window.editor.getValue()) ||
      (typeof getCode === 'function' ? getCode() : '') ||
      (document.getElementById('code')?.value || '');

    const { notes, finalTime, finalSpace } = analyzeJavaComplexity(code);

    await ensureModalInserted();

    const tEl = document.getElementById('cxTime');
    const sEl = document.getElementById('cxSpace');
    const tb  = document.querySelector('#cxTable tbody');
    const nt  = document.getElementById('cxNotes');
    if (!tEl || !sEl || !tb || !nt) return;

    tEl.textContent = finalTime || 'O(1)';
    sEl.textContent = finalSpace || 'O(1)';

    tb.innerHTML = '';
    for (const n of notes) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${n.line}</td><td>${n.type}</td><td>${n.cx}</td><td>${String(n.reason || '').replace(/</g,'&lt;')}</td>`;
      tb.appendChild(tr);
    }
    nt.innerHTML =
      `<p><strong>Heuristic:</strong> Nest-aware; detects halving/binary-search patterns, two-pointer loops, and common library costs. Space scans arrays/containers. Path-dependent math is approximated.</p>`;

    openModal();
  }

  function initUI({ getCode } = {}) {
    if (initUI._bound) return;
    const btn = document.getElementById('btnComplexity');
    if (!btn) return; // try again later if needed
    initUI._bound = true;
    btn.addEventListener('click', () => handleAnalyzeClick(getCode));
  }

  // Public API
  window.PolyComplexity = {
    analyze: (code) => analyzeJavaComplexity(code),
    initUI,           // ({ getCode })
    open: async () => { await ensureModalInserted(); openModal(); },
    close: closeModal
  };

  // Auto-bind once DOM is parsed if the button is present
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('btnComplexity')) initUI({});
    }, { once: true });
  } else {
    if (document.getElementById('btnComplexity')) initUI({});
  }
})();

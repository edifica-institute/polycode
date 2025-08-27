(function () {
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

  // ---- replace existing `simplify` with this ----
  const simplify = {
    // multiply symbolic costs (e.g., 'n', 'log n', 'n log n')
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
    // max of two complexities (coarse asymptotic order)
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
  // ---- add BELOW stripNoise(), ABOVE analyzeJavaComplexity() ----

  // find matching '}' for a '{' starting at idx
  function matchBrace(src, openIdx){
    let depth = 0;
    for (let i=openIdx; i<src.length; i++){
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}'){ depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  // collect all loops with exact body ranges
  function findLoopsWithBodies(code){
    const out = [];
    const re = /\b(for|while)\s*\(/g;
    let m;
    while ((m = re.exec(code))){
      const kind = m[1];
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
        // single statement loop: treat next ';' or next block as body
        const semi = code.indexOf(';', i);
        const brace = code[i] === '{' ? matchBrace(code, i) : -1;
        if (semi !== -1 && (brace === -1 || semi < brace)){
          bodyStart = i; bodyEnd = semi;
        } else if (brace !== -1){
          bodyStart = i; bodyEnd = brace;
        }
      }
      if (bodyStart !== -1 && bodyEnd !== -1){
        out.push({
          kind,
          headStart, headEnd,
          bodyStart, bodyEnd,
        });
      }
      re.lastIndex = headEnd;
    }
    // sort by range start so we can nest
    out.sort((a,b)=> a.bodyStart - b.bodyStart);
    // build nesting: a node's children are loops fully inside its body
    const stack = [];
    for (const node of out){
      node.children = [];
      while (stack.length && !(node.bodyStart >= stack.at(-1).bodyStart && node.bodyEnd <= stack.at(-1).bodyEnd)){
        stack.pop();
      }
      if (stack.length) stack.at(-1).children.push(node);
      stack.push(node);
    }
    // roots = nodes not contained by any parent
    const isChild = new Set(out.flatMap(p => p.children));
    return out.filter(n => !isChild.has(n));
  }

  // quick helpers
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
    // binary scan
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

  // ---- replace your loopCost() with this version ----
  function loopCost(header, body){
    const h = header.replace(/\s+/g,' ');
    const b = (body || '').replace(/\s+/g,' ');

    // Binary-search style (mid and narrowing via low/high)
    const looksLikeBS =
      /while\s*\(\s*\w+\s*<=\s*\w+\s*\)/i.test(h) &&
      /\bmid\s*=\s*\w+\s*\+\s*\(\s*\w+\s*-\s*\w+\s*\)\s*\/\s*2\b/i.test(b) &&
      (/\b(low|left)\s*=\s*mid\s*\+\s*1\b/i.test(b) || /\b(high|right)\s*=\s*mid\s*-\s*1\b/i.test(b) || /\b(low|left)\s*=\s*mid\b/i.test(b) || /\b(high|right)\s*=\s*mid\b/i.test(b));
    if (looksLikeBS) return 'log n';

    // Halving/doubling induction in header updates
    if (/[*/]\s*2\b|<<\s*1\b|>>\s*1\b/.test(h)) return 'log n';

    // Two-pointer shrinking (common in arrays)
    const twoPtr = /\bwhile\s*\(\s*\w+\s*<\s*\w+\s*\)/.test(h) &&
                   /\b\w+\s*\+\+/.test(b) && /\b\w+\s*--/.test(b);
    if (twoPtr) return 'n';

    // Canonical for(...) over array length / n
    if (/for\s*\([^;]*;\s*[^;]*\b(length|size\(\)|n)\b[^;]*;/.test(h)) return 'n';

    // While with counter++ until < n
    if (/while\s*\(\s*\w+\s*[<≤]\s*(\w+|n|\.length|size\(\))\s*\)/.test(h)) return 'n';

    // Fallback
    return 'n';
  }

  /* =================== Analyzer (Nested, Library-aware) =================== */

  // ---- FULL replacement for analyzeJavaComplexity() ----
  function analyzeJavaComplexity(src){
    // 1) Strip strings/comments
    const code = stripNoise(src);
    const lines = code.split(/\r?\n/);
    const linemap = posToLineMap(code);

    const notes = [];
    const pushNote = (line, type, cx, reason) => notes.push({ line, type, cx: `O(${cx})`, reason });

    // 2) Space: detect allocations (tweaked)
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

    // 3) Build loop nest forest
    const roots = findLoopsWithBodies(code);

    // helper to compute cost string for a loop subtree
    function costOfLoop(node){
      const header = code.slice(node.headStart, node.headEnd);
      const body   = code.slice(node.bodyStart, node.bodyEnd+1);

      // children are nested loops; siblings inside the same body should contribute via MAX
      let bodyCost = '1';
      if (node.children.length){
        let best = '1';
        for (const ch of node.children){
          const c = costOfLoop(ch); // includes its own nested body
          best = simplify.max(best, c);
        }
        bodyCost = best;
      }

      const selfTrip = loopCost(header, body); // 'n' or 'log n' …
      const total = simplify.mult(selfTrip, bodyCost); // multiply nested

      // annotate
      const ln = lineFromPos(linemap, node.headStart);
      pushNote(ln, 'loop', selfTrip, `loop header: ${header.trim().slice(0,100)}`);

      return total;
    }

    // 4) Combine top-level pieces: MAX across roots (sequential blocks)
    let finalTimeCore = '1';
    for (const root of roots){
      const c = costOfLoop(root);
      finalTimeCore = simplify.max(finalTimeCore, c);
    }

    // 5) Known library calls
    const libCosts = [];
    if (/Arrays\.sort\s*\(/.test(code)) libCosts.push('n log n');
    if (/Collections\.sort\s*\(/.test(code)) libCosts.push('n log n');
    if (/System\.arraycopy\s*\(/.test(code)) libCosts.push('n');
    if (/Arrays\.binarySearch\s*\(/.test(code)) libCosts.push('log n');

    let libTime = libCosts.reduce((acc,cur)=> simplify.max(acc, cur), '1');

    // 6) If no loops/library at all, keep O(1)
    let finalTime = simplify.max(finalTimeCore, libTime);

    // 7) Space result
    const finalSpace = spaceTerms.length
      ? spaceTerms.reduce((acc,cur)=> simplify.max(acc, cur), '1')
      : '1';

    return {
      notes,
      finalTime: `O(${finalTime})`,
      finalSpace: finalSpace === '1' ? 'O(1)' : `O(${finalSpace})`,
    };
  }

  /* =================== Modal Wiring (unchanged API) =================== */

  function openModal() {
    const m = document.getElementById('complexityModal');
    if (m) m.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    const m = document.getElementById('complexityModal');
    if (m) m.setAttribute('aria-hidden', 'true');
  }

  function initUI({ getCode, lang = 'java' } = {}) {
    // Close hooks
    const modal = document.getElementById('complexityModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.hasAttribute && t.hasAttribute('data-close')) closeModal();
      });
    }

    // Button
    const btn = document.getElementById('btnComplexity');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const code =
        (window.editor && window.editor.getValue && window.editor.getValue()) ||
        (typeof getCode === 'function' ? getCode() : '') ||
        (document.getElementById('code')?.value || '');

      // For now, we run the Java analyzer for all (heuristics fit C/C++ too).
      const { notes, finalTime, finalSpace } = analyzeJavaComplexity(code);

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
    });
  }

  // Public API (kept the same)
  window.PolyComplexity = {
    analyze: (code/*, {lang}*/) => analyzeJavaComplexity(code),
    initUI,           // ({ getCode, lang })
    open: openModal,  // programmatic open
    close: closeModal
  };

  // Auto-bind once DOM ready if #btnComplexity exists
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('btnComplexity')) {
        const lang = document.documentElement?.dataset?.lang || 'java';
        initUI({ lang });
      }
    }, { once: true });
  } else {
    if (document.getElementById('btnComplexity')) {
      const lang = document.documentElement?.dataset?.lang || 'java';
      initUI({ lang });
    }
  }
})();




(() => {
  // --- Config: path to your partial (can be overridden before this script loads) ---
  const PARTIAL_PATH = window.POLY_COMPLEXITY_PARTIAL || './partials/complexity-modal.html';

  // Namespace (exported)
  window.PolyComplexity = window.PolyComplexity || {
    inited: false,

    function initUI({ getCode, lang = 'java' } = {}) {
  if (initUI._bound) return;   // <-- guard
  initUI._bound = true;        // <-- guard

  // Close hooks
  const modal = document.getElementById('complexityModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.hasAttribute && t.hasAttribute('data-close')) closeModal();
    });
  }

  // Button
  const btn = document.getElementById('btnComplexity');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const code =
      (window.editor?.getValue?.() ?? '') ||
      (typeof getCode === 'function' ? getCode() : '') ||
      (document.getElementById('code')?.value || '');

    const { notes, finalTime, finalSpace } = analyzeJavaComplexity(code);

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
  });
}

  };

  // --- Helpers ---
  function insertModalIfMissing() {
    if (document.getElementById('complexityModal')) return Promise.resolve('exists');

    return fetch(PARTIAL_PATH, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load partial: ${r.status}`);
        return r.text();
      })
      .then(html => {
        document.body.insertAdjacentHTML('beforeend', html);
        // Let listeners know the modal just arrived
        document.dispatchEvent(new Event('pc:modal-ready'));
        return 'inserted';
      })
      .catch(err => {
        // Fail gracefully (button will remain inert, console shows why)
        console.warn('[PolyComplexity] Could not load modal partial:', err);
        return 'failed';
      });
  }

  function initWhenReady() {
    // 1) If modal is already in DOM (SSR or extremely fast load), init now
    if (document.getElementById('complexityModal')) {
      window.PolyComplexity.initUI();
    }

    // 2) Or initialize after we hear it was injected
    document.addEventListener('pc:modal-ready', () => {
      window.PolyComplexity.initUI();
    });

    // 3) As a fallback (e.g., scripts executed out of order), try once after DOM is ready
    //    and also try to fetch/insert it if missing.
    document.addEventListener('DOMContentLoaded', async () => {
      await insertModalIfMissing();
      window.PolyComplexity.initUI();
    });
  }

  // Kick off
  initWhenReady();
})();


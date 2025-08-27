/* =================== Loop Cost Heuristics (C/C++ friendly) =================== */

function loopCost(header, body){
  const h = (header || '').replace(/\s+/g,' ');
  const b = (body   || '').replace(/\s+/g,' ');

  // Any halving/doubling hint in header OR body ⇒ O(log n)
  // (covers i/=2, i*=2, shifts, etc.)
  if (/[*/]\s*2\b|<<\s*1\b|>>\s*1\b/.test(h) || /[*/]\s*2\b|<<\s*1\b|>>\s*1\b/.test(b)) {
    return 'log n';
  }

  // Binary-search flavored while (lo<=hi) + mid update + boundary moves
  const looksLikeBS =
    /while\s*\(\s*\w+\s*<=\s*\w+\s*\)/i.test(h) &&
    /\b(mid|m)\s*=\s*\w+\s*\+\s*\(\s*\w+\s*-\s*\w+\s*\)\s*\/\s*2\b/i.test(b) &&
    (
      /\b(low|left|lo|l)\s*=\s*(mid|m)\s*(\+|)\s*1?\b/i.test(b) ||
      /\b(high|right|hi|r)\s*=\s*(mid|m)\s*(\-|)\s*1?\b/i.test(b) ||
      /\b(low|left|lo|l)\s*=\s*(mid|m)\b/i.test(b) ||
      /\b(high|right|hi|r)\s*=\s*(mid|m)\b/i.test(b)
    );
  if (looksLikeBS) return 'log n';

  // For-loops that mutate an index by ±1 every iteration ⇒ O(n)
  // Works for C/C++/Java (e.g., for(i=0;i<m;i++), for(; i<n; ++i), for(i=..., i<cap; i+=1))
  if (/for\s*\([^;]*;\s*[^;]*[<≤>≥!=]=?[^;]*;\s*[^;]*(\+\+|--|[\+\-]=\s*1)\s*\)/.test(h)) {
    return 'n';
  }

  // While-loops that check a bound and mutate by ±1 inside the body ⇒ O(n)
  if (/while\s*\(\s*[\w\->\.\[\]]+\s*[<≤>≥!=]=?\s*[\w\->\.\[\]]+\s*\)/.test(h) &&
      /\b(\w+)\s*(\+\+|--|[\+\-]=\s*1)\b/.test(b)) {
    return 'n';
  }

  // Simple two-pointer pattern: while(i<j) with one ++ and one -- in body ⇒ O(n)
  const twoPtr = /\bwhile\s*\(\s*\w+\s*<\s*\w+\s*\)/.test(h) &&
                 /\b\w+\s*(\+\+|[\+]=\s*1)\b/.test(b) &&
                 /\b\w+\s*(--|[\-]=\s*1)\b/.test(b);
  if (twoPtr) return 'n';

  // Fallback: assume linear (safe upper bound for most classroom code)
  return 'n';
}

/* =================== Analyzer (Nested, Library-aware, C/C++ added) =================== */

function analyzeJavaComplexity(src){
  const code = stripNoise(src);                  // already suitable for C/C++ too
  const lines = code.split(/\r?\n/);
  const linemap = posToLineMap(code);

  const notes = [];
  const pushNote = (line, type, cx, reason) =>
    notes.push({ line, type, cx: `O(${cx})`, reason });

  // ---- Space: detect allocations (Java + C + C++) ----
  let spaceTerms = [];
  function scanSpace(lineTxt, ln){
    const L = lineTxt;

    // ===== Java arrays and collections (existing) =====
    const arr2 = L.match(/new\s+\w+\s*\[\s*([^\]]+)\s*\]\s*\[\s*([^\]]+)\s*\]/);
    const arr1 = L.match(/new\s+\w+\s*\[\s*([^\]]+)\s*\]/);
    if (arr2){
      const a = /n|length|size\(\)/i.test(arr2[1]) ? 'n' : '1';
      const b = /n|length|size\(\)/i.test(arr2[2]) ? 'n' : '1';
      const cx = (a==='n' && b==='n') ? 'n^2' : (a==='n' || b==='n') ? 'n' : '1';
      if (cx !== '1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'2D array allocation'); }
    } else if (arr1){
      const cx = /n|length|size\(\)/i.test(arr1[1]) ? 'n' : '1';
      if (cx !== '1'){ spaceTerms.push('n'); pushNote(ln,'alloc','n','array allocation'); }
    }
    const col = L.match(/new\s+(ArrayList|LinkedList|HashMap|HashSet)\s*<[^>]*>\s*\(\s*([^)]+)\s*\)/);
    if (col){
      const cap = col[2]; const cx = /n|length|size\(\)/i.test(cap) ? 'n' : '1';
      if (cx !== '1'){ spaceTerms.push('n'); pushNote(ln,'alloc','n',`${col[1]} capacity ~ ${cap.trim()}`); }
    }

    // ===== C static arrays / VLAs =====
    // int a[n];  int a[m][n];  double b[100];  char s[N+5];
    const cArr2 = L.match(/\b(?:char|short|int|long|float|double|bool|size_t)\s+\**\w+\s*\[\s*([^\]\[]+)\s*\]\s*\[\s*([^\]\[]+)\s*\]/);
    const cArr1 = L.match(/\b(?:char|short|int|long|float|double|bool|size_t)\s+\**\w+\s*\[\s*([^\]\[]+)\s*\]/);
    if (cArr2){
      const a = /n|N|len|size|count|\.size|->size/i.test(cArr2[1]) ? 'n' : (/\d+/.test(cArr2[1]) ? '1' : 'n');
      const b = /n|N|len|size|count|\.size|->size/i.test(cArr2[2]) ? 'n' : (/\d+/.test(cArr2[2]) ? '1' : 'n');
      const cx = (a==='n' && b==='n') ? 'n^2' : (a==='n' || b==='n') ? 'n' : '1';
      if (cx !== '1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'2D C array allocation'); }
    } else if (cArr1){
      const cx = /n|N|len|size|count|\.size|->size/i.test(cArr1[1]) ? 'n' : (/\d+/.test(cArr1[1]) ? '1' : 'n');
      if (cx !== '1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'C array allocation'); }
    }

    // ===== C heap allocations =====
    // malloc(bytes), calloc(a,b), realloc(p, bytes)
    const m = L.match(/\b(malloc|calloc|realloc)\s*\(([^)]*)\)/i);
    if (m){
      const fn = m[1].toLowerCase();
      const args = m[2];
      let cx = '1';
      if (fn === 'calloc'){
        const aa = args.split(',').map(s=>s.trim());
        const A = /n|N|len|size|count/i.test(aa[0]) ? 'n' : (/\d+/.test(aa[0]) ? '1' : 'n');
        const B = /n|N|len|size|count/i.test(aa[1]||'') ? 'n' : (/\d+/.test(aa[1]||'') ? '1' : 'n');
        cx = (A==='n' && B==='n') ? 'n^2' : (A==='n' || B==='n') ? 'n' : '1';
      } else {
        cx = /n|N|len|size|count/i.test(args) ? 'n' : (/\*\s*n\b/i.test(args) ? 'n' : '1');
      }
      if (cx !== '1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx, `${m[1]}(...)`); }
    }

    // ===== C++ vectors (size/reserve/resize) =====
    // vector<int> v(n); std::vector<int> v(n,0); v.resize(n); v.reserve(n);
    if (/\b(std::)?vector\s*<[^>]+>\s+\w+\s*\(\s*([^)]+)\s*\)/.test(L) ||
        /\.resize\s*\(\s*([^)]+)\s*\)/.test(L) ||
        /\.reserve\s*\(\s*([^)]+)\s*\)/.test(L)){
      const mm = L.match(/\(([^)]+)\)/);
      const arg = mm ? mm[1] : '';
      const cx = /n|N|len|size|count|capacity|\.size\(|\.capacity\(/.test(arg) ? 'n' : (/\d+/.test(arg) ? '1' : 'n');
      if (cx !== '1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'vector capacity/resize'); }
    }

    // ===== C++ new T[n] (also covered by your Java new[] regex in many cases) =====
    // e.g., auto p = new int[n];
    const cppNewArr = L.match(/\bnew\s+\w+(?:::\w+)?\s*\[\s*([^\]]+)\s*\]/);
    if (cppNewArr){
      const cx = /n|N|len|size|count/i.test(cppNewArr[1]) ? 'n' : (/\d+/.test(cppNewArr[1]) ? '1' : 'n');
      if (cx !== '1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'C++ new[]'); }
    }
  }
  lines.forEach((t,i)=> scanSpace(t, i+1));

  // ---- Loops (nest-aware, same as your original flow) ----
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

  // ---- Library time costs (Java + C + C++) ----
  const libCosts = [];

  // Java (existing)
  if (/Arrays\.sort\s*\(/.test(code))         libCosts.push('n log n');
  if (/Collections\.sort\s*\(/.test(code))    libCosts.push('n log n');
  if (/System\.arraycopy\s*\(/.test(code))    libCosts.push('n');
  if (/Arrays\.binarySearch\s*\(/.test(code)) libCosts.push('log n');

  // C stdlib
  if (/\bqsort\s*\(/.test(code))    libCosts.push('n log n');
  if (/\bbsearch\s*\(/.test(code))  libCosts.push('log n');
  if (/\bmemcpy\s*\(/.test(code))   libCosts.push('n');
  if (/\bmemmove\s*\(/.test(code))  libCosts.push('n');
  if (/\bmemset\s*\(/.test(code))   libCosts.push('n');
  if (/\bstrlen\s*\(/.test(code))   libCosts.push('n');
  if (/\bstrcmp\s*\(/.test(code))   libCosts.push('n'); // worst-case

  // C++ STL (simple, name-based)
  if (/\bstd::sort\s*\(/.test(code) || /\bsort\s*\(\s*[^,]+,\s*[^)]+\)/.test(code)) libCosts.push('n log n');
  if (/\bstd::stable_sort\s*\(/.test(code))                                         libCosts.push('n log n');
  if (/\bstd::binary_search\s*\(/.test(code))                                       libCosts.push('log n');
  if (/\bstd::copy\s*\(/.test(code) || /\bcopy\s*\(\s*[^,]+,\s*[^,]+,\s*[^)]+\)/.test(code)) libCosts.push('n');
  if (/\bstd::fill\s*\(/.test(code) || /\bfill\s*\(/.test(code))                    libCosts.push('n');
  if (/\bstd::accumulate\s*\(/.test(code))                                          libCosts.push('n');

  const libTime = libCosts.reduce((acc,cur)=> simplify.max(acc, cur), '1');

  // ---- Final aggregation ----
  const finalTime  = simplify.max(finalTimeCore, libTime);
  const finalSpace = spaceTerms.length
    ? spaceTerms.reduce((acc,cur)=> simplify.max(acc, cur), '1')
    : '1';

  return {
    notes,
    finalTime:  `O(${finalTime})`,
    finalSpace: finalSpace === '1' ? 'O(1)' : `O(${finalSpace})`,
  };
}





const MODAL_HTML = `
<div id="complexityModal" class="pc-modal" aria-hidden="true">
  <div class="pc-modal__backdrop" data-close></div>
  <div class="pc-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="cxTitle">
    <div class="pc-modal__header">
      <h3 id="cxTitle">Complexity Analysis</h3>
      <button class="pc-modal__close" data-close aria-label="Close">×</button>
    </div>
    <div class="pc-modal__body">
      <div class="cx-summary">
        <div><strong>Final Time:</strong> <span id="cxTime">—</span></div>
        <div><strong>Final Space:</strong> <span id="cxSpace">—</span></div>
      </div>
      <hr/>
      <table class="cx-table" id="cxTable">
        <thead>
          <tr><th>Line</th><th>Type</th><th>Complexity</th><th>Reason</th></tr>
        </thead>
        <tbody></tbody>
      </table>
      <div class="cx-notes" id="cxNotes"></div>
    </div>
    <div class="pc-modal__footer">
      <button class="btn" data-close>Close</button>
    </div>
  </div>
</div>
`;

function ensureModalInserted() {
  if (document.getElementById('complexityModal')) return 'exists';
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
  const modal = document.getElementById('complexityModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.hasAttribute && t.hasAttribute('data-close')) closeModal();
    });
  }
  return 'inserted';
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

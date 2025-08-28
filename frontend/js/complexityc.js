(function () {
  'use strict';

  /* =================== Utilities & Normalization =================== */

  function stripNoise(src) {
    let s = String(src);
    // keep line count when stripping strings/comments
    s = s.replace(/"(?:\\.|[^"\\])*"/g, '""')
         .replace(/'(?:\\.|[^'\\])'/g, "''");
    s = s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    s = s.replace(/\/\/.*$/gm, '');
    return s;
  }

  const simplify = {
    mult(a, b) {
      if (a === '1') return b;
      if (b === '1') return a;

      // Normalize tokens
      const norm = (x) => x.replace(/\s+/g,' ')
                           .replace(/n\s*log\s*n/g,'n log n')
                           .replace(/log\s*n/g,'log n')
                           .trim();

      a = norm(a); b = norm(b);
      // Handle exponentials conservatively
      if (/2\^n|phi\^n|FIB/.test(a) || /2\^n|phi\^n|FIB/.test(b)) return '2^n';

      // Count powers of n and log n
      const parts = (t) => t.split(/\s+/).filter(Boolean);
      const all = parts(a).concat(parts(b));
      const cnt = {};
      for (const t of all) cnt[t] = (cnt[t] || 0) + 1;

      const out = [];
      const pushPow = (sym) => {
        if (cnt[sym]) {
          out.push(cnt[sym] === 1 ? sym : `${sym}^${cnt[sym]}`);
          delete cnt[sym];
        }
      };
      pushPow('n');
      pushPow('log n');

      // include remaining symbols (e.g., h)
      for (const [k,v] of Object.entries(cnt)) {
        out.push(v === 1 ? k : `${k}^${v}`);
      }
      return out.length ? out.join(' ') : '1';
    },
    max(a, b) {
      if (a === '1') return b;
      if (b === '1') return a;
      const W = (v) => {
        v = v.replace(/\s+/g,'');
        if (/2\^n|phi\^n|FIB/i.test(v)) return 9;
        if (/n!/.test(v))               return 8;
        if (/n\^3/.test(v))             return 7;
        if (/n\^2/.test(v))             return 6;
        if (/nlogn|nlog/.test(v))       return 5;
        if (/n(?!\^)/.test(v))          return 4;
        if (/h(?!\w)/.test(v))          return 3; // tree height
        if (/logn|log/.test(v))         return 2;
        return 1;
      };
      return W(a) >= W(b) ? a : b;
    }
  };

  /* =================== Position helpers =================== */

  function matchParen(src, openIdx){
    let d = 0;
    for (let i=openIdx; i<src.length; i++){
      const ch = src[i];
      if (ch === '(') d++;
      else if (ch === ')'){ d--; if (d===0) return i; }
    }
    return -1;
  }
  function matchBrace(src, openIdx){
    let d = 0;
    for (let i=openIdx; i<src.length; i++){
      const ch = src[i];
      if (ch === '{') d++;
      else if (ch === '}'){ d--; if (d===0) return i; }
    }
    return -1;
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
      const mid=(lo+hi)>>1;
      if (idx < map[mid].start) hi=mid-1;
      else if (idx > map[mid].end) lo=mid+1;
      else { ans=map[mid].line; break; }
      ans = Math.max(1, Math.min(map.length, mid+1));
    }
    return ans;
  }

  /* =================== Function discovery =================== */

  // Grabs C/C++/Java-like function definitions, returns {name, headStart, bodyStart, bodyEnd}
  function findFunctions(code){
    const fns = [];
    const re = /\b(?:void|int|long|short|char|float|double|bool|size_t|auto|struct\s+\w+\s*\*?|[\w:<>]+\s*\*?)\s+(\w+)\s*\([^;{}]*\)\s*\{/g;
    let m;
    while ((m = re.exec(code))){
      const name = m[1];
      const bodyStart = code.indexOf('{', m.index);
      const bodyEnd = matchBrace(code, bodyStart);
      fns.push({ name, headStart: m.index, bodyStart, bodyEnd });
      re.lastIndex = bodyEnd + 1;
    }
    return fns;
  }

  /* =================== Block parser (top-level statements) =================== */

  // Parse a block (function body) into statement nodes (loops/ifs/switch/do-while/stmt)
  function parseBlock(code, start, end){
    const nodes = [];
    let i = start|0;
    while (i <= end){
      // skip whitespace
      while (i<=end && /\s/.test(code[i])) i++;
      if (i > end) break;

      // For-loop
      if (/\bfor\s*\(/y.test(code.slice(i))){
        const hStart = i + code.slice(i).match(/\bfor\s*\(/).index;
        const parOpen = code.indexOf('(', hStart);
        const parEnd  = matchParen(code, parOpen);
        let j = parEnd + 1;
        while (j<=end && /\s/.test(code[j])) j++;

        let bStart, bEnd;
        if (code[j] === '{'){ bStart=j; bEnd=matchBrace(code, j); }
        else { bStart=j; bEnd=code.indexOf(';', j); }

        nodes.push({ type:'loop', kind:'for', hStart, hEnd:parEnd+1, bStart, bEnd, children: parseBlock(code, bStart+(code[j]==='{'), bEnd-(code[j]==='{')) });
        i = bEnd + 1; continue;
      }

      // While-loop (not do-while)
      if (/\bwhile\s*\(/y.test(code.slice(i))){
        const hStart = i + code.slice(i).match(/\bwhile\s*\(/).index;
        const parOpen = code.indexOf('(', hStart);
        const parEnd  = matchParen(code, parOpen);
        let j = parEnd + 1;
        while (j<=end && /\s/.test(code[j])) j++;

        let bStart, bEnd;
        if (code[j] === '{'){ bStart=j; bEnd=matchBrace(code, j); }
        else { bStart=j; bEnd=code.indexOf(';', j); }

        nodes.push({ type:'loop', kind:'while', hStart, hEnd:parEnd+1, bStart, bEnd, children: parseBlock(code, bStart+(code[j]==='{'), bEnd-(code[j]==='{')) });
        i = bEnd + 1; continue;
      }

      // do { ... } while (...);
      if (/\bdo\b/y.test(code.slice(i))){
        const dStart = i + code.slice(i).match(/\bdo\b/).index;
        let j = dStart + 2;
        while (j<=end && /\s/.test(code[j])) j++;

        if (code[j] === '{'){
          const bStart=j, bEnd=matchBrace(code, j);
          let k = bEnd + 1;
          // expect while(...)
          const wIdx = code.indexOf('while', k);
          if (wIdx !== -1){
            const parOpen = code.indexOf('(', wIdx);
            const parEnd  = matchParen(code, parOpen);
            const hStart = wIdx;
            nodes.push({ type:'loop', kind:'do-while', hStart, hEnd:parEnd+1, bStart, bEnd, children: parseBlock(code, bStart+1, bEnd-1) });
            i = parEnd + 2; // after closing );
            continue;
          }
        }
      }

      // if (...) { ... } [else if ...]* [else ...]?
      if (/\bif\s*\(/y.test(code.slice(i))){
        const ifStart = i + code.slice(i).match(/\bif\s*\(/).index;
        const parOpen = code.indexOf('(', ifStart);
        const parEnd  = matchParen(code, parOpen);
        let j = parEnd + 1;
        while (j<=end && /\s/.test(code[j])) j++;

        let thenStart, thenEnd;
        if (code[j] === '{'){ thenStart=j; thenEnd=matchBrace(code, j); }
        else { thenStart=j; thenEnd=code.indexOf(';', j); }

        const branches = [];
        branches.push({ s: thenStart+(code[j]==='{'), e: thenEnd-(code[j]==='{') });

        let k = thenEnd + 1;
        // chain: else if ... / else ...
        while (k<=end){
          // whitespace
          while (k<=end && /\s/.test(code[k])) k++;
          if (!/\belse\b/y.test(code.slice(k))) break;
          k += code.slice(k).match(/\belse\b/).index + 4;
          while (k<=end && /\s/.test(code[k])) k++;

          if (/\bif\s*\(/y.test(code.slice(k))){
            const if2 = k + code.slice(k).match(/\bif\s*\(/).index;
            const po = code.indexOf('(', if2);
            const pe = matchParen(code, po);
            k = pe + 1;
            while (k<=end && /\s/.test(code[k])) k++;
            let s2,e2;
            if (code[k] === '{'){ s2=k; e2=matchBrace(code, k); }
            else { s2=k; e2=code.indexOf(';', k); }
            branches.push({ s: s2+(code[k]==='{'), e: e2-(code[k]==='{') });
            k = e2 + 1;
          } else {
            // plain else
            let s2,e2;
            if (code[k] === '{'){ s2=k; e2=matchBrace(code, k); }
            else { s2=k; e2=code.indexOf(';', k); }
            branches.push({ s: s2+(code[k]==='{'), e: e2-(code[k]==='{') });
            k = e2 + 1;
            break;
          }
        }

        nodes.push({ type:'if', hStart: ifStart, hEnd: parEnd+1, branches });
        i = k; continue;
      }

      // switch (...) { cases }
      if (/\bswitch\s*\(/y.test(code.slice(i))){
        const sStart = i + code.slice(i).match(/\bswitch\s*\(/).index;
        const po = code.indexOf('(', sStart);
        const pe = matchParen(code, po);
        let j = pe + 1;
        while (j<=end && /\s/.test(code[j])) j++;
        if (code[j] === '{'){
          const bStart=j, bEnd=matchBrace(code, j);
          // split cases coarsely
          const body = code.slice(bStart+1, bEnd);
          const cases = [];
          const caseRe = /(?:\bcase\b[^\:]*\:|\bdefault\s*:)/g;
          let cm, anchors = [];
          while ((cm = caseRe.exec(body))) {
            anchors.push(bStart+1 + cm.index);
          }
          anchors.push(bEnd); // sentinel
          for (let c=0;c<anchors.length-1;c++){
            const cs = anchors[c];
            const ce = anchors[c+1]-1;
            cases.push({ s: cs, e: ce });
          }
          nodes.push({ type:'switch', hStart:sStart, hEnd:pe+1, cases });
          i = bEnd + 1; continue;
        }
      }

      // Generic statement: consume until ';' or next brace (to avoid infinite loop)
      const semi = code.indexOf(';', i);
      const brace = code.indexOf('{', i);
      if (semi !== -1 && (brace === -1 || semi < brace)){
        nodes.push({ type:'stmt', s:i, e:semi });
        i = semi + 1;
      } else if (brace !== -1){
        // unknown construct with block, skip its block
        const bEnd = matchBrace(code, brace);
        nodes.push({ type:'stmt', s:i, e:bEnd });
        i = bEnd + 1;
      } else {
        // tail
        nodes.push({ type:'stmt', s:i, e:end });
        break;
      }
    }
    return nodes;
  }

  /* =================== Cost models =================== */

  function loopSelfTrip(header, body) {
    const h = (header||'').replace(/\s+/g,' ');
    const b = (body  ||'').replace(/\s+/g,' ');

    // explicit halving/doubling patterns
    if (/[*/]\s*2\b|<<\s*1\b|>>\s*1\b/.test(h) || /i\s*=\s*i\s*\/\s*2\b/.test(h) ||
        /[*/]\s*2\b|<<\s*1\b|>>\s*1\b/.test(b)) {
      return 'log n';
    }

    // canonical for (i=0; i<n; i++) / while(i<n){i++}
    if (/\bfor\s*\([^;]*;\s*[^;]*[<≤>≥!=]=?[^;]*;\s*[^;]*(\+\+|--|[\+\-]=\s*1)\s*\)/.test(h)) {
      return 'n';
    }
    if (/\bwhile\s*\(\s*[\w\->\.\[\]]+\s*[<≤>≥!=]=?\s*[\w\->\.\[\]]+\s*\)/.test(h) &&
        /\b(\w+)\s*(\+\+|--|[\+\-]=\s*1)\b/.test(b)) {
      return 'n';
    }

    // two-pointer like while(i<j){ i++; j--; }
    const twoPtr = /\bwhile\s*\(\s*\w+\s*<\s*\w+\s*\)/.test(h) &&
                   /\b\w+\s*(\+\+|[\+]=\s*1)\b/.test(b) &&
                   /\b\w+\s*(--|[\-]=\s*1)\b/.test(b);
    if (twoPtr) return 'n';

    // default linear
    return 'n';
  }

  /* =================== Space scan =================== */

  function analyzeSpace(lines, pushNote){
    let spaceTerms=[];
    lines.forEach((L, idx)=>{
      const ln = idx+1;

      // new T[a][b]
      const arr2 = L.match(/\bnew\s+\w+(?:::\w+)?\s*\[\s*([^\]]+)\s*\]\s*\[\s*([^\]]+)\s*\]/);
      const arr1 = L.match(/\bnew\s+\w+(?:::\w+)?\s*\[\s*([^\]]+)\s*\]/);
      if (arr2){
        const a = /n|N|len|size|count|length|size\(\)/i.test(arr2[1]) ? 'n' : (/\d+/.test(arr2[1]) ? '1' : 'n');
        const b = /n|N|len|size|count|length|size\(\)/i.test(arr2[2]) ? 'n' : (/\d+/.test(arr2[2]) ? '1' : 'n');
        const cx = (a==='n' && b==='n') ? 'n^2' : (a==='n' || b==='n') ? 'n' : '1';
        if (cx!=='1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'2D new[] allocation'); }
      } else if (arr1){
        const cx = /n|N|len|size|count|length|size\(\)/i.test(arr1[1]) ? 'n' : (/\d+/.test(arr1[1]) ? '1' : 'n');
        if (cx!=='1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'new[] allocation'); }
      }

      // C arrays
      const cArr2 = L.match(/\b(?:char|short|int|long|float|double|bool|size_t)\s+\**\w+\s*\[\s*([^\]\[]+)\s*\]\s*\[\s*([^\]\[]+)\s*\]/);
      const cArr1 = L.match(/\b(?:char|short|int|long|float|double|bool|size_t)\s+\**\w+\s*\[\s*([^\]\[]+)\s*\]/);
      if (cArr2){
        const a = /n|N|len|size|count|\.size|->size/i.test(cArr2[1]) ? 'n' : (/\d+/.test(cArr2[1]) ? '1' : 'n');
        const b = /n|N|len|size|count|\.size|->size/i.test(cArr2[2]) ? 'n' : (/\d+/.test(cArr2[2]) ? '1' : 'n');
        const cx = (a==='n' && b==='n') ? 'n^2' : (a==='n' || b==='n') ? 'n' : '1';
        if (cx!=='1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'2D C array allocation'); }
      } else if (cArr1){
        const cx = /n|N|len|size|count|\.size|->size/i.test(cArr1[1]) ? 'n' : (/\d+/.test(cArr1[1]) ? '1' : 'n');
        if (cx!=='1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'C array allocation'); }
      }

      // malloc/calloc/realloc
      const mm = L.match(/\b(malloc|calloc|realloc)\s*\(([^)]*)\)/i);
      if (mm){
        const fn = mm[1].toLowerCase(), args = mm[2];
        let cx = '1';
        if (fn === 'calloc'){
          const aa = args.split(',').map(s=>s.trim());
          const A = /n|N|len|size|count/i.test(aa[0]) ? 'n' : (/\d+/.test(aa[0]) ? '1' : 'n');
          const B = /n|N|len|size|count/i.test(aa[1]||'') ? 'n' : (/\d+/.test(aa[1]||'') ? '1' : 'n');
          cx = (A==='n' && B==='n') ? 'n^2' : (A==='n' || B==='n') ? 'n' : '1';
        } else {
          cx = /n|N|len|size|count/i.test(args) ? 'n' : (/\*\s*n\b/i.test(args) ? 'n' : '1');
        }
        if (cx!=='1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx, `${mm[1]}(...)`); }
      }

      // vector capacity
      if (/\b(std::)?vector\s*<[^>]+>\s+\w+\s*\(\s*([^)]+)\s*\)/.test(L) ||
          /\.resize\s*\(\s*([^)]+)\s*\)/.test(L) ||
          /\.reserve\s*\(\s*([^)]+)\s*\)/.test(L)){
        const mm2 = L.match(/\(([^)]+)\)/);
        const arg = mm2 ? mm2[1] : '';
        const cx = /n|N|len|size|count|capacity|\.size\(|\.capacity\(/.test(arg) ? 'n' : (/\d+/.test(arg) ? '1' : 'n');
        if (cx!=='1'){ spaceTerms.push(cx); pushNote(ln,'alloc',cx,'vector capacity/resize'); }
      }
    });
    return spaceTerms.length ? spaceTerms.reduce((a,c)=>simplify.max(a,c),'1') : '1';
  }

  /* =================== Library (per-line with teaching notes) =================== */

  function analyzeLibraryCallsDetailed(lines, pushNote) {
    let worst = '1';
    const add = (ln, worstCx, note) => {
      pushNote(ln, 'library', worstCx, note);
      worst = simplify.max(worst, worstCx);
    };

    lines.forEach((L, idx) => {
      const ln = idx + 1;

      // ---- C stdlib ----
      if (/\bqsort\s*\(/.test(L)) {
        add(ln, 'n^2', 'qsort(): average O(n log n), worst O(n^2) when partitions are highly unbalanced');
      }
      if (/\bbsearch\s*\(/.test(L)) {
        add(ln, 'log n', 'bsearch(): O(log n) (worst & average)');
      }
      if (/\b(memcpy|memmove|memset)\s*\(/.test(L)) {
        add(ln, 'n', RegExp.$1 + '(): linear in bytes → O(n)');
      }
      if (/\bstrlen\s*\(/.test(L)) {
        add(ln, 'n', 'strlen(): scans to null terminator → O(n) worst');
      }
      if (/\bstrcmp\s*\(/.test(L)) {
        add(ln, 'n', 'strcmp(): compares until mismatch → O(n) worst');
      }

      // ---- C++ algorithms ----
      if (/\bstd::sort\s*\(/.test(L) || /\bsort\s*\(\s*[^,]+,\s*[^)]+\)/.test(L)) {
        add(ln, 'n log n', 'std::sort(): introsort → average O(n log n), worst O(n log n)');
      }
      if (/\bstd::stable_sort\s*\(/.test(L)) {
        add(ln, 'n log n', 'std::stable_sort(): average/worst O(n log n) (stable)');
      }
      if (/\bstd::binary_search\s*\(/.test(L)) {
        add(ln, 'log n', 'std::binary_search(): O(log n)');
      }
      if (/\bstd::copy\s*\(/.test(L) || /\bcopy\s*\(\s*[^,]+,\s*[^,]+,\s*[^)]+\)/.test(L)) {
        add(ln, 'n', 'std::copy(): linear in distance → O(n)');
      }
      if (/\bstd::fill\s*\(/.test(L) || /\bfill\s*\(/.test(L)) {
        add(ln, 'n', 'std::fill(): linear in range → O(n)');
      }
      if (/\bstd::accumulate\s*\(/.test(L)) {
        add(ln, 'n', 'std::accumulate(): sums over range → O(n)');
      }
      if (/\bstd::nth_element\s*\(/.test(L)) {
        add(ln, 'n^2', 'std::nth_element(): average O(n), worst O(n^2)');
      }
      if (/\bstd::partition\s*\(/.test(L)) {
        add(ln, 'n^2', 'std::partition(): average O(n), worst O(n^2) for pathological pivots');
      }

      // ---- C++ containers (common ops) ----
      if (/\bstd::unordered_map\s*<[^>]+>/.test(L) && /\.(find|insert|erase|operator\s*\[)/.test(L)) {
        add(ln, 'n', 'unordered_map op: average O(1), worst O(n) due to collisions');
      }
      if (/\bstd::(map|multimap)\s*<[^>]+>/.test(L) && /\.(find|insert|erase|operator\s*\[)/.test(L)) {
        add(ln, 'log n', 'map/multimap op: balanced tree → O(log n) worst & average');
      }
      if (/\bstd::vector\s*<[^>]+>/.test(L) && /\.push_back\s*\(/.test(L)) {
        add(ln, 'n', 'vector::push_back(): amortized O(1), worst O(n) on reallocation');
      }
      if (/\bstd::vector\s*<[^>]+>/.test(L) && /\.(insert|erase)\s*\(/.test(L)) {
        add(ln, 'n', 'vector::insert/erase at middle: shifts → O(n) worst');
      }
    });

    return worst;
  }

  /* =================== Recursion heuristics (worst-case + teaching notes) =================== */

  // Worst-case recursion classifier
// Worst-case recursion classifier with QuickSort / D&C detection + teaching notes
function recursionHeuristic(fnName, body, pushNote, ln) {
  // Count direct self calls
  const callRe = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
  const calls = (body.match(callRe) || []).length;

  // Any hint that the problem size is halved / split by mid
  const halves =
    /[*/]\s*2\b|>>\s*1\b|\bmid\b|\b(high\s*-\s*low)\s*\/\s*2|\b(low\s*\+\s*high)\s*\/\s*2/i.test(body);

  // Linear "combine/partition" type work in the same function body
  // (QuickSort calls partition; MergeSort calls merge; generic "combine")
  const hasLinearCombine =
    /\b(for|while)\s*\(/.test(body) || /\bpartition\s*\(|\bmerge\s*\(|\bcombine\s*\(/i.test(body);

  // Two or more self-calls that are NOT mutually exclusive via else/else-if
  // (coarse but effective for typical D&C like quickSort/mergeSort)
  const hasElseBranching = /\belse\b/.test(body);
  const twoCallsSamePath = (calls >= 2) && !hasElseBranching;

  // Fibonacci-like: f(n-1) and f(n-2)
  const fib1 = new RegExp(`\\b${fnName}\\s*\\(\\s*\\w+\\s*[-]\\s*1\\s*\\)`, 'i');
  const fib2 = new RegExp(`\\b${fnName}\\s*\\(\\s*\\w+\\s*[-]\\s*2\\s*\\)`, 'i');

  // ---- Classification (WORST-CASE returned; average explained in notes) ----
  if (calls >= 2 && fib1.test(body) && fib2.test(body)) {
    pushNote(ln, 'recursion', '2^n',
      `${fnName}(): Fibonacci-like recursion → worst O(2^n) (no better average-case)`);
    return '2^n';
  }

  // Divide & Conquer: two self calls in same path
  if (twoCallsSamePath) {
    // MergeSort-ish: halves + linear combine → O(n log n) worst (and average)
    if (halves && hasLinearCombine) {
      pushNote(ln, 'recursion', 'n log n',
        `${fnName}(): divide & conquer with halving + linear combine (e.g., merge sort) → worst O(n log n), average O(n log n)`);
      return 'n log n';
    }
    // QuickSort-ish: no guaranteed halving, but linear partition/combine → worst O(n^2), average O(n log n)
    if (!halves && hasLinearCombine) {
      pushNote(ln, 'recursion', 'n^2',
        `${fnName}(): two recursive calls + linear partition/combine (e.g., quicksort) → worst O(n^2), average O(n log n)`);
      return 'n^2';
    }
    // Generic tree recursion (visit multiple branches) with no linear combine signal
    pushNote(ln, 'recursion', 'n',
      `${fnName}(): tree recursion (visits multiple branches) → worst O(n), average O(n)`);
    return 'n';
  }

  // Single-branch recursion
  if (calls >= 1) {
    if (halves) {
      pushNote(ln, 'recursion', 'log n',
        `${fnName}(): single-branch halving recursion → worst O(log n), average O(log n)`);
      return 'log n';
    }
    pushNote(ln, 'recursion', 'n',
      `${fnName}(): single-branch recursion (e.g., BST insert/search) → worst O(n); balanced average ≈ O(log n)`);
    return 'n';
  }

  return '1';
}


  /* =================== Statement cost (recursive over AST) =================== */

 function costNode(node, code, linemap, pushNote, fnCostMap, selfName){
  if (node.type === 'loop'){
    const header = code.slice(node.hStart, node.hEnd);
    const body   = code.slice(node.bStart, node.bEnd+1);
    // children cost (worst)
    let inner = '1';
    for (const ch of node.children){
      const cc = costNode(ch, code, linemap, pushNote, fnCostMap, selfName);
      inner = simplify.max(inner, cc);
    }
    const self = loopSelfTrip(header, body);
    const total = simplify.mult(self, inner); // multiply loop × inner (worst-case)
    const ln = Math.max(1, lineFromPos(linemap, node.hStart));
    pushNote(ln, 'loop', self, `loop header: ${header.trim().slice(0,100)}`);
    return total;
  }

  if (node.type === 'if'){
    let best = '1';
    for (const b of node.branches){
      const kids = parseBlock(code, b.s, b.e);
      let cx = '1';
      for (const kn of kids){
        cx = simplify.max(cx, costNode(kn, code, linemap, pushNote, fnCostMap, selfName));
      }
      best = simplify.max(best, cx);
    }
    const ln = Math.max(1, lineFromPos(linemap, node.hStart));
    pushNote(ln, 'branch', best, `if/else chain`);
    return best;
  }

  if (node.type === 'switch'){
    let best = '1';
    for (const c of node.cases){
      const kids = parseBlock(code, c.s, c.e);
      let cx = '1';
      for (const kn of kids){
        cx = simplify.max(cx, costNode(kn, code, linemap, pushNote, fnCostMap, selfName));
      }
      best = simplify.max(best, cx);
    }
    const ln = Math.max(1, lineFromPos(linemap, node.hStart));
    pushNote(ln, 'branch', best, `switch`);
    return best;
  }

  // generic statement: library calls + known function calls
  if (node.type === 'stmt'){
    const snip = code.slice(node.s, node.e+1);
    let cx = '1';

    // Library heuristics (quick)
    if (/\b(memcpy|memmove|memset|strlen|strcmp)\s*\(/.test(snip)) cx = 'n';
    if (/\b(bsearch)\s*\(/.test(snip)) cx = simplify.max(cx,'log n');
    if (/\b(qsort)\s*\(/.test(snip))   cx = simplify.max(cx,'n log n'); // avg; detailed pass sets worst
    if (/\bstd::(sort|stable_sort)\s*\(/.test(snip) || /\bsort\s*\(\s*[^,]+,\s*[^)]+\)/.test(snip)) cx = simplify.max(cx,'n log n');
    if (/\bstd::binary_search\s*\(/.test(snip)) cx = simplify.max(cx,'log n');

    // Substitute known function calls (exclude self to avoid double counting recursion)
    if (fnCostMap && Object.keys(fnCostMap).length){
      for (const [callee, calleeCx] of Object.entries(fnCostMap)){
        if (callee === selfName) continue;
        const re = new RegExp(`\\b${callee}\\s*\\(`);
        if (re.test(snip)){
          cx = simplify.max(cx, calleeCx);
          const ln = Math.max(1, lineFromPos(linemap, node.s));
          pushNote(ln, 'call', calleeCx, `calls ${callee}()`);
        }
      }
    }
    return cx;
  }

  return '1';
}


  

  function analyzeFunction(fn, code, linemap, pushNote, fnCostMap){
  // Parse all top-level statements inside this function’s body
  const nodes = parseBlock(code, fn.bodyStart + 1, fn.bodyEnd - 1);

  // Worst-case time across sequential statements = max of their worst costs
  let worstTime = '1';
  for (const n of nodes){
    const t = costNode(n, code, linemap, pushNote, fnCostMap, fn.name);
    worstTime = simplify.max(worstTime, t);
  }

  // Add worst-case recursion term from whole body (if any)
  const body = code.slice(fn.bodyStart + 1, fn.bodyEnd);
  const ln = Math.max(1, lineFromPos(linemap, fn.headStart));
  const recWorst = recursionHeuristic(fn.name, body, pushNote, ln);

  // Final worst-case for this function
  return simplify.max(worstTime, recWorst);
}


  /* =================== Main analyzer =================== */

  function analyzeCComplexity(src){
    const code = stripNoise(src);
    const lines = code.split(/\r?\n/);
    const linemap = posToLineMap(code);
    const notes = [];
    const pushNote = (line, type, cx, reason) => notes.push({ line, type, cx:`O(${cx})`, reason });

    // Space analysis
    const spaceAgg = analyzeSpace(lines, pushNote);

    // Function analysis
    // Function analysis (call-aware)
const fns = findFunctions(code);

// Pass 1: initial costs without cross-call substitution (map seeded)
let fnCost = {};
for (const fn of fns){
  // Use empty map here so we don't attribute calls yet
  const t0 = analyzeFunction(fn, code, linemap, ()=>{}, {}); // silent first pass
  fnCost[fn.name] = t0;
}

// Pass 2: iterate to fixed point with call substitution
// (handles chains: main -> A -> B, etc.)
for (let iter = 0; iter < 5; iter++){
  let changed = false;
  for (const fn of fns){
    const t = analyzeFunction(fn, code, linemap, pushNote, fnCost);
    if (t !== fnCost[fn.name]){
      fnCost[fn.name] = t;
      changed = true;
    }
  }
  if (!changed) break;
}

// Aggregate: we want the cost of what actually runs.
// If main() exists, show main’s cost (which now includes callees).
// Otherwise, show worst across all functions (e.g., single-file libs).
let timeMain = fnCost['main'] || '1';
let timeOthers = '1';
for (const [name, cx] of Object.entries(fnCost)){
  if (name !== 'main') timeOthers = simplify.max(timeOthers, cx);
}


    // Library costs (per-line with teaching notes; returns worst-case)
    const libWorst = analyzeLibraryCallsDetailed(lines, pushNote);

    // Final time: prefer main if present, else max across functions, include library worst
    let finalTimeCore = timeMain !== '1' ? timeMain : timeOthers;
finalTimeCore = simplify.max(finalTimeCore, analyzeLibraryCallsDetailed(lines, pushNote));


    const finalTime = `O(${finalTimeCore})`;                 // always worst-case
    const finalSpace = spaceAgg === '1' ? 'O(1)' : `O(${spaceAgg})`;

    return { notes, finalTime, finalSpace };
  }

  /* =================== Modal (same UI + teaching notes) =================== */

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
</div>`;

  function ensureModalInserted() {
    let modal = document.getElementById('complexityModal');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
      modal = document.getElementById('complexityModal');
      if (modal) {
        modal.addEventListener('click', (e) => {
          const t = e.target;
          if (t && t.hasAttribute && t.hasAttribute('data-close')) closeModal();
        });
      }
    }
    return modal;
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
    const code =
      (window.editor && window.editor.getValue && window.editor.getValue()) ||
      (typeof getCode === 'function' ? getCode() : '') ||
      (document.getElementById('code')?.value || '');

    const { notes, finalTime, finalSpace } = analyzeCComplexity(code);

    const modal = ensureModalInserted();
    if (!modal) return;

    const tEl = modal.querySelector('#cxTime');
    const sEl = modal.querySelector('#cxSpace');
    const tb  = modal.querySelector('#cxTable tbody');
    const nt  = modal.querySelector('#cxNotes');
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
      `<p><strong>Heuristic:</strong> Nest-aware loops (for/while/do-while), if/else & switch (max branch), function + recursion patterns (single-branch, tree, Fibonacci, divide&amp;conquer). Space scans arrays/containers/heap. Library calls add costs. Path-dependent math is approximated.</p>`;
    nt.innerHTML +=
      `<p><strong>Teaching note:</strong> The “Final Time” is always the <u>worst-case</u>. Line-by-line notes may also mention average-case so you learn both. In interviews/exams, quote worst-case unless asked otherwise.</p>`;
    nt.innerHTML +=
      `<p><strong>Library note:</strong> For standard library calls we show average <em>and</em> worst where they differ (e.g., <code>qsort</code> average O(n log n), worst O(n^2)). The Final Time remains worst-case.</p>`;

    openModal();
  }

  function initUI({ getCode } = {}) {
    if (initUI._bound) return;
    const btn = document.getElementById('btnComplexity');
    if (!btn) return;
    initUI._bound = true;
    btn.addEventListener('click', () => handleAnalyzeClick(getCode));
  }

  // Public API (unchanged)
  window.PolyComplexity = {
    analyze: (code) => analyzeCComplexity(code),
    initUI,
    open: async () => { await ensureModalInserted(); openModal(); },
    close: closeModal
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('btnComplexity')) initUI({});
    }, { once: true });
  } else {
    if (document.getElementById('btnComplexity')) initUI({});
  }
})();

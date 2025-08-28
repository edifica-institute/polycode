// === Modal/table layout fixes (sticky headers; no overlap) ===
const MODAL_CSS = `
.pc-modal{position:fixed;inset:0;z-index:9999;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial;}
.pc-modal__backdrop{position:absolute;inset:0;background:rgba(0,0,0,.6);}
.pc-modal__dialog{
  position:relative; margin:5vh auto; width:min(960px,95vw); max-height:90vh;
  display:flex; flex-direction:column; background:#1f1f1f; color:#eee;
  border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,.45); overflow:hidden;
}
.pc-modal__header, .pc-modal__footer{
  background:#1f1f1f; z-index:3; padding:12px 16px;
}
.pc-modal__header{ position:sticky; top:0; border-bottom:1px solid rgba(255,255,255,.08); }
.pc-modal__footer{ position:sticky; bottom:0; border-top:1px solid rgba(255,255,255,.08); }
.pc-modal__body{ flex:1 1 auto; overflow:auto; padding:16px; background:#191919; }

.cx-summary{ display:flex; gap:24px; flex-wrap:wrap; margin-bottom:8px; }
.cx-table{ width:100%; border-collapse:collapse; table-layout:fixed; }
.cx-table th, .cx-table td{
  padding:8px 10px; border-bottom:1px solid rgba(255,255,255,.08);
  vertical-align:top; word-wrap:break-word; overflow-wrap:anywhere;
}
.cx-table thead th{
  position:sticky; top:0; background:#262626; z-index:2;
  border-bottom:1px solid rgba(255,255,255,.12);
}
.cx-notes{ opacity:.9; font-size:.92rem; line-height:1.35; margin-top:10px; }
.pc-modal__close{ all:unset; cursor:pointer; font-size:18px; padding:0 4px; }
.btn{ padding:8px 12px; border-radius:8px; background:#2a2a2a; color:#eee; border:1px solid rgba(255,255,255,.08); }
.btn:hover{ background:#333; }
`;

// inject once
function ensureModalStyles(){
  if (document.getElementById('pc-modal-style')) return;
  const style = document.createElement('style');
  style.id = 'pc-modal-style';
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}





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
      const norm = (x) => x.replace(/\s+/g,' ')
                           .replace(/n\s*log\s*n/g,'n log n')
                           .replace(/log\s*n/g,'log n')
                           .trim();
      a = norm(a); b = norm(b);

      // If either side is exponential, keep exponential worst-case
      if (/2\^n|phi\^n|FIB/i.test(a) || /2\^n|phi\^n|FIB/i.test(b)) return '2^n';

      const parts = (txt) => txt.split(/\s+/).filter(Boolean);
      const all = parts(a).concat(parts(b));
      const count = {};
      for (const t of all) count[t] = (count[t] || 0) + 1;

      const out = [];
      const push = (sym) => {
        if (count[sym]) {
          out.push(count[sym] === 1 ? sym : `${sym}^${count[sym]}`);
          delete count[sym];
        }
      };
      push('n'); push('log n');
      for (const [k, p] of Object.entries(count)) out.push(p === 1 ? k : `${k}^${p}`);
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
        if (/h(?!\w)/.test(v))          return 3;
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

  /* =================== Method discovery =================== */

  // Java method definitions: capture name + body
  function findMethods(code){
    const fns = [];
    const re = /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[^>]+>\s*)?[\w\[\]<>]+\s+(\w+)\s*\([^;{}]*\)\s*\{/g;
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

  /* =================== Block parser (loops/ifs/switch/do/stmt) =================== */

  function parseBlock(code, start, end){
    const nodes = [];
    let i = start|0;
    while (i <= end){
      while (i<=end && /\s/.test(code[i])) i++;
      if (i > end) break;

      // for(...)
      if (/\bfor\s*\(/y.test(code.slice(i))){
        const hStart = i + code.slice(i).match(/\bfor\s*\(/).index;
        const po = code.indexOf('(', hStart);
        const pe = matchParen(code, po);
        let j = pe + 1;
        while (j<=end && /\s/.test(code[j])) j++;
        let bStart, bEnd;
        if (code[j] === '{'){ bStart=j; bEnd=matchBrace(code, j); }
        else { bStart=j; bEnd=code.indexOf(';', j); }
        nodes.push({ type:'loop', kind:'for', hStart, hEnd:pe+1, bStart, bEnd,
          children: parseBlock(code, bStart+(code[j]==='{'), bEnd-(code[j]==='{')) });
        i = bEnd + 1; continue;
      }

      // while(...)
      if (/\bwhile\s*\(/y.test(code.slice(i))){
        const hStart = i + code.slice(i).match(/\bwhile\s*\(/).index;
        const po = code.indexOf('(', hStart);
        const pe = matchParen(code, po);
        let j = pe + 1;
        while (j<=end && /\s/.test(code[j])) j++;
        let bStart, bEnd;
        if (code[j] === '{'){ bStart=j; bEnd=matchBrace(code, j); }
        else { bStart=j; bEnd=code.indexOf(';', j); }
        nodes.push({ type:'loop', kind:'while', hStart, hEnd:pe+1, bStart, bEnd,
          children: parseBlock(code, bStart+(code[j]==='{'), bEnd-(code[j]==='{')) });
        i = bEnd + 1; continue;
      }

      // do { ... } while(...);
      if (/\bdo\b/y.test(code.slice(i))){
        const dStart = i + code.slice(i).match(/\bdo\b/).index;
        let j = dStart + 2;
        while (j<=end && /\s/.test(code[j])) j++;
        if (code[j] === '{'){
          const bStart=j, bEnd=matchBrace(code, j);
          const wIdx = code.indexOf('while', bEnd);
          if (wIdx !== -1){
            const po = code.indexOf('(', wIdx);
            const pe = matchParen(code, po);
            nodes.push({ type:'loop', kind:'do-while', hStart:wIdx, hEnd:pe+1, bStart, bEnd,
              children: parseBlock(code, bStart+1, bEnd-1) });
            i = pe + 2; continue;
          }
        }
      }

      // if (...) { ... } [else if]* [else]?
      if (/\bif\s*\(/y.test(code.slice(i))){
        const hStart = i + code.slice(i).match(/\bif\s*\(/).index;
        const po = code.indexOf('(', hStart);
        const pe = matchParen(code, po);
        let j = pe + 1;
        while (j<=end && /\s/.test(code[j])) j++;
        let thenStart, thenEnd;
        if (code[j] === '{'){ thenStart=j; thenEnd=matchBrace(code, j); }
        else { thenStart=j; thenEnd=code.indexOf(';', j); }

        const branches = [];
        branches.push({ s: thenStart+(code[j]==='{'), e: thenEnd-(code[j]==='{') });

        let k = thenEnd + 1;
        while (k<=end){
          while (k<=end && /\s/.test(code[k])) k++;
          if (!/\belse\b/y.test(code.slice(k))) break;
          k += code.slice(k).match(/\belse\b/).index + 4;
          while (k<=end && /\s/.test(code[k])) k++;
          if (/\bif\s*\(/y.test(code.slice(k))){
            const if2 = k + code.slice(k).match(/\bif\s*\(/).index;
            const po2 = code.indexOf('(', if2);
            const pe2 = matchParen(code, po2);
            k = pe2 + 1;
            while (k<=end && /\s/.test(code[k])) k++;
            let s2,e2;
            if (code[k] === '{'){ s2=k; e2=matchBrace(code, k); }
            else { s2=k; e2=code.indexOf(';', k); }
            branches.push({ s: s2+(code[k]==='{'), e: e2-(code[k]==='{') });
            k = e2 + 1;
          } else {
            let s2,e2;
            if (code[k] === '{'){ s2=k; e2=matchBrace(code, k); }
            else { s2=k; e2=code.indexOf(';', k); }
            branches.push({ s: s2+(code[k]==='{'), e: e2-(code[k]==='{') });
            k = e2 + 1; break;
          }
        }
        nodes.push({ type:'if', hStart, hEnd:pe+1, branches });
        i = k; continue;
      }

      // switch
      if (/\bswitch\s*\(/y.test(code.slice(i))){
        const sStart = i + code.slice(i).match(/\bswitch\s*\(/).index;
        const po = code.indexOf('(', sStart);
        const pe = matchParen(code, po);
        let j = pe + 1;
        while (j<=end && /\s/.test(code[j])) j++;
        if (code[j] === '{'){
          const bStart=j, bEnd=matchBrace(code, j);
          const body = code.slice(bStart+1, bEnd);
          const cases = [];
          const caseRe = /(?:\bcase\b[^\:]*\:|\bdefault\s*:)/g;
          let cm, anchors = [];
          while ((cm = caseRe.exec(body))) anchors.push(bStart+1 + cm.index);
          anchors.push(bEnd);
          for (let c=0;c<anchors.length-1;c++) cases.push({ s: anchors[c], e: anchors[c+1]-1 });
          nodes.push({ type:'switch', hStart:sStart, hEnd:pe+1, cases });
          i = bEnd + 1; continue;
        }
      }

      // generic statement
      const semi = code.indexOf(';', i);
      const brace = code.indexOf('{', i);
      if (semi !== -1 && (brace === -1 || semi < brace)){
        nodes.push({ type:'stmt', s:i, e:semi });
        i = semi + 1;
      } else if (brace !== -1){
        const bEnd = matchBrace(code, brace);
        nodes.push({ type:'stmt', s:i, e:bEnd });
        i = bEnd + 1;
      } else {
        nodes.push({ type:'stmt', s:i, e:end }); break;
      }
    }
    return nodes;
  }

  /* =================== Loop self-trip =================== */

  function loopSelfTrip(header, body) {
    const h = (header||'').replace(/\s+/g,' ');
    const b = (body  ||'').replace(/\s+/g,' ');

    // halving / doubling hints
    if (/[*/]\s*2\b|<<\s*1\b|>>\s*1\b/.test(h) || /i\s*=\s*i\s*\/\s*2\b/.test(h) ||
        /[*/]\s*2\b|<<\s*1\b|>>\s*1\b/.test(b)) return 'log n';

    // for (...) with ++/-- step
    if (/\bfor\s*\([^;]*;\s*[^;]*[<≤>≥!=]=?[^;]*;\s*[^;]*(\+\+|--|[\+\-]=\s*1)\s*\)/.test(h)) return 'n';

    // while (i < N) { i++; } pattern
    if (/\bwhile\s*\(\s*[\w\.\(\)]+\s*[<≤>≥!=]=?\s*[\w\.\(\)]+\s*\)/.test(h) &&
        /\b(\w+)\s*(\+\+|--|[\+\-]=\s*1)\b/.test(b)) return 'n';

    // two-pointer scan
    const twoPtr = /\bwhile\s*\(\s*\w+\s*<\s*\w+\s*\)/.test(h) &&
                   /\b\w+\s*(\+\+|[\+]=\s*1)\b/.test(b) &&
                   /\b\w+\s*(--|[\-]=\s*1)\b/.test(b);
    if (twoPtr) return 'n';

    return 'n';
  }

  /* =================== Space scan (arrays + collections) =================== */

  function analyzeSpace(lines, pushNote){
    let terms = [];
    lines.forEach((L, idx) => {
      const ln = idx+1;

      // new int[a][b] / new int[a]
      const arr2 = L.match(/new\s+\w+\s*\[\s*([^\]]+)\s*\]\s*\[\s*([^\]]+)\s*\]/);
      const arr1 = L.match(/new\s+\w+\s*\[\s*([^\]]+)\s*\]/);
      if (arr2){
        const A = /n|length|size\(\)/.test(arr2[1]) ? 'n' : (/\d+/.test(arr2[1]) ? '1':'n');
        const B = /n|length|size\(\)/.test(arr2[2]) ? 'n' : (/\d+/.test(arr2[2]) ? '1':'n');
        const cx = (A==='n' && B==='n') ? 'n^2' : (A==='n'||B==='n') ? 'n' : '1';
        if (cx!=='1'){ terms.push(cx); pushNote(ln,'alloc',cx,'2D array allocation'); }
      } else if (arr1){
        const cx = /n|length|size\(\)/.test(arr1[1]) ? 'n' : (/\d+/.test(arr1[1]) ? '1':'n');
        if (cx!=='1'){ terms.push(cx); pushNote(ln,'alloc',cx,'array allocation'); }
      }

      // Collections with capacity
      const col = L.match(/new\s+(ArrayList|LinkedList|HashMap|HashSet|TreeMap|TreeSet)\s*<[^>]*>\s*\(\s*([^)]+)\s*\)/);
      if (col){
        const cap = col[2]; const cx = /n|length|size\(\)/.test(cap) ? 'n' : (/\d+/.test(cap) ? '1':'n');
        if (cx!=='1'){ terms.push(cx); pushNote(ln,'alloc',cx,`${col[1]} capacity ~ ${cap.trim()}`); }
      }
    });
    return terms.length ? terms.reduce((a,c)=>simplify.max(a,c),'1') : '1';
  }

  /* =================== Library (per-line notes; returns worst-case) =================== */

  function analyzeLibraryCallsDetailed(lines, pushNote){
    let worst = '1';
    const add = (ln, cx, note) => { pushNote(ln,'library',cx,note); worst = simplify.max(worst, cx); };

    lines.forEach((L, idx) => {
      const ln = idx+1;

      // Arrays.sort: primitives = Dual-Pivot QuickSort (avg n log n, worst n^2)
      // Objects = TimSort (avg/worst n log n). We show worst-case safely.
      if (/Arrays\.sort\s*\(/.test(L)){
        add(ln, 'n^2', 'Arrays.sort(): primitives → avg O(n log n), worst O(n^2); objects (TimSort) → worst O(n log n)');
      }
      if (/Collections\.sort\s*\(/.test(L)){
        add(ln, 'n log n', 'Collections.sort(): TimSort → average/worst O(n log n)');
      }
      if (/System\.arraycopy\s*\(/.test(L)){
        add(ln, 'n', 'System.arraycopy(): copies range → O(n)');
      }
      if (/Arrays\.binarySearch\s*\(/.test(L)){
        add(ln, 'log n', 'Arrays.binarySearch(): O(log n)');
      }

      // Common Collections ops (avg vs worst)
      if (/\bHashMap<[^>]*>\b/.test(L) && /\.(put|get|remove)\s*\(/.test(L)){
        add(ln, 'n', 'HashMap op: average O(1), worst O(n) due to collisions');
      }
      if (/\bTreeMap<[^>]*>\b/.test(L) && /\.(put|get|remove)\s*\(/.test(L)){
        add(ln, 'log n', 'TreeMap op: balanced tree → O(log n)');
      }
      if (/\bArrayList<[^>]*>\b/.test(L) && /\.add\s*\(/.test(L)){
        add(ln, 'n', 'ArrayList.add(): amortized O(1), worst O(n) on resize/insert at index');
      }
      if (/\bArrayList<[^>]*>\b/.test(L) && /\.(remove|add)\s*\(\s*\d+/.test(L)){
        add(ln, 'n', 'ArrayList insert/remove at index: shifts → O(n) worst');
      }
      if (/\bLinkedList<[^>]*>\b/.test(L) && /\.(addFirst|addLast|removeFirst|removeLast)\s*\(/.test(L)){
        add(ln, '1', 'LinkedList deque ops: O(1)');
      }
      if (/\bLinkedList<[^>]*>\b/.test(L) && /\.get\s*\(\s*\d+/.test(L)){
        add(ln, 'n', 'LinkedList.get(index): walk list → O(n)');
      }
    });

    return worst;
  }

  /* =================== Recursion heuristics (worst-case + teaching notes) =================== */

 // Worst-case recursion classifier + stack depth and trace notes
function recursionHeuristic(fnName, body, pushNote, ln){
  const callRe = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
  const calls = (body.match(callRe) || []).length;

  // halving / mid hints
  const halves = /[*/]\s*2\b|>>\s*1\b|\bmid\b|\b(high\s*-\s*low)\s*\/\s*2|\b(low\s*\+\s*high)\s*\/\s*2/i.test(body);

  // linear combine/partition hints
  const hasLinearCombine =
    /\b(for|while)\s*\(/.test(body) || /\bpartition\s*\(|\bmerge\s*\(|\bcombine\s*\(/i.test(body);

  // two self-calls in same path (not separated by else)
  const twoCallsSamePath = (calls >= 2) && !/\belse\b/.test(body);

  // Fibonacci-like
  const fib1 = new RegExp(`\\b${fnName}\\s*\\(\\s*\\w+\\s*[-]\\s*1\\s*\\)`, 'i');
  const fib2 = new RegExp(`\\b${fnName}\\s*\\(\\s*\\w+\\s*[-]\\s*2\\s*\\)`, 'i');

  // Heuristic: looks like tree nodes
  const looksTreey = /\.(left|right|child|next)\b/i.test(body) || /\b(node|root)\b/i.test(body);

  // helper to emit stack note
  function pushStack(depthExpr, trace) {
    // depthExpr like 'n', 'log n', or 'h'
    pushNote(ln, 'stack', depthExpr, `recursion stack (worst): ${trace}`);
  }

  // ---- Classification + stack depth/trace (WORST CASE) ----

  if (calls >= 2 && fib1.test(body) && fib2.test(body)) {
    pushNote(ln, 'recursion', '2^n', `${fnName}(): Fibonacci-like recursion → worst O(2^n)`);
    // stack depth is linear
    pushStack('n', `${fnName}(n) → ${fnName}(n-1) → … → ${fnName}(1)`);
    return '2^n';
  }

  if (twoCallsSamePath){
    if (halves && hasLinearCombine){
      // MergeSort-ish: two calls, guaranteed halving, linear combine
      pushNote(ln, 'recursion', 'n log n',
        `${fnName}(): divide & conquer with halving + linear combine (e.g., merge sort) → worst O(n log n)`);
      pushStack('log n', `${fnName}(n) → ${fnName}(n/2) → ${fnName}(n/4) → … → ${fnName}(1)`);
      return 'n log n';
    }
    if (!halves && hasLinearCombine){
      // QuickSort-ish: two calls, no guaranteed halving, linear partition
      pushNote(ln, 'recursion', 'n^2',
        `${fnName}(): two recursive calls + linear partition/combine (e.g., quicksort) → worst O(n^2), average O(n log n)`);
      pushStack('n', `${fnName}(n) → ${fnName}(n-1) → ${fnName}(n-2) → … → ${fnName}(1)`);
      return 'n^2';
    }
    // Generic tree recursion
    pushNote(ln, 'recursion', 'n',
      `${fnName}(): tree recursion (visits multiple branches) → worst O(n)`);
    pushStack('h', `${fnName}(node) → ${fnName}(node.left) → ${fnName}(node.left.left) → …`);
    return 'n';
  }

  if (calls >= 1){
    if (halves){
      // Single-branch halving (binary search style)
      pushNote(ln, 'recursion', 'log n',
        `${fnName}(): single-branch halving recursion → worst O(log n)`);
      pushStack('log n', `${fnName}(n) → ${fnName}(n/2) → ${fnName}(n/4) → … → ${fnName}(1)`);
      return 'log n';
    }
    // Single-branch (BST insert/search etc.)
    pushNote(ln, 'recursion', 'n',
      `${fnName}(): single-branch recursion (e.g., BST insert/search) → worst O(n); balanced avg ≈ O(log n)`);
    if (looksTreey) {
      pushStack('h', `${fnName}(node) → ${fnName}(node.left/right) → …`);
    } else {
      pushStack('n', `${fnName}(n) → ${fnName}(n-1) → … → ${fnName}(1)`);
    }
    return 'n';
  }

  return '1';
}

  /* =================== Statement cost (recursive AST) with call substitution =================== */

  function costNode(node, code, linemap, pushNote, fnCostMap, selfName){
    if (node.type === 'loop'){
      const header = code.slice(node.hStart, node.hEnd);
      const body   = code.slice(node.bStart, node.bEnd+1);
      let inner = '1';
      for (const ch of node.children){
        inner = simplify.max(inner, costNode(ch, code, linemap, pushNote, fnCostMap, selfName));
      }
      const self = loopSelfTrip(header, body);
      const total = simplify.mult(self, inner);
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

    if (node.type === 'stmt'){
      const snip = code.slice(node.s, node.e+1);
      let cx = '1';

      // quick library hints (detail pass adds notes/worst elsewhere)
      if (/System\.arraycopy\s*\(/.test(snip)) cx = simplify.max(cx,'n');
      if (/Arrays\.binarySearch\s*\(/.test(snip)) cx = simplify.max(cx,'log n');
      if (/Arrays\.sort\s*\(/.test(snip)) cx = simplify.max(cx,'n log n'); // avg
      if (/Collections\.sort\s*\(/.test(snip)) cx = simplify.max(cx,'n log n');

      // substitute known method calls (excluding self to avoid recursion double-counting)
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

  function analyzeMethod(fn, code, linemap, pushNote, fnCostMap){
    const nodes = parseBlock(code, fn.bodyStart + 1, fn.bodyEnd - 1);

    let worstTime = '1';
    for (const n of nodes){
      const t = costNode(n, code, linemap, pushNote, fnCostMap, fn.name);
      worstTime = simplify.max(worstTime, t);
    }

    const body = code.slice(fn.bodyStart + 1, fn.bodyEnd);
    const ln   = Math.max(1, lineFromPos(linemap, fn.headStart));
    const recWorst = recursionHeuristic(fn.name, body, pushNote, ln);

    return simplify.max(worstTime, recWorst);
  }

  /* =================== Main analyzer (call-aware fixed point) =================== */

  function analyzeJavaComplexity(src){
    const code = stripNoise(src);
    const lines = code.split(/\r?\n/);
    const linemap = posToLineMap(code);

    const notes = [];
    const pushNote = (line, type, cx, reason) => notes.push({ line, type, cx: `O(${cx})`, reason });

    // Space
    const spaceWorst = analyzeSpace(lines, pushNote);

    // Methods
    const fns = findMethods(code);

    // Pass 1: seed costs without cross-call substitution
    let fnCost = {};
    for (const fn of fns){
      const t0 = analyzeMethod(fn, code, linemap, ()=>{}, {}); // silent
      fnCost[fn.name] = t0;
    }

    // Pass 2: iterate to fixed point with call substitution
    for (let iter=0; iter<5; iter++){
      let changed = false;
      for (const fn of fns){
        const t = analyzeMethod(fn, code, linemap, pushNote, fnCost);
        if (t !== fnCost[fn.name]) { fnCost[fn.name] = t; changed = true; }
      }
      if (!changed) break;
    }

    // Aggregate what actually runs: prefer main() if present
    const mainCx = fnCost['main'] || fnCost['Main'] || '1';
    let others   = '1';
    for (const [name, cx] of Object.entries(fnCost)){
      if (name !== 'main' && name !== 'Main') others = simplify.max(others, cx);
    }

    // Library (per-line; adds notes; worst-case)
    const libWorst = analyzeLibraryCallsDetailed(lines, pushNote);

    let finalTimeCore = mainCx !== '1' ? mainCx : others;
    finalTimeCore = simplify.max(finalTimeCore, libWorst);

    const finalTime  = `O(${finalTimeCore})`;                 // worst-case
    const finalSpace = spaceWorst === '1' ? 'O(1)' : `O(${spaceWorst})`;

    return { notes, finalTime, finalSpace };
  }

  /* =================== Modal (inline) =================== */

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
    ensureModalStyles();
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
      `<p><strong>Heuristic:</strong> Nest-aware loops (for/while/do-while), if/else & switch (max branch), method + recursion patterns (single-branch, tree, Fibonacci, divide&amp;conquer). Space scans arrays/collections. Library calls add costs. Path-dependent math is approximated.</p>`;
    nt.innerHTML +=
      `<p><strong>Teaching note:</strong> The “Final Time” is always the <u>worst-case</u>. Line-by-line notes may also mention average-case so you learn both. In interviews/exams, quote worst-case unless asked otherwise.</p>`;
    nt.innerHTML +=
      `<p><strong>Library note:</strong> Arrays.sort on primitives uses dual-pivot quicksort (average O(n log n), worst O(n^2)); on objects it is TimSort (worst O(n log n)). Collections.sort is TimSort. We surface the worst-case in the total.</p>`;

    openModal();
  }

  function initUI({ getCode } = {}) {
    if (initUI._bound) return;
    const btn = document.getElementById('btnComplexity');
    if (!btn) return;
    initUI._bound = true;
    btn.addEventListener('click', () => handleAnalyzeClick(getCode));
  }

  window.PolyComplexity = {
    analyze: (code) => analyzeJavaComplexity(code),
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

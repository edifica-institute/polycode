// boolean-runner.js — Boolean Algebra service (ESM)
import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 8090;

const ALLOW_ORIGINS = [
  "https://www.polycode.in",
  "https://polycode.in",
  "https://polycode.pages.dev",
  "https://edifica-polycode.pages.dev",
  "http://localhost:3000",
];
const corsOptions = {
  origin(origin, cb){
    if (!origin) return cb(null, true);
    if (ALLOW_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"));
  },
  methods: ["POST","GET","OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400
};

const app = express();
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_,res)=>res.json({ ok:true }));

/* ========= Lexer / Parser (Shunting-yard) ========= */
const OP = {
  NOT: { p:4, a:"right", sym:["¬","~","!"] },
  AND: { p:3, a:"left",  sym:["·","*","&"] },
  XOR: { p:2, a:"left",  sym:["^"] },
  OR : { p:1, a:"left",  sym:["+","|"] },
};
const SYM_TO_OP = new Map(
  Object.entries(OP).flatMap(([k, v]) => v.sym.map(s => [s, k]))
);
const isVar = c => /^[A-Za-z][A-Za-z0-9_]*$/.test(c);
const isBit = c => c === "0" || c === "1";

function tokenize(expr){
  const out = [];
  let i=0, s = expr.trim();
  while (i < s.length) {
    const ch = s[i];

    // whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // parentheses
    if (ch === "(" || ch === ")") { out.push({t:"par", v:ch}); i++; continue; }

    // multi-char ops: ->, <-> (optional)
    if (s.startsWith("->", i)) { out.push({t:"op", v:"->"}); i+=2; continue; }
    if (s.startsWith("<->", i)) { out.push({t:"op", v:"<->"}); i+=3; continue; }

    // 1-char ops
    if (SYM_TO_OP.has(ch) || ch==="+" || ch==="|" || ch==="^") {
      out.push({t:"op", v:ch});
      i++; continue;
    }

    // variables or constants
    if (/[A-Za-z_]/.test(ch)) {
      let j=i+1;
      while (j<s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({t:"var", v:s.slice(i,j)});
      i=j; continue;
    }

    if (isBit(ch)) { out.push({t:"const", v:ch}); i++; continue; }

    throw new Error(`Unexpected token: '${ch}' at ${i}`);
  }
  return out;
}

// normalize implicit AND (A B -> A·B ; )(
function insertImplicitAnd(tokens){
  const out = [];
  for (let k=0; k<tokens.length; k++){
    const t = tokens[k], prev = out[out.length-1];
    out.push(t);
    if (!prev) continue;
    const prevCouldEnd = (prev.t==="var"||prev.t==="const"|| (prev.t==="par"&&prev.v===")"));
    const nextCouldStart = (t.t==="var"||t.t==="const"|| (t.t==="par"&&t.v==="(") || (t.t==="op" && SYM_TO_OP.get(t.v)==="NOT"));
    if (prevCouldEnd && nextCouldStart){
      // insert implicit AND between prev and t, but not if t is an operator except NOT
      if (!(t.t==="op" && SYM_TO_OP.get(t.v)!=="NOT")){
        // inject an AND before current 't' (we already pushed t, so insert at -1)
        out.splice(out.length-1, 0, {t:"op", v:"*"});
      }
    }
  }
  return out;
}

function toRPN(tokens){
  const out=[]; const st=[];
  const prec = (op) => (op==="->"||op==="↦")?0:(op==="<->")?0:OP[SYM_TO_OP.get(op)]?.p ?? 0;
  const assoc = (op) => OP[SYM_TO_OP.get(op)]?.a ?? "left";
  for (const tk of tokens){
    if (tk.t==="var"||tk.t==="const") out.push(tk);
    else if (tk.t==="op"){
      const isNot = SYM_TO_OP.get(tk.v)==="NOT";
      const p = isNot ? OP.NOT.p : prec(tk.v);
      const a = isNot ? OP.NOT.a : assoc(tk.v);
      while (st.length){
        const top = st[st.length-1];
        if (top.t!=="op") break;
        const topIsNot = SYM_TO_OP.get(top.v)==="NOT";
        const tp = topIsNot ? OP.NOT.p : prec(top.v);
        if ((a==="left" && p<=tp) || (a==="right" && p<tp)) out.push(st.pop());
        else break;
      }
      st.push(tk);
    } else if (tk.t==="par" && tk.v==="(") st.push(tk);
    else if (tk.t==="par" && tk.v===")") {
      while (st.length && !(st[st.length-1].t==="par" && st[st.length-1].v==="(")) out.push(st.pop());
      if (!st.length) throw new Error("Mismatched parentheses");
      st.pop(); // pop '('
    }
  }
  while (st.length){
    const x = st.pop();
    if (x.t==="par") throw new Error("Mismatched parentheses");
    out.push(x);
  }
  return out;
}

function evalRPN(rpn, env){
  const st=[];
  for (const tk of rpn){
    if (tk.t==="const") st.push(tk.v==="1");
    else if (tk.t==="var") {
      if (!(tk.v in env)) throw new Error(`Missing var: ${tk.v}`);
      st.push(!!env[tk.v]);
    } else if (tk.t==="op"){
      const op = tk.v;
      const name = SYM_TO_OP.get(op) || op;
      if (name==="NOT"){
        const a = st.pop(); st.push(!a); continue;
      }
      if (name==="AND"){ const b=st.pop(), a=st.pop(); st.push(a && b); continue; }
      if (name==="OR"){  const b=st.pop(), a=st.pop(); st.push(a || b); continue; }
      if (name==="XOR"){ const b=st.pop(), a=st.pop(); st.push(!!(a ^ b)); continue; }
      if (op==="->"){ const b=st.pop(), a=st.pop(); st.push((!a) || b); continue; }
      if (op==="<->"){ const b=st.pop(), a=st.pop(); st.push(a===b); continue; }
      throw new Error(`Unknown op: ${op}`);
    }
  }
  if (st.length!==1) throw new Error("Bad expression");
  return st[0];
}

function detectVars(tokens){
  const set=new Set();
  for (const t of tokens) if (t.t==="var") set.add(t.v);
  return [...set];
}

/* ========= Truth table / SOP-POS ========= */
function truthTable(rpn, vars){
  const n = vars.length;
  if (n>8) throw new Error("Too many variables (max 8)");
  const rows = [];
  for (let mask=0; mask < (1<<n); mask++){
    const env = {};
    for (let i=0;i<n;i++) env[vars[i]] = !!(mask & (1<<(n-1-i)));
    const val = evalRPN(rpn, env);
    rows.push({ env, out: val ? 1 : 0 });
  }
  return rows;
}
function mintermsFromTT(tt, vars){
  const n = vars.length, ms=[];
  for (let i=0;i<tt.length;i++){
    if (tt[i].out===1) ms.push(i);
  }
  return ms;
}
function maxtermsFromTT(tt, vars){
  const n = vars.length, Ms=[];
  for (let i=0;i<tt.length;i++){
    if (tt[i].out===0) Ms.push(i);
  }
  return Ms;
}
function toSOP(terms, vars){
  // Σ m(...) — human SOP string
  if (!terms.length) return "0";
  const n = vars.length;
  return "Σ m(" + terms.join(",") + ")";
}
function toPOS(terms, vars){
  if (!terms.length) return "1";
  const n = vars.length;
  return "Π M(" + terms.join(",") + ")";
}

/* ========= Quine–McCluskey (min SOP) ========= */
function bitCount(x){ let c=0; while (x){ x&=x-1; c++; } return c; }
function combine(a, b){
  // a,b are {mask, bits, terms:Set}
  const diff = a.bits ^ b.bits;
  if (bitCount(diff)!==1 || a.mask!==b.mask) return null;
  return {
    mask: a.mask | diff,                // 1 at don't-care position
    bits: a.bits & ~diff,               // 0 at that position
    terms: new Set([...a.terms, ...b.terms]),
    srcs: [a,b]
  };
}
function qmMinimize(minterms, dc, nbits){
  // Based on grouping by ones, iteratively combine to prime implicants
  const dontCares = new Set(dc||[]);
  const all = [...new Set([...minterms, ...dontCares])].sort((a,b)=>a-b);
  if (!all.length) return []; // constant 0
  let groups = new Map(); // ones -> array of implicants
  for (const m of all){
    const imp = { mask:0, bits:m, terms: new Set([m]) };
    const ones = bitCount(m);
    if (!groups.has(ones)) groups.set(ones, []);
groups.get(ones).push(imp);
  }
  let marked = new WeakSet();
  let nextGroups;
  const primes = new Set();

  function addPrime(imp){ primes.add(JSON.stringify({mask:imp.mask,bits:imp.bits})); }

  while (true){
    nextGroups = new Map();
    let any=false;
    const keys = [...groups.keys()].sort((a,b)=>a-b);
    for (let k=0;k<keys.length-1;k++){
      const g1 = groups.get(keys[k])||[], g2 = groups.get(keys[k+1])||[];
      for (const a of g1){
        for (const b of g2){
          const c = combine(a,b);
          if (!c) continue;
          any = true;
          marked.add(a); marked.add(b);
          const ones = bitCount(c.bits);
           if (!nextGroups.has(ones)) nextGroups.set(ones, []);
           nextGroups.get(ones).push(c);
        }
      }
    }
    // any unmarked in current groups are primes
    for (const arr of groups.values()){
      for (const imp of arr){
        if (!marked.has(imp)) addPrime(imp);
      }
    }
    if (!any) break;
    groups = nextGroups; marked = new WeakSet();
  }

  // materialize primes
  const primeImps = [...primes].map(j => JSON.parse(j));
  // Cover minterms (exclude pure DC)
  const coverUniverse = new Set(minterms);
  // Build prime implicant chart
  const covers = primeImps.map(p=>{
    const covered = [];
    for (const m of minterms){
      // check if p covers m: (m & ~mask) === bits
      if ((m & ~p.mask) === p.bits) covered.push(m);
    }
    return { ...p, covered };
  });

  // Essential primes: columns that have only one covering implicant
  const chosen = [];
  const uncovered = new Set(minterms);
  while (true){
    let progress=false;
    for (const m of [...uncovered]){
      const candidates = covers.filter(c => c.covered.includes(m));
      if (candidates.length===1){
        const c = candidates[0];
        chosen.push(c);
        for (const mm of c.covered) uncovered.delete(mm);
        // remove rows covered to avoid re-choosing
        covers.forEach(k => {
          k.covered = k.covered.filter(x => !c.covered.includes(x));
        });
        progress=true;
      }
    }
    if (!progress) break;
  }
  // If still uncovered, greedily pick largest cover
  while (uncovered.size){
    covers.sort((a,b)=>b.covered.length - a.covered.length);
    const pick = covers[0];
    if (!pick || pick.covered.length===0) break; // safety
    chosen.push(pick);
    for (const mm of pick.covered) uncovered.delete(mm);
    covers.forEach(k => {
      k.covered = k.covered.filter(x => !pick.covered.includes(x));
    });
  }

  return chosen; // array of implicants {mask,bits}
}

function implicantsToExpression(imps, vars){
  if (imps.length===0) return "0";
  const n = vars.length;
  const terms = imps.map(p=>{
    // build literal string based on mask/bits; 1 means don't-care
    let lits=[];
    for (let i=0;i<n;i++){
      const bitPos = n-1-i;
      if ( (p.mask>>bitPos) & 1 ) continue;         // don't care
      const val = (p.bits>>bitPos) & 1;
      const v = vars[i];
      lits.push(val ? v : `¬${v}`);
    }
    return lits.length? lits.join("·") : "1";
  });
  return terms.join(" + ");
}

/* ========= K-map helper (2–4 vars) ========= */
function gray(n){ return n ^ (n>>1); }
function kmapGroups(minterms, vars){
  const n = Math.min(vars.length, 4);
  if (n<2) return { n, groups:[], note:"K-map shown for 2–4 variables only." };
  // Basic group suggestions: powers of 2 blocks covering minterms (no don't-cares here)
  // For brevity, we give rectangles in (rowStart,rowSize,colStart,colSize) on Gray order.
  const size = 1<<n;
  // Build a matrix using Gray codes
  const rows = 1<<(Math.floor(n/2));
  const cols = 1<<(n - Math.floor(n/2));
  const grid = Array.from({length:rows},()=>Array(cols).fill(0));
  for (let i=0;i<size;i++){
    if (!minterms.includes(i)) continue;
    // split into row/col gray indices
    const rbits = Math.floor(n/2);
    const row = gray(i>> (n - rbits)) & ((1<<rbits)-1);
    const col = gray(i & ((1<<(n-rbits))-1));
    grid[row][col]=1;
  }
  // Simple greedy grouping (not exhaustive—good enough to draw helpful groups)
  const groups=[];
  function markBlock(r,c,hr,wr){
    for (let i=0;i<hr;i++) for (let j=0;j<wr;j++) grid[(r+i)%rows][(c+j)%cols] = 0;
  }
  const sizes = []; // try 8,4,2,1 cells depending on n
  if (n===4) sizes.push([4,4],[4,2],[2,4],[2,2],[1,4],[4,1],[1,2],[2,1],[1,1]);
  if (n===3) sizes.push([2,2],[1,4],[2,1],[1,2],[1,1]);
  if (n===2) sizes.push([1,2],[2,1],[1,1]);

  for (const [hr,wr] of sizes){
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        // check if all ones in block (with wrap-around)
        let ok=true;
        for (let i=0;i<hr;i++) for (let j=0;j<wr;j++){
          if (grid[(r+i)%rows][(c+j)%cols]!==1){ ok=false; break; }
        }
        if (ok){ groups.push({ r, c, hr, wr }); markBlock(r,c,hr,wr); }
      }
    }
  }
  return { n, rows, cols, groups };
}

/* ========= Endpoints ========= */

app.post("/api/ba/truthtable", (req,res)=>{
  try{
    const { expr, vars:varsIn } = req.body || {};
    if (!expr) return res.status(400).json({ ok:false, error:"expr required" });
    const rpn = toRPN(insertImplicitAnd(tokenize(expr)));
    const vars = (varsIn && varsIn.length)? varsIn : detectVars(rpn);
    const varsSorted = [...vars].sort(); // deterministic
    const tt = truthTable(rpn, varsSorted);
    return res.json({ ok:true, vars: varsSorted, rows: tt });
  }catch(e){
    return res.status(400).json({ ok:false, error:String(e.message||e) });
  }
});

app.post("/api/ba/simplify", (req,res)=>{
  try{
    const { expr, vars:varsIn, dontCares=[] , includeTable=false } = req.body || {};
    if (!expr) return res.status(400).json({ ok:false, error:"expr required" });
    const rpn = toRPN(insertImplicitAnd(tokenize(expr)));
    const vars = (varsIn && varsIn.length)? varsIn : detectVars(rpn);
    const varsSorted = [...vars].sort();
    const tt = truthTable(rpn, varsSorted);
    const mins = mintermsFromTT(tt, varsSorted);
    const maxs = maxtermsFromTT(tt, varsSorted);
    const q = qmMinimize(mins, dontCares, varsSorted.length);
    const simp = implicantsToExpression(q, varsSorted);

    return res.json({
      ok:true,
      vars: varsSorted,
      minterms: mins,
      maxterms: maxs,
      sop: toSOP(mins, varsSorted),
      pos: toPOS(maxs, varsSorted),
      simplifiedSOP: simp,
      steps: { primeImplicants: q },        // minimal step info for UI
      table: includeTable ? tt : undefined,
    });
  }catch(e){
    return res.status(400).json({ ok:false, error:String(e.message||e) });
  }
});

app.post("/api/ba/kmap", (req,res)=>{
  try{
    const { vars, minterms=[] } = req.body || {};
    if (!vars || !vars.length) return res.status(400).json({ ok:false, error:"vars required" });
    const km = kmapGroups(minterms, vars);
    return res.json({ ok:true, ...km });
  }catch(e){
    return res.status(400).json({ ok:false, error:String(e.message||e) });
  }
});

app.listen(PORT, ()=> console.log(`[boolean-runner] listening on :${PORT}`));

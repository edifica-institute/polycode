// ---------- PARSER (drop-in replacement) ----------

const TOK = { OR:'OR', AND:'AND', NOTP:'NOTP', VAR:'VAR', L:'(', R:')', SNOT:'SNOT' };

function normalizeExpr(expr){
  return String(expr||'')
    .replace(/[’‘`´]/g, "'")   // smart quotes → '
    .replace(/[·•⋅]/g, '·')    // various dots → ·
    .replace(/\s+/g, ' ')
    .trim();
}

// Step 1: Tokenize with suffix-quote grouping (A'' = A + SNOT + SNOT)
function tokenizeExpr(s){
  const t = [];
  for (let i=0; i<s.length; ){
    const c = s[i];

    if (/\s/.test(c)){ i++; continue; }
    if (c==='('){ t.push({t:TOK.L}); i++; continue; }
    if (c===')'){ t.push({t:TOK.R}); i++; continue; }

    // Single-char operators
    if (c==='+'){ t.push({t:TOK.OR});  i++; continue; }
    if (c==='·' || c==='*' || c==='&'){ t.push({t:TOK.AND}); i++; continue; }
    if (c==='~'){ t.push({t:TOK.NOTP}); i++; continue; }

    // Word: OR, AND, NOT, or variables (letters)
    if (/[A-Za-z]/.test(c)){
      let j=i, word='';
      while (j<s.length && /[A-Za-z_]/.test(s[j])) word += s[j++];
      const U = word.toUpperCase();
      if (U === 'OR')  { t.push({t:TOK.OR});  i=j; continue; }
      if (U === 'AND') { t.push({t:TOK.AND}); i=j; continue; }
      if (U === 'NOT') { t.push({t:TOK.NOTP}); i=j; continue; }

      // Treat each letter as its own variable (A,B,C...)
      for (const ch of word){
        t.push({t:TOK.VAR, v: ch.toUpperCase()});
        // absorb any following apostrophes as suffix NOTs for THIS var
        let k = j;
        while (k<s.length && s[k]==="'"){ t.push({t:TOK.SNOT}); k++; }
        j = k;
      }
      i = j;
      continue;
    }

    // Lone apostrophe not attached to a var (e.g., after ')') becomes SNOT token
    if (c === "'"){ t.push({t:TOK.SNOT}); i++; continue; }

    throw new Error('Unexpected character: ' + c);
  }
  return t;
}

// Step 2: Inject implicit ANDs between atom-end and atom-start
function injectImplicitAnd(tokens){
  const out = [];
  const isAtomEnd   = tk => tk.t===TOK.VAR || tk.t===TOK.R || tk.t===TOK.SNOT;
  const isAtomStart = tk => tk.t===TOK.VAR || tk.t===TOK.L || tk.t===TOK.NOTP;
  for (let i=0; i<tokens.length; i++){
    const tk = tokens[i];
    if (out.length && isAtomStart(tk) && isAtomEnd(out[out.length-1])){
      out.push({t:TOK.AND});   // implicit AND
    }
    out.push(tk);
  }
  return out;
}

// Step 3: Shunting-yard to postfix.
// Trick: after pushing an atom (VAR or closed ')'), immediately apply pending prefix NOTs.
function toPostfix(tokens){
  const out=[], op=[];
  const prec = t => t===TOK.NOTP ? 3 : t===TOK.AND ? 2 : t===TOK.OR ? 1 : 0;

  const flushPrefixNots = () => {
    while (op.length && op[op.length-1].t===TOK.NOTP){ out.push(op.pop()); }
  };

  for (let i=0;i<tokens.length;i++){
    const tk = tokens[i];

    if (tk.t===TOK.VAR){
      out.push(tk);
      // apply any prefix NOTs that were waiting for this atom
      flushPrefixNots();
      continue;
    }

    if (tk.t===TOK.SNOT){ // suffix NOT becomes a NOT op on output
      out.push({t:TOK.NOTP}); // reuse NOTP as unary NOT in output
      continue;
    }

    if (tk.t===TOK.NOTP){ // prefix NOT
      op.push(tk);
      continue;
    }

    if (tk.t===TOK.L){
      op.push(tk);
      continue;
    }

    if (tk.t===TOK.R){
      while (op.length && op[op.length-1].t!==TOK.L) out.push(op.pop());
      if (!op.length) throw new Error('Mismatched )');
      op.pop(); // pop '('
      // a prefix NOT may be waiting specifically for this parenthesized group
      flushPrefixNots();
      continue;
    }

    if (tk.t===TOK.AND || tk.t===TOK.OR){
      while (op.length){
        const top = op[op.length-1];
        if (top.t===TOK.L) break;
        if (prec(top) >= prec(tk.t)) out.push(op.pop());
        else break;
      }
      op.push(tk);
      continue;
    }

    throw new Error('Bad token stream');
  }

  while (op.length){
    const t = op.pop();
    if (t.t===TOK.L || t.t===TOK.R) throw new Error('Mismatched ()');
    out.push(t);
  }
  return out;
}

// Step 4: Build AST from postfix
function astFromPostfix(pf){
  const st=[];
  for (const tk of pf){
    if (tk.t===TOK.VAR){ st.push({type:'VAR', name:tk.v}); continue; }
    if (tk.t===TOK.NOTP){ const a=st.pop(); if(!a) throw new Error('Invalid expression'); st.push({type:'NOT', a}); continue; }
    if (tk.t===TOK.AND || tk.t===TOK.OR){
      const b=st.pop(), a=st.pop(); if(!a||!b) throw new Error('Invalid expression');
      st.push({type: tk.t===TOK.AND ? 'AND' : 'OR', a, b}); continue;
    }
    throw new Error('Invalid expression');
  }
  if (st.length !== 1) throw new Error('Invalid expression');
  return st[0];
}

// Step 5: Single entry
function parse(expr){
  const clean = normalizeExpr(expr);
  const t1 = tokenizeExpr(clean);
  const t2 = injectImplicitAnd(t1);
  const pf = toPostfix(t2);
  return astFromPostfix(pf);
}

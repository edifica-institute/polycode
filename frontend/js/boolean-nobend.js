/* boolean-nobend.js — draw logic gate diagrams with straight wires (2-bend detours only when needed)
   Ops: + (OR), ·/*/& (AND), postfix ' or prefix ~ / NOT, parentheses, implicit AND (AB == A·B)
   Exact structure (NO algebraic simplification). AND/OR flattened to n-ary gates for neat multi-input shapes.
*/
(() => {
  // ---------------- Parser ----------------
  const TOK = { OR:'OR', AND:'AND', NOTP:'NOTP', VAR:'VAR', L:'(', R:')', SNOT:'SNOT' };

  const norm = (s) => String(s||'')
    .replace(/[’‘`´]/g, "'")        // smart → straight apostrophe
    .replace(/[·•⋅]/g, '·')         // bullets → middle dot
    .replace(/\s+/g, ' ')
    .trim();

  function tokenizeExpr(s){
    const t=[]; let i=0;
    while (i<s.length){
      const c=s[i];
      if (/\s/.test(c)){ i++; continue; }
      if (c==='('){ t.push({t:TOK.L}); i++; continue; }
      if (c===')'){ t.push({t:TOK.R}); i++; continue; }
      if (c==='+'){ t.push({t:TOK.OR}); i++; continue; }
      if (c==='·'||c==='*'||c==='&'){ t.push({t:TOK.AND}); i++; continue; }
      if (c==='~'){ t.push({t:TOK.NOTP}); i++; continue; }
      if (/[A-Za-z]/.test(c)){
        let j=i, w='';
        while (j<s.length && /[A-Za-z_]/.test(s[j])) w+=s[j++];
        const U=w.toUpperCase();
        if (U==='OR'){ t.push({t:TOK.OR}); i=j; continue; }
        if (U==='AND'){ t.push({t:TOK.AND}); i=j; continue; }
        if (U==='NOT'){ t.push({t:TOK.NOTP}); i=j; continue; }
        for (const ch of w){
          t.push({t:TOK.VAR, v:ch.toUpperCase()});
          // swallow postfix apostrophes for this variable (e.g., A'' => NOT NOT A)
          let k=j; while (k<s.length && s[k]==="'"){ t.push({t:TOK.SNOT}); k++; }
          j=k;
        }
        i=j; continue;
      }
      if (c==="'"){ t.push({t:TOK.SNOT}); i++; continue; }
      throw new Error('Unexpected character: '+c);
    }
    return t;
  }

  function injectImplicitAnd(tokens){
    const out=[]; const end=tk=>tk.t===TOK.VAR||tk.t===TOK.R||tk.t===TOK.SNOT;
    const start=tk=>tk.t===TOK.VAR||tk.t===TOK.L||tk.t===TOK.NOTP;
    for (let i=0;i<tokens.length;i++){
      const tk=tokens[i];
      if (out.length && start(tk) && end(out[out.length-1])) out.push({t:TOK.AND});
      out.push(tk);
    }
    return out;
  }

  function toPostfix(tokens){
    const out=[], op=[];
    const prec = t => t===TOK.NOTP?3 : t===TOK.AND?2 : t===TOK.OR?1 : 0;
    const flushN=()=>{ while(op.length && op[op.length-1].t===TOK.NOTP) out.push(op.pop()); };
    for (const tk of tokens){
      if (tk.t===TOK.VAR){ out.push(tk); flushN(); continue; }
      if (tk.t===TOK.SNOT){ out.push({t:TOK.NOTP}); continue; }
      if (tk.t===TOK.NOTP){ op.push(tk); continue; }
      if (tk.t===TOK.L){ op.push(tk); continue; }
      if (tk.t===TOK.R){
        while (op.length && op[op.length-1].t!==TOK.L) out.push(op.pop());
        if (!op.length) throw new Error('Mismatched )');
        op.pop(); flushN(); continue;
      }
      if (tk.t===TOK.AND || tk.t===TOK.OR){
        while (op.length){
          const top=op[op.length-1];
          if (top.t===TOK.L) break;
          if (prec(top)>=prec(tk.t)) out.push(op.pop()); else break;
        }
        op.push(tk); continue;
      }
      throw new Error('Bad token stream');
    }
    while (op.length){
      const t=op.pop(); if (t.t===TOK.L||t.t===TOK.R) throw new Error('Mismatched ()'); out.push(t);
    }
    return out;
  }

  function astFromPostfix(pf){
    const st=[];
    for (const tk of pf){
      if (tk.t===TOK.VAR){ st.push({type:'VAR', name:tk.v}); continue; }
      if (tk.t===TOK.NOTP){ const a=st.pop(); if(!a) throw 'Invalid expression'; st.push({type:'NOT', a}); continue; }
      if (tk.t===TOK.AND || tk.t===TOK.OR){
        const b=st.pop(), a=st.pop(); if(!a||!b) throw 'Invalid expression';
        st.push({type: tk.t===TOK.AND?'AND':'OR', a,b}); continue;
      }
      throw 'Invalid expression';
    }
    if (st.length!==1) throw 'Invalid expression';
    return st[0];
  }

  // Flatten associative AND/OR to n-ary nodes (no algebraic simplification).
  function assocify(node){
    if (!node) return node;
    if (node.type==='VAR') return node;
    if (node.type==='NOT'){ node.a = assocify(node.a); return node; }
    if (node.type==='AND' || node.type==='OR'){
      const kind=node.type, inputs=[];
      (function collect(n){
        n = assocify(n);
        if (n.type===kind){
          const kids = n.inputs || [n.a, n.b];
          kids.forEach(collect);
        } else { inputs.push(n); }
      })(node);
      return { type:kind, inputs };
    }
    return node;
  }

  function parse(expr){
    const t1 = tokenizeExpr(norm(expr));
    const t2 = injectImplicitAnd(t1);
    const pf = toPostfix(t2);
    return assocify(astFromPostfix(pf));
  }

  // ---------------- Layout ----------------
  function depth(n){
    if (n.type==='VAR') return 0;
    if (n.type==='NOT') return 1 + depth(n.a);
    if (n.type==='AND' || n.type==='OR'){
      const kids = n.inputs || [n.a, n.b];
      return 1 + Math.max(...kids.map(depth));
    }
    return 0;
  }

  function collectVars(ast){
    const set=new Set(), list=[];
    (function walk(n){
      if (!n) return;
      if (n.type==='VAR'){ if(!set.has(n.name)){ set.add(n.name); list.push(n.name);} return; }
      if (n.type==='NOT') walk(n.a);
      else (n.inputs || [n.a,n.b]).forEach(walk);
    })(ast);
    list.sort();
    return list;
  }

  function layout(ast){
    const xStep=170, margin=70, yStart=80, yGap=52;
    const vars=collectVars(ast);
    const varY = new Map(vars.map((v,i)=>[v, yStart+i*yGap]));
    const maxD = depth(ast);

    (function place(n, d){
      n.depth = (n.type==='VAR'?0:d);
      if (n.type==='VAR'){ n.x = margin; n.y = varY.get(n.name); return; }
      if (n.type==='NOT'){ place(n.a, d-1); n.x = margin + d*xStep; n.y = n.a.y; return; }
      const kids = n.inputs || [];
      kids.forEach(k => place(k, d-1));
      n.x = margin + d*xStep;
      n.y = kids.length ? (kids.reduce((s,k)=>s+k.y,0)/kids.length) : (yStart);
    })(ast, maxD);

    return {maxD, xStep, margin, yStart, yGap, varY};
  }

  // ---------------- Geometry & routing ----------------
  function gateBox(n){
    if (n.type==='VAR') return null;
    if (n.type==='NOT') return {x1:n.x-22, y1:n.y-22, x2:n.x+30, y2:n.y+22};
    const k = (n.inputs ? n.inputs.length : 2);
    const step = 28, h = Math.max(step*(k-1)+50, 50);
    if (n.type==='AND') return {x1:n.x-22, y1:n.y-h/2, x2:n.x+62, y2:n.y+h/2};
    if (n.type==='OR'){
      const xL = n.x - 12, xR = n.x + 70;
      return {x1:xL, y1:n.y - h/2 - 6, x2:xR, y2:n.y + h/2 + 6};
    }
  }

  function intersectsH(y, x1, x2, box){
    if (!box) return false;
    const lo=Math.min(x1,x2), hi=Math.max(x1,x2);
    return (y>=box.y1 && y<=box.y2) && !(hi<=box.x1 || lo>=box.x2);
  }

  // Straight segment unless it would hit a gate; then 2-bend detour (under the obstacle).
  function routeSegment(p1, p2, boxes){
    if (p1.y === p2.y){
      const hits = boxes.filter(b => intersectsH(p1.y, p1.x, p2.x, b));
      if (!hits.length) return {type:'line', pts:[p1.x,p1.y,p2.x,p2.y]};
      const pad=20;
      const detourY = Math.max(...hits.map(b=>b.y2)) + pad;
      const detourX = Math.min(p2.x-20, Math.max(...hits.map(b=>b.x2))+pad);
      return {type:'poly', pts:[p1.x,p1.y, detourX,p1.y, detourX,detourY, p2.x,detourY, p2.x,p2.y]};
    }
    // vertical join: go to a safe X near target, then up/down, then into target
    const pad=18, detourX = p2.x - pad;
    return {type:'poly', pts:[p1.x,p1.y, detourX,p1.y, detourX,p2.y, p2.x,p2.y]};
  }

  function ports(n){
    if (n.type==='VAR') return { out:{x:n.x+12, y:n.y} };
    if (n.type==='NOT') return { in1:{x:n.x-20,y:n.y}, out:{x:n.x+28,y:n.y} };

    const k = (n.inputs ? n.inputs.length : 2);
    const step = 28;
    const topY = n.y - step*(k-1)/2;

    if (n.type==='AND'){
      const ins = {};
      for (let i=0;i<k;i++) ins['in'+i] = {x:n.x-22, y: topY + i*step};
      return Object.assign(ins, { out:{x:n.x+62, y:n.y} });
    }
    if (n.type==='OR'){
      // Flat left wall at xL, output at nose tip xR
      const xL = n.x - 12, xR = n.x + 70;
      const ins = {};
      for (let i=0;i<k;i++) ins['in'+i] = {x:xL, y: topY + i*step};
      return Object.assign(ins, { out:{x:xR, y:n.y} });
    }
  }

  // ---------------- Render ----------------
  function renderNoBend(expr, mount){
    const el = (typeof mount==='string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('Mount element not found');

    const ast = parse(expr);
    const L = layout(ast);

    // collect gate boxes
    const boxes=[];
    (function collect(n){
      if (!n) return;
      if (n.type!=='VAR'){ const b=gateBox(n); if (b) boxes.push(b); }
      if (n.type==='NOT') collect(n.a);
      else (n.inputs||[n.a,n.b]).forEach(collect);
    })(ast);

    const W = (L.margin + (L.maxD+1)*L.xStep + 220);
    const H = Math.max(L.yStart + (L.varY.size||1)*L.yGap + 100, 260);

    const NS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    svg.setAttribute('width','100%');
    svg.setAttribute('height',`${H}px`);
    svg.style.background='#0b0f13';
    svg.style.borderRadius='12px';

    const style=document.createElementNS(NS,'style');
    style.textContent = `
      .gate{ fill:#1e2024; stroke:#9ecbff; stroke-width:2 }
      .wire{ stroke:#e9edf3; stroke-width:2; fill:none; stroke-linecap:butt } /* exact wire ends */
      .node{ fill:#e9edf3 }
      .pin { fill:#9ecbff; font:600 14px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif }
      .label{ fill:#b8c1cd; font:12px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif }
    `;
    svg.appendChild(style);

    // Inputs (labels + pins)
    const vars = Array.from(L.varY.keys()).sort();
    vars.forEach(v=>{
      const y=L.varY.get(v), pinX=34;
      const t=document.createElementNS(NS,'text'); t.setAttribute('x','18'); t.setAttribute('y', y+4); t.setAttribute('class','pin'); t.textContent=v; svg.appendChild(t);
      const c=document.createElementNS(NS,'circle'); c.setAttribute('class','node'); c.setAttribute('cx', pinX); c.setAttribute('cy', y); c.setAttribute('r','3'); svg.appendChild(c);
    });

    // Gate drawing
    function drawGate(n){
      if (n.type==='VAR') return;

      if (n.type==='NOT'){
        const p=document.createElementNS(NS,'path');
        p.setAttribute('class','gate');
        p.setAttribute('d', `M ${n.x-20} ${n.y-20} L ${n.x-20} ${n.y+20} L ${n.x+20} ${n.y} Z`);
        svg.appendChild(p);
        const bub=document.createElementNS(NS,'circle');
        bub.setAttribute('class','gate'); bub.setAttribute('cx', n.x+28); bub.setAttribute('cy', n.y); bub.setAttribute('r','6'); bub.setAttribute('fill','#0b0f13'); svg.appendChild(bub);
        const lbl=document.createElementNS(NS,'text'); lbl.setAttribute('class','label'); lbl.setAttribute('x', n.x-10); lbl.setAttribute('y', n.y-26); lbl.textContent='NOT'; svg.appendChild(lbl);
        drawGate(n.a); return;
      }

      const kids = n.inputs || [n.a,n.b];
      const k = kids.length || 2;
      const step = 28;
      const h = Math.max(step*(k-1)+50, 50);
      const top = n.y - h/2, bot = n.y + h/2;

      const path=document.createElementNS(NS,'path');
      path.setAttribute('class','gate');

      if (n.type==='AND'){
        path.setAttribute('d',
          `M ${n.x-22} ${top}
           L ${n.x+20} ${top}
           C ${n.x+65} ${top}, ${n.x+65} ${bot}, ${n.x+20} ${bot}
           L ${n.x-22} ${bot} Z`);
      }else{ // OR with flat left wall at xL and nose to the right
        const xL = n.x - 12;
        path.setAttribute('d',
          `M ${xL} ${top}
           C ${n.x+18} ${top}, ${n.x+48} ${top}, ${n.x+66} ${top+15}
           C ${n.x+84} ${n.y},   ${n.x+84} ${n.y+30}, ${n.x+66} ${bot+5}
           C ${n.x+48} ${bot+20}, ${n.x+18} ${bot+20}, ${xL} ${bot}
           L ${xL} ${top} Z`);
      }
      svg.appendChild(path);

      const lbl=document.createElementNS(NS,'text');
      lbl.setAttribute('class','label'); lbl.setAttribute('x', n.x-6); lbl.setAttribute('y', top-6); lbl.textContent=n.type;
      svg.appendChild(lbl);

      kids.forEach(drawGate);
    }
    drawGate(ast);

    // Wiring
    function drawWireSeg(p1, p2){
      const r = routeSegment(p1, p2, boxes);
      if (r.type==='line'){
        const ln=document.createElementNS(NS,'line'); ln.setAttribute('class','wire');
        ln.setAttribute('x1', r.pts[0]); ln.setAttribute('y1', r.pts[1]); ln.setAttribute('x2', r.pts[2]); ln.setAttribute('y2', r.pts[3]); svg.appendChild(ln);
      } else {
        const pl=document.createElementNS(NS,'polyline'); pl.setAttribute('class','wire');
        pl.setAttribute('points', r.pts.join(' ')); svg.appendChild(pl);
      }
    }

    (function wire(n){
      if (n.type==='VAR') return;

      if (n.type==='NOT'){
        const p = ports(n), a = ports(n.a);
        drawWireSeg(a.out, p.in1);
        wire(n.a); return;
      }

      const ps = ports(n);
      const kids = n.inputs || [n.a,n.b];
      kids.forEach((kid, i) => {
        const pk = ports(kid);
        drawWireSeg(pk.out, ps['in'+i]);
        wire(kid);
      });
    })(ast);

    // output wire to Y
    const rootOut = ports(ast).out;
    drawWireSeg(rootOut, {x: W-140, y: rootOut.y});
    const ypin=document.createElementNS(NS,'circle'); ypin.setAttribute('class','node');
    ypin.setAttribute('cx', W-140); ypin.setAttribute('cy', rootOut.y); ypin.setAttribute('r','3'); svg.appendChild(ypin);
    const ylbl=document.createElementNS(NS,'text'); ylbl.setAttribute('class','pin'); ylbl.setAttribute('x', W-130); ylbl.setAttribute('y', rootOut.y+4); ylbl.textContent='Y'; svg.appendChild(ylbl);

    // input wires from pins → first var node
    const pinX=34, varX=L.margin;
    Array.from(L.varY.entries()).forEach(([v, y])=>{
      drawWireSeg({x:pinX, y}, {x:varX, y});
    });

    el.innerHTML=''; el.appendChild(svg);
    return svg;
  }

  // expose
  window.renderNoBend = renderNoBend;
})();

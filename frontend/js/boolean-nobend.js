(() => {
  // =============== Parser (implicit AND + suffix NOT) ===============
  const TOK = { OR:'OR', AND:'AND', NOTP:'NOTP', VAR:'VAR', L:'(', R:')', SNOT:'SNOT' };

  function normalizeExpr(s){
    return String(s||'')
      .replace(/[’‘`´]/g, "'")
      .replace(/[·•⋅]/g, '·')
      .replace(/\s+/g, ' ')
      .trim();
  }

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
        let j=i, word=''; while (j<s.length && /[A-Za-z_]/.test(s[j])) word+=s[j++];
        const U=word.toUpperCase();
        if (U==='OR'){ t.push({t:TOK.OR}); i=j; continue; }
        if (U==='AND'){ t.push({t:TOK.AND}); i=j; continue; }
        if (U==='NOT'){ t.push({t:TOK.NOTP}); i=j; continue; }
        for (const ch of word){
          t.push({t:TOK.VAR, v:ch.toUpperCase()});
          // absorb any immediate apostrophes for this var
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
    const out=[]; const end = tk=>tk.t===TOK.VAR||tk.t===TOK.R||tk.t===TOK.SNOT;
    const start = tk=>tk.t===TOK.VAR||tk.t===TOK.L||tk.t===TOK.NOTP;
    for (let i=0;i<tokens.length;i++){
      const tk=tokens[i];
      if (out.length && start(tk) && end(out[out.length-1])) out.push({t:TOK.AND});
      out.push(tk);
    }
    return out;
  }

  function toPostfix(tokens){
    const out=[], op=[];
    const prec = t => t===TOK.NOTP?3: t===TOK.AND?2: t===TOK.OR?1:0;
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

  function parse(expr){
    const t1 = tokenizeExpr(normalizeExpr(expr));
    const t2 = injectImplicitAnd(t1);
    return astFromPostfix(toPostfix(t2));
  }

  // =============== Layout (columns by depth, rows by variables) ===============
  function depth(n){ return n.type==='VAR'?0 : n.type==='NOT'?1+depth(n.a) : 1+Math.max(depth(n.a), depth(n.b)); }

  function collectVars(ast){
    const set=new Set(), list=[];
    (function walk(n){
      if (!n) return;
      if (n.type==='VAR'){ if(!set.has(n.name)){ set.add(n.name); list.push(n.name);} return; }
      if (n.type==='NOT') walk(n.a); else { walk(n.a); walk(n.b); }
    })(ast);
    list.sort(); return list;
  }

  function layout(ast){
    const xStep=160, margin=50, yStart=80, yGap=50;
    const vars=collectVars(ast);
    const varY = new Map(vars.map((v,i)=>[v, yStart+i*yGap]));
    const maxD = depth(ast);

    (function place(n, d){
      n.depth = (n.type==='VAR'?0:d);
      if (n.type==='VAR'){ n.x = margin; n.y = varY.get(n.name); return; }
      if (n.type==='NOT'){ place(n.a, d-1); n.x = margin + d*xStep; n.y = n.a.y; return; }
      place(n.a, d-1); place(n.b, d-1);
      n.x = margin + d*xStep; n.y = (n.a.y + n.b.y)/2;
    })(ast, maxD);

    return {maxD, xStep, margin, yStart, yGap, varY};
  }

  // =============== Gate geometry & collision helpers ===============
  function gateBox(n){
    // approximate bounding boxes for collision avoidance
    if (n.type==='VAR') return null;
    if (n.type==='NOT') return {x1:n.x-20, y1:n.y-20, x2:n.x+26, y2:n.y+20}; // triangle + bubble(r=6)
    if (n.type==='AND') return {x1:n.x-20, y1:n.y-25, x2:n.x+60, y2:n.y+25};
    if (n.type==='OR')  return {x1:n.x-10, y1:n.y-30, x2:n.x+70, y2:n.y+45};
  }

  function intersectsH(y, x1, x2, box){
    if (!box) return false;
    const lo=Math.min(x1,x2), hi=Math.max(x1,x2);
    return (y>=box.y1 && y<=box.y2) && !(hi<=box.x1 || lo>=box.x2);
  }

  // route with 0 bends; if blocked, do a 2-bend detour (down by default).
  function routeSegment(p1, p2, boxes){
    if (p1.y === p2.y){
      const hits = boxes.filter(b => intersectsH(p1.y, p1.x, p2.x, b));
      if (!hits.length) return {type:'line', points:[p1.x,p1.y,p2.x,p2.y]};
      const pad=20;
      const detourY = Math.max(...hits.map(b=>b.y2)) + pad;
      const detourX = Math.min(p2.x-20, Math.max(...hits.map(b=>b.x2))+pad);
      return {type:'poly', pts:[p1.x,p1.y, detourX,p1.y, detourX,detourY, p2.x,detourY, p2.x,p2.y]};
    }
    // L-shape: go to a safe X then up/down, then into target
    const pad=20, detourX = p2.x - pad;
    return {type:'poly', pts:[p1.x,p1.y, detourX,p1.y, detourX,p2.y, p2.x,p2.y]};
  }

  // get ports (exact join points) in world coords
  function ports(n){
    if (n.type==='VAR') return {out:{x:n.x+10, y:n.y}};
    if (n.type==='NOT') return {
      in1:{x:n.x-20, y:n.y},
      out:{x:n.x+26, y:n.y} // bubble center = x+6, r=6 → right edge = x+12? but body extends; keep safe 26 matches box
    };
    if (n.type==='AND') return {
      in1:{x:n.x-20, y:n.y-14}, in2:{x:n.x-20, y:n.y+14}, out:{x:n.x+60, y:n.y}
    };
    if (n.type==='OR') return {
      in1:{x:n.x-10, y:n.y-20}, in2:{x:n.x-10, y:n.y+20}, out:{x:n.x+70, y:n.y+7}
    };
  }

  // =============== Render ===============
  function renderNoBend(expr, mount, opts={}){
    const el = (typeof mount==='string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('Mount element not found');

    const ast = parse(expr);
    const L = layout(ast);

    // collect all gate boxes after layout
    const boxes=[];
    (function collect(n){
      if (!n) return;
      if (n.type!=='VAR'){ const b=gateBox(n); if (b) boxes.push(Object.assign({id:Math.random()}, b)); }
      if (n.type==='NOT') collect(n.a); else if (n.type==='AND'||n.type==='OR'){ collect(n.a); collect(n.b); }
    })(ast);

    const W = (L.margin + (L.maxD+1)*L.xStep + 180);
    const H = Math.max(L.yStart + L.varY.size * L.yGap + 80, 260);

    const svgNS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(svgNS,'svg');
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    svg.setAttribute('width','100%');
    svg.setAttribute('height',`${H}px`);
    svg.style.background = '#0b0f13';
    svg.style.borderRadius = '12px';

    const style=document.createElementNS(svgNS,'style');
    style.textContent = `
      .gate{ fill:#1e2024; stroke:#9ecbff; stroke-width:2 }
      .wire{ stroke:#e9edf3; stroke-width:2; fill:none; stroke-linecap:round }
      .node{ fill:#e9edf3 }
      .pin { fill:#9ecbff; font:600 14px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif }
      .label{ fill:#b8c1cd; font:12px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif }
    `;
    svg.appendChild(style);

    // draw input pins/labels for all variables
    const vars = Array.from(L.varY.keys()).sort();
    vars.forEach(v=>{
      const y=L.varY.get(v), x=30;
      const t=document.createElementNS(svgNS,'text'); t.setAttribute('x','18'); t.setAttribute('y', y+4); t.setAttribute('class','pin'); t.textContent=v; svg.appendChild(t);
      const c=document.createElementNS(svgNS,'circle'); c.setAttribute('class','node'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r','3'); svg.appendChild(c);
    });

    // --- Draw all gates first (so wires can route around their boxes) ---
    function drawGate(n){
      if (n.type==='VAR') return;
      if (n.type==='NOT'){
        const p=document.createElementNS(svgNS,'path');
        p.setAttribute('class','gate'); p.setAttribute('d', `M ${n.x-20} ${n.y-20} L ${n.x-20} ${n.y+20} L ${n.x+20} ${n.y} Z`);
        svg.appendChild(p);
        const bub=document.createElementNS(svgNS,'circle');
        bub.setAttribute('class','gate'); bub.setAttribute('cx', n.x+26); bub.setAttribute('cy', n.y); bub.setAttribute('r','6'); bub.setAttribute('fill','#0b0f13'); svg.appendChild(bub);
        const lbl=document.createElementNS(svgNS,'text'); lbl.setAttribute('class','label'); lbl.setAttribute('x', n.x-12); lbl.setAttribute('y', n.y-26); lbl.textContent='NOT'; svg.appendChild(lbl);
        drawGate(n.a); return;
      }
      if (n.type==='AND'){
        const p=document.createElementNS(svgNS,'path');
        p.setAttribute('class','gate');
        p.setAttribute('d', `M ${n.x-20} ${n.y-25} L ${n.x+20} ${n.y-25} C ${n.x+65} ${n.y-25}, ${n.x+65} ${n.y+25}, ${n.x+20} ${n.y+25} L ${n.x-20} ${n.y+25} Z`);
        svg.appendChild(p);
        const lbl=document.createElementNS(svgNS,'text'); lbl.setAttribute('class','label'); lbl.setAttribute('x', n.x-4); lbl.setAttribute('y', n.y-31); lbl.textContent='AND'; svg.appendChild(lbl);
        drawGate(n.a); drawGate(n.b); return;
      }
      if (n.type==='OR'){
        const p=document.createElementNS(svgNS,'path');
        p.setAttribute('class','gate');
        p.setAttribute('d', `M ${n.x-10} ${n.y-30}
                             C ${n.x+15} ${n.y-30}, ${n.x+50} ${n.y-30}, ${n.x+70} ${n.y-15}
                             C ${n.x+90} ${n.y},    ${n.x+90} ${n.y+30}, ${n.x+70} ${n.y+45}
                             C ${n.x+50} ${n.y+60}, ${n.x+15} ${n.y+60}, ${n.x-10} ${n.y+60}
                             C ${n.x+15} ${n.y+30}, ${n.x+15} ${n.y},   ${n.x-10} ${n.y-30} Z`);
        svg.appendChild(p);
        const lbl=document.createElementNS(svgNS,'text'); lbl.setAttribute('class','label'); lbl.setAttribute('x', n.x+4); lbl.setAttribute('y', n.y-36); lbl.textContent='OR'; svg.appendChild(lbl);
        drawGate(n.a); drawGate(n.b); return;
      }
    }
    drawGate(ast);

    // --- Wire routing (no bends unless needed) ---
    const allBoxes = boxes.slice(); // shallow copy
    function drawWire(p1, p2){
      const r = routeSegment(p1, p2, allBoxes);
      if (r.type==='line'){
        const ln=document.createElementNS(svgNS,'line'); ln.setAttribute('class','wire');
        ln.setAttribute('x1', r.points[0]); ln.setAttribute('y1', r.points[1]);
        ln.setAttribute('x2', r.points[2]); ln.setAttribute('y2', r.points[3]); svg.appendChild(ln);
      }else{
        const pl=document.createElementNS(svgNS,'polyline'); pl.setAttribute('class','wire');
        pl.setAttribute('points', r.pts.join(' ')); svg.appendChild(pl);
      }
    }

    // helper to wire a gate and recurse
    (function wire(n){
      if (n.type==='VAR') return;
      if (n.type==='NOT'){
        const p = ports(n), a = ports(n.a);
        drawWire(a.out, p.in1); wire(n.a); return;
      }
      const p = ports(n);
      const a = ports(n.a), b = ports(n.b);
      drawWire(a.out, p.in1);
      drawWire(b.out, p.in2);
      wire(n.a); wire(n.b);
    })(ast);

    // draw inputs out to their first consumer (already done via recursion).
    // draw final output to Y pin
    const rootOut = ports(ast).out;
    // output label/pin
    drawWire(rootOut, {x: W-120, y: rootOut.y});
    const ypin=document.createElementNS(svgNS,'circle'); ypin.setAttribute('class','node');
    ypin.setAttribute('cx', W-120); ypin.setAttribute('cy', rootOut.y); ypin.setAttribute('r','3'); svg.appendChild(ypin);
    const ylbl=document.createElementNS(svgNS,'text'); ylbl.setAttribute('class','pin');
    ylbl.setAttribute('x', W-110); ylbl.setAttribute('y', rootOut.y+4); ylbl.textContent='Y'; svg.appendChild(ylbl);

    // input pins already drawn; add from pin to var node
    vars.forEach(v=>{
      const y=L.varY.get(v);
      const wireStart={x:40,y}, varPort={x: L.margin, y};
      drawWire(wireStart, varPort);
    });

    el.innerHTML=''; el.appendChild(svg);
    return svg;
  }

  // expose
  window.renderNoBend = renderNoBend;
})();

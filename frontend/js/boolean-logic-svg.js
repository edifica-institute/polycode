(() => {
  // ======== Tiny Boolean -> SVG renderer for Polycode ========
  // API: drawLogic(expr, mountElOrSelector, opts?)
  // opts: { width, height, palette }

  const TOK = { OR:'OR', AND:'AND', NOT:'NOT', VAR:'VAR', L:'(', R:')' };
  const isSpace = c => /\s/.test(c);
  const isVar = c => /^[A-Za-z]$/.test(c);

  function tokenize(s){
    const out=[];
    for (let i=0;i<s.length;){
      const c=s[i];
      if (isSpace(c)){ i++; continue; }
      if (c==='('){ out.push({t:TOK.L}); i++; continue; }
      if (c===')'){ out.push({t:TOK.R}); i++; continue; }
      if (c==='+' ){ out.push({t:TOK.OR}); i++; continue; }
      if (c==='·' || c==='*' || c==='&'){ out.push({t:TOK.AND}); i++; continue; }
      if (c==="'" ){ out.push({t:TOK.NOT, suffix:true}); i++; continue; }
      if (c==='~'){ out.push({t:TOK.NOT, prefix:true}); i++; continue; }
      if (/^[A-Za-z]/.test(c)){
        let j=i, word='';
        while (j<s.length && /[A-Za-z_]/.test(s[j])) word+=s[j++];
        const u=word.toUpperCase();
        if (u==='OR'){ out.push({t:TOK.OR}); i=j; continue; }
        if (u==='AND'){ out.push({t:TOK.AND}); i=j; continue; }
        if (u==='NOT'){ out.push({t:TOK.NOT, prefix:true}); i=j; continue; }
        for (const ch of word) out.push({t:TOK.VAR, v:ch.toUpperCase()});
        i=j; continue;
      }
      throw new Error(`Unexpected character: ${c}`);
    }
    return out;
  }


  // Shunting-yard: support prefix/suffix NOT
  function toPostfix(tokens){
    const out=[], op=[];
    const prec = (t)=> t===TOK.NOT ? 3 : (t===TOK.AND ? 2 : (t===TOK.OR ? 1 : 0));
    const rightAssoc = (t)=> t===TOK.NOT;

    // Convert suffix NOT markers by wrapping the previous atom
    // We'll insert a marker object {t:TOK.NOT} after the atom when we see suffix flag
    const expanded=[];
    for (let i=0;i<tokens.length;i++){
      const tk=tokens[i];
      if (tk.t===TOK.NOT && tk.suffix){
        expanded.push({t:'SUFFIX_NOT'}); // placeholder handled below
      } else expanded.push(tk);
    }

    // Walk with a small stack to apply SUFFIX_NOT after previous output push
    // We'll push tokens but remember positions to inject NOT later (simpler: post-pass).
    const injectAfterIndices=[];
    for (let i=0;i<expanded.length;i++){
      const tk=expanded[i];
      if (tk.t===TOK.VAR){ out.push(tk); continue; }
      if (tk.t===TOK.NOT && tk.prefix){ op.push(tk); continue; }
      if (tk.t==='SUFFIX_NOT'){ out.push({t:TOK.NOT}); continue; }
      if (tk.t===TOK.L){ op.push(tk); continue; }
      if (tk.t===TOK.R){
        while (op.length && op[op.length-1].t!==TOK.L) out.push(op.pop());
        if (!op.length) throw new Error('Mismatched )');
        op.pop(); // pop '('
        // if a NOT is on top (prefix applied to parenthesized expr)
        if (op.length && op[op.length-1].t===TOK.NOT && op[op.length-1].prefix){
          out.push(op.pop());
        }
        continue;
      }
      if (tk.t===TOK.AND || tk.t===TOK.OR || (tk.t===TOK.NOT && tk.prefix)){
        while (op.length){
          const top=op[op.length-1];
          if (top.t===TOK.L) break;
          if (prec(top.t)>prec(tk.t) || (prec(top.t)===prec(tk.t) && !rightAssoc(tk.t)))
            out.push(op.pop());
          else break;
        }
        op.push(tk);
        continue;
      }
      throw new Error('Bad token sequence.');
    }
    while (op.length){
      const t=op.pop();
      if (t.t===TOK.L||t.t===TOK.R) throw new Error('Mismatched ()');
      out.push(t);
    }
    return out;
  }

  // Build AST from postfix
  function astFromPostfix(pf){
    const st=[];
    for (const tk of pf){
      if (tk.t===TOK.VAR){ st.push({type:'VAR', name:tk.v}); continue; }
      if (tk.t===TOK.NOT){ const a=st.pop(); st.push({type:'NOT', a}); continue; }
      if (tk.t===TOK.AND || tk.t===TOK.OR){
        const b=st.pop(), a=st.pop();
        st.push({type: tk.t===TOK.AND ? 'AND' : 'OR', a,b});
        continue;
      }
      throw new Error('Postfix error');
    }
    if (st.length!==1) throw new Error('Invalid expression');
    return st[0];
  }

  // Layout: assign x by depth, y by in-order traversal with spacing
  function layout(node){
    const levels=[];
    function depth(n){ if (!n) return 0; if (n.type==='VAR') return 0; if (n.type==='NOT') return 1+depth(n.a); return 1+Math.max(depth(n.a),depth(n.b)); }
    const maxD = depth(node);
    const xStep=160, yStep=70, margin=40;

    let yCursor=0;
    function traverse(n, d){
      n.depth = (n.type==='VAR'?0:d);
      if (n.type==='VAR'){ n.y = yCursor++ * yStep + margin; n.x = n.depth * xStep + margin; return; }
      if (n.type==='NOT'){
        traverse(n.a, d-1);
        n.y = n.a.y; n.x = d*xStep + margin;
        return;
      }
      traverse(n.a, d-1);
      traverse(n.b, d-1);
      n.y = (n.a.y + n.b.y)/2; n.x = d*xStep + margin;
    }
    traverse(node, maxD);
    return {maxD, xStep, yStep, margin};
  }

  // Collect unique variables in left-to-right order
  function collectVars(ast){
    const set=new Set(), list=[];
    (function walk(n){
      if (!n) return;
      if (n.type==='VAR'){ if (!set.has(n.name)){ set.add(n.name); list.push(n.name);} return; }
      if (n.type==='NOT'){ walk(n.a); return; }
      walk(n.a); walk(n.b);
    })(ast);
    list.sort(); // A,B,C...
    return list;
  }

  // Draw SVG
  function renderSVG(ast, opts={}){
    const W = +opts.width  || 800;
    const H = +opts.height || 300;

    // read theme tokens or fallback
    const css = getComputedStyle(document.documentElement);
    const col = k => css.getPropertyValue(k).trim();
    const palette = Object.assign({
      bg:   col('--bg')||'#0b0f13',
      panel:col('--panel')||'#1e2024',
      wire: '#e9edf3',
      gate: '#9ecbff',
      text: col('--text')||'#e9edf3',
      pin:  col('--link')||'#9ecbff'
    }, opts.palette||{});

    layout(ast);
    const vars=collectVars(ast);
    // re-pin variables evenly on the left (nice rows)
    vars.forEach((v,i)=>{
      (function setVar(n){
        if (!n) return;
        if (n.type==='VAR' && n.name===v){ n.x = 50; n.y = 80 + i*50; }
        else if (n.type==='NOT') setVar(n.a);
        else if (n.type==='AND' || n.type==='OR'){ setVar(n.a); setVar(n.b); }
      })(ast);
    });

    // Utility: elbow polyline from (x1,y1) to (x2,y2)
    const elbow = (x1,y1,x2,y2, midx=null) => {
      const m = midx ?? ((x1+x2)/2|0);
      return `${x1},${y1} ${m},${y1} ${m},${y2} ${x2},${y2}`;
    };

    // Gate box widths/heights
    const gw = 80, gh = 50, r=10;

    // Assign port coordinates (center-right/left)
    function ports(n){
      if (n.type==='VAR') return {out:{x:n.x+10,y:n.y}};
      if (n.type==='NOT') return {
        in1:{x:n.x-10, y:n.y},
        out:{x:n.x+40, y:n.y}
      };
      if (n.type==='AND' || n.type==='OR') return {
        in1:{x:n.x-10, y:n.y-14},
        in2:{x:n.x-10, y:n.y+14},
        out:{x:n.x+60, y:n.y}
      };
    }

    const wires=[];
    (function wireUp(n){
      if (n.type==='VAR') return;
      if (n.type==='NOT'){
        const p = ports(n), a=ports(n.a);
        wires.push(elbow(a.out.x, a.out.y, p.in1.x, p.in1.y));
        wireUp(n.a);
        return;
      }
      const p=ports(n), a=ports(n.a), b=ports(n.b);
      wires.push(elbow(a.out.x, a.out.y, p.in1.x, p.in1.y));
      wires.push(elbow(b.out.x, b.out.y, p.in2.x, p.in2.y));
      wireUp(n.a); wireUp(n.b);
    })(ast);

    const rootPorts = ports(ast);
    const outX = rootPorts.out.x, outY = rootPorts.out.y;

    // Build SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width','100%');
    svg.setAttribute('height', `${H}px`);
    svg.style.background = palette.bg;
    svg.style.borderRadius='12px';

    // defs: base styles
    const style = document.createElementNS(svg.namespaceURI,'style');
    style.textContent = `
      .gate{ fill:${palette.panel}; stroke:${palette.gate}; stroke-width:2 }
      .wire{ fill:none; stroke:${palette.wire}; stroke-width:2 }
      .node{ fill:${palette.wire} }
      .label{ fill:${palette.text}; font:14px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif }
      .pin  { fill:${palette.pin};  font:600 14px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif }
      .title{ fill:${palette.pin};  font:600 16px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif }
    `;
    svg.appendChild(style);

    // Title
    const title=document.createElementNS(svg.namespaceURI,'text');
    title.setAttribute('x','24'); title.setAttribute('y','26');
    title.setAttribute('class','title');
    title.textContent='Logic Diagram';
    svg.appendChild(title);

    // Draw wires first
    for (const pts of wires){
      const pl=document.createElementNS(svg.namespaceURI,'polyline');
      pl.setAttribute('class','wire');
      pl.setAttribute('points', pts);
      svg.appendChild(pl);
    }

    // Draw nodes (variables as small pins & labels)
    vars.forEach((name,i)=>{
      const y=80+i*50, x=30;
      const text=document.createElementNS(svg.namespaceURI,'text');
      text.setAttribute('x','20'); text.setAttribute('y',y+5);
      text.setAttribute('class','pin'); text.textContent=name;
      svg.appendChild(text);

      const pin=document.createElementNS(svg.namespaceURI,'circle');
      pin.setAttribute('class','node'); pin.setAttribute('cx', x); pin.setAttribute('cy', y);
      pin.setAttribute('r','3'); svg.appendChild(pin);
    });

    // Draw gates recursively (over wires)
    (function draw(n){
      if (n.type==='VAR') return;
      if (n.type==='NOT'){
        // Triangle + bubble
        const tri = document.createElementNS(svg.namespaceURI,'path');
        tri.setAttribute('class','gate');
        tri.setAttribute('d', `M ${n.x-20} ${n.y-20} L ${n.x-20} ${n.y+20} L ${n.x+18} ${n.y} Z`);
        svg.appendChild(tri);
        const bub=document.createElementNS(svg.namespaceURI,'circle');
        bub.setAttribute('class','gate');
        bub.setAttribute('cx', n.x+24); bub.setAttribute('cy', n.y); bub.setAttribute('r','6');
        bub.setAttribute('fill', palette.bg);
        svg.appendChild(bub);
        // label
        const t=document.createElementNS(svg.namespaceURI,'text');
        t.setAttribute('class','label'); t.setAttribute('x', n.x-22); t.setAttribute('y', n.y-28);
        t.textContent='NOT'; svg.appendChild(t);
        draw(n.a); return;
      }
      // AND/OR capsules
      const body=document.createElementNS(svg.namespaceURI,'path');
      body.setAttribute('class','gate');
      if (n.type==='AND'){
        body.setAttribute('d', `M ${n.x-20} ${n.y-25} L ${n.x+20} ${n.y-25} 
                                C ${n.x+55} ${n.y-25}, ${n.x+55} ${n.y+25}, ${n.x+20} ${n.y+25}
                                L ${n.x-20} ${n.y+25} Z`);
      }else{ // OR
        body.setAttribute('d', `M ${n.x-10} ${n.y-30}
                                C ${n.x+15} ${n.y-30}, ${n.x+45} ${n.y-30}, ${n.x+70} ${n.y-15}
                                C ${n.x+90} ${n.y},    ${n.x+90} ${n.y+30}, ${n.x+70} ${n.y+45}
                                C ${n.x+45} ${n.y+60}, ${n.x+15} ${n.y+60}, ${n.x-10} ${n.y+60}
                                C ${n.x+15} ${n.y+30}, ${n.x+15} ${n.y},   ${n.x-10} ${n.y-30} Z`);
      }
      svg.appendChild(body);
      const lbl=document.createElementNS(svg.namespaceURI,'text');
      lbl.setAttribute('class','label'); lbl.setAttribute('x', n.x-10);
      lbl.setAttribute('y', n.y-36); lbl.textContent=n.type; svg.appendChild(lbl);

      if (n.type!=='VAR'){ draw(n.a); if (n.b) draw(n.b); }
    })(ast);

    // Output wire and pin
    const out = document.createElementNS(svg.namespaceURI,'polyline');
    out.setAttribute('class','wire');
    out.setAttribute('points', elbow(outX, outY, W-90, outY));
    svg.appendChild(out);
    const yLbl=document.createElementNS(svg.namespaceURI,'text');
    yLbl.setAttribute('class','pin'); yLbl.setAttribute('x', W-50); yLbl.setAttribute('y', outY+5);
    yLbl.textContent='Y'; svg.appendChild(yLbl);
    const yDot=document.createElementNS(svg.namespaceURI,'circle');
    yDot.setAttribute('class','node'); yDot.setAttribute('cx', W-70); yDot.setAttribute('cy', outY);
    yDot.setAttribute('r','3'); svg.appendChild(yDot);

    return svg;
  }

  function parse(expr){
    return astFromPostfix(toPostfix(tokenize(expr)));
  }

  function drawLogic(expr, mount, opts){
    const el = typeof mount==='string' ? document.querySelector(mount) : mount;
    if (!el) throw new Error('Mount element not found');
    // parse & render
    const ast = parse(expr);
    const svg = renderSVG(ast, opts||{});
    el.innerHTML='';
    el.appendChild(svg);
    return svg;
  }

  // expose
  window.drawLogic = drawLogic;
})();


/*
  PolyCode — Boolean Circuit SVG Modal (drop‑in)
  ------------------------------------------------
  What this gives you:
  - PolyBool.showCircuit(expr, opts): parses a Boolean SOP expression like "a + ab + a'b'c" and shows a clean SVG circuit in a modal (like your Pyplot modal)
  - PolyBool.svg(expr, opts): returns an SVG string so you can embed anywhere
  - PolyBool.downloadSVG()/downloadPNG(): helpers wired to modal buttons

  Notes
  - Focused on Sum‑of‑Products with implicit multiplication (ab == a·b). Use ' (apostrophe) for NOT, e.g., a', b'.
  - No algebraic simplification is performed (as requested). It renders the circuit as‑is.
  - Layout is clean, minimal, and scalable. No external libs.

  Quick use:
    PolyBool.showCircuit("a + ab + abc", { title: "F = a + ab + abc" });
    PolyBool.showCircuit("a + a'b", { output: "Y" });
*/

(function (global) {
  'use strict';

  // ————— Minimal, namespaced modal styles (won't collide with existing) —————
  const STYLE_TAG_ID = 'polybool-modal-style';
  const BASE_CSS = `
  .pb-modal{position:fixed;inset:0;z-index:99999;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial}
  .pb-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}
  .pb-dialog{position:relative;margin:5vh auto;width:min(980px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#141922;color:#e9edf3;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden}
  .pb-header,.pb-footer{padding:10px 14px}
  .pb-header{display:flex;align-items:center;gap:12px;border-bottom:1px solid #2b2f34}
  .pb-title{font-size:16px;font-weight:600;flex:1}
  .pb-body{padding:12px 14px;overflow:auto;background:#0b0f13}
  .pb-footer{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #2b2f34;background:#141922}
  .pb-btn{appearance:none;border:1px solid #2b2f34;background:#1e2024;color:#e9edf3;border-radius:10px;padding:8px 12px;cursor:pointer}
  .pb-btn:hover{filter:brightness(1.08)}
  .pb-close{margin-left:auto}
  .pb-svg-wrap{display:flex;justify-content:center}
  .pb-svg-wrap svg{max-width:100%;height:auto}
  `;

  function ensureStyles() {
    if (document.getElementById(STYLE_TAG_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_TAG_ID;
    s.textContent = BASE_CSS;
    document.head.appendChild(s);
  }

  // ————— Parsing —————
  // Supported: sum of products with implicit multiplication; apostrophe (') for NOT
  // Example: "a + ab + a'b'c" -> [ [ {v:'a',not:false} ], [ {v:'a',not:false},{v:'b',not:false} ], [ {v:'a',not:true},{v:'b',not:true},{v:'c',not:false} ] ]
  function parseExpression(expr) {
    if (!expr || typeof expr !== 'string') throw new Error('Expression must be a string');
    const cleaned = expr.replace(/\s+/g, '')
                        .replace(/[·•*]/g, '') // allow a·b or a*b but treat as implicit
                        .replace(/\(/g, '').replace(/\)/g, ''); // ignore parentheses for now

    const termStrs = cleaned.split('+').filter(Boolean);
    const terms = termStrs.map(ts => {
      const lits = [];
      for (let i = 0; i < ts.length; i++) {
        const ch = ts[i];
        if (/^[a-zA-Z]$/.test(ch)) {
          let not = false;
          if (i + 1 < ts.length && ts[i + 1] === '\'') { not = true; i++; }
          lits.push({ v: ch, not });
        } else if (ch === '\'') {
          // standalone ' (should have been consumed by previous letter) —
          // tolerate by attaching to previous literal if any
          if (lits.length) lits[lits.length - 1].not = true;
        } else {
          // unsupported character — ignore silently to be forgiving
        }
      }
      return lits;
    });
    return terms;
  }

  // Collect variable set (preserve first‑seen order)
  function collectVars(terms) {
    const seen = new Set();
    const vars = [];
    for (const t of terms) for (const { v } of t) if (!seen.has(v)) { seen.add(v); vars.push(v); }
    return vars;
  }

  // ————— SVG helpers —————
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function line(x1,y1,x2,y2){ return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
  function rect(x,y,w,h,r=10){ return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}"/>`; }
  function text(x,y,txt,anchor='start',dy='0'){ return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" dy="${dy}">${esc(txt)}</text>`; }
  function circle(x,y,r){ return `<circle cx="${x}" cy="${y}" r="${r}"/>`; }

  // Basic AND/OR gate rectangles with labels (clean, readable)
  function gateRect(x,y,w,h,label){
    return `${rect(x,y,w,h,12)}${text(x+w/2,y+h/2,label,'middle')}`;
  }

  // Draw a literal input stub (label + bubble if NOT)
  function literalStub(x,y,label,neg){
    const parts = [];
    parts.push(text(x-8,y,label,'end'));
    parts.push(line(x,y,x+20,y));
    if (neg) parts.push(circle(x+10,y,4));
    return parts.join('');
  }

  // ————— Layout engine —————
  function layoutAndRender(terms, opts={}){
    const theme = Object.assign({
      bg:'#0b0f13', ink:'#e9edf3', grid:'#2b2f34', accent:'#9ecbff'
    }, opts.theme||{});

    const outVar = opts.output || 'F';
    const title = opts.title || `${outVar} = ${opts.expr || ''}`.trim();

    const rowH = 64;           // vertical spacing per product term
    const litSpace = 54;       // space per literal within a term
    const lm = 90;             // left margin for labels/stubs
    const top = 60;            // top margin
    const gateW = 72, gateH = 34;  // AND gate box size
    const gapToOR = 120;       // horizontal gap from AND to OR

    const nTerms = terms.length || 1;

    // Measure max literals across terms to position ANDs consistently
    const maxLits = Math.max(1, ...terms.map(t => t.length||1));

    const andX = lm + maxLits*litSpace + 20;   // X for all AND gates
    const orX  = andX + gapToOR;               // X for OR gate

    const width  = orX + 180;
    const height = top + Math.max(1,nTerms)*rowH + 60;

    const svgParts = [];
    svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:${theme.bg};color:${theme.ink}">
      <defs>
        <style>
          .pb *{ vector-effect:non-scaling-stroke }
          .pb line,.pb rect,.pb circle{ stroke:${theme.ink}; fill:none; stroke-width:1.6 }
          .pb text{ fill:${theme.ink}; font: 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Arial }
          .pb .accent rect,.pb .accent line,.pb .accent circle{ stroke:${theme.accent} }
          .pb .accent text{ fill:${theme.accent} }
        </style>
      </defs>
      <g class="pb">`);

    // Title
    if (opts.showTitle !== false && title) svgParts.push(text(lm, 28, title, 'start'));

    // For each term, draw literals -> AND gate -> wire to OR inputs
    const termOutYs = [];
    terms.forEach((lits, i) => {
      const cy = top + i*rowH + rowH/2;
      // literals block
      lits.forEach((lit, j) => {
        const lx = lm + j*litSpace;
        svgParts.push(literalStub(lx, cy, lit.not ? `${lit.v}'` : lit.v, lit.not));
      });
      // connect last stub into AND gate
      const stubEndX = lits.length ? (lm + (lits.length-1)*litSpace + 20) : lm;
      const gateY = cy - gateH/2;
      // wire from last stubEndX to AND left
      svgParts.push(line(stubEndX, cy, andX, cy));
      // AND gate
      svgParts.push(gateRect(andX, gateY, gateW, gateH, (lits.length<=1?'BUF':'AND')));
      // AND output wire to the right (towards OR)
      const outX = andX + gateW;
      svgParts.push(line(outX, cy, orX, cy));
      termOutYs.push(cy);
    });

    // If only one term, just label output and finish
    if (nTerms === 1) {
      const cy = termOutYs[0];
      // Output label and arrow
      svgParts.push(gateRect(orX, cy - gateH/2, 80, gateH, 'OUT'));
      const outX2 = orX + 80;
      svgParts.push(line(orX + 80, cy, outX2 + 30, cy));
      svgParts.push(text(outX2 + 40, cy, outVar, 'start'));
      svgParts.push('</g></svg>');
      return svgParts.join('');
    }

    // Multi-input OR gate area
    const minY = Math.min(...termOutYs), maxY = Math.max(...termOutYs);
    const orY = (minY + maxY)/2 - gateH/2;
    const orInputs = nTerms;
    const orH = Math.max(gateH, (termOutYs[termOutYs.length-1] - termOutYs[0]) + 28);
    const orYTop = (minY + maxY)/2 - orH/2;

    // Draw OR gate rectangle spanning inputs
    const orWidth = 84;
    svgParts.push(rect(orX, orYTop, orWidth, orH, 12));
    svgParts.push(text(orX + orWidth/2, orYTop + orH/2, 'OR', 'middle'));

    // Connect each term output into OR gate left edge
    termOutYs.forEach(y => {
      svgParts.push(line(orX - 0, y, orX, y));
    });

    // OR output to named output
    const orOutX = orX + orWidth;
    const outWireX = orOutX + 36;
    const outY = (minY + maxY)/2;
    svgParts.push(line(orOutX, outY, outWireX, outY));
    svgParts.push(text(outWireX + 12, outY, outVar, 'start'));

    svgParts.push('</g></svg>');
    return svgParts.join('');
  }

  // ————— Public API —————
  function svg(expr, opts={}){
    const terms = parseExpression(expr);
    return layoutAndRender(terms, Object.assign({}, opts, { expr }));
  }

  function toDataURI(svgStr){
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  }

  function showCircuit(expr, opts={}){
    ensureStyles();
    const svgStr = svg(expr, opts);

    // Build modal
    const wrap = document.createElement('div');
    wrap.className = 'pb-modal';
    wrap.innerHTML = `
      <div class="pb-backdrop"></div>
      <div class="pb-dialog" role="dialog" aria-modal="true">
        <div class="pb-header">
          <div class="pb-title">${esc(opts.title || `Circuit: ${esc(expr)}`)}</div>
          <button class="pb-btn pb-close" aria-label="Close">Close</button>
        </div>
        <div class="pb-body">
          <div class="pb-svg-wrap">
            <img alt="Boolean circuit" src="${toDataURI(svgStr)}" />
          </div>
        </div>
        <div class="pb-footer">
          <button class="pb-btn" data-act="dl-svg">Download SVG</button>
          <button class="pb-btn" data-act="dl-png">Download PNG</button>
          <button class="pb-btn pb-close">Close</button>
        </div>
      </div>`;

    document.body.appendChild(wrap);

    // Close interactions
    function close(){ wrap.remove(); }
    wrap.querySelectorAll('.pb-close,.pb-backdrop').forEach(el => el.addEventListener('click', close));

    // Downloads
    wrap.querySelector('[data-act="dl-svg"]').addEventListener('click', () => downloadSVG(svgStr, (opts.output||'F')+'.svg'));
    wrap.querySelector('[data-act="dl-png"]').addEventListener('click', async () => {
      const url = await svgToPngDataURL(svgStr, { scale: 2 });
      downloadURL(url, (opts.output||'F')+'.png');
    });

    return wrap; // in case caller wants to keep a handle
  }

  function downloadURL(url, filename){
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'circuit';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function downloadSVG(svgStr, filename){
    const url = toDataURI(svgStr);
    downloadURL(url, filename || 'circuit.svg');
  }

  async function svgToPngDataURL(svgStr, { scale=1 }={}){
    const img = new Image();
    const url = toDataURI(svgStr);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const blobURL = URL.createObjectURL(blob);

    // Use blob URL for better fidelity; fallback to data URI
    const src = blobURL || url;

    const { width, height } = getSvgSize(svgStr);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');

    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = rej;
      img.src = src;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngURL = canvas.toDataURL('image/png');
    URL.revokeObjectURL(blobURL);
    return pngURL;
  }

  function getSvgSize(svgStr){
    const mW = svgStr.match(/width="(\d+(?:\.\d+)?)"/);
    const mH = svgStr.match(/height="(\d+(?:\.\d+)?)"/);
    return { width: mW ? parseFloat(mW[1]) : 800, height: mH ? parseFloat(mH[1]) : 400 };
  }

  // Expose
  const API = { showCircuit, svg, toDataURI, downloadSVG };
  global.PolyBool = Object.assign(global.PolyBool || {}, API);

})(window);

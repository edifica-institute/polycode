// /js/plot-preview.js
(() => {
  const BASE = (self.pyodideIndexURL || "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/"); // fallback
  const PYODIDE_URL = BASE.replace(/\/+$/, "/") + "pyodide.js";
  let __pyodidePromise = null;

  // ---------- Utilities ----------
  function $(sel, root = document) { return root.querySelector(sel); }

  // SVG-aware create()
  function create(tag, attrs = {}, children = []) {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const isSvg = /^(svg|path|rect|circle|line|polyline|polygon|g|ellipse|text)$/.test(tag);
    const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style" && v && typeof v === "object") {
        Object.assign(el.style, v);
      } else if (k === "className") {
        if (isSvg) el.setAttribute("class", v);
        else el.className = v;
      } else if (isSvg) {
        el.setAttribute(k, String(v));
      } else if (k in el) {
        el[k] = v;
      } else {
        el.setAttribute(k, v);
      }
    }
    for (const c of children) {
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  // ---------- Modal ----------
  function ensureModal() {
    let modal = $("#plotModal");
    if (modal) return modal;

    modal = create("div", { id: "plotModal", className: "pc-modal", "aria-hidden": "true", style: { display: "none" } }, [
      create("div", { className: "pc-modal__backdrop", "data-close": "modal" }),
      create("div", { className: "pc-modal__dialog", role: "dialog", "aria-modal": "true" }, [
        create("div", { className: "pc-modal__header" }, [
          create("strong", {}, ["Matplotlib Preview"]),
          create("button", { className: "pc-modal__close", "data-close": "modal", "aria-label": "Close" }, ["✕"])
        ]),
        create("div", { className: "pc-modal__body", id: "plotModalBody" }, [
          create("div", { id: "plotSpinner", style: { opacity: ".8" } }, ["Preparing Pyodide & rendering…"])
        ]),
        create("div", { className: "pc-modal__footer" }, [
          create("button", { className: "btn", "data-close": "modal" }, ["Close"])
        ])
      ])
    ]);
    document.body.appendChild(modal);

    document.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.matches('[data-close="modal"]')) closeModal();
    });
    return modal;
  }
  function openModal() {
    const m = ensureModal();
    m.style.display = "block";
    m.setAttribute("aria-hidden", "false");
  }
  function closeModal() {
    const m = $("#plotModal");
    if (!m) return;
    m.style.display = "none";
    m.setAttribute("aria-hidden", "true");
    const body = $("#plotModalBody");
    if (body) body.innerHTML = '<div id="plotSpinner" style="opacity:.8">Preparing Pyodide & rendering…</div>';
  }

  // ---------- Button ----------
 /* function ensureButton() {
    let btn = $("#btnPlotPreview");
    if (btn) return btn;

    const right = $(".right-controls") || $("#centerPanel .pane-head .right-controls");
    btn = create("button", {
      id: "btnPlotPreview",
      className: "btn btn-ghost",
      title: "Preview pyplot figures",
      "aria-label": "Plot Preview",
      disabled: true
    }, [
      create("svg", { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true" }, [
        // chart axes
        create("path", { d: "M3 3v18h18", fill: "none", stroke: "currentColor", "stroke-width": 2 }),
        // bars
        create("rect", { x: 6,  y: 11, width: 3, height: 7,  fill: "currentColor" }),
        create("rect", { x: 11, y: 7,  width: 3, height: 11, fill: "currentColor" }),
        create("rect", { x: 16, y: 4,  width: 3, height: 14, fill: "currentColor" })
      ])
    ]);

    if (right) right.appendChild(btn);
    else document.body.appendChild(btn); // fallback
    return btn;
  }*/


  function ensureButton() {
  // 1) Reuse if already created
  let btn = document.getElementById('btnPlotPreview');
  if (btn) return btn;

  // 2) Prefer the CENTER panel toolbar; fall back only if missing
  const toolbar =
    document.querySelector('#centerPanel .pane-head .right-controls') ||
    document.querySelector('.center.panel .pane-head .right-controls') ||
    document.querySelector('#centerPanel .right-controls') ||
    document.querySelector('.right-controls'); // last-resort

  // 3) Build button
  btn = create('button', {
    id: 'btnPlotPreview',
    className: 'btn',                // keep your base .btn styling
    title: 'Preview pyplot figures',
    'aria-label': 'Plot Preview',
    disabled: true
  }, [
    create('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }, [
      create('path', { d: 'M3 3v18h18', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
      create('rect', { x: 6,  y: 11, width: 3, height: 7,  fill: 'currentColor' }),
      create('rect', { x: 11, y: 7,  width: 3, height: 11, fill: 'currentColor' }),
      create('rect', { x: 16, y: 4,  width: 3, height: 14, fill: 'currentColor' })
    ])
  ]);

  // 4) Place it right after the Run button if present, else append at end
  if (toolbar) {
    const runBtn = toolbar.querySelector('#btnRun');
    if (runBtn && runBtn.parentNode === toolbar) {
      runBtn.after(btn);
    } else {
      toolbar.appendChild(btn);
    }
  } else {
    // ultimate fallback so it still exists
    document.body.appendChild(btn);
  }

  return btn;
}


  

  // ---------- Editor detection & toggle ----------
  function codeLooksLikeMatplotlib(s) {
    const t = String(s || "");
    return /\bmatplotlib\b/.test(t) || /\bplt\s*\./.test(t) || /\bfrom\s+matplotlib\b/.test(t);
  }

  function enablePlotBtnWhenRelevant() {
    const plotBtn = ensureButton();
    const runBtn  = document.getElementById("btnRun");
    const ed = window.editor, m = window.monaco;

    const evalNow = () => {
      const code = ed ? ed.getValue() : "";
      const hasPlot = codeLooksLikeMatplotlib(code);
      plotBtn.disabled = !hasPlot;
      if (runBtn) runBtn.disabled = hasPlot;
    };

    if (ed && m) {
      evalNow();
      ed.onDidChangeModelContent(evalNow);
    } else {
      let tries = 0;
      const id = setInterval(() => {
        tries++;
        if (window.editor && window.monaco) {
          clearInterval(id);
          enablePlotBtnWhenRelevant();
        } else if (tries > 40) {
          clearInterval(id);
        }
      }, 150);
    }
  }

  // ---------- Pyodide ----------
 async function ensurePyodide() {
    if (__pyodidePromise) return __pyodidePromise;
    __pyodidePromise = new Promise(async (resolve, reject) => {
      try {
        if (!window.loadPyodide) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = PYODIDE_URL; s.defer = true;
            s.onload = res; s.onerror = () => rej(new Error("Pyodide loader failed"));
            document.head.appendChild(s);
          });
        }
        const py = await window.loadPyodide({ indexURL: BASE });
        resolve(py);
      } catch (e) { reject(e); }
    });
    return __pyodidePromise;
  }



  
   function detectPkgs(userCode) {
    const s = String(userCode || "");
    const needsMpl = /\b(from\s+matplotlib|import\s+matplotlib|plt\s*\.)/.test(s);
    const needsPandas = /\bimport\s+pandas\b|pandas\./.test(s);
    const pkgs = [];
    if (needsMpl) pkgs.push("matplotlib");
    if (needsPandas) pkgs.push("pandas");
    return pkgs;
  }

  async function renderPlotsFromCode(userCode) {
    const py = await ensurePyodide();

    // ⬇️ make sure required packages are present
    const pkgs = detectPkgs(userCode);
    for (const p of pkgs) {
      if (!py.loadedPackages?.[p]) {
        await py.loadPackage(p);
      }
    }

    const code = `
import sys, io, base64, builtins
builtins.input = lambda prompt='': ''
import matplotlib
matplotlib.use('agg')
import matplotlib.pyplot as plt
plt.close('all')
# ==== USER CODE ====
${userCode}
# ===================
imgs=[]
try:
    fns = getattr(plt, 'get_fignums', lambda: [])()
    for n in list(fns):
        fig = plt.figure(n)
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=150)
        buf.seek(0)
        imgs.append(base64.b64encode(buf.read()).decode('ascii'))
        buf.close()
except Exception as e:
    imgs = ["__PLOT_ERROR__:"+str(e)]
imgs
`;
    return py.runPythonAsync(code);
  }


  

  // ---------- Click handler ----------
  async function onPlotClick() {
    openModal();
    const body = document.querySelector('#plotModalBody');
    if (!body) return;

    body.innerHTML = '<div id="plotSpinner" style="opacity:.8">Preparing Pyodide & rendering…</div>';

    try {
      const code = window.editor ? window.editor.getValue() : "";
      if (!codeLooksLikeMatplotlib(code)) {
        body.innerHTML = '<div style="opacity:.8">No matplotlib usage detected.</div>';
        return;
      }
      const imgs = await renderPlotsFromCode(code);

      if (imgs.length === 1 && String(imgs[0]).startsWith("__PLOT_ERROR__:")) {
        body.innerHTML = '<div style="color:#e66">Plot error: ' +
                         imgs[0].replace("__PLOT_ERROR__:", "") + '</div>';
        return;
      }
      if (!imgs.length) {
        body.innerHTML = '<div style="opacity:.8">No figures found. Did you call plotting functions?</div>';
        return;
      }

      const frag = document.createDocumentFragment();
      imgs.forEach((b64, i) => {
        const img = document.createElement('img');
        img.src = 'data:image/png;base64,' + b64;
        img.alt = 'Figure ' + (i + 1);
        img.style.maxWidth = '100%';
        img.style.display = 'block';
        img.style.margin = '10px auto';
        frag.appendChild(img);
      });
      body.innerHTML = '';
      body.appendChild(frag);
    } catch (err) {
      body.innerHTML = '<div style="color:#e66">Plot preview failed: ' +
                       (err?.message || String(err)) + '</div>';
    }
  }

  // ---------- Init ----------
  function init() {
    const btn = ensureButton();
    enablePlotBtnWhenRelevant();
    btn.addEventListener("click", onPlotClick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

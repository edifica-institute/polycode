// /js/lang-select.js
(() => {
  const SCRATCH_URL = "https://turbowarp.org/editor?dark&fps=60";

  // Map keyword -> page URL (used by your index page)
  const PAGE = {
    java: "./index-java.html",
    c: "./index-c.html",
    cpp: "./index-cpp.html",
    web: "./index-web.html",
    python: "./index-python.html",
    sql: "./index-sql.html",
  };

  function isScratchValue(v) {
    return String(v || "").toLowerCase() === "scratch";
  }

  function resolveUrl(val) {
    // If it's a keyword (index page), map it; else assume it's already a URL (other pages)
    return PAGE[val] || val || "";
  }

  function bindSelect(sel) {
    if (!sel || sel.__pcBound) return;
    sel.__pcBound = true;

    // Remove any inline onchange
    sel.onchange = null;
    sel.removeAttribute("onchange");

    // Remember last valid selection so we can revert if user cancels Scratch
    sel._lastIndex = sel.selectedIndex;

    sel.addEventListener("change", function () {
      const raw = this.value;

      if (isScratchValue(raw)) {
        // Revert visual selection immediately so it doesn't stick on "Scratch"
        this.selectedIndex = this._lastIndex ?? 0;

        if (window.confirm(
          "Open Scratch (TurboWarp editor) in a new tab? Nothing will be saved unless you download."
        )) {
          window.open(SCRATCH_URL, "_blank", "noopener,noreferrer");
        }
        // Stay on current page
      } else {
        const url = resolveUrl(raw);
        if (url) window.location.href = url;
      }

      // Track last seen index after any change/revert
      this._lastIndex = this.selectedIndex;
    });
  }

  function init() {
    document.querySelectorAll('#langSelect, [data-role="lang-select"]').forEach(bindSelect);
  }

  const mo = new MutationObserver(init);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// /js/lang-select.js
(() => {
  const SCRATCH_URL = "https://turbowarp.org/editor?dark&fps=60";

  function isScratchValue(v) {
    return String(v || "").toLowerCase() === "scratch";
  }

  function bindSelect(sel) {
    if (!sel || sel.__pcBound) return;
    sel.__pcBound = true;

    // Kill any inline onchange to avoid accidental navigation
    sel.onchange = null;
    sel.removeAttribute("onchange");

    // Remember where we started so we can revert on cancel
    sel._lastIndex = sel.selectedIndex;

    sel.addEventListener("change", function () {
      const val = this.value;

      if (isScratchValue(val)) {
        // Immediately revert visual selection so it doesn't stick on "Scratch"
        this.selectedIndex = this._lastIndex ?? 0;

        const ok = window.confirm(
          "Open Scratch (TurboWarp editor) in a new tab? Nothing will be saved unless you download."
        );
        if (ok) {
          window.open(SCRATCH_URL, "_blank", "noopener,noreferrer");
        }
        // Do not navigate the current page
      } else if (val) {
        // Normal navigation for all other languages
        window.location.href = val;
      }

      // Track last valid selection after any change/revert
      this._lastIndex = this.selectedIndex;
    });
  }

  function init() {
    document.querySelectorAll('#langSelect, [data-role="lang-select"]').forEach(bindSelect);
  }

  // Re-bind if nav is injected later
  const mo = new MutationObserver(init);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

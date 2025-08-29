// /js/lang-select.js
(() => {
  const SCRATCH_URL = "https://turbowarp.org/editor?dark&fps=60";

  // Helper: does the option point to Scratch?
  function isScratchValue(v) {
    if (!v) return false;
    const s = String(v).toLowerCase();
    return s === "scratch" || s.endsWith("index-scratch.html") || s.includes("/scratch");
  }

  // Attach handler to any language selector (by id or data-role)
  function bindSelect(sel) {
    if (!sel || sel.__pcBound) return;
    sel.__pcBound = true;

    // Remember current selection so we can restore if user cancels
    sel._lastIndex = sel.selectedIndex;

    sel.addEventListener("change", function () {
      const val = this.value;

      if (isScratchValue(val)) {
        // Revert immediately so the UI doesn't stick on "Scratch"
        this.selectedIndex = this._lastIndex ?? 0;

        const ok = window.confirm(
          "Open Scratch (TurboWarp editor) in a new tab? Nothing will be saved unless you download."
        );
        if (ok) {
          window.open(SCRATCH_URL, "_blank", "noopener,noreferrer");
        }
        // Do NOT change page
      } else if (val) {
        window.location.href = val; // normal navigation
      }

      // Track last seen index after any change/revert
      this._lastIndex = this.selectedIndex;
    });
  }

  // Bind existing selects on load
  function init() {
    document.querySelectorAll('#langSelect, [data-role="lang-select"]').forEach(bindSelect);
  }

  // Also support selects injected later (rare, but safe)
  const obs = new MutationObserver(() => init());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

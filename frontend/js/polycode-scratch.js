// /js/polycode-scratch.js
(() => {
  const SCRATCH_URL = "https://turbowarp.org/editor?dark&fps=60";

  // Decide if the clicked element is a “Scratch” trigger
  function isScratchTrigger(el) {
    if (!el) return false;
    // Prefer explicit markers (best practice)
    if (el.closest('[data-open="scratch"]')) return true;
    if (el.closest('.js-open-scratch')) return true;

    // Fallbacks so you don’t have to touch every page:
    const a = el.closest('a,button');
    if (!a) return false;
    const href = (a.getAttribute('href') || '').toLowerCase();
    if (href.includes('index-scratch') || href.endsWith('/scratch') || href.includes('/scratch')) return true;

    const label = (a.textContent || '').trim().toLowerCase();
    return label === 'scratch' || label.startsWith('scratch ');
  }

  function openScratchWithConfirm(e) {
    const t = e.target;
    if (!isScratchTrigger(t)) return;

    e.preventDefault();
    e.stopPropagation();

    const ok = window.confirm(
      "Open Scratch (TurboWarp editor) in a new tab? Nothing will be saved unless you download."
    );
    if (ok) window.open(SCRATCH_URL, "_blank", "noopener,noreferrer");
  }

  // Event delegation covers *all* pages and dynamically-added menus
  document.addEventListener("click", openScratchWithConfirm, true);
})();

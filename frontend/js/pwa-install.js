// pwa-install.js — one smart button that Just Works
(function () {
  const START_URL = '/frontend/index.html';

  let deferredPrompt = null;

  const $ = (id) => document.getElementById(id);
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true; // iOS

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);

  function ensureButtons() {
    // Use ONE button with id="btnPWA"
    if (!$('btnPWA')) {
      const btn = document.createElement('button');
      btn.id = 'btnPWA';
      btn.className = 'pwa-btn';
      btn.hidden = true;
      btn.textContent = 'Install App';
      document.body.appendChild(btn);
    }
  }

  function setBtn(label, hidden) {
    const btn = $('btnPWA');
    if (!btn) return;
    btn.textContent = label;
    btn.hidden = !!hidden;
  }

  function showIOSInstructions() {
    alert(
      "Install PolyCode:\n\n" +
      "1) Tap the Share button (square with arrow).\n" +
      "2) Choose 'Add to Home Screen'.\n" +
      "3) Open from your Home Screen for the full app."
    );
  }

 // If already installed, hide the button and show a hint instead of trying to "launch".
function updateUI() {
  const btn = document.getElementById('btnPWA');
  const hint = document.getElementById('pwaHint');

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (standalone) {
    if (btn) btn.hidden = true;
    if (hint) { hint.hidden = false; hint.textContent = 'PolyCode is installed. Open it from your Home Screen.'; }
    return;
  }

  // Not installed: keep showing the Install button (or iOS instructions)
  if (btn) { btn.hidden = false; btn.textContent = 'Install App'; }
  if (hint) hint.hidden = true;
}


  // Listen for install availability
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateUI();
  });

  // When installed, hide the button
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateUI();
  });

  // Click behavior
  window.addEventListener('DOMContentLoaded', () => {
    ensureButtons();
    const btn = $('btnPWA');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      if (isStandalone()) {
        // Already installed: if this isn't START_URL, navigate there; otherwise do nothing
        if (location.pathname !== START_URL) location.href = START_URL;
        return;
      }

      // Not installed
      if (isIOS) {
        // iOS never shows beforeinstallprompt
        showIOSInstructions();
        return;
      }

      if (deferredPrompt) {
        btn.disabled = true;
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } finally {
          deferredPrompt = null;
          btn.disabled = false;
          updateUI();
        }
      } else {
        // No prompt yet → show gentle instructions (Android/desktop)
        alert(
          "To install PolyCode:\n\n" +
          "• Open the browser menu (⋮ or ⋯)\n" +
          "• Tap 'Install app' or 'Add to Home screen'\n"
        );
      }
    });

    updateUI();
  });

  // Also update once on load (covers some browsers)
  window.addEventListener('load', updateUI);
})();

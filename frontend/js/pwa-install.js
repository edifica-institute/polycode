// pwa-install.js — Show the right button (Install vs Launch) and make it work everywhere.
(function () {
  // ---- CONFIG ----
  // Keep this in sync with your manifest.json
  const START_URL = '/frontend/index.html';

  // Will hold the install prompt event when available
  let deferredPrompt = null;

  // Helpers
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true; // iOS

  function byId(id) { return document.getElementById(id); }
  function show(el) { el && (el.hidden = false); }
  function hide(el) { el && (el.hidden = true); }

  function updateUI() {
    const installBtn = byId('btnPWAInstall');
    const launchBtn  = byId('btnPWALaunch');

    if (isStandalone()) {
      hide(installBtn);
      show(launchBtn);
      return;
    }
    // Not standalone: show Install if we have a prompt, else hide Install and show Launch
    if (deferredPrompt) {
      show(installBtn);
      hide(launchBtn);
    } else {
      // If the browser won't prompt yet, offer a Launch (opens START_URL in same tab)
      hide(installBtn);
      show(launchBtn);
    }
  }

  // Catch the install prompt when the page qualifies
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateUI();
  });

  // When the app gets installed
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateUI();
  });

  // Button clicks
  window.addEventListener('DOMContentLoaded', () => {
    const installBtn = byId('btnPWAInstall');
    const launchBtn  = byId('btnPWALaunch');

    installBtn && installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) {
        // No prompt available — navigate to START_URL as a fallback.
        window.location.href = START_URL;
        return;
      }
      installBtn.disabled = true;
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice; // {outcome: 'accepted'|'dismissed'}
      } finally {
        deferredPrompt = null;               // must reset per spec
        installBtn.disabled = false;
        updateUI();
      }
    });

    launchBtn && launchBtn.addEventListener('click', () => {
      // If already in standalone, just focus. Otherwise, navigate to your app home.
      if (!isStandalone()) window.location.href = START_URL;
    });

    updateUI();
  });

  // Optional: show/hide correctly after page load too
  window.addEventListener('load', updateUI);
})();

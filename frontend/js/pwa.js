// pwa.js
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => console.log("✅ PolyCode PWA enabled"))
    .catch((err) => console.error("❌ PWA registration failed:", err));
}

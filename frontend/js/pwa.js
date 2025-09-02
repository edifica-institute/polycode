<!-- /frontend/js/pwa.js (drop-in) -->
<script>
if ('serviceWorker' in navigator) {
  const primary  = '/sw.js';           // root
  const fallback = '/frontend/sw.js';  // under /frontend

  function reg(url){
    return navigator.serviceWorker.register(url)
      .then(r => console.log('✅ SW registered:', r.scope))
      .catch(err => console.error('❌ SW register failed for', url, err));
  }

  // Try root first; if 404, try /frontend
  fetch(primary, { method: 'HEAD' }).then(r => {
    if (r.ok) reg(primary); else reg(fallback);
  }).catch(() => reg(fallback));
}
</script>

document.getElementById('langSelect').addEventListener('change', (e) => {
  if (e.target.value) {
    window.location.href = `index-${e.target.value}.html`;
  }
});
// server/langs/sql/plugin.js (CJS)
function register(app, _core){
  app.post('/api/sql/prepare', (req, res) => {
    res.json({ ok: true, note: 'SQL runs client-side via sql.js (WASM).' });
  });
}
module.exports = { register };

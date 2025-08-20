// server/langs/sql/plugin.js
export async function register(app, core){
  app.post('/api/sql/prepare', (req, res) => {
    res.json({ ok: true, note: 'SQL runs client-side via sql.js (WASM).' });
  });
}

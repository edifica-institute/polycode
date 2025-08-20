// server/langs/web/plugin.js
export async function register(app, core){
  app.post('/api/web/prepare', (req, res) => {
    res.json({ ok: true, note: 'No backend needed for HTML/CSS/JS rendering.' });
  });
}

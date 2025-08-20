const express = require('express');
const cors = require('cors');
const { createTermServer } = require('./core/term');
const { loadPlugins } = require('./core/utils.cjs');

const PORT = process.env.PORT || 8080;
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

(async () => {
  await loadPlugins(app);
  const server = app.listen(PORT, () => console.log('[polycode] listening on :' + PORT));
  createTermServer(server);
})();

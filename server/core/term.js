exports.register = (app) => {
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true });
  // Stub WS handler
  console.log("WebSocket /term initialized");
};
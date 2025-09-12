#!/usr/bin/env bash
set -euo pipefail

# Start virtual X server for Swing
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -noreset &
sleep 0.5

# VNC server on :99 (passwordless for lab/demo)
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -quiet &
sleep 0.5

# Websockify + noVNC on the SAME PORT as your app using a subpath:
# We'll just let Node serve the app on $PORT and run websockify on 5901,
# but we don't expose it publicly; we'll reverse-proxy via Node or use the built-in noVNC URL.
# Easiest: noVNC static is at /usr/share/novnc; we'll reference it via Node routes you already added.
# (If you prefer zero JS changes, see note below.)
websockify --web=/usr/share/novnc 5901 127.0.0.1:5900 >/dev/null 2>&1 &

# Finally start your Node server
exec npm start

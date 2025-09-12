#!/usr/bin/env bash
set -euo pipefail

# Start a virtual X display for Swing
Xvfb :99 -screen 0 1280x800x24 -ac +extension RANDR >/tmp/xvfb.log 2>&1 &

# Expose the display via VNC (no password, for lab use)
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 >/tmp/x11vnc.log 2>&1 &

# Start the Node runner (serves /vnc and proxies VNC WS)
exec node /app/java-runner.js

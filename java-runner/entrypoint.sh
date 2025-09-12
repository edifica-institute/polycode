#!/usr/bin/env bash
set -euo pipefail

# Virtual display for Swing/AWT
export DISPLAY="${DISPLAY:-:99}"
XVFB_W=${XVFB_W:-1280}
XVFB_H=${XVFB_H:-800}
XVFB_D=${XVFB_D:-24}

# Start Xvfb
Xvfb "$DISPLAY" -screen 0 "${XVFB_W}x${XVFB_H}x${XVFB_D}" -nolisten tcp &
sleep 0.5

# Start a local VNC server bound to the virtual display (localhost only)
x11vnc -display "$DISPLAY" -nopw -forever -shared -rfbport 5900 -localhost -xkb >/dev/null 2>&1 &

# Start your Node app (serves /health, /java and will expose /vnc below)
exec npm start

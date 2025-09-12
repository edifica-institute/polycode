#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
# 1280x800 is a good default; adjust if you like
XVFB_W=${XVFB_W:-1280}
XVFB_H=${XVFB_H:-800}
XVFB_D=${XVFB_D:-24}

# 1) Start a virtual X server
Xvfb "$DISPLAY" -screen 0 "${XVFB_W}x${XVFB_H}x${XVFB_D}" -nolisten tcp -ac &
XVFB_PID=$!

# 2) Start a minimal window manager so Swing has decorations/placement
openbox &

# 3) Expose the X display over VNC (no password; for lab/demo use)
x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport 5900 -quiet &
VNC_PID=$!

# 4) Start Node server (serves /novnc assets and WS proxy)
node /app/java-runner.js &
NODE_PID=$!

# 5) Reap and shut down cleanly
trap 'kill $NODE_PID $VNC_PID $XVFB_PID 2>/dev/null || true' INT TERM
wait -n $NODE_PID $VNC_PID $XVFB_PID

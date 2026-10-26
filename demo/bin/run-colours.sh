#!/usr/bin/env bash
# Run the rendered-colour test inside the recording image (see `colours-e2e` in
# the Makefile and docs/colours-e2e.md). Xvfb is started directly, as in
# run-e2e.sh, because xvfb-run hangs in this image.
set -euo pipefail

Xvfb :99 -screen 0 1600x1200x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for _ in $(seq 1 50); do
    xdpyinfo -display :99 >/dev/null 2>&1 && break
    sleep 0.2
done
xdpyinfo -display :99 >/dev/null 2>&1 || { echo "Xvfb never came up:" >&2; cat /tmp/xvfb.log >&2; exit 1; }
export DISPLAY=:99

exec /node_modules/.bin/tsx /work/demo/src/colours.ts "$@"

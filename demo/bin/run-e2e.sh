#!/usr/bin/env bash
# Run the extension's extension-host suite inside the recording image.
#
# This runs INSIDE the container (see the `e2e` target in the Makefile). The
# host needs no X server and no VS Code of its own: the image already carries
# Xvfb and every shared library Electron asks for, and @vscode/test-electron
# caches its own VS Code under the extension repo's .vscode-test/.
#
# Xvfb is started directly rather than through xvfb-run, which hangs in this
# image: it brings the server up and then never spawns the command, so the run
# sits there with a display and nothing on it. The recording entrypoint starts
# Xvfb the same way, for the same reason.
set -euo pipefail

Xvfb :99 -screen 0 1600x1200x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for _ in $(seq 1 50); do
    xdpyinfo -display :99 >/dev/null 2>&1 && break
    sleep 0.2
done
xdpyinfo -display :99 >/dev/null 2>&1 || { echo "Xvfb never came up:" >&2; cat /tmp/xvfb.log >&2; exit 1; }
export DISPLAY=:99

cd /work/ext
# The build's palette check reads ../ipm-tools, which the Makefile mounts as a
# sibling at /work/ipm-tools so the relative path resolves the same as on a dev
# machine.
npm run build
npm run test:e2e "$@"

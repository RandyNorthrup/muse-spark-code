#!/usr/bin/env bash
# Keep QEMU's character backend independent of host terminal modem settings.
set -euo pipefail
state=${1:?private state directory}
shift
"$@" &
child=$!
trap 'kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true' EXIT
for ((attempt=0; attempt<200; attempt++)); do
 [[ -S "$state/qemu-uart" ]] && break
 kill -0 "$child" || exit 1
 sleep 0.05
done
[[ -S "$state/qemu-uart" ]] || exit 1
socat "FILE:$state/uart,raw,echo=0" "UNIX-CONNECT:$state/qemu-uart"

#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")/../.." && pwd)
action=${1:?start|stop|status|run}
board=${2:?pico}
state=${3:?private state directory}
[[ "$board" == pico ]] || exit 2
if [[ "$action" != run ]]; then
 exec python3 "$base/scripts/emulators/supervisor.py" "$action" "$board" "$state" /bin/bash "$base/scripts/emulators/pico.sh" run "$board" "$state"
fi
exec node "$base/scripts/emulators/pico.mjs" "$base/temp/m103-x/rp2040" "$base/temp/m103-x/images/pico.uf2" "$state/uart"

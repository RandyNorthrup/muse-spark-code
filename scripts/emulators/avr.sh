#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")/../.." && pwd)
action=${1:?start|stop|status|run}
board=${2:?uno|mega}
state=${3:?private state directory}
case "$board" in uno|mega) ;; *) exit 2 ;; esac
if [[ "$action" != run ]]; then
 exec python3 "$base/scripts/emulators/supervisor.py" "$action" "$board" "$state" /bin/bash "$base/scripts/emulators/avr.sh" run "$board" "$state" "${4:-boot}"
fi
mcu=atmega328p
[[ "$board" == mega ]] && mcu=atmega2560
image="$base/temp/m103-x/images/$board.elf"
[[ "${4:-boot}" == download ]] && image="$base/temp/m103-x/images/$board-boot.hex"
exec "$base/temp/m103-x/tools/avr-runner" "$mcu" "$image" "$state/uart"

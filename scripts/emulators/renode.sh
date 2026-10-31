#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")/../.." && pwd)
action=${1:?start|stop|status|run}
board=${2:?stm32|nrf52}
state=${3:?private state directory}
case "$board" in stm32|nrf52) ;; *) exit 2 ;; esac
if [[ "$action" != run ]]; then
 exec python3 "$base/scripts/emulators/supervisor.py" "$action" "$board" "$state" /bin/bash "$base/scripts/emulators/renode.sh" run "$board" "$state"
fi
platform=platforms/boards/stm32f4_discovery-kit.repl
uart=uart4
if [[ "$board" == nrf52 ]]; then
 platform=platforms/cpus/nrf52840.repl
 uart=uart0
fi
cat > "$state/board.resc" <<EOF
mach create "$board"
machine LoadPlatformDescription @$platform
sysbus LoadELF @$base/temp/m103-x/images/$board.elf
emulation CreateUartPtyTerminal "term" "$state/renode-uart"
connector Connect sysbus.$uart term
start
EOF
"$base/temp/m103-x/tools/renode_1.17.0-portable/renode" --disable-xwt -P -1 -p --config "$state/renode.config" "$state/board.resc" &
child=$!
trap 'kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true' EXIT
for ((attempt=0; attempt<200; attempt++)); do
 [[ -e "$state/renode-uart" ]] && break
 kill -0 "$child" || exit 1
 sleep 0.05
done
[[ -e "$state/renode-uart" ]] || exit 1
socat "FILE:$state/uart,raw,echo=0" "FILE:$state/renode-uart,raw,echo=0"

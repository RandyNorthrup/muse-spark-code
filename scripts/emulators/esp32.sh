#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")/../.." && pwd)
action=${1:?start|stop|status|run}
board=${2:?esp32|esp32s3|esp32c3}
state=${3:?private state directory}
case "$board" in esp32|esp32s3|esp32c3) ;; *) exit 2 ;; esac
if [[ "$action" != run ]]; then
  exec python3 "$base/scripts/emulators/supervisor.py" "$action" "$board" "$state" /bin/bash "$base/scripts/emulators/esp32.sh" run "$board" "$state" "${4:-boot}"
fi
mode=${4:-boot}
tools="$base/temp/m103-x/tools/qemu"
qemu="$tools/bin/qemu-system-xtensa"
[[ "$board" == esp32c3 ]] && qemu="$tools/bin/qemu-system-riscv32"
flash="$state/flash.bin"
if [[ ! -f "$flash" ]]; then
  cp -- "$base/temp/m103-x/images/$board-flash.bin" "$flash"
fi
args=(-M "$board" -display none -monitor none -nic none -drive "file=$flash,if=mtd,format=raw" -chardev "socket,id=uart,path=$state/qemu-uart,server=on,wait=on" -serial chardev:uart)
[[ "$board" == esp32c3 ]] && args+=(-icount 3)
[[ "$board" == esp32s3 ]] && args+=(-m 4M)
if [[ "$mode" == download ]]; then
  strap=0x0f
  [[ "$board" == esp32c3 ]] && strap=0x02
  [[ "$board" == esp32s3 ]] && strap=0x00
  args+=(-global "driver=$board.gpio,property=strap_mode,value=$strap")
  if [[ "$board" == esp32s3 ]]; then
    # The ROM otherwise selects unemulated USB and faults on UART input.
    # This initializes a disposable emulator fixture; it never burns efuses.
    cp -- "$base/temp/m103-x/images/esp32s3-uart-efuse.bin" "$state/uart-efuse.bin"
    args+=(-drive "file=$state/uart-efuse.bin,if=none,format=raw,id=efuse" -global 'driver=nvram.esp32s3.efuse,property=drive,value=efuse')
  fi
elif [[ "$mode" != boot ]]; then
  exit 2
fi
exec /bin/bash "$base/scripts/emulators/qemu-uart.sh" "$state" "$qemu" "${args[@]}"

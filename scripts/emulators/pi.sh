#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")/../.." && pwd)
action=${1:?start|stop|status|run}
board=${2:?raspi3b|raspi4b|pi-virt}
state=${3:?private state directory}
case "$board" in raspi3b|raspi4b|pi-virt) ;; *) exit 2 ;; esac
if [[ "$action" != run ]]; then
 exec python3 "$base/scripts/emulators/supervisor.py" "$action" "$board" "$state" /bin/bash "$base/scripts/emulators/pi.sh" run "$board" "$state"
fi
images="$base/temp/m103-x/images"
args=(-display none -monitor none -nic none -chardev "socket,id=uart,path=$state/qemu-uart,server=on,wait=on" -serial chardev:uart -snapshot)
if [[ "$board" == pi-virt ]]; then
 args+=(-M virt -cpu cortex-a53 -m 512M -kernel "$images/virt-kernel" -initrd "$images/virt-initrd.gz" -dtb "$images/virt.dtb" -drive "file=$images/pi-root.ext4,if=virtio,format=raw" -append 'console=ttyAMA0 root=/dev/vda rw init=/usr/local/bin/muse-emulator-init')
else
 dtb=pi3-console.dtb
 [[ "$board" == raspi4b ]] && dtb=pi4-console.dtb
 root=/dev/mmcblk0p2
 extra=maxcpus=1
 if [[ "$board" == raspi4b ]]; then root=/dev/mmcblk1p2; extra="maxcpus=1 earlycon=pl011,mmio32,0xfe201000"; fi
 # PL011 is the first backend; explicitly discard the second (mini-UART).
 args+=(-serial null -M "$board" -kernel "$images/pi-kernel.img" -dtb "$images/$dtb" -drive "file=$images/pi.img,if=sd,format=raw" -append "console=ttyAMA0,115200 root=$root rw rootwait $extra init=/usr/local/bin/muse-emulator-init")
fi
exec /bin/bash "$base/scripts/emulators/qemu-uart.sh" "$state" qemu-system-aarch64 "${args[@]}"

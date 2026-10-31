#!/bin/sh
# Builds the QEMU runner's proof guest (M111 lane QA): the distribution's
# real kernel plus a busybox initramfs whose /init prints the boot marker
# on the console and powers off. This is a disposable test input for the
# runner's marker, keys and screenshot plumbing — MuseOS images come
# from lane OS1, never from here.
#
# Usage, on a Debian/Ubuntu machine or container with the packages
# linux-image-<arch>, busybox-static and cpio installed:
#   sh build-proof-guest.sh <out-dir>
# Writes <out-dir>/vmlinuz and <out-dir>/initramfs.cpio.gz.
set -eu

OUT="${1:?usage: build-proof-guest.sh <out-dir>}"
mkdir -p "$OUT/rootfs/bin" "$OUT/rootfs/dev" "$OUT/rootfs/proc" "$OUT/rootfs/sys"

KERNEL="$(ls /boot/vmlinuz-* | sort -V | tail -1)"
test -n "$KERNEL" || { echo "no kernel under /boot (install linux-image)" >&2; exit 1; }
BUSYBOX="$(command -v busybox)"
test -n "$BUSYBOX" || { echo "busybox is required (install busybox-static)" >&2; exit 1; }

cp "$KERNEL" "$OUT/vmlinuz"
cp "$BUSYBOX" "$OUT/rootfs/bin/busybox"
cat > "$OUT/rootfs/init" <<'INIT'
#!/bin/busybox sh
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
echo "M111QA-GUEST-OK kernel=$(/bin/busybox uname -r)"
/bin/busybox sleep 2
/bin/busybox poweroff -f
INIT
chmod +x "$OUT/rootfs/init" "$OUT/rootfs/bin/busybox"
(cd "$OUT/rootfs" && find . | cpio -o -H newc 2>/dev/null | gzip -9 > "$OUT/initramfs.cpio.gz")
echo "proof guest: $OUT/vmlinuz $OUT/initramfs.cpio.gz"

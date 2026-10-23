# QEMU proving-boot transcripts (recorded)

Captured 2026-10-23 on linuxlt (qemu-system-x86_64, emulated, no
KVM) by booting Alpine's `virt` kernel with a one-file initramfs
whose `/init` prints the marker and sleeps:

```sh
curl -sSL -O https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/netboot/vmlinuz-virt
gcc -static -Os -o init init.c  # prints NODE-OS-PROVING-GUEST-BOOTED, then pauses
find . -print0 | cpio -o -H newc -0 > micro.cpio
node scripts/os-boot-test.mjs --arch x86_64 --out run1 \
  --marker NODE-OS-PROVING-GUEST-BOOTED --timeout 240 --memory 512 \
  --kernel vmlinuz-virt --initrd micro.cpio \
  --append "console=ttyS0 rdinit=/init" --kvm off
```

Guest kernel SHA-256: `17fbd3efd16f2e7cb1b945f06423b37399ba7d5ac8cdd3665e7f13f363500e85`
(`vmlinuz-virt`, Alpine latest-stable, kernel 6.18.58-0-virt).

- `serial-proving.txt`: the passing boot (marker in 9367 ms).
  SHA-256: `71dfaf56197c4d2714e72193fda0e0173b4a1385b7e308e4cea7875eb6fc628b`
- `serial-panic.txt`: the same guest with `rdinit=/bin/false`,
  failing fast on `Kernel panic - not syncing`.
  SHA-256: `63ffc31df0d67edf5d018791cffc85e818cf77a1d0320e18b9d6d313996fa9fb`

The boot suite replays these through the driver's scanner and
re-runs the proving boot live where QEMU, gcc and the network
allow it.

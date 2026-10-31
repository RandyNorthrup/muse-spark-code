#!/bin/sh
# Stage 2 of the compositor guest (M111 lane QA), run once by
# m111qa-session.service after the reboot into the full Debian kernel
# (the cloud kernel has no virtio-gpu driver, so no /dev/dri): mount the
# harness share, run one harness session as the cloud user, power off.
set -u
exec >>/dev/ttyS0 2>&1
echo "M111QA-STAGE2 kernel=$(uname -r)"
modprobe virtio_gpu || true
ls /dev/dri || true
usermod -aG seat,video,render debian || true
systemctl start seatd || true
mkdir -p /mnt/share
mount /dev/vdb /mnt/share || mount /dev/vda2 /mnt/share || true
mkdir -p /mnt/share/session-out
chown debian:debian /mnt/share/session-out
date > /mnt/share/session-out/started
chown debian:debian /mnt/share/session-out/started
install -d -o debian -g debian /run/user/1000
chmod 700 /run/user/1000
runuser -l debian -c "mkdir -p /mnt/share/session-out && XDG_RUNTIME_DIR=/run/user/1000 LIBSEAT_BACKEND=seatd MUSE_HARNESS_SHARE=/mnt/share node /mnt/share/run-session.mjs >> /mnt/share/session-out/run.log 2>&1; echo guest-session-exit=\$? >> /mnt/share/session-out/run.log"
sync
systemctl poweroff

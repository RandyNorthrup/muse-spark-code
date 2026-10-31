#!/bin/sh
# Stage 2 of the compositor guest (M111 lane QA), run once by
# m111qa-session.service after the reboot into the full Debian kernel
# (the cloud kernel has no virtio-gpu driver, so no /dev/dri). Arms a
# logind autologin session for the cloud user on tty1 - the seat a
# compositor normally starts from, and how upstream Hyprland's own VM
# tests run - whose shell profile runs one harness session off the
# share and powers the guest off.
set -u
exec >>/dev/ttyS0 2>&1
echo "M111QA-STAGE2 kernel=$(uname -r)"
modprobe virtio_gpu || true
ls /dev/dri || true
mkdir -p /mnt/share
mount /dev/vdb /mnt/share || mount /dev/vda2 /mnt/share || true
mkdir -p /mnt/share/session-out
chown debian:debian /mnt/share/session-out
date > /mnt/share/session-out/started
chown debian:debian /mnt/share/session-out/started

mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/m111qa-autologin.conf <<'EOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin debian --noclear %I $TERM
EOF

# Only logind manages the seat in this guest: seatd arrives as a
# Hyprland dependency, and two seat managers fight over DRM master.
systemctl mask --now seatd.service || true

cat >> /home/debian/.profile <<'EOF'
if [ "$(tty)" = "/dev/tty1" ] && [ ! -f /var/lib/m111qa/session-started ] && [ ! -f /tmp/m111qa-session-started ]; then
  sudo -n touch /var/lib/m111qa/session-started 2>/dev/null || touch /tmp/m111qa-session-started
  mkdir -p /mnt/share/session-out
  {
    echo "id: $(id)"
    echo "XDG_SESSION_ID=$XDG_SESSION_ID seat=$XDG_SEAT"
    ls -la /dev/dri /dev/dri/by-path 2>&1
    loginctl session-status "$XDG_SESSION_ID" --no-pager 2>&1 | head -8
  } > /mnt/share/session-out/run.log 2>&1
  MUSE_HARNESS_SHARE=/mnt/share node /mnt/share/run-session.mjs >> /mnt/share/session-out/run.log 2>&1
  echo "guest-session-exit=$?" >> /mnt/share/session-out/run.log
  sync
  sudo -n systemctl poweroff || systemctl poweroff
fi
EOF
chown debian:debian /home/debian/.profile
systemctl daemon-reload
systemctl restart getty@tty1.service
echo "M111QA-AUTOLOGIN-ARMED"

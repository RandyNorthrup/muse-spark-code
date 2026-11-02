#!/bin/sh
# Builds the compositor guest's harness share disk and NoCloud seed
# (M111 lane QA). The share is a plain ext4 filesystem image the guest
# mounts read-write: the harness libs the in-guest runner imports, the
# runner itself, and the built virtual-input binary. The session's
# results land back on it under session-out/ for the host to read after
# the guest powers off (debugfs dumps them without a mount).
#
# Usage: sh build-session-share.sh <repo-root> <work-dir> <virtual-input-binary>
# Writes <work-dir>/share.img and <work-dir>/seed.iso.
# Needs e2fsprogs (mkfs.ext4) and genisoimage.
set -eu

REPO="${1:?usage: build-session-share.sh <repo-root> <work-dir> <virtual-input-binary>}"
WORK="${2:?usage: build-session-share.sh <repo-root> <work-dir> <virtual-input-binary>}"
DRIVER="${3:?usage: build-session-share.sh <repo-root> <work-dir> <virtual-input-binary>}"
HARNESS="$REPO/test/desktop/harness"

test -x "$DRIVER" || { echo "virtual-input binary not executable: $DRIVER" >&2; exit 1; }
mkdir -p "$WORK/share/lib" "$WORK/share/session-out" "$WORK/seed"
cp "$HARNESS/lib/proc.mjs" "$HARNESS/lib/tools.mjs" "$HARNESS/lib/compositor.mjs" \
  "$HARNESS/lib/virtualInput.mjs" "$WORK/share/lib/"
cp "$HARNESS/guest/run-session.mjs" "$WORK/share/run-session.mjs"
cp "$HARNESS/guest/stage2.sh" "$WORK/share/stage2.sh"
cp "$HARNESS/guest/m111qa-session.service" "$WORK/share/m111qa-session.service"
cp "$DRIVER" "$WORK/share/muse-virtual-input"
chmod +x "$WORK/share/muse-virtual-input"
# The guest runs as its cloud user, not as whoever built the share.
chmod -R a+rX "$WORK/share/lib" "$WORK/share/run-session.mjs"
cp "$HARNESS/guest/user-data" "$HARNESS/guest/meta-data" "$WORK/seed/"
# The cloud user (uid 1000) writes the results; a root build can say so now.
if [ "$(id -u)" = "0" ]; then
  chown 1000:1000 "$WORK/share/session-out"
fi

dd if=/dev/zero of="$WORK/share.img" bs=1M count=64 2>/dev/null
mkfs.ext4 -q -d "$WORK/share" "$WORK/share.img"
genisoimage -quiet -output "$WORK/seed.iso" -volid CIDATA -joliet -rock \
  "$WORK/seed/user-data" "$WORK/seed/meta-data"
echo "session share: $WORK/share.img $WORK/seed.iso"

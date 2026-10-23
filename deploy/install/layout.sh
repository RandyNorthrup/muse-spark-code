#!/bin/sh
# S0: lays out a trusted node release tarball: the runtime bundle, the legal
# files and the two systemd units, plus the state directories. Trust is the
# caller's job (install.sh verifies checksums and the release attestation
# first); this script checks members and the node runtime, unpacks, and sets
# modes. Under --root everything stays beneath the prefix and ownership is
# skipped, so the layout is inspectable without root.
set -eu
umask 022

MIN_NODE_MAJOR=22

die() {
  printf '%s\n' "$1" >&2
  exit 1
}
note() {
  printf '%s\n' "$1" >&2
}
usage() {
  cat <<'USAGE'
Usage: layout.sh --tarball FILE --root DIR [--node-bin BIN]
  --tarball FILE   a trusted muse-spark-code-acp release tarball
  --root DIR       the install prefix (/ for a live install)
  --node-bin BIN   the node binary the units call (default: node)
USAGE
}

TARBALL=''
ROOT=''
NODE_BIN='node'
while [ $# -gt 0 ]; do
  case "$1" in
    --help) usage && exit 0 ;;
    --tarball | --root | --node-bin) ;;
    *) die "unknown argument: $1" ;;
  esac
  [ $# -ge 2 ] || die "missing value: $1"
  case "$1" in
    --tarball) TARBALL=$2 ;;
    --root) ROOT=$2 ;;
    --node-bin) NODE_BIN=$2 ;;
  esac
  shift 2
done
[ -n "$TARBALL" ] || die 'missing --tarball'
[ -n "$ROOT" ] || die 'missing --root'
[ -f "$TARBALL" ] || die "tarball not found: $TARBALL"

need() {
  command -v "$1" >/dev/null 2>&1 || die "required tool missing: $1"
}
need tar
need grep
need find
need cp
need chmod
need mkdir

version=$("$NODE_BIN" --version 2>/dev/null) || die "node runtime missing or broken: $NODE_BIN"
major=${version#v}
major=${major%%.*}
case "$major" in
  '' | *[!0-9]*) die "node version unreadable: $version" ;;
esac
[ "$major" -ge "$MIN_NODE_MAJOR" ] || die "node 22 or newer required, found: $version"

members=$(tar -tzf "$TARBALL" 2>/dev/null) || die "tarball unreadable: $TARBALL"
echo "$members" | grep -q -x -F 'package/dist/node.js' || die 'tarball has no node runtime'
echo "$members" | grep -q -x -F 'package/LICENSE' || die 'tarball has no licence'
echo "$members" | grep -q -x -F 'package/THIRD_PARTY_NOTICES.txt' || die 'tarball has no notices'
if echo "$members" | grep -q -x -F 'package/dist/nodeToolHost.js'; then
  TOOLHOST='yes'
else
  TOOLHOST='no'
  note 'toolhost bundle absent: the toolhost unit stays inert until the release ships it'
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dest=$ROOT/opt/muse
if [ -e "$dest" ]; then
  [ -d "$dest" ] && [ ! -L "$dest" ] || die "not a directory: $dest"
  [ -z "$(find "$dest" -mindepth 1 -maxdepth 1 -print -quit)" ] || die "already installed: $dest"
fi

mkdir -p "$dest/dist" "$ROOT/etc/systemd/system" "$ROOT/var/lib/muse-spark-code-node/workspaces"
if [ "$TOOLHOST" = 'yes' ]; then
  tar -xzf "$TARBALL" -C "$dest" --strip-components=1 \
    package/dist/node.js package/dist/nodeToolHost.js package/LICENSE package/THIRD_PARTY_NOTICES.txt
else
  tar -xzf "$TARBALL" -C "$dest" --strip-components=1 \
    package/dist/node.js package/LICENSE package/THIRD_PARTY_NOTICES.txt
fi
find "$dest" -type d -exec chmod 0755 {} +
find "$dest" -type f -exec chmod 0644 {} +
cp "$here/muse-node.service" "$here/muse-node-toolhost.service" "$ROOT/etc/systemd/system/"
chmod 0644 "$ROOT/etc/systemd/system/muse-node.service" "$ROOT/etc/systemd/system/muse-node-toolhost.service"
chmod 0700 "$ROOT/var/lib/muse-spark-code-node" "$ROOT/var/lib/muse-spark-code-node/workspaces"

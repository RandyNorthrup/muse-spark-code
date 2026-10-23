#!/bin/sh
# S0: the native Linux installer's LAN profile. Verifies the release tarball
# (its SHA-256 entry plus the release's GitHub attestation), ensures the
# service users, lays the files out through layout.sh and enables the two
# systemd units. The firewall and node init stay the operator's explicit
# steps (docs/node/home.md). Upgrades are a later lane: reinstalling over a
# live install is refused.
set -eu
umask 022

REPO='RandyNorthrup/muse-spark-code'
NODE_UID=10001
TOOLS_UID=10002
BUS_GID=10003

die() {
  printf '%s\n' "$1" >&2
  exit 1
}
note() {
  printf '%s\n' "$1" >&2
}
usage() {
  cat <<'USAGE'
Usage: install.sh --tarball FILE --sums FILE [--bundle FILE] [--root DIR]
  --tarball FILE   the muse-spark-code-acp release tarball
  --sums FILE      the release SHA256SUMS listing the tarball
  --bundle FILE    an offline attestation bundle (else verified online)
  --root DIR       stage the file layout under DIR for inspection
                   (users, ownership and systemd stay untouched)
  --node-bin BIN   the node binary the units call (default: node)
  --gh-bin BIN     the gh binary for attestations (default: gh)
  --shasum-bin BIN the checksum checker (default: sha256sum, else shasum)
USAGE
}

TARBALL=''
SUMS=''
BUNDLE=''
ROOT='/'
NODE_BIN='node'
GH_BIN='gh'
SHASUM_BIN=''
while [ $# -gt 0 ]; do
  case "$1" in
    --help) usage && exit 0 ;;
    --tarball | --sums | --bundle | --root | --node-bin | --gh-bin | --shasum-bin) ;;
    *) die "unknown argument: $1" ;;
  esac
  [ $# -ge 2 ] || die "missing value: $1"
  case "$1" in
    --tarball) TARBALL=$2 ;;
    --sums) SUMS=$2 ;;
    --bundle) BUNDLE=$2 ;;
    --root) ROOT=$2 ;;
    --node-bin) NODE_BIN=$2 ;;
    --gh-bin) GH_BIN=$2 ;;
    --shasum-bin) SHASUM_BIN=$2 ;;
  esac
  shift 2
done
[ -n "$TARBALL" ] || die 'missing --tarball'
[ -n "$SUMS" ] || die 'missing --sums'
[ -f "$TARBALL" ] || die "tarball not found: $TARBALL"
[ -f "$SUMS" ] || die "checksums not found: $SUMS"
[ -z "$BUNDLE" ] || [ -f "$BUNDLE" ] || die "attestation bundle not found: $BUNDLE"
entry=$(basename "$TARBALL")
case "$entry" in
  muse-spark-code-acp-*.tgz) ;;
  *) die "not a node release tarball: $entry" ;;
esac

need() {
  command -v "$1" >/dev/null 2>&1 || die "required tool missing: $1"
}
need awk
need mktemp
need id
if [ -z "$SHASUM_BIN" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    SHASUM_BIN='sha256sum'
  elif command -v shasum >/dev/null 2>&1; then
    SHASUM_BIN='shasum -a 256'
  else
    die 'no checksum checker (sha256sum or shasum)'
  fi
else
  command -v "${SHASUM_BIN%% *}" >/dev/null 2>&1 || die "checksum checker missing: $SHASUM_BIN"
fi

# The tarball's own checksums entry must verify, from the tarball's directory.
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT INT TERM
awk -v name="$entry" '$2 == name' "$SUMS" >"$tmp"
[ -s "$tmp" ] || die "tarball not listed in checksums: $entry"
(cd -- "$(dirname -- "$TARBALL")" && $SHASUM_BIN -c "$tmp" >/dev/null) \
  || die "checksum mismatch: $entry"

# The release signed this exact tarball; without gh there is no install.
command -v "$GH_BIN" >/dev/null 2>&1 || die "gh not found: $GH_BIN"
if [ -n "$BUNDLE" ]; then
  "$GH_BIN" attestation verify "$TARBALL" --repo "$REPO" --bundle "$BUNDLE" >/dev/null \
    || die "attestation rejected: $entry"
else
  "$GH_BIN" attestation verify "$TARBALL" --repo "$REPO" >/dev/null \
    || die "attestation rejected: $entry"
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$ROOT" = '/' ]; then
  [ "$(id -u)" = '0' ] || die 're-run as root (users and systemd need it)'
  need useradd
  need groupadd
  need usermod
  need getent
  need cut
  need systemctl
  need install
  if getent group muse-bus >/dev/null 2>&1; then
    [ "$(getent group muse-bus | cut -d: -f3)" = "$BUS_GID" ] || die 'group muse-bus has the wrong gid'
  else
    groupadd -r -g "$BUS_GID" muse-bus
  fi
  for pair in "muse-node:$NODE_UID" "muse-tools:$TOOLS_UID"; do
    name=${pair%%:*}
    uid=${pair##*:}
    if getent passwd "$name" >/dev/null 2>&1; then
      [ "$(getent passwd "$name" | cut -d: -f3)" = "$uid" ] || die "user $name has the wrong uid"
    else
      useradd -r -u "$uid" -U -M -s /usr/sbin/nologin -d /nonexistent "$name"
    fi
    usermod -aG muse-bus "$name"
  done
fi

sh "$here/layout.sh" --tarball "$TARBALL" --root "$ROOT" --node-bin "$NODE_BIN"

if [ "$ROOT" = '/' ]; then
  chown "$NODE_UID:$NODE_UID" /var/lib/muse-spark-code-node
  chown "$TOOLS_UID:$TOOLS_UID" /var/lib/muse-spark-code-node/workspaces
  systemctl daemon-reload
  systemctl enable muse-node.service muse-node-toolhost.service
  note 'installed: initialize the node, open only its port, then start the units (docs/node/home.md)'
else
  note "layout under $ROOT: users, ownership and systemd skipped"
fi

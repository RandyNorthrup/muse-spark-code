#!/bin/sh
# Generated-only Linux native receipts; use a private bus/keyring, never the desktop vault anchor.
set -eu
receipt_root=$(mktemp -d "${TMPDIR:?Set TMPDIR to private disk-backed scratch}/vault-native-XXXXXX")
trap 'rm -rf "$receipt_root"' EXIT
export XDG_DATA_HOME="$receipt_root/data"
export XDG_CONFIG_HOME="$receipt_root/config"
export XDG_CACHE_HOME="$receipt_root/cache"
mkdir -m 700 "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$receipt_root/control"
export receipt_root
dbus-run-session -- sh -c '
  set -eu
  printf "\n" | gnome-keyring-daemon --foreground --unlock --components=secrets --control-directory "$receipt_root/control" > "$receipt_root/daemon.log" 2>&1 &
  keyring_pid=$!
  trap '\''kill "$keyring_pid" 2>/dev/null || true; wait "$keyring_pid" 2>/dev/null || true'\'' EXIT
  export MUSE_VAULT_TEST_ISOLATED=1
  node test/hosts/vault-os-store.mjs
  node test/hosts/vault-posix-broker.mjs
'

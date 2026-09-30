#!/bin/sh
# code-server check (hosts.yml, PLAN.md M62): installs VSIX into the given
# code-server with its data, extensions and settings in WORK, points the
# extension at the fake Muse Code CLI, serves on 127.0.0.1 and drives the
# panel (code-server.mjs). Screenshots and logs stay in WORK.
#
#   sh test/hosts/run-code-server.sh CODE_SERVER_BIN VSIX WORK
set -eu
cs="$1"
vsix="$2"
work="$3"
port="${HOSTS_PORT:-8123}"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$work/data/User" "$work/extensions" "$work/workspace"
muse="$(sh "$here/fake-muse.sh" "$work/fake-muse")"
printf 'hello\n' > "$work/workspace/notes.txt"
printf '{\n  "museSpark.museBinaryPath": "%s",\n  "workbench.startupEditor": "none",\n  "security.workspace.trust.enabled": false\n}\n' "$muse" \
  > "$work/data/User/settings.json"
printf 'bind-addr: 127.0.0.1:%s\nauth: none\ncert: false\n' "$port" > "$work/config.yaml"
set -- --config "$work/config.yaml" --user-data-dir "$work/data" --extensions-dir "$work/extensions"
"$cs" "$@" --install-extension "$vsix"
XDG_CONFIG_HOME="$work/fake-muse/config" "$cs" "$@" --disable-telemetry --disable-update-check \
  "$work/workspace" > "$work/code-server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
tries=0
until curl -s -o /dev/null "http://127.0.0.1:$port/"; do
  tries=$((tries + 1))
  if [ "$tries" -gt 120 ]; then
    echo "code-server did not start; its log:" >&2
    cat "$work/code-server.log" >&2
    exit 1
  fi
  sleep 0.5
done
"$cs" --version | head -1
node "$here/code-server.mjs" "http://127.0.0.1:$port" "$work/workspace" "$work/shots"
grep -rh "Activating Muse Spark" "$work/data/logs" || true

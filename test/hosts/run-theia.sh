#!/bin/sh
# Theia check (hosts.yml, PLAN.md M62): builds the browser app of
# test/hosts/theia in WORK, unpacks VSIX as its plugin, points the
# extension at the fake Muse Code CLI and drives it (theia.mjs). Theia's
# configuration folder is WORK's too.
#
#   sh test/hosts/run-theia.sh VSIX WORK
set -eu
vsix="$1"
work="$2"
port="${HOSTS_PORT:-3030}"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$work/app" "$work/config" "$work/workspace"
cp "$here/theia/package.json" "$work/app/package.json"
(cd "$work/app" && npm install --no-audit --no-fund --loglevel=error && npx theia build --mode development)
rm -rf "$work/app/plugins" && mkdir -p "$work/app/plugins/muse-spark-code"
unzip -q "$vsix" 'extension/*' -d "$work/unpacked"
cp -R "$work/unpacked/extension/." "$work/app/plugins/muse-spark-code/"
muse="$(sh "$here/fake-muse.sh" "$work/fake-muse")"
printf 'hello\n' > "$work/workspace/notes.txt"
printf '{\n  "museSpark.museBinaryPath": "%s",\n  "security.workspace.trust.enabled": false\n}\n' "$muse" \
  > "$work/config/settings.json"
(cd "$work/app" && THEIA_CONFIG_DIR="$work/config" XDG_CONFIG_HOME="$work/fake-muse/config" \
  npx theia start --hostname 127.0.0.1 --port "$port" --plugins=local-dir:plugins "$work/workspace") \
  > "$work/theia.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true; pkill -f "$work/app" 2>/dev/null || true' EXIT
tries=0
until grep -q "Theia app listening" "$work/theia.log"; do
  tries=$((tries + 1))
  if [ "$tries" -gt 240 ]; then
    echo "Theia did not start; its log:" >&2
    cat "$work/theia.log" >&2
    exit 1
  fi
  sleep 0.5
done
grep -o '"version": "[^"]*"' "$work/app/node_modules/@theia/core/package.json" | head -1
node "$here/theia.mjs" "http://localhost:$port" "$work/workspace" "$work/shots"

#!/bin/sh
# VSCodium check (hosts.yml, PLAN.md M62): the extension's integration tests
# in VSCodium RELEASE (a tag such as 1.99.32846, or `latest`, read from
# VSCodium's own version feed), downloaded into WORK. Needs the dev build
# (`npm run build:dev`) and a display (xvfb-run on Linux).
#
#   sh test/hosts/run-vscodium.sh RELEASE WORK
set -eu
release="$1"
work="$2"
here="$(cd "$(dirname "$0")" && pwd)"
if [ "$release" = latest ]; then
  release="$(curl -fsSL https://raw.githubusercontent.com/VSCodium/versions/master/stable/linux/x64/latest.json \
    | node -e 'let s="";process.stdin.on("data",(c)=>{s+=c}).on("end",()=>{process.stdout.write(JSON.parse(s).name)})')"
fi
mkdir -p "$work/vscodium"
curl -fsSL -o "$work/vscodium.tar.gz" \
  "https://github.com/VSCodium/vscodium/releases/download/$release/VSCodium-linux-x64-$release.tar.gz"
tar -xzf "$work/vscodium.tar.gz" -C "$work/vscodium"
echo "VSCodium $release"
cd "$here/../.."
HOST_BIN="$work/vscodium/codium" HOST_LABEL=vscodium npx vscode-test --config test/hosts/installed.vscode-test.mjs

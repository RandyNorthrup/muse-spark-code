#!/bin/sh
# M80 H1-H2 against an installed PRODUCTION package: its help names the
# headless commands, and the trust flag is refused with exit 2. The key's
# round trip through the OS credential store is keystore.sh.
# sh test/hosts/exec.sh <installed-package-root>
set -eu
package=$(cd "$1" && pwd)
agent="$package/dist/acp.js"
export LANG=C LC_ALL=C
mkdir -p temp
work=$(mktemp -d "$(pwd)/temp/m80-host.XXXXXX")
cleanup() {
  code=$?
  trap - EXIT HUP INT TERM
  rm -rf -- "$work"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
fail() { echo "FAIL $1" >&2; exit 1; }

node "$agent" --help > "$work/help"
grep -Fq 'exec' "$work/help" || fail 'exec help'
grep -Fq 'scan-secrets' "$work/help" || fail 'scanner help'
code=0
node "$agent" exec --trust-workspace hello > "$work/refused" 2>&1 || code=$?
[ "$code" = 2 ] || fail 'trust flag must exit 2'
echo 'ok   installed headless help and trust refusal'

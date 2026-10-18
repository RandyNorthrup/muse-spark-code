#!/bin/sh
# M80 H1-H2 against an installed PRODUCTION package: its help names the
# headless commands, and the trust flag is refused with exit 2. The key's
# round trip through the OS credential store is keystore.sh.
# AUDITCLI (0.19.0): every terminal misuse exits 2 with words that name the
# flag or argument (each row below failed before that fix: exit 1, or a
# refusal that did not name the flag), and --help exits 0 everywhere. These
# run here, not in test/unit: the unit shards run `vitest` without `dist/`.
# Parse-only paths: no store, no network, no model.
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

# Every misuse exits 2 and names its flag or argument; --help exits 0.
refuses() {
  token=$1; shift
  code=0
  out=$(node "$agent" "$@" 2>&1) || code=$?
  [ "$code" = 2 ] || fail "exit 2 naming [$token]: $* (got $code)"
  case "$out" in *"$token"*) ;; *) fail "names [$token]: $*";; esac
  echo "ok   refuses [$*] naming [$token]"
}
refuses 'frobnicate' frobnicate
refuses 'providers accounts' providers accounts bogus
refuses '--provider' login --provider foo
refuses '--effort none' exec --effort none hi
refuses '--timeout' exec --timeout abc hi
refuses '--range' usage --range bogus
refuses 'developer' developer --help
prints_help() {
  code=0
  out=$(node "$agent" "$@" 2>&1) || code=$?
  [ "$code" = 0 ] || fail "help exits 0: $* (got $code)"
  [ -n "$out" ] || fail "help prints: $*"
  echo "ok   help [$*] exits 0"
}
prints_help --help
prints_help exec --help
prints_help help --all

# No bound of ours: a set value past every removed bound is honored, and no
# value means no limit. Parsing reaches the missing prompt instead of
# refusing the flag (exit 2 names the prompt, never the flag).
past_bound() {
  token=$1; shift
  code=0
  out=$(node "$agent" "$@" 2>&1) || code=$?
  [ "$code" = 2 ] || fail "reaches the prompt check: $* (got $code)"
  case "$out" in *'Provide one nonempty prompt.'*) ;; *) fail "prompt check: $*";; esac
  if [ -n "$token" ]; then
    case "$out" in *"$token"*) fail "still bounds [$token]: $*";; esac
  fi
  echo "ok   past bound [$*]"
}
past_bound '--max-requests' exec --backend modelApi --max-budget-usd 1 --max-requests 1000000
past_bound '--timeout' exec --timeout 1000000
past_bound '' exec --timeout 9
past_bound '--max-budget-usd' exec --backend modelApi --max-budget-usd 250.5
past_bound '' exec --backend modelApi --max-budget-usd 1

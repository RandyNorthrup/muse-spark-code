#!/bin/sh
# The Model API key's round trip through the operating system's credential
# store (hosts.yml, PLAN.md D61): no key, `auth set` from a pipe, `auth
# status`, `auth clear`, no key again, with the installed
# muse-spark-code-acp. The key is made up; nothing is sent anywhere. On
# Linux run it inside a D-Bus session with an unlocked Secret Service.
#
#   sh test/hosts/keystore.sh AGENT
set -u
agent="$1"
fail() {
  echo "FAIL $1" >&2
  exit 1
}
if "$agent" auth status; then fail "a key was stored before the check"; fi
printf 'LLM|123456|made-up-for-the-ci-check\n' | "$agent" auth set || fail "auth set"
"$agent" auth status || fail "auth status after set"
"$agent" auth clear || fail "auth clear"
if "$agent" auth status; then fail "the key outlived auth clear"; fi
echo "ok   the key went into the credential store and out again"

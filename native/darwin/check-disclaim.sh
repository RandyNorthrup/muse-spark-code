#!/usr/bin/env bash
# Checks the built helper's disclaim (PLAN.md M28) with no one at the Mac.
# The helper starts a copy of itself that disclaims the responsibility of
# the app that started it, and only that copy asks macOS under the helper's
# own name, so its "asking macOS … for muse-dictate" line proves the copy
# made the request. If the request is still pending (a prompt on screen),
# a SIGTERM to the first process must end the copy too, and the first
# process must exit as a SIGTERM does (143). If macOS answered at once (a
# refusal), the helper must have exited with its refusal code (2).
set -euo pipefail

cd "$(dirname "$0")"

HELPER="$PWD/muse-dictate"
ERR="$(mktemp -t muse-dictate-check)"
trap 'rm -f "$ERR"' EXIT
EXIT_REFUSED=2
EXIT_SIGTERM=143
WAIT_SECONDS=15

# stdin stays open (the pipe from sleep), so the helper does not quit on EOF.
# The copy's marker is cleared, so only the helper itself can set it.
sleep 60 | env -u MUSE_DICTATE_DISCLAIMED "$HELPER" --app-name "the disclaim check" > /dev/null 2> "$ERR" &
helper=$!

for _ in $(seq 1 "$WAIT_SECONDS"); do
  grep -q 'asking macOS for speech recognition' "$ERR" && break
  kill -0 "$helper" 2>/dev/null || break
  sleep 1
done

if ! grep -q 'asking macOS for speech recognition for muse-dictate' "$ERR"; then
  echo "the request was not made under the helper's own name:" >&2
  cat "$ERR" >&2
  kill -TERM "$helper" 2>/dev/null || true
  exit 1
fi

if kill -0 "$helper" 2>/dev/null; then
  if ! pgrep -P "$helper" -f "$HELPER" > /dev/null; then
    echo "the helper is waiting on macOS without a disclaimed copy of itself" >&2
    kill -TERM "$helper"
    exit 1
  fi
  kill -TERM "$helper"
  # Bounded: a parent that does not relay the signal would wait for ever.
  for _ in $(seq 1 "$WAIT_SECONDS"); do
    kill -0 "$helper" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$helper" 2>/dev/null; then
    echo "the helper did not end within ${WAIT_SECONDS} s of SIGTERM" >&2
    pkill -KILL -f "$HELPER" || true
    exit 1
  fi
  status=0
  wait "$helper" || status=$?
  if [ "$status" -ne "$EXIT_SIGTERM" ]; then
    echo "the helper exited with $status after SIGTERM, not $EXIT_SIGTERM" >&2
    exit 1
  fi
  sleep 1
  if pgrep -f "$HELPER" > /dev/null; then
    echo "the disclaimed copy outlived its parent's SIGTERM" >&2
    exit 1
  fi
  echo "disclaimed request pending; SIGTERM ended both processes (exit $status)"
else
  status=0
  wait "$helper" || status=$?
  if [ "$status" -ne "$EXIT_REFUSED" ]; then
    echo "the helper exited with $status, not the refusal code $EXIT_REFUSED:" >&2
    cat "$ERR" >&2
    exit 1
  fi
  echo "disclaimed request answered at once (exit $status)"
fi

#!/usr/bin/env bash
# systemd-analyze security threshold gate (OS4).
#
# Fails when any listed unit's exposure exceeds the threshold. The threshold
# is in tenths of an exposure point from 0 to 100 (systemd-analyze
# --threshold=N fails a unit whose exposure is strictly greater than N/10
# and refuses N above 100; see analyze-security.c).
#
# Usage: security-threshold.sh --root DIR --threshold TENTHS unit [unit...]
# Exit: 0 all units within threshold, 1 a unit exceeds it (systemd-analyze's
# own exit), 2 bad arguments, 3 systemd-analyze not installed.
set -euo pipefail

usage() {
  echo "usage: security-threshold.sh --root DIR --threshold TENTHS unit [unit...]" >&2
}

ROOT=""
THRESHOLD=""
UNITS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ROOT="${2:?missing value for --root}"; shift 2;;
    --threshold)
      THRESHOLD="${2:?missing value for --threshold}"; shift 2;;
    --help|-h)
      usage; exit 0;;
    --*)
      echo "security-threshold.sh: unknown option: $1" >&2; usage; exit 2;;
    *)
      UNITS+=("$1"); shift;;
  esac
done

[[ -n "$ROOT" ]] || { echo "security-threshold.sh: --root is required" >&2; usage; exit 2; }
[[ -d "$ROOT" ]] || { echo "security-threshold.sh: root is not a directory: $ROOT" >&2; exit 2; }
[[ "$THRESHOLD" =~ ^[0-9]+$ ]] && [[ "$THRESHOLD" -le 100 ]] || { echo "security-threshold.sh: --threshold must be an integer in tenths from 0 to 100" >&2; exit 2; }
[[ "${#UNITS[@]}" -ge 1 ]] || { echo "security-threshold.sh: at least one unit is required" >&2; usage; exit 2; }
command -v systemd-analyze >/dev/null || { echo "security-threshold.sh: systemd-analyze not installed" >&2; exit 3; }

exec systemd-analyze security --offline=yes --root="$ROOT" --threshold="$THRESHOLD" "${UNITS[@]}"

#!/usr/bin/env bash
# Bind the LUKS2 /var device to a Tang server with Clevis (OS4, optional).
#
# The pin config carries the Tang URL and the server's advertised signing-key
# thumbprint (from tang-show-keys, base64url SHA-256, 43 characters). The
# config is validated before clevis runs; the existing LUKS passphrase is
# asked for interactively by clevis itself on the console.
#
# Usage: bind-tang.sh --device DEV --config FILE [--dry-run]
# Exit: 0 bound, 1 clevis failed, 2 bad arguments or config, 3 tool missing.
# --dry-run validates the config and prints the clevis command without
# needing the device to exist; the live run refuses a missing device first.
set -euo pipefail

usage() {
  echo "usage: bind-tang.sh --device DEV --config FILE [--dry-run]" >&2
}

DEVICE=""
CONFIG=""
DRY_RUN="no"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE="${2:?missing value for --device}"; shift 2;;
    --config)
      CONFIG="${2:?missing value for --config}"; shift 2;;
    --dry-run)
      DRY_RUN="yes"; shift;;
    --help|-h)
      usage; exit 0;;
    --*)
      echo "bind-tang.sh: unknown option: $1" >&2; usage; exit 2;;
    *)
      echo "bind-tang.sh: unexpected argument: $1" >&2; usage; exit 2;;
  esac
done

[[ -n "$DEVICE" ]] || { echo "bind-tang.sh: --device is required" >&2; usage; exit 2; }
[[ -n "$CONFIG" ]] || { echo "bind-tang.sh: --config is required" >&2; usage; exit 2; }
[[ -r "$CONFIG" ]] || { echo "bind-tang.sh: config is not readable: $CONFIG" >&2; exit 2; }
command -v python3 >/dev/null || { echo "bind-tang.sh: python3 not installed" >&2; exit 3; }

PIN_JSON="$(python3 - "$CONFIG" <<'EOF'
import json, re, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    config = json.load(handle)
url = config.get("url")
thp = config.get("thp")
if not isinstance(url, str) or not re.fullmatch(r"https?://[^/\s]+(:\d+)?(/.*)?", url):
    sys.exit("tang config url must be an http(s) URL")
if not isinstance(thp, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", thp):
    sys.exit("tang config thp must be the 43-character base64url thumbprint")
print(json.dumps({"url": url, "thp": thp}))
EOF
)" || { echo "bind-tang.sh: invalid tang config: $CONFIG" >&2; exit 2; }

if [[ "$DRY_RUN" == "yes" ]]; then
  echo "clevis luks bind -d $DEVICE tang '$PIN_JSON'"
  exit 0
fi

[[ -b "$DEVICE" ]] || { echo "bind-tang.sh: not a block device: $DEVICE" >&2; exit 2; }
command -v clevis >/dev/null || { echo "bind-tang.sh: clevis not installed" >&2; exit 3; }
exec clevis luks bind -d "$DEVICE" tang "$PIN_JSON"

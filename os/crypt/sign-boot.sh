#!/usr/bin/env bash
# Sign a boot binary (UKI, bootloader, kernel EFI) with sbsign (OS4).
#
# Signs --input with the Secure Boot key and certificate, writes --output,
# then verifies the output with sbverify before succeeding. When signing or
# verification fails no output is left behind. --verify-only runs the
# sbverify check alone, for release verification of published binaries.
#
# Usage: sign-boot.sh --key KEY --cert CERT --input EFI --output OUT
#        sign-boot.sh --verify-only --cert CERT --input EFI
# Exit: 0 signed and verified (or verified), 1 sign or verify failed,
# 2 bad arguments, 3 sbsign/sbverify not installed.
set -euo pipefail

usage() {
  echo "usage: sign-boot.sh --key KEY --cert CERT --input EFI --output OUT" >&2
  echo "       sign-boot.sh --verify-only --cert CERT --input EFI" >&2
}

KEY=""
CERT=""
INPUT=""
OUTPUT=""
VERIFY_ONLY="no"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)
      KEY="${2:?missing value for --key}"; shift 2;;
    --cert)
      CERT="${2:?missing value for --cert}"; shift 2;;
    --input)
      INPUT="${2:?missing value for --input}"; shift 2;;
    --output)
      OUTPUT="${2:?missing value for --output}"; shift 2;;
    --verify-only)
      VERIFY_ONLY="yes"; shift;;
    --help|-h)
      usage; exit 0;;
    --*)
      echo "sign-boot.sh: unknown option: $1" >&2; usage; exit 2;;
    *)
      echo "sign-boot.sh: unexpected argument: $1" >&2; usage; exit 2;;
  esac
done

if [[ "$VERIFY_ONLY" == "yes" ]]; then
  [[ -n "$KEY$OUTPUT" ]] && { echo "sign-boot.sh: --key and --output are not used with --verify-only" >&2; exit 2; }
  [[ -n "$CERT" ]] || { echo "sign-boot.sh: --cert is required" >&2; usage; exit 2; }
  [[ -n "$INPUT" ]] || { echo "sign-boot.sh: --input is required" >&2; usage; exit 2; }
  [[ -r "$CERT" ]] || { echo "sign-boot.sh: certificate is not readable: $CERT" >&2; exit 2; }
  [[ -r "$INPUT" ]] || { echo "sign-boot.sh: input is not readable: $INPUT" >&2; exit 2; }
  command -v sbverify >/dev/null || { echo "sign-boot.sh: sbverify not installed" >&2; exit 3; }
  if sbverify --cert "$CERT" "$INPUT" >/dev/null 2>&1; then
    echo "sign-boot.sh: verification OK: $INPUT" >&2
  else
    echo "sign-boot.sh: verification failed: $INPUT" >&2
    exit 1
  fi
  exit 0
fi

[[ -n "$KEY" ]] || { echo "sign-boot.sh: --key is required" >&2; usage; exit 2; }
[[ -n "$CERT" ]] || { echo "sign-boot.sh: --cert is required" >&2; usage; exit 2; }
[[ -n "$INPUT" ]] || { echo "sign-boot.sh: --input is required" >&2; usage; exit 2; }
[[ -n "$OUTPUT" ]] || { echo "sign-boot.sh: --output is required" >&2; usage; exit 2; }
[[ -r "$KEY" ]] || { echo "sign-boot.sh: key is not readable: $KEY" >&2; exit 2; }
[[ -r "$CERT" ]] || { echo "sign-boot.sh: certificate is not readable: $CERT" >&2; exit 2; }
[[ -r "$INPUT" ]] || { echo "sign-boot.sh: input is not readable: $INPUT" >&2; exit 2; }
command -v sbsign >/dev/null || { echo "sign-boot.sh: sbsign not installed" >&2; exit 3; }
command -v sbverify >/dev/null || { echo "sign-boot.sh: sbverify not installed" >&2; exit 3; }

if sbsign --key "$KEY" --cert "$CERT" --output "$OUTPUT" "$INPUT" >/dev/null 2>&1 \
  && sbverify --cert "$CERT" "$OUTPUT" >/dev/null 2>&1; then
  echo "sign-boot.sh: signed and verified: $OUTPUT" >&2
else
  rm -f "$OUTPUT"
  echo "sign-boot.sh: signing or verification failed; output deleted" >&2
  exit 1
fi

#!/usr/bin/env bash
# Enroll the LUKS2 /var device with systemd-cryptenroll (OS4).
#
# Enrolls, in order: the TPM2 chip (bound to the current PCR values and to
# the signed policy public key so OS updates keep unlocking), then a freshly
# generated recovery key, which is printed once on stdout for the operator to
# record. The pre-enrollment passphrase is read from stdin and held only in
# memory; it never appears in arguments, the environment, or a file.
#
# The optional TPM PIN (--with-pin yes) is enrolled interactively on the
# console by systemd-cryptenroll itself; that mode needs a TTY.
#
# Usage: enroll-var.sh --device DEV --public-key FILE --public-key-pcrs PCRS
#          [--pcrs PCRS] [--tpm2-device PATH] [--with-pin yes|no]
#          [--wipe-slot SLOT] [--dry-run] < passphrase
# Exit: 0 enrolled, 1 cryptenroll failed, 2 bad arguments, 3 tool missing.
# --dry-run checks the argument shapes and prints the cryptenroll commands
# without needing the device or key to exist; the live run refuses a
# missing device or unreadable key before reading the passphrase.
set -euo pipefail

usage() {
  echo "usage: enroll-var.sh --device DEV --public-key FILE --public-key-pcrs PCRS [--pcrs PCRS] [--tpm2-device PATH] [--with-pin yes|no] [--wipe-slot SLOT] [--dry-run]" >&2
}

DEVICE=""
PUBLIC_KEY=""
PUBLIC_KEY_PCRS=""
PCRS="7"
TPM2_DEVICE="auto"
WITH_PIN="no"
WIPE_SLOT=""
DRY_RUN="no"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE="${2:?missing value for --device}"; shift 2;;
    --public-key)
      PUBLIC_KEY="${2:?missing value for --public-key}"; shift 2;;
    --public-key-pcrs)
      PUBLIC_KEY_PCRS="${2:?missing value for --public-key-pcrs}"; shift 2;;
    --pcrs)
      PCRS="${2:?missing value for --pcrs}"; shift 2;;
    --tpm2-device)
      TPM2_DEVICE="${2:?missing value for --tpm2-device}"; shift 2;;
    --with-pin)
      WITH_PIN="${2:?missing value for --with-pin}"; shift 2;;
    --wipe-slot)
      WIPE_SLOT="${2:?missing value for --wipe-slot}"; shift 2;;
    --dry-run)
      DRY_RUN="yes"; shift;;
    --help|-h)
      usage; exit 0;;
    --*)
      echo "enroll-var.sh: unknown option: $1" >&2; usage; exit 2;;
    *)
      echo "enroll-var.sh: unexpected argument: $1" >&2; usage; exit 2;;
  esac
done

[[ -n "$DEVICE" ]] || { echo "enroll-var.sh: --device is required" >&2; usage; exit 2; }
[[ -n "$PUBLIC_KEY" ]] || { echo "enroll-var.sh: --public-key is required" >&2; usage; exit 2; }
[[ "$PUBLIC_KEY_PCRS" =~ ^[0-9]+(\+[0-9]+)*$ ]] || { echo "enroll-var.sh: --public-key-pcrs must look like 7 or 4+7: $PUBLIC_KEY_PCRS" >&2; exit 2; }
[[ "$PCRS" =~ ^[0-9]+(\+[0-9]+)*$ ]] || { echo "enroll-var.sh: --pcrs must look like 7 or 4+7: $PCRS" >&2; exit 2; }
[[ "$WITH_PIN" == "yes" || "$WITH_PIN" == "no" ]] || { echo "enroll-var.sh: --with-pin must be yes or no" >&2; exit 2; }
if [[ -n "$WIPE_SLOT" ]]; then
  [[ "$WIPE_SLOT" =~ ^(empty|password|recovery|pkcs11|fido2|tpm2|[0-9]+)$ ]] || { echo "enroll-var.sh: bad --wipe-slot: $WIPE_SLOT" >&2; exit 2; }
fi

TPM_ARGS=(--tpm2-device="$TPM2_DEVICE" --tpm2-pcrs="$PCRS" --tpm2-public-key="$PUBLIC_KEY" --tpm2-public-key-pcrs="$PUBLIC_KEY_PCRS")
[[ "$WITH_PIN" == "yes" ]] && TPM_ARGS+=(--tpm2-with-pin=yes)
[[ -n "$WIPE_SLOT" ]] && TPM_ARGS+=(--wipe-slot="$WIPE_SLOT")

if [[ "$DRY_RUN" == "yes" ]]; then
  echo "systemd-cryptenroll ${TPM_ARGS[*]} $DEVICE <passphrase-on-stdin>"
  echo "systemd-cryptenroll --recovery-key $DEVICE <passphrase-on-stdin>"
  exit 0
fi

[[ -b "$DEVICE" ]] || { echo "enroll-var.sh: not a block device: $DEVICE" >&2; exit 2; }
[[ -r "$PUBLIC_KEY" ]] || { echo "enroll-var.sh: public key is not readable: $PUBLIC_KEY" >&2; exit 2; }
command -v systemd-cryptenroll >/dev/null || { echo "enroll-var.sh: systemd-cryptenroll not installed" >&2; exit 3; }

echo "enroll-var.sh: reading the current passphrase from stdin" >&2
IFS= read -rs PASSPHRASE || true
[[ -n "${PASSPHRASE:-}" ]] || { echo "enroll-var.sh: no passphrase on stdin" >&2; exit 2; }
printf '%s' "$PASSPHRASE" | systemd-cryptenroll "${TPM_ARGS[@]}" "$DEVICE"
printf '%s' "$PASSPHRASE" | systemd-cryptenroll --recovery-key "$DEVICE"
PASSPHRASE=""
echo "enroll-var.sh: enrolled; record the recovery key printed above" >&2

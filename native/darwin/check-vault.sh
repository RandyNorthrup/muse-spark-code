#!/usr/bin/env bash
# Pure protocol/crypto checks, one thin binary per Mac architecture (D209).
# The separate --keychain capture is opt-in because unlocking the login
# Keychain and OS access prompts belong to the user. Only the host
# architecture executes here (no Rosetta guarantee in CI); both slices are
# signature-verified.
set -euo pipefail
cd "$(dirname "$0")/../.."
case "$(uname -m)" in arm64) HOST_ARCH=arm64 ;; *) HOST_ARCH=x64 ;; esac
for arch in arm64 x64; do
  codesign --verify --strict "$PWD/dist/native/darwin/muse-vault-${arch}"
done
HELPER="$PWD/dist/native/darwin/muse-vault-${HOST_ARCH}"
SCRATCH="$PWD/temp/m109-p/native-check"
mkdir -p "$SCRATCH"
swiftc -parse-as-library -D VAULT_TEST -Osize -o "$SCRATCH/contracts" \
  native/darwin/VaultKey.swift test/unit/helpers/vault/macVaultNative.swift
"$SCRATCH/contracts"
python3 test/unit/helpers/vault/macVaultCapture.py "$HELPER" "$@"

#!/usr/bin/env bash
# Pure protocol/crypto checks. The separate --keychain capture is opt-in because
# unlocking the login Keychain and OS access prompts belong to the user.
set -euo pipefail
cd "$(dirname "$0")/../.."
HELPER="$PWD/dist/native/darwin/muse-vault"
SCRATCH="$PWD/temp/m109-p/native-check"
mkdir -p "$SCRATCH"
swiftc -parse-as-library -D VAULT_TEST -Osize -o "$SCRATCH/contracts" \
  native/darwin/VaultKey.swift test/unit/helpers/vault/macVaultNative.swift
"$SCRATCH/contracts"
python3 test/unit/helpers/vault/macVaultCapture.py "$HELPER" "$@"

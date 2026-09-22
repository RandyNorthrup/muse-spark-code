#!/usr/bin/env bash
# Builds the macOS dictation helper (native/darwin/muse-dictate): a universal
# binary from Dictation.swift with Info.plist embedded in the __info_plist
# section (the usage descriptions behind the permission prompts) and an
# ad-hoc signature. Runs in CI's macOS job; the .vsix packaged there carries
# the result. The binary is git-ignored: a Windows or Linux checkout cannot
# build it, and a package built there says so in the panel.
set -euo pipefail

cd "$(dirname "$0")"

MIN_MACOS=12.0
ARCHES=(arm64 x86_64)
OUTPUT=muse-dictate

for arch in "${ARCHES[@]}"; do
  swiftc -O \
    -target "${arch}-apple-macos${MIN_MACOS}" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist \
    -o "${OUTPUT}-${arch}" \
    Dictation.swift
done

lipo -create -output "$OUTPUT" "${OUTPUT}-arm64" "${OUTPUT}-x86_64"
rm -f "${OUTPUT}-arm64" "${OUTPUT}-x86_64"
codesign --force --sign - "$OUTPUT"
lipo -info "$OUTPUT"
ls -l "$OUTPUT"

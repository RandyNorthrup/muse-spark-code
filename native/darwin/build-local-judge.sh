#!/usr/bin/env bash
# M28's universal/ad-hoc-signed helper approach, without dictation entitlements.
# Assembly copies this ignored artifact into the signed extension/ACP package.
set -euo pipefail
cd "$(dirname "$0")"
MIN_MACOS=12.0
OUTPUT=muse-local-judge-peer
trap 'rm -f "${OUTPUT}-arm64" "${OUTPUT}-x86_64" "${OUTPUT}-universal"' EXIT
for arch in arm64 x86_64; do
  xcrun clang -std=c11 -O2 -Wall -Wextra -Werror \
    -target "${arch}-apple-macos${MIN_MACOS}" \
    LocalJudgePeer.c -lproc -o "${OUTPUT}-${arch}"
done
lipo -create -output "${OUTPUT}-universal" "${OUTPUT}-arm64" "${OUTPUT}-x86_64"
codesign --force --sign - "${OUTPUT}-universal"
codesign --verify --strict "${OUTPUT}-universal"
mv "${OUTPUT}-universal" "$OUTPUT"
lipo -info "$OUTPUT"

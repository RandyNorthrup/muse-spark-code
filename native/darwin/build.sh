#!/usr/bin/env bash
# Builds the macOS dictation helper (native/darwin/muse-dictate): a universal
# binary from Dictation.swift with Info.plist embedded in the __info_plist
# section (the usage descriptions behind the permission prompts) and an
# ad-hoc signature. Runs in CI's macOS job, which hands the binary to the
# package job (Ubuntu) that packs the .vsix. The binary is git-ignored: a
# Windows or Linux checkout cannot build it, and a package built there says
# so in the panel.
#
# The bundle version is the extension's own, read from package.json here
# and checked in the finished binary (M26, PLAN.md D29): Info.plist carries
# no version, so the two cannot drift apart by hand.
#
# Size (PLAN.md D6, the .vsix budget): optimised for size, unreferenced code
# dead-stripped at link time (SwiftPM's release default) and local symbols
# stripped from each slice before signing. Nothing reads them: the helper
# finds its one private call with dlsym in the system's own images. Measured
# 2026-10-04 on the Mac mini (Swift 6.1.2): 109,034 bytes deflated as `-O`,
# 80,798 now; check-disclaim.sh passes on both.
set -euo pipefail

cd "$(dirname "$0")"

MIN_MACOS=12.0
ARCHES=(arm64 x86_64)
OUTPUT=muse-dictate
MANIFEST=../../package.json
VERSION_KEY=CFBundleShortVersionString

# plutil reads JSON as well as property lists.
VERSION="$(plutil -extract version raw -o - "$MANIFEST")"
PLIST="$(mktemp -t muse-dictate-plist)"
BUILD_DIR="$(mktemp -d -t muse-dictate-build)"
trap 'rm -f "$PLIST" "${OUTPUT}-arm64" "${OUTPUT}-x86_64"; rm -rf "$BUILD_DIR"' EXIT
cp Info.plist "$PLIST"
plutil -replace "$VERSION_KEY" -string "$VERSION" "$PLIST"

# Swift requires top-level statements in main.swift with multiple sources.
# Keep the existing dictation source intact; dispatch screen mode after its
# responsibility relay and before the first speech/microphone request.
awk '
  /^let session = isCaptureMode/ { print "ScreenRecord.runIfRequested()"; routes++ }
  { print }
  END {
    if (routes != 1) {
      print "screen-recording dispatch anchor must appear exactly once" > "/dev/stderr"
      exit 1
    }
  }
' Dictation.swift > "$BUILD_DIR/main.swift"

for arch in "${ARCHES[@]}"; do
  swiftc -Osize \
    -target "${arch}-apple-macos${MIN_MACOS}" \
    -Xlinker -dead_strip \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$PLIST" \
    -o "${OUTPUT}-${arch}" \
    "$BUILD_DIR/main.swift" ScreenRecord.swift
  strip -x "${OUTPUT}-${arch}"
done

lipo -create -output "$OUTPUT" "${OUTPUT}-arm64" "${OUTPUT}-x86_64"
codesign --force --sign - "$OUTPUT"

# `launchctl plist` prints a Mach-O's embedded __info_plist section.
EMBEDDED="$(launchctl plist __TEXT,__info_plist "$OUTPUT" |
  sed -n "s/.*\"${VERSION_KEY}\" = \"\\(.*\\)\";/\\1/p")"
if [ "$EMBEDDED" != "$VERSION" ]; then
  echo "the helper embeds ${VERSION_KEY} '${EMBEDDED}', package.json says '${VERSION}'" >&2
  exit 1
fi
echo "embedded ${VERSION_KEY}: ${EMBEDDED}"
lipo -info "$OUTPUT"
ls -l "$OUTPUT"

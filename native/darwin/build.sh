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
SCREEN_BUNDLE=muse-dictate-screen.app
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

# A command-line Mach-O has no localized bundle resources for TCC. Screen
# recording therefore launches the signed .app executable, through R1's
# trusted-path/signature ports. Keep the existing bare dictation path too.
APP="$BUILD_DIR/$SCREEN_BUNDLE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$OUTPUT" "$APP/Contents/MacOS/muse-dictate"
# Bundle-only keys belong in the generated .app, never the bare helper's
# sibling Info.plist: otherwise codesign treats native/darwin as a flat app.
plutil -insert CFBundleExecutable -string muse-dictate "$PLIST"
plutil -insert CFBundlePackageType -string APPL "$PLIST"
cp "$PLIST" "$APP/Contents/Info.plist"
# Refuse missing or stale resources; translations have one source in l10n/.
node --input-type=module - "$PWD" <<'JS'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const root = process.argv[2]
const readPlist = (file) => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }))
const info = readPlist(path.join(root, 'Info.plist'))
const keys = { nativeMicrophonePurpose: 'NSMicrophoneUsageDescription', nativeScreenPurpose: 'NSScreenCaptureUsageDescription', nativeSpeechPurpose: 'NSSpeechRecognitionUsageDescription' }
for (const language of info.CFBundleLocalizations) {
  const resource = readPlist(path.join(root, language + '.lproj', 'InfoPlist.strings'))
  const tableLanguage = { 'pt-BR': 'pt-br', 'zh-Hans': 'zh-cn', 'zh-Hant': 'zh-tw' }[language] ?? language
  const table = language === 'en' ? null : JSON.parse(readFileSync(path.join(root, '../../l10n/ui.' + tableLanguage + '.json'), 'utf8')).media
  for (const [key, plistKey] of Object.entries(keys)) {
    if (!resource[plistKey] || resource[plistKey] !== (table ? table[key] : info[plistKey])) throw new Error('localized permission resource is missing or stale: ' + language + '/' + plistKey)
  }
}
JS
for resource in *.lproj; do cp -R "$resource" "$APP/Contents/Resources/"; done
codesign --force --sign - "$APP"
codesign --verify --strict "$APP"
rm -rf "$SCREEN_BUNDLE"
cp -R "$APP" "$SCREEN_BUNDLE"
echo "screen helper signed with 14 translated InfoPlist.strings resources"


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

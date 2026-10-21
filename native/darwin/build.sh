#!/usr/bin/env bash
# Builds the macOS dictation helper from Dictation.swift with Info.plist
# embedded in the __info_plist section (the usage descriptions behind the
# permission prompts), shipped only as one thin signed .app executable per
# Mac architecture
# (native/darwin/muse-dictate-screen-arm64.app and -x64.app, each at
# Contents/MacOS/muse-dictate), which serves every role (dictation, screen
# recording, created-directory, process identity). Runs in CI's macOS job,
# which hands the bundles to the package job (Ubuntu) that packs the .vsix.
# The outputs are git-ignored: a Windows or Linux checkout cannot build
# them, and a package built there says so in the panel.
#
# The bundle version is the extension's own, read from package.json here
# and checked in the finished executable (M26, PLAN.md D29): Info.plist carries
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
# Repo arch names (VSIX targets, native/linux dirs); the compiler wants
# x86_64 where the repo says x64.
ARCHES=(arm64 x64)
SCREEN_EXECUTABLE=muse-dictate
MANIFEST=../../package.json
VERSION_KEY=CFBundleShortVersionString
case "$(uname -m)" in arm64) HOST_ARCH=arm64 ;; *) HOST_ARCH=x64 ;; esac

# plutil reads JSON as well as property lists.
VERSION="$(plutil -extract version raw -o - "$MANIFEST")"
PLIST="$(mktemp -t muse-dictate-plist)"
CREATED_OBJECT_DIR="$(mktemp -d -t muse-created-objects)"
CREATED_OBJECT="${CREATED_OBJECT_DIR}/created.o"
BUILD_DIR="$(mktemp -d -t muse-dictate-build)"
trap 'rm -f "$CREATED_OBJECT" "$PLIST"; rmdir "$CREATED_OBJECT_DIR"; rm -rf "$BUILD_DIR"' EXIT
cp Info.plist "$PLIST"
plutil -replace "$VERSION_KEY" -string "$VERSION" "$PLIST"
# Bundle-only keys belong in the generated .apps, never the sibling
# Info.plist: otherwise codesign treats native/darwin as a flat app.
plutil -insert CFBundleExecutable -string muse-dictate "$PLIST"
plutil -insert CFBundlePackageType -string APPL "$PLIST"

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

# One thin signed .app per Mac architecture (D209): darwin-arm64 ships only
# the arm64 slices, darwin-x64 only x86_64. A command-line Mach-O has no
# localized bundle resources for TCC, so every role runs its architecture's
# signed .app executable, through R1's trusted-path/signature ports; no
# universal or bare binary is produced or shipped. Dictation's microphone
# permission comes from the bundle's localized resources, as screen
# recording's already does.
for arch in "${ARCHES[@]}"; do
  if [ "$arch" = arm64 ]; then cc_arch=arm64; else cc_arch=x86_64; fi
  cc -Os -Wall -Wextra -Werror -arch "$cc_arch" -mmacosx-version-min="$MIN_MACOS" \
    -c MuseSparkCreated.c -o "$CREATED_OBJECT"
  swiftc -Osize \
    -target "${cc_arch}-apple-macos${MIN_MACOS}" \
    -Xlinker -dead_strip \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$PLIST" \
    -o "$BUILD_DIR/${SCREEN_EXECUTABLE}-${arch}" \
    "$BUILD_DIR/main.swift" ScreenRecord.swift "$CREATED_OBJECT"
  strip -x "$BUILD_DIR/${SCREEN_EXECUTABLE}-${arch}"
  APP="$BUILD_DIR/muse-dictate-screen-${arch}.app"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  mv "$BUILD_DIR/${SCREEN_EXECUTABLE}-${arch}" "$APP/Contents/MacOS/$SCREEN_EXECUTABLE"
  cp "$PLIST" "$APP/Contents/Info.plist"
  for resource in *.lproj; do cp -R "$resource" "$APP/Contents/Resources/"; done
  codesign --force --sign - "$APP"
  codesign --verify --strict "$APP"
  rm -rf "muse-dictate-screen-${arch}.app"
  cp -R "$APP" "muse-dictate-screen-${arch}.app"
  # `launchctl plist` prints a Mach-O's embedded __info_plist section; it
  # reads the section, so it verifies every architecture, not only the host's.
  EXECUTABLE="muse-dictate-screen-${arch}.app/Contents/MacOS/$SCREEN_EXECUTABLE"
  EMBEDDED="$(launchctl plist __TEXT,__info_plist "$EXECUTABLE" |
    sed -n "s/.*\"${VERSION_KEY}\" = \"\\(.*\\)\";/\\1/p")"
  if [ "$EMBEDDED" != "$VERSION" ]; then
    echo "the ${arch} helper embeds ${VERSION_KEY} '${EMBEDDED}', package.json says '${VERSION}'" >&2
    exit 1
  fi
  echo "${arch} embedded ${VERSION_KEY}: ${EMBEDDED}"
  codesign --verify --strict "$EXECUTABLE"
  lipo -info "$EXECUTABLE"
  ls -l "$EXECUTABLE"
done
echo "screen helpers signed with 14 translated InfoPlist.strings resources"
# Process identity is read-only and dispatched before any audio/privacy
# setup. Only the host architecture can execute here (no Rosetta
# guarantee in CI); the other slice gets the same dispatch through the
# same sources, verified above without running.
"./muse-dictate-screen-${HOST_ARCH}.app/Contents/MacOS/$SCREEN_EXECUTABLE" proc-identity "$$" > /dev/null
for legacy in muse-dictate muse-dictate-screen.app; do
  if [ -e "$legacy" ]; then
    echo "the legacy ${legacy} must not be produced: only per-arch .apps ship" >&2
    exit 1
  fi
done

# M109 P: this helper has no provisioned data-protection-keychain entitlement.
# The SE path stays disabled under Q-M109. dist/ keeps native outputs untracked;
# lane W binds the artifact into VSIX/ACP packages with the lazy vault bundle.
# One thin binary per architecture (D209), like the .apps above.
VAULT_OUTPUT=../../dist/native/darwin/muse-vault
mkdir -p "$(dirname "$VAULT_OUTPUT")"
for arch in "${ARCHES[@]}"; do
  if [ "$arch" = arm64 ]; then cc_arch=arm64; else cc_arch=x86_64; fi
  swiftc -parse-as-library -Osize \
    -target "${cc_arch}-apple-macos${MIN_MACOS}" \
    -Xlinker -dead_strip \
    -o "${VAULT_OUTPUT}-${arch}" VaultKey.swift
  strip -x "${VAULT_OUTPUT}-${arch}"
  codesign --force --sign - --identifier com.musespark.vault "${VAULT_OUTPUT}-${arch}"
  codesign --verify --strict "${VAULT_OUTPUT}-${arch}"
  lipo -info "${VAULT_OUTPUT}-${arch}"
done
rm -f "$VAULT_OUTPUT"

# C-M109-1b: OS peer credentials, pinned process identity and the broker startup lock.
# One thin binary per architecture (D209), like the .apps above.
PEER_OUTPUT=muse-vault-peer
for arch in "${ARCHES[@]}"; do
  if [ "$arch" = arm64 ]; then cc_arch=arm64; else cc_arch=x86_64; fi
  cc -Os -Wall -Wextra -Werror -arch "$cc_arch" -mmacosx-version-min="$MIN_MACOS" \
    ../../native/posix/vaultPeer.c -o "${PEER_OUTPUT}-${arch}"
  strip -x "${PEER_OUTPUT}-${arch}"
  codesign --force --sign - --identifier com.musespark.vault-peer "${PEER_OUTPUT}-${arch}"
  codesign --verify --strict "${PEER_OUTPUT}-${arch}"
  lipo -info "${PEER_OUTPUT}-${arch}"
done
rm -f "$PEER_OUTPUT"

#!/usr/bin/env bash
# Permission-free checks of the built screen bundle's signature and localization.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/native/darwin/muse-dictate-screen.app"
BUILD_DIR="$(mktemp -d "$ROOT/temp/m105-r1-resources.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
codesign --verify --strict "$APP"
BARE_SIGNATURE="$(codesign -d --verbose=4 "$ROOT/native/darwin/muse-dictate" 2>&1)"
if ! [[ "$BARE_SIGNATURE" == *'Sealed Resources=none'* ]] || [ -e "$ROOT/native/darwin/_CodeSignature" ]; then
  echo 'FAIL: legacy bare helper remains independently signed without flat-bundle resources' >&2; exit 1
fi
codesign --verify --strict "$ROOT/native/darwin/muse-dictate"
echo 'PASS: legacy bare helper remains independently signed without flat-bundle resources'
INTEL_HASH="$(codesign -d --arch x86_64 --verbose=4 "$APP" 2>&1 | sed -n 's/^CDHash=//p')"
ARM_HASH="$(codesign -d --arch arm64 --verbose=4 "$APP" 2>&1 | sed -n 's/^CDHash=//p')"
test -n "$INTEL_HASH"
test -n "$ARM_HASH"
REQUIREMENT="identifier \"dev.randynorthrup.muse-spark-code.dictate\" and (cdhash H\"$INTEL_HASH\" or cdhash H\"$ARM_HASH\")"
codesign --verify --strict -R "=$REQUIREMENT" "$APP"
cp -R "$APP" "$BUILD_DIR/unsigned.app"
codesign --remove-signature "$BUILD_DIR/unsigned.app/Contents/MacOS/muse-dictate"
if codesign --verify --strict -R "=$REQUIREMENT" "$BUILD_DIR/unsigned.app" >/dev/null 2>&1; then
  echo 'FAIL: unsigned screen helper is refused' >&2; exit 1
fi
echo 'PASS: unsigned screen helper is refused'
cp -R "$APP" "$BUILD_DIR/replaced.app"
cp /usr/bin/true "$BUILD_DIR/replaced.app/Contents/MacOS/muse-dictate"
if codesign --verify --strict -R "=$REQUIREMENT" "$BUILD_DIR/replaced.app" >/dev/null 2>&1; then
  echo 'FAIL: replaced screen helper is refused by the pinned requirement' >&2; exit 1
fi
echo 'PASS: replaced screen helper is refused by the pinned requirement'
cp -R "$APP" "$BUILD_DIR/resources.app"
printf '\n"tampered" = "test-only";\n' >> "$BUILD_DIR/resources.app/Contents/Resources/de.lproj/InfoPlist.strings"
if codesign --verify --strict -R "=$REQUIREMENT" "$BUILD_DIR/resources.app" >/dev/null 2>&1; then
  echo 'FAIL: replaced permission resources invalidate the signature' >&2; exit 1
fi
echo 'PASS: replaced permission resources invalidate the signature'
# Execute a Foundation-only test binary in the same bundle layout. Argument
# defaults select the language for this process, without changing OS settings.
mkdir -p "$BUILD_DIR/probe.app/Contents/MacOS"
cp "$APP/Contents/Info.plist" "$BUILD_DIR/probe.app/Contents/Info.plist"
cp -R "$APP/Contents/Resources" "$BUILD_DIR/probe.app/Contents/Resources"
cat > "$BUILD_DIR/main.swift" <<'SWIFT'
import Foundation
let keys = ["NSMicrophoneUsageDescription", "NSScreenCaptureUsageDescription", "NSSpeechRecognitionUsageDescription"]
let values = Dictionary(uniqueKeysWithValues: keys.map { ($0, Bundle.main.object(forInfoDictionaryKey: $0) as? String ?? "") })
let data = try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
SWIFT
swiftc -Osize -o "$BUILD_DIR/probe.app/Contents/MacOS/muse-dictate" "$BUILD_DIR/main.swift"
node --input-type=module - "$ROOT" "$BUILD_DIR/probe.app/Contents/MacOS/muse-dictate" <<'JS'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const [root, executable] = process.argv.slice(2)
const keys = { nativeMicrophonePurpose: 'NSMicrophoneUsageDescription', nativeScreenPurpose: 'NSScreenCaptureUsageDescription', nativeSpeechPurpose: 'NSSpeechRecognitionUsageDescription' }
for (const file of readdirSync(path.join(root, 'l10n')).filter((name) => /^ui\..*\.json$/.test(name))) {
  const language = file.slice('ui.'.length, -'.json'.length)
  const nativeLanguage = { 'pt-br': 'pt-BR', 'zh-cn': 'zh-Hans', 'zh-tw': 'zh-Hant' }[language] ?? language
  const actual = JSON.parse(execFileSync(executable, ['-AppleLanguages', '(' + nativeLanguage + ')'], { encoding: 'utf8' }))
  const table = JSON.parse(readFileSync(path.join(root, 'l10n', file), 'utf8')).media
  for (const [key, plistKey] of Object.entries(keys)) {
    if (actual[plistKey] !== table[key]) throw new Error('FAIL: localized native Bundle.main permission description: ' + language + '/' + plistKey)
  }
  console.log('PASS: localized native Bundle.main permission descriptions: ' + language)
}
JS

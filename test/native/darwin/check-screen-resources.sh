#!/usr/bin/env bash
# Permission-free checks of the built screen bundles' signatures and
# localization: one thin signed .app per Mac architecture (D209).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUILD_DIR="$(mktemp -d "$ROOT/temp/m105-r1-resources.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
# No universal or bare binary ships beside the per-arch signed .apps.
for legacy in "$ROOT/native/darwin/muse-dictate" "$ROOT/native/darwin/muse-dictate-screen.app"; do
  if [ -e "$legacy" ]; then
    echo "FAIL: legacy helper ships beside the per-arch signed .apps: $legacy" >&2; exit 1
  fi
done
echo 'PASS: no legacy helper ships beside the per-arch signed .apps'
for arch in arm64 x64; do
  APP="$ROOT/native/darwin/muse-dictate-screen-${arch}.app"
  codesign --verify --strict "$APP"
  # A thin bundle holds no slice of the other architecture: that read fails.
  INTEL_HASH="$(codesign -d --arch x86_64 --verbose=4 "$APP" 2>&1 | sed -n 's/^CDHash=//p' || true)"
  ARM_HASH="$(codesign -d --arch arm64 --verbose=4 "$APP" 2>&1 | sed -n 's/^CDHash=//p' || true)"
  if [ "$arch" = arm64 ]; then
    test -z "$INTEL_HASH"
    test -n "$ARM_HASH"
    REQUIREMENT="identifier \"dev.randynorthrup.muse-spark-code.dictate\" and cdhash H\"$ARM_HASH\""
  else
    test -n "$INTEL_HASH"
    test -z "$ARM_HASH"
    REQUIREMENT="identifier \"dev.randynorthrup.muse-spark-code.dictate\" and cdhash H\"$INTEL_HASH\""
  fi
  codesign --verify --strict -R "=$REQUIREMENT" "$APP"
  echo "PASS: ${arch} screen bundle is thin, signed and verified"
  cp -R "$APP" "$BUILD_DIR/unsigned-${arch}.app"
  codesign --remove-signature "$BUILD_DIR/unsigned-${arch}.app/Contents/MacOS/muse-dictate"
  if codesign --verify --strict -R "=$REQUIREMENT" "$BUILD_DIR/unsigned-${arch}.app" >/dev/null 2>&1; then
    echo "FAIL: unsigned ${arch} screen helper is refused" >&2; exit 1
  fi
  echo "PASS: unsigned ${arch} screen helper is refused"
  cp -R "$APP" "$BUILD_DIR/replaced-${arch}.app"
  cp /usr/bin/true "$BUILD_DIR/replaced-${arch}.app/Contents/MacOS/muse-dictate"
  if codesign --verify --strict -R "=$REQUIREMENT" "$BUILD_DIR/replaced-${arch}.app" >/dev/null 2>&1; then
    echo "FAIL: replaced ${arch} screen helper is refused by the pinned requirement" >&2; exit 1
  fi
  echo "PASS: replaced ${arch} screen helper is refused by the pinned requirement"
  cp -R "$APP" "$BUILD_DIR/resources-${arch}.app"
  printf '\n"tampered" = "test-only";\n' >> "$BUILD_DIR/resources-${arch}.app/Contents/Resources/de.lproj/InfoPlist.strings"
  if codesign --verify --strict -R "=$REQUIREMENT" "$BUILD_DIR/resources-${arch}.app" >/dev/null 2>&1; then
    echo "FAIL: replaced ${arch} permission resources invalidate the signature" >&2; exit 1
  fi
  echo "PASS: replaced ${arch} permission resources invalidate the signature"
done
# Execute a Foundation-only test binary in the same bundle layout. Argument
# defaults select the language for this process, without changing OS settings.
# The resources are built once from the same .lproj sources, so one probe
# covers both bundles; each bundle's own resources are sealed by its signature.
case "$(uname -m)" in arm64) PROBE_ARCH=arm64 ;; *) PROBE_ARCH=x64 ;; esac
APP="$ROOT/native/darwin/muse-dictate-screen-${PROBE_ARCH}.app"
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

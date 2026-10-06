#!/usr/bin/env bash
# Compile once and exercise the real AVFoundation encoder with synthetic input.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$ROOT/temp"
BUILD_DIR="$(mktemp -d "$ROOT/temp/m105-r1-native.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
cp "$ROOT/test/native/darwin/ScreenRecordTests.swift" "$BUILD_DIR/main.swift"
ARCH="$(uname -m)"
swiftc -Osize -target "${ARCH}-apple-macos12.0" -o "$BUILD_DIR/check" "$BUILD_DIR/main.swift" "$ROOT/native/darwin/ScreenRecord.swift"
mkdir -m 700 "$BUILD_DIR/output"
"$BUILD_DIR/check" "$BUILD_DIR/output"
mkdir -m 700 "$BUILD_DIR/deadline" "$BUILD_DIR/size"
"$BUILD_DIR/check" "$BUILD_DIR/deadline" --deadline
"$BUILD_DIR/check" "$BUILD_DIR/size" --size
mkdir -m 700 "$BUILD_DIR/fallback"
"$BUILD_DIR/check" "$BUILD_DIR/fallback" --fallback-finalize
for mode in final-size final-empty; do
  mkdir -m 700 "$BUILD_DIR/$mode"
  test_exit=0
  test_frame="$("$BUILD_DIR/check" "$BUILD_DIR/$mode" "--$mode")" || test_exit=$?
  if [ "$test_exit" != 2 ] || [ "$test_frame" != '{"code":"tooLarge","type":"error"}' ]; then
    echo "FAIL: native $mode refuses finished output" >&2
    exit 1
  fi
  echo "PASS: native $mode refuses finished output"
done

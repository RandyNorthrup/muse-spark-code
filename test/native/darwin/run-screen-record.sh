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

for mode in sleep display-sleep; do
  mkdir -m 700 "$BUILD_DIR/$mode"
  "$BUILD_DIR/check" "$BUILD_DIR/$mode" "--$mode"
done
for mode in conversion-size conversion-deadline; do
  mkdir -m 700 "$BUILD_DIR/$mode"
  test_exit=0
  test_frame="$("$BUILD_DIR/check" "$BUILD_DIR/$mode" "--$mode")" || test_exit=$?
  expected_code=tooLarge
  if [ "$mode" = conversion-deadline ]; then expected_code=failed; fi
  converter_pid="$(sed -n 's/^CONVERTER_PID=//p' <<< "$test_frame")"
  if [ "$test_exit" != 2 ] || ! [[ "$test_frame" == *"{\"code\":\"$expected_code\",\"type\":\"error\"}"* ]]; then
    # A deliberately broken monitor must not leave the test-owned sleep alive.
    if [ -n "$converter_pid" ]; then kill -KILL "$converter_pid" 2>/dev/null || true; fi
    echo "FAIL: $mode monitor stays alive through conversion" >&2
    exit 1
  fi
  if [ -z "$converter_pid" ] || kill -0 "$converter_pid" 2>/dev/null; then
    echo "FAIL: $mode kills the owned converter before refusing" >&2
    exit 1
  fi
  if [ -n "$(ls -A "$BUILD_DIR/$mode")" ]; then
    echo "FAIL: $mode deletes partial files" >&2
    exit 1
  fi
  echo "PASS: $mode monitor stays alive through conversion and kills/removes owned work"
done

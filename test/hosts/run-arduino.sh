#!/bin/sh
# Arduino IDE 2.3.10, same integration suite, no model or physical device.
#   sh test/hosts/run-arduino.sh IDE_EXECUTABLE ARDUINO_VSIX WORK
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
node "$here/arduino.mjs" "$1" "$2" "$3"

#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")/../.." && pwd)
root="$base/temp/m103-x"
export IDF_PATH="$root/idf" IDF_TOOLS_PATH="$root/idf-tools"
source "$IDF_PATH/export.sh" > "$root/idf-export.log"
cmake -S "$base/test/fixtures/maker-emulators/esp32s3" -B "$root/esp32s3-build" -G Ninja -DIDF_TARGET=esp32s3 -DSDKCONFIG="$root/esp32s3-sdkconfig"
cmake --build "$root/esp32s3-build" --parallel 3
cd -- "$root/esp32s3-build"
"$root/venv/bin/esptool" --chip esp32s3 merge-bin --pad-to-size 4MB -o "$root/images/esp32s3-flash.bin" @flash_args

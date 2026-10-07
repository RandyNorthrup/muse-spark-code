#!/usr/bin/env bash
# Installs only rig tools; npm/pip payloads and images stay in this worktree.
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")/../.." && pwd)
cd -- "$base"
mkdir -p "$base/temp/m103-x/idf-home"
if [[ "${MUSE_EMULATOR_SETUP_CLEAN:-}" != 1 ]]; then
 exec env -i MUSE_EMULATOR_SETUP_CLEAN=1 HOME="$base/temp/m103-x/idf-home" PATH=/usr/sbin:/usr/bin:/sbin:/bin /bin/bash "$base/scripts/emulators/setup.sh"
fi
mkdir -p temp/m103-x/{tools,images,rp2040}
sudo -n apt-get install -y qemu-system-arm qemu-utils socat simavr libsimavr-dev avrdude gcc-avr avr-libc gcc-arm-none-eabi device-tree-compiler mtools e2fsprogs python3-venv kmod cpio cmake ninja-build git curl flex bison gperf libffi-dev libssl-dev dfu-util
python3 scripts/emulators/prepare.py download
python3 -m venv temp/m103-x/venv
temp/m103-x/venv/bin/pip install --no-cache-dir esptool==5.0.2
npm info rp2040js@1.4.0 peerDependencies
npm install --prefix temp/m103-x/rp2040 --save-exact --ignore-scripts rp2040js@1.4.0
npm audit --prefix temp/m103-x/rp2040
# ESP-IDF and every tool stay under this lane; no user shell/profile changes.
root="$base/temp/m103-x"
idf_commit=f5c3654a1c2d2a01f7f67def7a0dc48e691f63c0
if [[ ! -d "$root/idf/.git" ]]; then
 git clone --branch v5.4.2 --depth 1 --recursive https://github.com/espressif/esp-idf.git "$root/idf"
fi
[[ "$(git -C "$root/idf" rev-parse HEAD)" == "$idf_commit" ]]
mkdir -p "$root/idf-home"
env -i HOME="$root/idf-home" PATH=/usr/bin:/bin IDF_TOOLS_PATH="$root/idf-tools" /bin/bash "$root/idf/install.sh" esp32s3
python3 scripts/emulators/prepare.py prepare
env -i HOME="$root/idf-home" PATH=/usr/bin:/bin /bin/bash "$base/scripts/emulators/build-esp32s3.sh"

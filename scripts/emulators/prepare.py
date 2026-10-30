#!/usr/bin/env python3
"""Download hash-pinned upstream artifacts and prepare local board images."""
import gzip
import hashlib
import json
import lzma
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tarfile

BASE = Path(__file__).resolve().parents[2]
ROOT = BASE / 'temp/m103-x'
IMAGES = ROOT / 'images'


def run(*args, **kwargs):
    subprocess.run(args, cwd=BASE, check=True, timeout=180, **kwargs)


def debugfs(command):
    result = subprocess.run(['debugfs', '-w', '-R', command, str(IMAGES / 'pi-root.ext4')],
                            cwd=BASE, check=True, timeout=30, capture_output=True, text=True)
    # debugfs can exit zero on failed commands; successful image edits must be real.
    if any(word in result.stderr for word in ('not found', 'File exists', 'error', 'short read')):
        raise RuntimeError(result.stderr)


def digest(file):
    with file.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def download():
    for asset in json.loads((BASE / 'scripts/emulators/assets.json').read_text()):
        file = ROOT / asset['file']
        if not file.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError('artifact outside rig directory')
        if not re.fullmatch('[a-f0-9]{64}', asset['sha256']) or not asset['url'].startswith('https://'):
            raise ValueError('invalid pinned artifact')
        file.parent.mkdir(parents=True, exist_ok=True)
        if not file.exists() or digest(file) != asset['sha256']:
            temporary = file.with_suffix(file.suffix + '.part')
            run('curl', '-fL', '--max-time', '180', '--output', str(temporary), asset['url'])
            if digest(temporary) != asset['sha256']:
                temporary.unlink()
                raise ValueError('artifact hash mismatch')
            temporary.replace(file)
        print('verified', asset['file'], flush=True)
        if file.name.endswith(('.tar.xz', '.tar.gz')):
            # The archive's SHA-256 is verified against the pinned digest
            # above and extraction uses the data filter, which strips
            # absolute and parent paths (PLAN.md section 8).
            # nosemgrep: trailofbits.python.tarfile-extractall-traversal.tarfile-extractall-traversal
            with tarfile.open(file) as archive:
                archive.extractall(ROOT / 'tools', filter='data')


def pi():
    image = IMAGES / 'pi.img'
    # Restore the pristine compressed source on each prepare; no mounted disks.
    with lzma.open(IMAGES / 'pi.img.xz', 'rb') as source, image.open('wb') as target:
        shutil.copyfileobj(source, target)
    with image.open('rb') as source:
        table = source.read(512)
        boot_offset = struct.unpack_from('<I', table, 446 + 8)[0] * 512
        root_offset, root_sectors = struct.unpack_from('<II', table, 446 + 16 + 8)
        source.seek(root_offset * 512)
        remaining = root_sectors * 512
        with (IMAGES / 'pi-root.ext4').open('wb') as target:
            while remaining:
                block = source.read(min(remaining, 1024 * 1024))
                if not block:
                    raise ValueError('truncated Pi partition')
                target.write(block)
                remaining -= len(block)
    # Use the pinned OS image's matching kernel, device trees and modules.
    for source, target in [('kernel8.img', 'pi-kernel.img'),
                           ('bcm2710-rpi-3-b.dtb', 'pi3-console.dtb'),
                           ('bcm2711-rpi-4-b.dtb', 'pi4-console.dtb')]:
        run('mcopy', '-o', '-i', f'{image}@@{boot_offset}', f'::{source}', str(IMAGES / target))
    for target in ('pi3-console.dtb', 'pi4-console.dtb'):
        tree = str(IMAGES / target)
        # QEMU's serial_hd(0) is PL011, serial_hd(1) is the mini-UART.
        # Firmware is absent: let Linux initialize PL011, not Bluetooth.
        for node, key, value in [('/aliases', 'serial0', '/soc/serial@7e201000'),
                                 ('/aliases', 'serial1', '/soc/serial@7e215040'),
                                 ('/chosen', 'stdout-path', 'serial0:115200n8'),
                                 ('/soc/serial@7e201000/bluetooth', 'status', 'disabled')]:
            run('fdtput', '-t', 's', tree, node, key, value)
        run('fdtput', '-d', tree, '/soc/serial@7e201000', 'skip-init')
    for command in (
        'write scripts/emulators/pi-guest.sh /usr/local/bin/muse-emulator-init',
        'set_inode_field /usr/local/bin/muse-emulator-init mode 0100755',
    ):
        debugfs(command)
    with image.open('r+b') as target, (IMAGES / 'pi-root.ext4').open('rb') as source:
        target.seek(root_offset * 512)
        shutil.copyfileobj(source, target)
        target.truncate(4 * 1024 ** 3)
    run('qemu-system-aarch64', '-M', 'virt', '-cpu', 'cortex-a53', '-m', '512M',
        '-machine', f'dumpdtb={IMAGES / "virt.dtb"}', '-display', 'none')
    run('fdtput', '-t', 's', str(IMAGES / 'virt.dtb'), '/', 'model',
        'Raspberry Pi (QEMU virt, generic arm64)')
    generic = ROOT / 'virt-root'
    run('dpkg-deb', '-x', str(ROOT / 'linux-image-612.deb'), str(generic))
    run('dpkg-deb', '-x', str(ROOT / 'busybox-static.deb'), str(generic))
    kernel = next((generic / 'boot').glob('vmlinuz-*'))
    shutil.copyfile(kernel, IMAGES / 'virt-kernel')
    version = kernel.name.removeprefix('vmlinuz-')
    init = ROOT / 'initramfs'
    if init.exists():
        shutil.rmtree(init)
    for directory in ('bin', 'dev', 'proc', 'sys', 'root', 'lib/modules'):
        (init / directory).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(generic / 'usr/bin/busybox', init / 'bin/busybox')
    (init / 'bin/busybox').chmod(0o755)
    shutil.copytree(generic / 'usr/lib/modules', init / 'lib/modules', dirs_exist_ok=True)
    run('depmod', '-b', str(init), version, stderr=subprocess.DEVNULL)
    keep = set()
    for module in ('virtio_mmio', 'virtio_blk', 'ext4', 'crc32c_generic'):
        result = subprocess.check_output(['modprobe', '-d', str(init), '-S', version,
                                          '--show-depends', module], timeout=10, text=True)
        keep.update(Path(line.split()[1]) for line in result.splitlines() if line.startswith('insmod'))
    for file in (init / 'lib/modules').rglob('*.ko.xz'):
        if file not in keep:
            file.unlink()
    run('depmod', '-b', str(init), version, stderr=subprocess.DEVNULL)
    (init / 'sbin').symlink_to('bin')
    (init / 'init').write_text('''#!/bin/busybox sh
/bin/busybox --install -s /bin
mount -t devtmpfs devtmpfs /dev
mount -t proc proc /proc
mount -t sysfs sysfs /sys
modprobe virtio_mmio
modprobe virtio_blk
modprobe crc32c_generic
modprobe ext4
mount -t ext4 /dev/vda /root || exec sh
exec switch_root /root /usr/local/bin/muse-emulator-init
''')
    (init / 'init').chmod(0o755)
    names = '\n'.join(['.'] + [str(file.relative_to(init)) for file in init.rglob('*')]) + '\n'
    archive = subprocess.check_output(['cpio', '-o', '-H', 'newc'], input=names.encode(), cwd=init, timeout=30)
    (IMAGES / 'virt-initrd.gz').write_bytes(gzip.compress(archive))


def prepare():
    # Test-model initial state only; no efuse programming command is run.
    # IDF 5.4.2 esp32s3/esp_efuse_table.csv: disable USB download (not UART).
    efuse = bytearray(1024)
    for bit in (132, 159):  # DIS_USB_SERIAL_JTAG_DOWNLOAD_MODE, DIS_USB_OTG_DOWNLOAD_MODE
        efuse[bit // 8] |= 1 << (bit % 8)
    (IMAGES / 'esp32s3-uart-efuse.bin').write_bytes(efuse)
    for board, source, address in [('esp32', 'esp32.bin', '0x1000'),
                                   ('esp32c3', 'esp32c3.bin', '0')]:
        run(str(ROOT / 'venv/bin/esptool'), '--chip', board, 'merge-bin', '--pad-to-size',
            '4MB', '-o', str(IMAGES / f'{board}-flash.bin'), address, str(IMAGES / source))
    run('gcc', '-Wall', '-Wextra', '-Werror', '-O2', 'scripts/emulators/avr.c',
        '-lsimavr', '-o', str(ROOT / 'tools/avr-runner'))
    for board, chip in [('uno', 'atmega328p'), ('mega', 'atmega2560')]:
        run('avr-gcc', '-Os', f'-mmcu={chip}', 'test/fixtures/maker-emulators/avr-firmware.c',
            '-o', str(IMAGES / f'{board}.elf'))
        run('avr-objcopy', '-O', 'ihex', str(IMAGES / f'{board}.elf'), str(IMAGES / f'{board}.hex'))
    run('arm-none-eabi-gcc', '-Os', '-mcpu=cortex-m4', '-mthumb', '-nostdlib',
        '-Wl,-T,test/fixtures/maker-emulators/stm32.ld',
        'test/fixtures/maker-emulators/stm32-firmware.c', '-o', str(IMAGES / 'stm32.elf'))
    source = (ROOT / 'rp2040/bootrom.ts').read_text()
    words = re.findall(r'0x[\da-fA-F]+', source[source.index('['):source.index(']')])
    (ROOT / 'rp2040/bootrom.bin').write_bytes(b''.join(struct.pack('<I', int(word, 16)) for word in words))
    # Resolve the release's diagnostic SVDs locally: board starts need no network.
    for cpu, svd in [('stm32f4', 'STM32F40x'), ('nrf52840', 'NRF52840')]:
        platform = ROOT / f'tools/renode_1.17.0-portable/platforms/cpus/{cpu}.repl'
        content = platform.read_text().replace(f'https://dl.antmicro.com/projects/renode/svd/{svd}.svd.gz',
                                               str(IMAGES / f'{svd}.svd.gz'))
        platform.write_text(content)
    pi()


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('download', 'prepare'):
        raise SystemExit('usage: prepare.py download|prepare')
    {'download': download, 'prepare': prepare}[sys.argv[1]]()

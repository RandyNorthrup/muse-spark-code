#!/usr/bin/env python3
"""Test-only flash transport: exact approved stdin bytes to fixed emulator tools."""
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

BASE = Path(__file__).resolve().parents[3]
board, directory, length_text = sys.argv[1:]
length = int(length_text)
limit = 262144 if board == 'esp32s3' else 65536
if board not in ('esp32', 'esp32s3', 'esp32c3', 'uno', 'mega') or not 0 < length <= limit:
    raise SystemExit(2)
state = Path(directory).resolve()
info = state.stat()
if info.st_uid != os.getuid() or info.st_mode & 0o077:
    raise SystemExit(2)
port = state / f'ttyEMU-{board}-0'
if not re.fullmatch(r'/dev/pts/\d+', str(port.resolve())) or not stat.S_ISCHR(port.stat().st_mode):
    raise SystemExit(2)
sys.stderr.write('serial-ready\n')
sys.stderr.flush()
data = sys.stdin.buffer.read(length)
if len(data) != length:
    raise SystemExit(1)
artifact = state / 'approved-image'
artifact.write_bytes(data)
if board.startswith('esp32'):
    address = '0x10000' if board == 'esp32s3' else '0x3f0000'
    args = [str(BASE / 'temp/m103-x/venv/bin/esptool'), '--chip', board, '--port', str(port),
            '--no-stub', '--before', 'no-reset', '--after', 'no-reset', 'write-flash',
            '--flash-size', '4MB', address, str(artifact)]
else:
    chip, programmer, baud = ('atmega328p', 'stk500v1', '57600') if board == 'uno' else ('atmega2560', 'stk500v2', '115200')
    args = ['avrdude', '-p', chip, '-c', programmer, '-b', baud, '-P', str(port),
            '-D', '-U', f'flash:w:{artifact}:i']
child = subprocess.Popen(args, env={'PATH': os.defpath, 'LANG': 'C.UTF-8'},
                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
(state / 'flash-tool-pid').write_text(str(child.pid))
pending = b''
while byte := child.stdout.read(1):
    sys.stdout.buffer.write(byte)
    sys.stdout.buffer.flush()
    pending = (pending + byte)[-128:]
    if any(word in pending for word in (b'Writing at 0x003f0400', b'Writing at 0x00010400', b'Writing |')):
        (state / 'flash-writing').touch()
raise SystemExit(child.wait(timeout=30))

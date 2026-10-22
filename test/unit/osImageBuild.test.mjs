import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runOsBootProbe } from './helpers/osBootProbe.mjs'

// The refusal drill must stop before it can touch any host state.
vi.mock('../../src/runtime/node/state', () => ({
  NodeStateStore: function rejectHostState() {
    throw new Error('OS1 fixture reached filesystem')
  },
}))

const root = fileURLToPath(new URL('../../os/', import.meta.url))
const interpreter = process.platform === 'win32' ? 'python' : 'python3'
const temporary = []
function directory() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm110-os1-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function python(code) {
  return spawnSync(interpreter, ['-c', code], { encoding: 'utf8' })
}
describe('M110-OS1 immutable image inputs', () => {
  it('refuses to execute the native boot fixture outside the service UID', async () => {
    await expect(runOsBootProbe({ NodeService: null, nodeHealth: null })).rejects.toThrow(
      'OS1 wrong service UID',
    )
  })
  it('accepts the pinned Debian/Node policy and A/B partition layout', () => {
    expect(
      execFileSync(interpreter, [path.join(root, 'check.py')], { encoding: 'utf8' }),
    ).toContain('0 problems')
  })
  it.each([
    ['mkosi.conf', 'Distribution=debian', 'Distribution=ubuntu', 'Debian base'],
    ['mkosi.conf', 'Release=trixie', 'Release=sid', 'Debian 13'],
    ['mkosi.conf', 'Snapshot=20261005T000000Z', 'Snapshot=latest', 'snapshot pin'],
    ['mkosi.conf', 'SourceDateEpoch=1791158400', 'SourceDateEpoch=0', 'source epoch pin'],
    ['mkosi.conf', '8821992e-4707-4882-96ce-a8b16b671a09', 'random', 'partition seed'],
    ['mkosi.conf', 'Checksum=yes', 'Checksum=no', 'artifact digests'],
    [
      'initrd-overlay/usr/lib/systemd/system/muse-overlay-usr.service',
      'remount,bind,ro',
      'remount,bind,rw',
      'verified installer usr',
    ],
    [
      'mkosi.initrd.postinst',
      '/usr/lib/systemd/system/initrd-root-fs.target.wants',
      '/etc/systemd/system/initrd-root-fs.target.wants',
      'initrd vendor dependency',
    ],
    [
      'overlay/usr/lib/systemd/system/systemd-resolved.service.d/muse-var.conf',
      'RequiresMountsFor=/var/tmp',
      'RequiresMountsFor=/tmp',
      'resolver mount ordering',
    ],
    [
      'repart/10-root.conf',
      '/usr/ /var/ /boot/ /efi/',
      '/usr /var /boot /efi',
      'root mount points',
    ],
    ['repart/00-esp.conf', 'CopyFiles=/efi:/', '', 'EFI and UKI payloads'],
    ['repart/20-usr-a.conf', 'Verity=data', 'Verity=off', 'usr integrity'],
    ['repart/20-usr-a.conf', 'ReadOnly=yes', 'ReadOnly=no', 'read-only usr'],
    [
      'repart/21-usr-a-verity.conf',
      'VerityMatchKey=usr-a',
      'VerityMatchKey=other',
      'verity pairing',
    ],
    ['repart/30-usr-b.conf', 'NoAuto=yes', 'NoAuto=no', 'inactive slot admission'],
    ['repart/30-usr-b.conf', 'SizeMinBytes=1536M', 'SizeMinBytes=1M', 'equal slots'],
    ['repart/30-usr-b.conf', '[Partition]', '[Partition]\nCopyFiles=/usr:/', 'inactive slot empty'],
    ['repart/40-var.conf', 'Format=ext4', 'Format=vfat', 'persistent var'],
    ['repart/40-var.conf', 'GrowFileSystem=yes', 'GrowFileSystem=no', 'var growth'],
    ['overlay/usr/lib/sysusers.d/muse-node.conf', '61101:61101', '61100:61100', 'separate users'],
    [
      'overlay/usr/lib/tmpfiles.d/muse-node.conf',
      '0700 muse-node muse-node',
      '0755 root root',
      'private state',
    ],
    [
      'overlay/usr/lib/systemd/system/muse-node.service',
      'NoNewPrivileges=yes',
      'NoNewPrivileges=no',
      'no privilege gain',
    ],
    [
      'overlay/usr/lib/systemd/system/muse-node.service',
      'ProtectSystem=strict',
      'ProtectSystem=no',
      'immutable runtime',
    ],
    [
      'overlay/usr/lib/systemd/system/muse-node.service',
      'ExecStart=',
      'ExecStart=--listen ',
      'no implicit listener',
    ],
    ['pins.json', '24.18.0', '20.19.0', 'Node version'],
    ['pins.json', '55aa7153', 'not-hex-', 'Node digest'],
    ['pi/manifest.json', '"package": "raspi-firmware"', '"package": "other"', 'Pi firmware pin'],
    [
      'pi/manifest.json',
      '"package": "linux-image-6.18.50+rpt-rpi-v8"',
      '"package": "other"',
      'Pi kernel pin',
    ],
    [
      'overlay/usr/lib/systemd/system/muse-node.service',
      'User=muse-node',
      'User=root',
      'non-root service',
    ],
  ])('refuses a weakened %s guard (%s)', (file, before, after, reason) => {
    const dir = directory()
    cpSync(root, dir, { recursive: true })
    const target = path.join(dir, ...file.split('/'))
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace(before, () => after),
    )
    const result = spawnSync(interpreter, [path.join(root, 'check.py'), dir], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(reason)
  })
  it.each(['package/../outside', String.raw`package\outside`, '/absolute', 'package/key'])(
    'rejects untrusted archive path %s before extraction',
    (name) => {
      const dir = directory()
      const result = python(`
import sys, tarfile, io
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from build import extract
archive = Path(${JSON.stringify(path.join(dir, 'bad.tar'))})
with tarfile.open(archive, 'w') as output:
    item = tarfile.TarInfo(${JSON.stringify(name)})
    item.size = 1
    output.addfile(item, io.BytesIO(b'x'))
extract(archive, Path(${JSON.stringify(path.join(dir, 'image'))}), 'package', lambda name: ${name === 'package/key' ? 'False' : 'True'})
`)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/unsafe archive member|unexpected archive member/u)
    },
  )
  it('refuses an archive symlink without writing an earlier valid member', () => {
    const dir = directory()
    const result = python(`
import sys, tarfile, io
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from build import extract
archive = Path(${JSON.stringify(path.join(dir, 'link.tar'))})
dest = Path(${JSON.stringify(path.join(dir, 'image'))})
with tarfile.open(archive, 'w') as output:
    item = tarfile.TarInfo('package/dist/node.js')
    item.size = 1
    output.addfile(item, io.BytesIO(b'x'))
    link = tarfile.TarInfo('package/link')
    link.type = tarfile.SYMTYPE
    link.linkname = '/outside'
    output.addfile(link)
try:
    extract(archive, dest, 'package', lambda name: True)
except ValueError:
    assert not dest.exists()
    print('refused before writes')
else:
    raise AssertionError('accepted symlink')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused before writes')
  })
  it('refuses a corrupt pinned download and removes partial bytes', () => {
    const dir = directory()
    const source = path.join(dir, 'source')
    writeFileSync(source, 'corrupt input')
    const result = python(`
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from build import download
dest = Path(${JSON.stringify(path.join(dir, 'asset'))})
try:
    download(Path(${JSON.stringify(source)}).as_uri(), '0' * 64, dest)
except ValueError:
    assert not dest.exists() and not dest.with_suffix('.partial').exists()
    print('refused digest')
else:
    raise AssertionError('accepted mismatch')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused digest')
  })
  it.each(['download', 'archive'])('bounds %s bytes before installing input', (kind) => {
    const dir = directory()
    const result = python(`
import sys, tarfile, io, hashlib
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
import build
build.DOWNLOAD_LIMIT = 1
base = Path(${JSON.stringify(dir)})
dest = base / 'destination'
source = base / 'source'
source.write_bytes(b'oversized')
try:
    if ${JSON.stringify(kind)} == 'download':
        build.download(source.as_uri(), hashlib.sha256(source.read_bytes()).hexdigest(), dest)
    else:
        with tarfile.open(source, 'w') as output:
            member = tarfile.TarInfo('package/dist/node.js')
            member.size = 5
            output.addfile(member, io.BytesIO(b'12345'))
        build.extract(source, dest, 'package', lambda name: True)
except ValueError as error:
    assert 'limit' in str(error)
    assert not dest.exists() and not dest.with_suffix('.partial').exists()
    print('bounded before install')
else:
    raise AssertionError('accepted oversized input')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('bounded before install')
  })
  it.each([
    ['target', 'unknown target'],
    ['runtime', 'runtime SHA-256 mismatch'],
    ['node', 'Node input is not a regular file'],
    ['package', 'wrong runtime package/version'],
    ['binding', 'binding SHA-256 mismatch'],
    ['valid', null],
    ['installer', null],
  ])('validates the %s input and its staging boundary', (kind, reason) => {
    const dir = directory()
    const result = python(`
import sys, tarfile, io, json, shutil
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(root)})
import build
base = Path(${JSON.stringify(dir)})
build.OUT = base / 'out'
node = base / 'node.tar'
kind = ${JSON.stringify(kind)}
with tarfile.open(node, 'w') as output:
    for name in ('bin/node', 'LICENSE'):
        member = tarfile.TarInfo('node-v24.18.0-linux-x64/' + name)
        if kind == 'node' and name == 'bin/node':
            member.type = tarfile.SYMTYPE
            member.linkname = '/outside'
            output.addfile(member)
        else:
            member.size = 1
            output.addfile(member, io.BytesIO(b'x'))
build.download = lambda url, expected, dest: shutil.copyfile(node, dest)
runtime = base / 'runtime.tar'
with tarfile.open(runtime, 'w') as output:
    package = json.dumps({'name': 'muse-spark-code-acp', 'version': 'wrong' if kind == 'package' else '0.14.0'}).encode()
    member = tarfile.TarInfo('package/package.json')
    member.size = len(package)
    output.addfile(member, io.BytesIO(package))
binding = base / 'binding.mjs'
binding.write_text('test-only invalid input')
args = SimpleNamespace(target='wrong' if kind == 'target' else 'x86-64', installer=kind == 'installer',
    runtime=runtime, runtime_sha256='0' * 64 if kind == 'runtime' else build.digest(runtime),
    binding=binding if kind == 'binding' else None, binding_sha256='0' * 64)
try:
    build.stage(args)
except ValueError as error:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is not None
    assert ${reason === null ? 'None' : JSON.stringify(reason)} in str(error)
    assert not (build.OUT / args.target / 'work').exists()
else:
    assert kind in ('valid', 'installer')
    workspace = build.OUT / 'x86-64' / ('installer-work' if kind == 'installer' else 'work')
    assert (workspace / 'repart/40-var.conf').exists() == (kind == 'valid')
    assert not (workspace / 'overlay/usr/lib/muse-node-os/service-binding.mjs').exists()
    assert not (workspace / 'overlay/var/lib/muse-spark-code-node/state.v1.json').exists()
print('verified staging result')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('verified staging result')
  })
  it.each([
    ['x86-64', ['--binding', 'test-only.mjs'], 'supplied together'],
    ['pi4', ['--installer'], 'native firmware'],
  ])('rejects incompatible composer arguments for %s', (target, extra, reason) => {
    const result = spawnSync(
      interpreter,
      [
        path.join(root, 'build.py'),
        target,
        '--runtime',
        'unused',
        '--runtime-sha256',
        '0',
        ...extra,
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(reason)
  })
  it('publishes final artifact bytes and digests without stale self-references or aliases', () => {
    const dir = directory()
    const result = python(`
import sys, json, hashlib
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, ${JSON.stringify(root)})
import build
base = Path(${JSON.stringify(dir)})
workspace = base / 'work'
workspace.mkdir()
payload = base / 'payload.raw'
payload.write_bytes(b'final media')
(base / 'alias.raw').write_bytes(b'alias fixture')
(base / 'artifacts.json').write_text('stale receipt')
build.stage = lambda args: workspace
build.subprocess.run = lambda command, check: None
sys.argv = ['build.py', 'x86-64', '--runtime', 'unused', '--runtime-sha256', '0']
with patch.object(Path, 'is_symlink', lambda file: file.name == 'alias.raw'):
    build.main()
receipt = json.loads((base / 'artifacts.json').read_text())
assert receipt == [{'file': 'payload.raw', 'bytes': 11, 'sha256': hashlib.sha256(b'final media').hexdigest()}]
assert not workspace.exists()
print('final receipt verified')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('final receipt verified')
  })
  it('refuses a truncated native Pi boot partition', () => {
    const dir = directory()
    const result = python(`
import sys, json
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from pi import compose
base = Path(${JSON.stringify(dir)})
(base / 'muse-node-pi4.raw').write_bytes(b'')
(base / 'muse-node-pi4.roothash').write_text('0' * 64)
compose.subprocess.run = lambda command, check: None
compose.subprocess.check_output = lambda command: json.dumps({'partitiontable': {'partitions': [
    {'name': 'muse-pi-boot-a', 'start': 0, 'size': 1}]}}).encode()
try:
    compose.finish('pi4', base, {'targets': {'pi4': {'kernelFile': 'kernel8.img'}}})
except ValueError as error:
    assert 'truncated Pi boot partition' in str(error)
    print('refused truncated partition')
else:
    raise AssertionError('published truncated native boot')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused truncated partition')
  })
  it.each([
    ['members', 'archive member limit'],
    ['metadata', 'decoded archive exceeds limit'],
    ['seek', 'archive seek exceeds limit'],
  ])('bounds archive %s before decoding or writing', (kind, reason) => {
    const dir = directory()
    const result = python(`
import sys, tarfile, io
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
import build
base = Path(${JSON.stringify(dir)})
archive = base / 'input.tar'
dest = base / 'image'
kind = ${JSON.stringify(kind)}
if kind == 'metadata':
    build.ARCHIVE_STREAM_LIMIT = 1024
    header = tarfile.TarInfo('package/metadata')
    header.type = tarfile.XHDTYPE
    header.size = 2048
    archive.write_bytes(header.tobuf() + b'junk' * 512)
else:
    with tarfile.open(archive, 'w:gz' if kind == 'seek' else 'w') as output:
        if kind == 'members':
            build.ARCHIVE_MEMBER_LIMIT = 1
            for name in ('package', 'package/extra'):
                member = tarfile.TarInfo(name)
                member.type = tarfile.DIRTYPE
                output.addfile(member)
        else:
            build.ARCHIVE_STREAM_LIMIT = 1536
            member = tarfile.TarInfo('package/dist/node.js')
            member.size = 2048
            output.addfile(member, io.BytesIO(b'x' * 2048))
try:
    build.extract(archive, dest, 'package', lambda name: True)
except ValueError as error:
    assert ${JSON.stringify(reason)} in str(error)
    assert not dest.exists()
    print('bounded before decoding/writing')
else:
    raise AssertionError('accepted unbounded archive')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('bounded before decoding/writing')
  })
  it.each([
    'package//outside',
    'package/C:/outside',
    'package/C:outside',
    'package/.. /outside',
    'package/../outside',
    'package/folder\nother',
  ])('refuses an ambiguous archive directory %s before filesystem access', (name) => {
    const dir = directory()
    const result = python(`
import sys, tarfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from build import extract
archive = Path(${JSON.stringify(path.join(dir, 'directory.tar'))})
with tarfile.open(archive, 'w') as output:
    member = tarfile.TarInfo(${JSON.stringify(name)})
    member.type = tarfile.DIRTYPE
    output.addfile(member)
class NoWrites:
    def __truediv__(self, relative):
        raise AssertionError('unsafe directory reached filesystem')
try:
    extract(archive, NoWrites(), 'package', lambda name: True)
except ValueError as error:
    assert 'unsafe archive member' in str(error)
    print('refused directory before filesystem')
else:
    raise AssertionError('accepted ambiguous directory')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused directory before filesystem')
  })
})

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
// Fixture Pi staging: real file:// downloads (digest enforced), a stubbed
// gpgv replaying the captured VALIDSIG shape with the fixture fingerprint,
// and a stubbed depmod. No host tool runs on any OS.
function piPreparePython(dir, kind, reason) {
  return String.raw`
import hashlib, io, json, sys, tarfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(root)})
from build import download
from pi import compose
kind = ${JSON.stringify(kind)}
base = Path(${JSON.stringify(dir)})
pin = 'AA55' * 10
kernel = '6.18.50+rpt-rpi-v8'
def ar_member(member_name, content):
    header = (member_name.ljust(16) + '0'.rjust(12) + '0'.rjust(6) + '0'.rjust(6)
              + '100644'.rjust(8) + str(len(content)).rjust(10)).encode() + b'\x60\x0a'
    return header + content + (b'\n' if len(content) % 2 else b'')
def make_deb(specs):
    blob = io.BytesIO()
    with tarfile.open(fileobj=blob, mode='w:gz') as output:
        for member_name, content, mode in specs:
            info = tarfile.TarInfo(member_name)
            info.size = len(content)
            info.mode = mode
            output.addfile(info, io.BytesIO(content))
    control = io.BytesIO()
    with tarfile.open(fileobj=control, mode='w:gz'):
        pass
    return (b'!<arch>\n' + ar_member('debian-binary', b'2.0\n')
            + ar_member('control.tar.gz', control.getvalue())
            + ar_member('data.tar.gz', blob.getvalue()))
kernel_specs = [
    ('boot/vmlinuz-' + kernel, b'kernel-bytes', 0o644),
    ('usr/lib/modules/' + kernel + '/modules.order', b'order', 0o644),
    ('usr/lib/modules/' + kernel + '/dtb/broadcom/bcm2711-rpi-4-b.dtb', b'dtb', 0o644),
    ('usr/lib/modules/' + kernel + '/dtb/overlays/README', b'readme', 0o644),
]
firm_specs = [('usr/lib/raspi-firmware/start.elf', b'elf', 0o644)]
if kind == 'hostile-deb':
    firm_specs.append(('../evil', b'evil', 0o644))
kernel_deb = make_deb(kernel_specs)
firm_deb = make_deb(firm_specs)
assets = base / 'assets'
assets.mkdir()
(assets / 'kernel.deb').write_bytes(kernel_deb)
(assets / 'firm.deb').write_bytes(firm_deb)
kernel_sha = hashlib.sha256(kernel_deb).hexdigest()
firm_sha = hashlib.sha256(firm_deb).hexdigest()
claimed_kernel = 'ff' * 32 if kind == 'index-disagrees' else kernel_sha
payload = ('Origin: fixture\nSuite: trixie\nSHA256:\n'
           + ' ' + claimed_kernel + ' 10 pool/main/l/linux/kernel.deb\n'
           + ' ' + firm_sha + ' 20 pool/main/r/raspi-firmware/firm.deb\n')
armor = ('-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n' + payload
         + '-----BEGIN PGP SIGNATURE-----\n\nfixture\n-----END PGP SIGNATURE-----\n')
(assets / 'InRelease').write_bytes(armor.encode() + (b'x' if kind == 'tampered-index' else b''))
manifest = {
    'archiveSigningFingerprint': '0' if kind == 'bad-fingerprint' else pin,
    'packagesIndexSha256': hashlib.sha256(armor.encode()).hexdigest(),
    'packagesIndexUrl': (assets / 'InRelease').as_uri(),
    'packages': [
        {'package': 'linux-image-' + kernel, 'version': '1',
         'url': (assets / 'kernel.deb').as_uri(), 'sha256': kernel_sha},
        {'package': 'raspi-firmware', 'version': '1',
         'url': (assets / 'firm.deb').as_uri(), 'sha256': firm_sha},
    ],
    'targets': {'pi4': {'kernel': kernel, 'kernelFile': 'kernel8.img',
                        'deviceTree': 'bcm2711-rpi-4-b.dtb'}},
}
workspace = base / 'ws'
(workspace / 'pi').mkdir(parents=True)
(workspace / 'pi/manifest.json').write_text(json.dumps(manifest))
keyring = base / 'keyring.gpg'
keyring.write_bytes(b'fixture-keyring')
captured = (
    '[GNUPG:] NEWSIG\n'
    '[GNUPG:] KEY_CONSIDERED ' + pin + ' 0\n'
    '[GNUPG:] SIG_ID fixture 2026-10-05 1791158400\n'
    '[GNUPG:] GOODSIG ' + pin[24:32] + ' fixture key <fixture@example.invalid>\n'
    '[GNUPG:] VALIDSIG ' + pin + ' 2026-10-05 1791158400 0 4 0 1 8 01 ' + pin + '\n'
)
errsig = (
    '[GNUPG:] NEWSIG\n'
    '[GNUPG:] KEY_CONSIDERED CC9686A587AAFF7D9845EBA0E2EDD1F6158491F0 1\n'
    '[GNUPG:] ERRSIG E2EDD1F6158491F0 1 8 01 1791158400 9 -\n'
    '[GNUPG:] NO_PUBKEY E2EDD1F6158491F0\n'
)
calls = []
def fake_run(cmd, **kw):
    calls.append(cmd[0])
    if cmd[0] == 'gpgv':
        assert cmd[1:4] == ['--status-fd', '1', '--keyring']
        assert Path(cmd[4]) == keyring
        if kind == 'bad-signature':
            return SimpleNamespace(returncode=2, stdout=errsig)
        return SimpleNamespace(returncode=0, stdout=captured)
    if cmd[0] == 'depmod':
        assert kernel in cmd
        return SimpleNamespace(returncode=0)
    raise AssertionError('unexpected host tool: ' + cmd[0])
try:
    result = compose.prepare('pi4', workspace, assets, download, keyring, runner=fake_run)
except ValueError as error:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is not None
    assert ${reason === null ? 'None' : JSON.stringify(reason)} in str(error)
    if kind == 'hostile-deb':
        assert 'depmod' not in calls
    print('refused hostile pi input')
else:
    overlay = workspace / 'overlay'
    assert (overlay / 'usr/lib/modules' / kernel / 'vmlinuz').read_bytes() == b'kernel-bytes'
    assert (overlay / 'boot/firmware/start.elf').read_bytes() == b'elf'
    assert (overlay / 'boot/firmware/bcm2711-rpi-4-b.dtb').read_bytes() == b'dtb'
    assert 'kernel8.img' in (overlay / 'boot/firmware/config.txt').read_text()
    assert 'tryboot_a_b=1' in (overlay / 'boot/firmware/autoboot.txt').read_text()
    assert 'gpgv' in calls and 'depmod' in calls
    assert result['targets']['pi4']['kernelFile'] == 'kernel8.img'
    print('pi staging verified')
`
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
      'mkosi.profiles/installer.conf',
      'KernelCommandLine=systemd.volatile=overlay',
      'KernelCommandLine=systemd.volatile=no',
      'installer volatile overlay',
    ],
    [
      'mkosi.profiles/installer.conf',
      'KernelCommandLine=systemd.volatile=overlay\n',
      '',
      'installer volatile overlay',
    ],
    [
      'mkosi.conf',
      'Repositories=main non-free-firmware',
      'Repositories=main contrib',
      'Debian repositories',
    ],
    ['repart/00-esp.conf', '260M', '256M', 'ESP size'],
    [
      'pi/manifest.json',
      '"archiveSigningFingerprint": "CF8A1AF502A2AA2D763BAE7E82B129927FA3303E"',
      '"archiveSigningFingerprint": "0"',
      'Pi archive fingerprint',
    ],
    [
      'pi/manifest.json',
      '"packagesIndexSha256": "e871e65b3d0dcf9b71cb6f5d69ed2e362c5cf81055043bc7531e1b92763151cd"',
      '"packagesIndexSha256": "xyz"',
      'Pi index digest',
    ],
    [
      'pi/manifest.json',
      '"packagesIndexUrl": "https://archive.raspberrypi.com/debian/dists/trixie/InRelease",\n',
      '',
      'Pi index location',
    ],
    [
      'pi/manifest.json',
      '"sha256": "41a73543781af93f591adddcbf1e2fcc478450784ba2a27be2f07af84ce2bbb6"',
      '"sha256": "0"',
      'Pi package digest',
    ],
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
    ['mkosi', 'mkosi version mismatch'],
    ['node', 'is not a regular file'],
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
kind = ${JSON.stringify(kind)}
# The mkosi version probe never leaves this process: the reply below is the
# only version the staged composer ever sees.
build.subprocess.run = lambda cmd, **kw: SimpleNamespace(
    stdout='mkosi 26' if kind == 'mkosi' else 'mkosi 27.1', stderr='')
node = base / 'node.tar'
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
    binding=binding if kind == 'binding' else None, binding_sha256='0' * 64,
    mkosi=base / 'fake-mkosi', pi_keyring=None, pi_keyring_sha256=None)
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
    ['pi4', [], 'Pi builds need'],
    ['pi4', ['--pi-keyring', 'only'], 'supplied together'],
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
  it.each([
    ['match', null],
    ['disagree', 'Pi package digest'],
    ['missing', 'Pi index package entry'],
    ['ambiguous', 'Pi index package entry'],
    ['malformed', 'Pi index entry'],
    ['empty', 'Pi index hashes'],
  ])('checks Pi package pins against the verified index (%s)', (kind, reason) => {
    const result = python(String.raw`
import sys
sys.path.insert(0, ${JSON.stringify(root)})
from check import verify_pi_index
kind = ${JSON.stringify(kind)}
firmware = 'aa' * 32
kernel = 'bb' * 32
manifest = {'packages': [
    {'package': 'raspi-firmware',
     'url': 'https://archive.raspberrypi.com/debian/pool/main/r/raspi-firmware/raspi-firmware_1.20260915-1_all.deb',
     'sha256': firmware},
    {'package': 'linux-image-x',
     'url': 'https://archive.raspberrypi.com/debian/pool/main/l/linux/other_1_arm64.deb',
     'sha256': kernel},
]}
entries = [
    ' ' + firmware + ' 10 pool/main/r/raspi-firmware/raspi-firmware_1.20260915-1_all.deb',
    ' ' + kernel + ' 20 pool/main/l/linux/other_1_arm64.deb',
]
if kind == 'disagree':
    entries[0] = ' ' + 'cc' * 32 + ' 10 pool/main/r/raspi-firmware/raspi-firmware_1.20260915-1_all.deb'
elif kind == 'missing':
    entries = entries[:1]
elif kind == 'ambiguous':
    entries.append(' ' + firmware + ' 30 pool/other/r/raspi-firmware/raspi-firmware_1.20260915-1_all.deb')
elif kind == 'malformed':
    entries[0] = ' ' + firmware + ' pool/main/r/raspi-firmware/raspi-firmware_1.20260915-1_all.deb'
elif kind == 'empty':
    entries = []
payload = 'Origin: test\nSuite: trixie\nSHA256:\n' + '\n'.join(entries) + '\n'
try:
    wanted = verify_pi_index(manifest, payload)
except ValueError as error:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is not None
    assert ${reason === null ? 'None' : JSON.stringify(reason)} in str(error)
    print('refused index mismatch')
else:
    assert wanted == {'raspi-firmware': firmware, 'linux-image-x': kernel}
    print('index pins agree')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(reason === null ? 'index pins agree' : 'refused index mismatch')
  })
  // The status shape below is the byte-exact gpgv 2.4.8 capture from the
  // kubuntu rig against a throwaway RSA key (minted, used once and destroyed
  // in FIXM110OS1; recipe and full capture in the OS1 certificate). Key
  // material is built by repetition, never a literal: the committed tests
  // carry no key bytes at all. One case reports an unrelated key to prove
  // the comparison bites.
  it.each([
    ['match', null],
    ['lowercase-pin', null],
    ['unrelated-key', 'signature mismatch'],
    ['bad-exit', 'signature mismatch'],
    ['no-validsig', 'signature mismatch'],
  ])('checks the archive signature report against the pinned fingerprint (%s)', (kind, reason) => {
    const result = python(String.raw`
import sys
sys.path.insert(0, ${JSON.stringify(root)})
from pi.compose import check_gpgv_status
kind = ${JSON.stringify(kind)}
pin = 'AA55' * 10
other = 'BB66' * 10
def captured_for(key):
    return (
        '[GNUPG:] NEWSIG\n'
        '[GNUPG:] KEY_CONSIDERED ' + key + ' 0\n'
        '[GNUPG:] SIG_ID Kfcj5dJKS0evnOyboBjHkpx+8pY 2026-10-05 1791158400\n'
        '[GNUPG:] GOODSIG ' + key[24:32] + ' OS1 throwaway fixture key <os1-throwaway@example.invalid>\n'
        '[GNUPG:] VALIDSIG ' + key + ' 2026-10-05 1791158400 0 4 0 1 8 01 ' + key + '\n'
    )
errsig = (
    '[GNUPG:] NEWSIG\n'
    '[GNUPG:] KEY_CONSIDERED CC9686A587AAFF7D9845EBA0E2EDD1F6158491F0 1\n'
    '[GNUPG:] ERRSIG E2EDD1F6158491F0 1 8 01 1791158400 9 -\n'
    '[GNUPG:] NO_PUBKEY E2EDD1F6158491F0\n'
)
if kind in ('match', 'lowercase-pin'):
    output, exit, fingerprint = captured_for(pin), 0, pin.lower() if kind == 'lowercase-pin' else pin
elif kind == 'unrelated-key':
    output, exit, fingerprint = captured_for(other), 0, pin
elif kind == 'bad-exit':
    output, exit, fingerprint = errsig, 2, pin
else:
    output, exit, fingerprint = '[GNUPG:] GOODSIG fixture\n', 0, pin
try:
    check_gpgv_status(exit, output, fingerprint)
except ValueError as error:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is not None
    assert ${reason === null ? 'None' : JSON.stringify(reason)} in str(error)
    print('refused signature mismatch')
else:
    print('signature accepted')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      reason === null ? 'signature accepted' : 'refused signature mismatch',
    )
  })
  it.each([
    ['payload', null],
    ['no-begin', 'armor'],
    ['no-signature', 'armor'],
    ['binary', 'encoding'],
  ])('reads the signed text of a clearsigned index (%s)', (kind, reason) => {
    const dir = directory()
    const result = python(String.raw`
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from pi.compose import clearsign_payload
kind = ${JSON.stringify(kind)}
file = Path(${JSON.stringify(path.join(dir, 'index.asc'))})
if kind == 'payload':
    file.write_text('-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nfirst\n- - second\n-----BEGIN PGP SIGNATURE-----\n\nfixture\n-----END PGP SIGNATURE-----\n')
elif kind == 'no-begin':
    file.write_text('first\n-----BEGIN PGP SIGNATURE-----\n')
elif kind == 'no-signature':
    file.write_text('-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nfirst\n')
else:
    file.write_bytes(b'\xff\xfe\x00binary')
try:
    payload = clearsign_payload(file)
except ValueError as error:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is not None
    assert ${reason === null ? 'None' : JSON.stringify(reason)} in str(error)
    print('refused malformed armor')
else:
    assert payload == 'first\n- second\n'
    print('payload extracted')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      reason === null ? 'payload extracted' : 'refused malformed armor',
    )
  })
  it.each([
    ['traversal', '../evil', null, 'unsafe archive member'],
    ['absolute', '/evil', null, 'unsafe archive member'],
    ['backslash', String.raw`a\b`, null, 'unsafe archive member'],
    ['dotdot', 'usr/../../evil', null, 'unsafe archive member'],
    ['symlink-outside', 'x/link', '/../evil', 'unsafe archive member'],
    ['hardlink', 'x/link', 'usr/lib/raspi-firmware/fw.bin', 'unsafe archive member'],
    ['device', 'usr/lib/raspi-firmware/dev', null, 'unsafe archive member'],
    ['duplicate', 'usr/lib/raspi-firmware/fw.bin', null, 'duplicate member'],
  ])('refuses a hostile Pi .deb member (%s) before staging', (kind, name, target, reason) => {
    const dir = directory()
    const result = python(String.raw`
import io, sys, tarfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from pi.compose import extract_deb
kind = ${JSON.stringify(kind)}
name = ${JSON.stringify(name)}
target = ${target === null ? 'None' : JSON.stringify(target)}
def ar_member(member_name, content):
    header = (member_name.ljust(16) + '0'.rjust(12) + '0'.rjust(6) + '0'.rjust(6)
              + '100644'.rjust(8) + str(len(content)).rjust(10)).encode() + b'\x60\x0a'
    return header + content + (b'\n' if len(content) % 2 else b'')
def reg(member_name, content, mode=0o644):
    info = tarfile.TarInfo(member_name)
    info.size = len(content)
    info.mode = mode
    return (info, content)
members = [reg('usr/lib/raspi-firmware/fw.bin', b'firmware')]
if kind == 'duplicate':
    members.append(reg(name, b'copy'))
elif kind == 'hardlink':
    info = tarfile.TarInfo(name)
    info.type = tarfile.LNKTYPE
    info.linkname = target
    members.append((info, None))
elif kind == 'device':
    info = tarfile.TarInfo(name)
    info.type = tarfile.CHRTYPE
    members.append((info, None))
elif kind in ('symlink-outside',):
    info = tarfile.TarInfo(name)
    info.type = tarfile.SYMTYPE
    info.linkname = target
    members.append((info, None))
else:
    members.append(reg(name, b'evil'))
blob = io.BytesIO()
with tarfile.open(fileobj=blob, mode='w:gz') as output:
    for info, content in members:
        output.addfile(info, io.BytesIO(content) if content is not None else None)
control = io.BytesIO()
with tarfile.open(fileobj=control, mode='w:gz'):
    pass
deb = (b'!<arch>\n' + ar_member('debian-binary', b'2.0\n')
       + ar_member('control.tar.gz', control.getvalue())
       + ar_member('data.tar.gz', blob.getvalue()))
archive = Path(${JSON.stringify(path.join(dir, 'fixture.deb'))})
archive.write_bytes(deb)
dest = Path(${JSON.stringify(path.join(dir, 'overlay'))})
try:
    extract_deb(archive, dest, runner=lambda cmd, **kw: (_ for _ in ()).throw(AssertionError('host tool reached')))
except ValueError as error:
    assert ${JSON.stringify(reason)} in str(error)
    assert not (dest / 'evil').exists()
    print('refused hostile member')
else:
    raise AssertionError('staged hostile member')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused hostile member')
  })
  it('stages a valid Pi .deb with setuid stripped', () => {
    const dir = directory()
    const result = python(String.raw`
import io, os, stat, sys, tarfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from pi.compose import extract_deb
def ar_member(member_name, content):
    header = (member_name.ljust(16) + '0'.rjust(12) + '0'.rjust(6) + '0'.rjust(6)
              + '100644'.rjust(8) + str(len(content)).rjust(10)).encode() + b'\x60\x0a'
    return header + content + (b'\n' if len(content) % 2 else b'')
blob = io.BytesIO()
with tarfile.open(fileobj=blob, mode='w:gz') as output:
    root_entry = tarfile.TarInfo('./')
    root_entry.type = tarfile.DIRTYPE
    output.addfile(root_entry)
    setuid = tarfile.TarInfo('usr/lib/raspi-firmware/fw.bin')
    setuid.size = 8
    setuid.mode = 0o4755
    output.addfile(setuid, io.BytesIO(b'firmware'))
    plain = tarfile.TarInfo('boot/vmlinuz-x')
    plain.size = 6
    output.addfile(plain, io.BytesIO(b'kernel'))
    prefixed = tarfile.TarInfo('./usr/lib/raspi-firmware/prefixed.bin')
    prefixed.size = 8
    output.addfile(prefixed, io.BytesIO(b'prefixed'))
control = io.BytesIO()
with tarfile.open(fileobj=control, mode='w:gz'):
    pass
deb = (b'!<arch>\n' + ar_member('debian-binary', b'2.0\n')
       + ar_member('control.tar.gz', control.getvalue())
       + ar_member('data.tar.gz', blob.getvalue()))
archive = Path(${JSON.stringify(path.join(dir, 'firmware.deb'))})
archive.write_bytes(deb)
dest = Path(${JSON.stringify(path.join(dir, 'overlay'))})
extract_deb(archive, dest)
firmware = dest / 'usr/lib/raspi-firmware/fw.bin'
assert firmware.read_bytes() == b'firmware'
assert (dest / 'boot/vmlinuz-x').read_bytes() == b'kernel'
assert (dest / 'usr/lib/raspi-firmware/prefixed.bin').read_bytes() == b'prefixed'
if os.name == 'posix':
    assert stat.S_IMODE(os.stat(firmware).st_mode) == 0o755
    assert os.stat(firmware).st_mode & 0o6000 == 0
print('valid deb staged without privilege bits')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('valid deb staged without privilege bits')
  })
  it.each([
    ['bad-magic', 'archive header'],
    ['no-data', 'data member'],
    ['bad-version', 'version'],
  ])('refuses a malformed Pi .deb container (%s)', (kind, reason) => {
    const dir = directory()
    const result = python(String.raw`
import io, sys, tarfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from pi.compose import extract_deb
kind = ${JSON.stringify(kind)}
def ar_member(member_name, content):
    header = (member_name.ljust(16) + '0'.rjust(12) + '0'.rjust(6) + '0'.rjust(6)
              + '100644'.rjust(8) + str(len(content)).rjust(10)).encode() + b'\x60\x0a'
    return header + content + (b'\n' if len(content) % 2 else b'')
control = io.BytesIO()
with tarfile.open(fileobj=control, mode='w:gz'):
    pass
if kind == 'bad-magic':
    deb = b'not-an-archive'
elif kind == 'no-data':
    deb = b'!<arch>\n' + ar_member('debian-binary', b'2.0\n') + ar_member('control.tar.gz', control.getvalue())
else:
    deb = b'!<arch>\n' + ar_member('debian-binary', b'1.0\n') + ar_member('control.tar.gz', control.getvalue())
archive = Path(${JSON.stringify(path.join(dir, 'broken.deb'))})
archive.write_bytes(deb)
try:
    extract_deb(archive, Path(${JSON.stringify(path.join(dir, 'overlay'))}))
except ValueError as error:
    assert ${JSON.stringify(reason)} in str(error)
    print('refused malformed container')
else:
    raise AssertionError('staged malformed container')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused malformed container')
  })
  it('routes an undecodable data member through dpkg-deb, then admits the tree', () => {
    const dir = directory()
    const result = python(String.raw`
import sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(root)})
from pi.compose import extract_deb
def ar_member(member_name, content):
    header = (member_name.ljust(16) + '0'.rjust(12) + '0'.rjust(6) + '0'.rjust(6)
              + '100644'.rjust(8) + str(len(content)).rjust(10)).encode() + b'\x60\x0a'
    return header + content + (b'\n' if len(content) % 2 else b'')
deb = (b'!<arch>\n' + ar_member('debian-binary', b'2.0\n')
       + ar_member('data.tar.zst', b'fixture bytes stay opaque here'))
archive = Path(${JSON.stringify(path.join(dir, 'opaque.deb'))})
archive.write_bytes(deb)
calls = []
def fake_run(cmd, **kw):
    calls.append(cmd)
    assert cmd[0] == 'dpkg-deb' and cmd[1] == '--extract'
    assert Path(cmd[2]) == archive
    planted = Path(cmd[3]) / 'usr/lib/raspi-firmware'
    planted.mkdir(parents=True)
    (planted / 'fw.bin').write_bytes(b'firmware')
    return SimpleNamespace(returncode=0)
dest = Path(${JSON.stringify(path.join(dir, 'overlay'))})
extract_deb(archive, dest, runner=fake_run)
assert len(calls) == 1
assert (dest / 'usr/lib/raspi-firmware/fw.bin').read_bytes() == b'firmware'
print('opaque data member admitted after host decode')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('opaque data member admitted after host decode')
  })
  it('stages Pi firmware through the verified index without host tools', () => {
    const dir = directory()
    const result = python(piPreparePython(dir, 'valid', null))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('pi staging verified')
  })
  it.each([
    ['tampered-index', 'SHA-256 mismatch'],
    ['bad-signature', 'signature mismatch'],
    ['index-disagrees', 'Pi package digest'],
    ['bad-fingerprint', 'Pi archive fingerprint'],
    ['hostile-deb', 'unsafe archive member'],
  ])('refuses hostile Pi staging input (%s)', (kind, reason) => {
    const dir = directory()
    const result = python(piPreparePython(dir, kind, reason))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused hostile pi input')
  })
  it.each([
    ['valid', null],
    ['link', 'is not a regular file'],
  ])('admits only the wanted regular files from an xz archive (%s)', (kind, reason) => {
    const dir = directory()
    const result = python(`
import sys, tarfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from build import extract_selected
kind = ${JSON.stringify(kind)}
prefix = 'node-v24.18.0-linux-x64'
archive = Path(${JSON.stringify(path.join(dir, 'node.tar.xz'))})
dest = Path(${JSON.stringify(path.join(dir, 'node'))})
with tarfile.open(archive, 'w:xz') as output:
    node = tarfile.TarInfo(prefix + '/bin/node')
    import io
    if kind == 'link':
        node.type = tarfile.SYMTYPE
        node.linkname = '/outside'
        output.addfile(node)
    else:
        node.size = 1
        node.mode = 0o755
        output.addfile(node, io.BytesIO(b'n'))
    license = tarfile.TarInfo(prefix + '/LICENSE')
    license.size = 1
    output.addfile(license, io.BytesIO(b'l'))
    if kind != 'link':
        npm = tarfile.TarInfo(prefix + '/bin/npm')
        npm.type = tarfile.SYMTYPE
        npm.linkname = '../lib/node_modules/npm/bin/npm-cli.js'
        output.addfile(npm)
        docs = tarfile.TarInfo(prefix + '/docs/readme')
        docs.size = 1
        output.addfile(docs, io.BytesIO(b'd'))
try:
    extract_selected(archive, dest, prefix, ('bin/node', 'LICENSE'))
except ValueError as error:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is not None
    assert ${reason === null ? 'None' : JSON.stringify(reason)} in str(error)
    print('refused wanted link')
else:
    assert (dest / 'bin/node').read_bytes() == b'n'
    assert (dest / 'LICENSE').read_bytes() == b'l'
    assert not (dest / 'bin/npm').exists()
    assert not (dest / 'docs').exists()
    print('selected regular files admitted')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      reason === null ? 'selected regular files admitted' : 'refused wanted link',
    )
  })
})

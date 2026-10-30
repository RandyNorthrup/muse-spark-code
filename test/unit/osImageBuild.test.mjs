import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runOsBootProbe } from './helpers/osBootProbe.mjs'

// Tool-gated tests follow the repository's bun precedent (PLAN §9): they
// run where the tool exists and skip elsewhere with the reason in the name.
let isGpgvAvailable = false
try {
  isGpgvAvailable = spawnSync('gpgv', ['--version'], { encoding: 'utf8' }).status === 0
} catch {
  isGpgvAvailable = false
}
let rigInRelease = null
try {
  const names = readdirSync('/var/lib/apt/lists')
    .filter((name) => name.endsWith('InRelease'))
    .toSorted((a, b) => a.localeCompare(b))
  if (names.length > 0) rigInRelease = path.join('/var/lib/apt/lists', names[0])
} catch {
  rigInRelease = null
}

// OpenPGP framing helpers for the minted-key test below: pure packet
// layout with no key state, so they live at module scope.
function openpgpMpi(bytes) {
  let value = BigInt(`0x${bytes.length > 0 ? bytes.toString('hex') : '00'}`)
  let bits = 0
  for (let rest = value; rest > 0n; rest >>= 1n) bits += 1
  const head = Buffer.alloc(2)
  head.writeUInt16BE(bits)
  return Buffer.concat([head, bytes])
}
function openpgpPacket(tag, body) {
  let len
  if (body.length < 192) len = Buffer.from([body.length])
  else if (body.length < 8384) {
    const n = body.length - 192
    len = Buffer.from([192 + (n >> 8), n & 0xff])
  } else {
    const head = Buffer.alloc(5)
    head[0] = 255
    head.writeUInt32BE(body.length, 1)
    len = head
  }
  return Buffer.concat([Buffer.from([0xc0 | tag]), len, body])
}
function openpgpCrc24(buf) {
  let crc = 0xb7_04_ce
  for (const byte of buf) {
    crc ^= byte << 16
    for (let i = 0; i < 8; i += 1) {
      crc <<= 1
      if (crc & 0x1_00_00_00) crc ^= 0x1_86_4c_fb
    }
  }
  const out = Buffer.alloc(3)
  out.writeUIntBE(crc & 0xff_ff_ff, 0, 3)
  return out
}
function openpgpArmor(label, buf) {
  const text = buf.toString('base64')
  const lines = []
  for (let i = 0; i < text.length; i += 64) lines.push(text.slice(i, i + 64))
  return (
    `-----BEGIN PGP ${label}-----\n\n${lines.join('\n')}\n=` +
    `${openpgpCrc24(buf).toString('base64')}\n-----END PGP ${label}-----\n`
  )
}

// A throwaway OpenPGP RSA key minted at test time with node:crypto (the
// rig sandbox blocks gpg-agent, so gpg cannot mint here). Packets are
// framed by hand; the real gpgv binary is the oracle. No key material is
// committed: the key lives only in the test's temp dir.
function mintThrowaway() {
  const mpi = openpgpMpi
  const packet = openpgpPacket
  const armor = openpgpArmor
  const created = 1_791_158_400
  const timeBytes = () => {
    const out = Buffer.alloc(4)
    out.writeUInt32BE(created)
    return out
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 65_537,
  })
  const pub = publicKey.export({ format: 'jwk' })
  const n = Buffer.from(pub.n, 'base64url')
  const e = Buffer.from(pub.e, 'base64url')
  // OpenPGP RSA public key: modulus MPI first, exponent MPI second.
  const keyBody = Buffer.concat([Buffer.from([4]), timeBytes(), Buffer.from([1]), mpi(n), mpi(e)])
  const keyPacket = packet(6, keyBody)
  const fingerprint = crypto
    .createHash('sha1')
    .update(
      Buffer.concat([
        Buffer.from([0x99, (keyBody.length >> 8) & 0xff, keyBody.length & 0xff]),
        keyBody,
      ]),
    )
    .digest('hex')
  const uid = Buffer.from('OS1 throwaway <os1-throwaway@example.invalid>', 'utf8')
  const signPacket = (sigType, hashInput) => {
    const hashedArea = Buffer.concat([Buffer.from([5, 2]), timeBytes()])
    const head = Buffer.concat([
      Buffer.from([4, sigType, 1, 8]),
      (() => {
        const len = Buffer.alloc(2)
        len.writeUInt16BE(hashedArea.length)
        return len
      })(),
      hashedArea,
    ])
    const trailer = Buffer.concat([
      Buffer.from([4, 0xff]),
      (() => {
        const len = Buffer.alloc(4)
        len.writeUInt32BE(hashedArea.length + 6)
        return len
      })(),
    ])
    const keyid = Buffer.from(fingerprint.slice(-16), 'hex')
    const unhashed = Buffer.concat([Buffer.from([9, 16]), keyid])
    const digest = crypto
      .createHash('sha256')
      .update(Buffer.concat([hashInput, head, trailer]))
      .digest()
    const signature = crypto.sign('sha256', Buffer.concat([hashInput, head, trailer]), {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    })
    return packet(
      2,
      Buffer.concat([
        head,
        (() => {
          const len = Buffer.alloc(2)
          len.writeUInt16BE(unhashed.length)
          return len
        })(),
        unhashed,
        digest.slice(0, 2),
        mpi(signature),
      ]),
    )
  }
  const uidLen = Buffer.alloc(4)
  uidLen.writeUInt32BE(uid.length)
  const selfSig = signPacket(
    0x13,
    Buffer.concat([
      Buffer.from([0x99, (keyBody.length >> 8) & 0xff, keyBody.length & 0xff]),
      keyBody,
      Buffer.from([0xb4]),
      uidLen,
      uid,
    ]),
  )
  const keyring = Buffer.concat([keyPacket, packet(13, uid), selfSig])
  // Text-mode clearsign: CRLF canonical form with the trailing CRLF
  // omitted from the hash (verified against real gpgv on this rig).
  const sign = (text) => {
    const escaped = text
      .split('\n')
      .map((line) => (line.startsWith('-') ? `- ${line}` : line))
      .join('\n')
    let canonical = Buffer.from(escaped.replaceAll('\n', '\r\n'), 'utf8')
    if (canonical.slice(-2).toString() === '\r\n') canonical = canonical.slice(0, -2)
    return `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n${escaped}${armor('SIGNATURE', signPacket(0x01, canonical))}`
  }
  return { fingerprint, keyring, sign }
}

// The refusal drill proves the probe stops before touching any host state. It
// never runs as the node service account itself: there the real probe would
// proceed past the UID gate and write the service's state directory.

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
// Fixture Pi staging in the REAL apt shape: a Release payload whose SHA256
// section lists index files (never .debs), a gzipped Packages index with
// real-shaped stanzas (Package/Version/Architecture/Filename/Size/SHA256),
// real file:// downloads (digest enforced), a stubbed gpgv replaying the
// captured VALIDSIG shape with the fixture fingerprint, and a stubbed
// depmod. No host tool runs on any OS.
function piPreparePython(dir, kind, reason) {
  return String.raw`
import gzip, hashlib, io, json, sys, tarfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(root)})
from build import download
from pi import compose
kind = ${JSON.stringify(kind)}
base = Path(${JSON.stringify(dir)})
pin = 'AA55' * 10
kernel = '6.18.50+rpt-rpi-v8'
kernel_version = '1:6.18.50-1+rpt1'
firm_version = '1:1.20260915-1'
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
kernel_size = len(kernel_deb) + (1 if kind == 'size-mismatch' else 0)
firm_url = (assets / 'firm.deb').as_uri()
kernel_url = (assets / 'kernel.deb').as_uri()
if kind == 'filename-mismatch':
    kernel_url = (assets / 'renamed.deb').as_uri()
def stanza(package, version, arch, filename, sha, size):
    return ('Package: ' + package + '\nVersion: ' + version + '\nArchitecture: ' + arch
            + '\nFilename: ' + filename + '\nSize: ' + str(size) + '\nSHA256: ' + sha + '\n')
packages_text = (stanza('linux-image-' + kernel, kernel_version, 'arm64',
                        'pool/main/l/linux/kernel.deb', claimed_kernel, kernel_size)
                 + '\n'
                 + stanza('raspi-firmware', firm_version, 'all',
                          'pool/main/r/raspi-firmware/firm.deb', firm_sha, len(firm_deb)))
packages_gz = gzip.compress(packages_text.encode())
served_gz = packages_gz[:-4] + b'\x00\x00\x00\x00' if kind == 'packages-tampered' else packages_gz
index_name = 'other.gz' if kind == 'index-missing' else 'Packages.gz'
index_entry = (' ' + hashlib.sha256(packages_gz).hexdigest() + ' '
               + str(len(packages_gz)) + ' main/binary-arm64/' + index_name + '\n')
payload = ('Origin: fixture\nSuite: trixie\nCodename: trixie\nSHA256:\n'
           + index_entry
           + ' ' + 'ee' * 32 + ' 98 main/binary-arm64/Release\n')
armor = ('-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n' + payload
         + '-----BEGIN PGP SIGNATURE-----\n\nfixture\n-----END PGP SIGNATURE-----\n')
(assets / 'InRelease').write_bytes(armor.encode())
(assets / 'served-Packages.gz').write_bytes(served_gz)
manifest = {
    'archiveSigningFingerprint': '0' if kind == 'bad-fingerprint' else pin,
    'packagesIndex': 'main/binary-arm64/Packages.gz',
    'packagesIndexSha256': hashlib.sha256(packages_gz).hexdigest(),
    'packagesIndexUrl': (assets / 'InRelease').as_uri(),
    'packages': [
        {'package': 'linux-image-' + kernel, 'version': kernel_version,
         'url': kernel_url, 'sha256': kernel_sha},
        {'package': 'raspi-firmware', 'version': firm_version,
         'url': firm_url, 'sha256': firm_sha},
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
served = {'inrelease': assets / 'InRelease', 'packages': assets / 'served-Packages.gz'}
def fixture_download(url, expected, dest):
    # Each fixture URL serves its own file; the InRelease is the unsigned
    # trust root.
    if url.endswith('Packages.gz'):
        source = served['packages']
    elif url.endswith('kernel.deb'):
        source = assets / 'kernel.deb'
    elif url.endswith('firm.deb'):
        source = assets / 'firm.deb'
    else:
        source = served['inrelease']
    download(source.as_uri(), expected, dest)
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
    result = compose.prepare('pi4', workspace, assets, fixture_download, keyring, runner=fake_run)
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
  it.runIf(typeof process.getuid !== 'function' || process.getuid() !== 61_100)(
    'refuses to execute the native boot fixture outside the service UID',
    async () => {
      await expect(runOsBootProbe({ NodeService: null, nodeHealth: null })).rejects.toThrow(
        'OS1 wrong service UID',
      )
    },
  )
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
      '"packagesIndexSha256": "81158a38dbb347200ac3222c4183d1297b6f7c3bf39cda642355ddd3e66b1b3c"',
      '"packagesIndexSha256": "xyz"',
      'Pi index digest',
    ],
    [
      'pi/manifest.json',
      '"packagesIndex": "main/binary-arm64/Packages.gz"',
      '"packagesIndex": "../evil/Packages.gz"',
      'Pi index path',
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
      'mkosi.initrd.postinst',
      'ln -s ../muse-overlay-usr.service "$wants/muse-overlay-usr.service"',
      'ln -s ../muse-overlay-usr.service "$wants/other.service"',
      'initrd bind-ro enablement',
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
    [
      'mkosi.conf',
      'hash_seed=8821992e-4707-4882-96ce-a8b16b671a09',
      'hash_seed=random',
      'ext4 hash seed pin',
    ],
    ['mkosi.conf', '\n            /var/cache/ldconfig/aux-cache', '', 'ldconfig cache removal'],
    ['mkosi.conf', 'firmware-mediatek', 'firmware-other', 'base firmware packages'],
    ['mkosi.conf', '         nftables\n', '', 'firewall package'],
    ['mkosi.conf', '-/drivers/gpu/', '-/drivers/net/', 'initrd firmware exclusions'],
    [
      'hardening/nftables.conf',
      'type filter hook input priority 0; policy drop;',
      'type filter hook input priority 0; policy accept;',
      'default-drop firewall',
    ],
    [
      'hardening/nftables.conf',
      'type filter hook forward priority 0; policy drop;',
      'type filter hook forward priority 0; policy accept;',
      'default-drop firewall',
    ],
    [
      'mkosi.postinst',
      ' muse-node.service nftables.service',
      ' muse-node.service',
      'firewall enablement',
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
  it('refuses a tree without the kernel hardening knobs', () => {
    const dir = directory()
    cpSync(root, dir, { recursive: true })
    rmSync(path.join(dir, 'hardening', 'sysctl.d', '99-muse-node.conf'))
    const result = spawnSync(interpreter, [path.join(root, 'check.py'), dir], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('kernel hardening knobs')
  })
  it('ships the firewall and the kernel knobs from their one source with the right modes', () => {
    const dir = directory()
    const result = python(`
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
import build
overlay = Path(${JSON.stringify(path.join(dir, 'overlay'))})
build.install_hardening(overlay)
for source, shipped in (
    ('hardening/nftables.conf', 'etc/nftables.conf'),
    ('hardening/sysctl.d/99-muse-node.conf', 'usr/lib/sysctl.d/99-muse-node.conf'),
):
    copy = overlay / shipped
    assert copy.read_bytes() == (build.ROOT / source).read_bytes(), shipped
    assert copy.stat().st_mode & 0o777 == 0o644, shipped
print('hardening shipped')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('hardening shipped')
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
    stdout='mkosi 26' if kind == 'mkosi' else 'mkosi 27.1', stderr='', returncode=0)
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
    package = json.dumps({'name': 'muse-spark-code-acp', 'version': 'wrong' if kind == 'package' else '0.19.0'}).encode()
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
  it('admits the linux runtime member shapes and refuses an intruder', () => {
    const dir = directory()
    const result = python(`
import sys, tarfile, io, json, shutil
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(root)})
import build
base = Path(${JSON.stringify(dir)})
build.OUT = base / 'out'
build.subprocess.run = lambda cmd, **kw: SimpleNamespace(
    stdout='mkosi 27.1', stderr='', returncode=0)
node = base / 'node.tar'
with tarfile.open(node, 'w') as output:
    for name in ('bin/node', 'LICENSE'):
        member = tarfile.TarInfo('node-v24.18.0-linux-x64/' + name)
        member.size = 1
        output.addfile(member, io.BytesIO(b'x'))
build.download = lambda url, expected, dest: shutil.copyfile(node, dest)
# One member per admitted shape of the linux-targeted runtime tarball.
shaped = base / 'shaped.tar'
with tarfile.open(shaped, 'w') as output:
    package = json.dumps({'name': 'muse-spark-code-acp', 'version': '0.19.0'}).encode()
    members = {'package.json': package}
    for name in ('dist/node.js', 'dist/webview/chunks/DEADBEEF.js',
                 'dist/webview/usage.css', 'dist/legal-data.json.br',
                 'dist/legal-data/NOTICE.md', 'l10n/ui.tables.json.br',
                 'schemas/exec-result-v1.schema.json',
                 'native/linux/x64/muse-created', 'native/runner/runner-helper.sh',
                 'ci/lib/ci-entry.mjs', 'ci/prompts/ci/review.md',
                 'design/fonts/manifest.json', 'package.nls.de.json'):
        members[name] = b'x'
    for name, body in members.items():
        member = tarfile.TarInfo('package/' + name)
        member.size = len(body)
        output.addfile(member, io.BytesIO(body))
args = SimpleNamespace(target='x86-64', installer=False, runtime=shaped,
    runtime_sha256=build.digest(shaped), binding=None, binding_sha256=None,
    mkosi=base / 'fake-mkosi', pi_keyring=None, pi_keyring_sha256=None)
workspace = build.stage(args)
assert (workspace / 'overlay/usr/lib/muse-spark-code/dist/node.js').exists()
assert (workspace / 'overlay/usr/lib/muse-spark-code/dist/webview/chunks/DEADBEEF.js').exists()
build.OUT = base / 'out-intruder'
intruder = base / 'intruder.tar'
with tarfile.open(intruder, 'w') as output:
    package = json.dumps({'name': 'muse-spark-code-acp', 'version': '0.19.0'}).encode()
    for name, body in (('package.json', package), ('dist/evil.sh', b'x')):
        member = tarfile.TarInfo('package/' + name)
        member.size = len(body)
        output.addfile(member, io.BytesIO(body))
args = SimpleNamespace(target='x86-64', installer=False, runtime=intruder,
    runtime_sha256=build.digest(intruder), binding=None, binding_sha256=None,
    mkosi=base / 'fake-mkosi', pi_keyring=None, pi_keyring_sha256=None)
try:
    build.stage(args)
except ValueError as error:
    assert 'unexpected archive member' in str(error)
    print('refused the intruder')
else:
    raise AssertionError('admitted dist/evil.sh')
print('verified runtime member shapes')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('verified runtime member shapes')
    expect(result.stdout).toContain('refused the intruder')
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
    ['index-digest', 'Pi index digest'],
    ['index-absent', 'Pi index package entry'],
    ['disagree', 'Pi package digest'],
    ['missing', 'Pi index package entry'],
    ['ambiguous', 'Pi index package entry'],
    ['filename', 'Pi package file'],
    ['arch', 'Pi index package entry'],
    ['malformed', 'Pi index entry'],
    ['empty', 'Pi index hashes'],
    ['no-stanzas', 'Pi packages index'],
  ])('checks Pi package pins through the real index chain (%s)', (kind, reason) => {
    const result = python(String.raw`
import sys
sys.path.insert(0, ${JSON.stringify(root)})
from check import parse_release_hashes, verify_pi_packages
kind = ${JSON.stringify(kind)}
firmware = 'aa' * 32
kernel = 'bb' * 32
index_sha = 'dd' * 32
manifest = {'packagesIndex': 'main/binary-arm64/Packages.gz',
    'packagesIndexSha256': 'ee' * 32 if kind == 'index-digest' else index_sha,
    'packages': [
        {'package': 'raspi-firmware', 'version': '1:1',
         'url': 'https://archive.raspberrypi.com/debian/pool/main/r/raspi-firmware/firm_1_all.deb',
         'sha256': firmware},
        {'package': 'linux-image-x', 'version': '1:2',
         'url': 'https://archive.raspberrypi.com/debian/pool/main/l/linux/other_1_arm64.deb',
         'sha256': kernel},
    ]}
release_lines = [
    ' ' + index_sha + ' 10 main/binary-arm64/Packages.gz',
    ' ' + 'ff' * 32 + ' 20 main/binary-arm64/Release',
]
if kind == 'index-absent':
    release_lines = release_lines[1:]
elif kind == 'malformed':
    release_lines[0] = ' ' + index_sha + ' main/binary-arm64/Packages.gz'
elif kind == 'empty':
    release_lines = []
payload = 'Origin: test\nSuite: trixie\nSHA256:\n' + '\n'.join(release_lines) + '\n'
def stanza(package, version, arch, filename, sha, size):
    return ('Package: ' + package + '\nVersion: ' + version + '\nArchitecture: ' + arch
            + '\nFilename: ' + filename + '\nSize: ' + str(size) + '\nSHA256: ' + sha + '\n'
            + 'Description: fixture\n continued\n')
kernel_stanza = stanza('linux-image-x', '1:2', 'arm64',
                       'pool/main/l/linux/other_1_arm64.deb', kernel, 20)
firm_stanza = stanza('raspi-firmware', '1:1', 'armhf' if kind == 'arch' else 'all',
                     'pool/main/r/raspi-firmware/renamed_1_all.deb' if kind == 'filename' else 'pool/main/r/raspi-firmware/firm_1_all.deb',
                     'cc' * 32 if kind == 'disagree' else firmware, 10)
stanzas = [firm_stanza, kernel_stanza]
if kind == 'missing':
    stanzas = stanzas[1:]
elif kind == 'ambiguous':
    stanzas.append(firm_stanza)
elif kind == 'no-stanzas':
    stanzas = []
packages_text = '\n'.join(stanzas) + '\n'
try:
    entries = parse_release_hashes(payload)
    wanted = verify_pi_packages(manifest, entries, packages_text)
except ValueError as error:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is not None
    assert ${reason === null ? 'None' : JSON.stringify(reason)} in str(error)
    print('refused index mismatch')
else:
    assert wanted == {
        'raspi-firmware': {'sha256': firmware, 'size': 10,
                           'filename': 'pool/main/r/raspi-firmware/firm_1_all.deb'},
        'linux-image-x': {'sha256': kernel, 'size': 20,
                          'filename': 'pool/main/l/linux/other_1_arm64.deb'},
    }
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
    ['symlink-absolute', 'x/link', '/usr/lib/raspi-firmware/fw.bin', 'unsafe archive member'],
    ['hardlink', 'x/link', 'usr/lib/raspi-firmware/fw.bin', 'unsafe archive member'],
    ['device', 'usr/lib/raspi-firmware/dev', null, 'unsafe archive member'],
    ['duplicate', 'usr/lib/raspi-firmware/fw.bin', null, 'duplicate member'],
  ])('refuses a hostile Pi .deb member (%s) before staging', (kind, name, target, reason) => {
    const dir = directory()
    const result = python(String.raw`
import io, sys, tarfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from pi import compose
from pi.compose import extract_deb
compose.subprocess.run = lambda *args, **kw: (_ for _ in ()).throw(AssertionError('host tool reached'))
compose.subprocess.check_output = lambda *args, **kw: (_ for _ in ()).throw(AssertionError('host tool reached'))
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
elif kind in ('symlink-outside', 'symlink-absolute'):
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
    extract_deb(archive, dest)
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
  it.each([
    ['zst', null],
    ['unknown', 'OS1 Pi .deb compression'],
  ])('decodes a zstd data member in-process without host tools (%s)', (kind, reason) => {
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
try:
    from compression import zstd
    have_zstd = True
except ImportError:
    have_zstd = False
if kind == 'zst' and have_zstd:
    blob = io.BytesIO()
    with tarfile.open(fileobj=blob, mode='w:') as output:
        member = tarfile.TarInfo('usr/lib/raspi-firmware/fw.bin')
        member.size = 8
        output.addfile(member, io.BytesIO(b'firmware'))
    payload, suffix = zstd.compress(blob.getvalue()), '.zst'
elif kind == 'zst':
    payload, suffix = b'undecodable without compression.zstd', '.zst'
else:
    payload, suffix = b'fixture bytes stay opaque here', '.foo'
deb = (b'!<arch>\n' + ar_member('debian-binary', b'2.0\n')
       + ar_member('data.tar' + suffix, payload))
archive = Path(${JSON.stringify(path.join(dir, 'opaque.deb'))})
archive.write_bytes(deb)
dest = Path(${JSON.stringify(path.join(dir, 'overlay'))})
print('have_zstd=' + str(have_zstd and kind == 'zst'))
if kind == 'zst' and not have_zstd:
    expected = 'OS1 Pi .deb compression unavailable'
else:
    expected = ${reason === null ? 'None' : JSON.stringify(reason)}
try:
    extract_deb(archive, dest)
except ValueError as error:
    assert expected is not None
    assert expected in str(error)
    print('refused undecodable data member')
else:
    assert kind == 'zst' and have_zstd
    assert (dest / 'usr/lib/raspi-firmware/fw.bin').read_bytes() == b'firmware'
    print('zstd data member staged without host tools')
`)
    expect(result.status).toBe(0)
    // Hosts without compression.zstd take the named fail-closed refusal.
    const refused = reason !== null || result.stdout.includes('have_zstd=False')
    expect(result.stdout).toContain(
      refused ? 'refused undecodable data member' : 'zstd data member staged without host tools',
    )
  })
  it('stages Pi firmware through the verified index without host tools', () => {
    const dir = directory()
    const result = python(piPreparePython(dir, 'valid', null))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('pi staging verified')
  })
  it.each([
    ['packages-tampered', 'SHA-256 mismatch'],
    ['bad-signature', 'signature mismatch'],
    ['index-disagrees', 'Pi package digest'],
    ['index-missing', 'Pi index package entry'],
    ['filename-mismatch', 'Pi package file'],
    ['size-mismatch', 'Pi package size'],
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
  it.skipIf(!isGpgvAvailable)(
    'stages Pi firmware through a minted-key signed index and real gpgv [skips where gpgv is absent]',
    () => {
      const dir = directory()
      // Step 1: build fixture .debs and a real-shaped Packages index.
      const built = JSON.parse(
        python(String.raw`
import gzip, hashlib, io, json, tarfile
from pathlib import Path
base = Path(${JSON.stringify(dir)})
# A real archive layout, so real file:// downloads (including the
# composed Packages URL) resolve with no fixture routing.
pool = base / 'assets/pool/main'
(pool / 'l/linux').mkdir(parents=True)
(pool / 'r/raspi-firmware').mkdir(parents=True)
kernel = '6.18.50+rpt-rpi-v8'
def ar_member(member_name, content):
    header = (member_name.ljust(16) + '0'.rjust(12) + '0'.rjust(6) + '0'.rjust(6)
              + '100644'.rjust(8) + str(len(content)).rjust(10)).encode() + b'\x60\x0a'
    return header + content + (b'\n' if len(content) % 2 else b'')
def make_deb(specs):
    blob = io.BytesIO()
    with tarfile.open(fileobj=blob, mode='w:gz') as output:
        for member_name, content in specs:
            info = tarfile.TarInfo(member_name)
            info.size = len(content)
            output.addfile(info, io.BytesIO(content))
    control = io.BytesIO()
    with tarfile.open(fileobj=control, mode='w:gz'):
        pass
    return (b'!<arch>\n' + ar_member('debian-binary', b'2.0\n')
            + ar_member('control.tar.gz', control.getvalue())
            + ar_member('data.tar.gz', blob.getvalue()))
kernel_deb = make_deb([
    ('boot/vmlinuz-' + kernel, b'kernel-bytes'),
    ('usr/lib/modules/' + kernel + '/modules.order', b'order'),
    ('usr/lib/modules/' + kernel + '/dtb/broadcom/bcm2711-rpi-4-b.dtb', b'dtb'),
    ('usr/lib/modules/' + kernel + '/dtb/overlays/README', b'readme'),
])
firm_deb = make_deb([('usr/lib/raspi-firmware/start.elf', b'elf')])
(pool / 'l/linux/kernel.deb').write_bytes(kernel_deb)
(pool / 'r/raspi-firmware/firm.deb').write_bytes(firm_deb)
def stanza(package, version, arch, filename, data):
    return ('Package: ' + package + '\nVersion: ' + version + '\nArchitecture: ' + arch
            + '\nFilename: ' + filename + '\nSize: ' + str(len(data))
            + '\nSHA256: ' + hashlib.sha256(data).hexdigest() + '\n')
packages_text = (stanza('linux-image-' + kernel, '1:6.18.50-1+rpt1', 'arm64',
                        'pool/main/l/linux/kernel.deb', kernel_deb)
                 + '\n'
                 + stanza('raspi-firmware', '1:1.20260915-1', 'all',
                          'pool/main/r/raspi-firmware/firm.deb', firm_deb))
packages_gz = gzip.compress(packages_text.encode())
index_dir = base / 'assets/dists/trixie/main/binary-arm64'
index_dir.mkdir(parents=True)
(index_dir / 'Packages.gz').write_bytes(packages_gz)
print(json.dumps({
    'kernel_sha': hashlib.sha256(kernel_deb).hexdigest(),
    'firm_sha': hashlib.sha256(firm_deb).hexdigest(),
    'kernel_size': len(kernel_deb),
    'firm_size': len(firm_deb),
    'packages_sha': hashlib.sha256(packages_gz).hexdigest(),
    'packages_size': len(packages_gz),
}))
`).stdout,
      )
      // Step 2: mint two throwaway keys; sign the real-format Release with A.
      const good = mintThrowaway()
      const bad = mintThrowaway()
      const indexLine = ` ${built.packages_sha} ${built.packages_size} main/binary-arm64/Packages.gz\n`
      const payload = `Origin: minted-fixture\nSuite: trixie\nCodename: trixie\nSHA256:\n${indexLine}`
      writeFileSync(path.join(dir, 'assets', 'dists', 'trixie', 'InRelease'), good.sign(payload))
      writeFileSync(path.join(dir, 'keyring.gpg'), good.keyring)
      writeFileSync(path.join(dir, 'keyring-bad.gpg'), bad.keyring)
      const archive = (rel) => `file://${path.join(dir, 'assets', ...rel)}`
      const manifest = {
        archiveSigningFingerprint: good.fingerprint,
        packagesIndex: 'main/binary-arm64/Packages.gz',
        packagesIndexSha256: built.packages_sha,
        packagesIndexUrl: archive(['dists', 'trixie', 'InRelease']),
        packages: [
          {
            package: 'linux-image-6.18.50+rpt-rpi-v8',
            version: '1:6.18.50-1+rpt1',
            url: archive(['pool', 'main', 'l', 'linux', 'kernel.deb']),
            sha256: built.kernel_sha,
          },
          {
            package: 'raspi-firmware',
            version: '1:1.20260915-1',
            url: archive(['pool', 'main', 'r', 'raspi-firmware', 'firm.deb']),
            sha256: built.firm_sha,
          },
        ],
        targets: {
          pi4: {
            kernel: '6.18.50+rpt-rpi-v8',
            kernelFile: 'kernel8.img',
            deviceTree: 'bcm2711-rpi-4-b.dtb',
          },
        },
      }
      // Step 3: stage through the REAL gpgv binary (depmod stays stubbed);
      // the wrong keyring must refuse before any staging.
      const result = python(`
import json, subprocess, sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(root)})
from build import download
from pi import compose
base = Path(${JSON.stringify(dir)})
manifest = json.loads(${JSON.stringify(JSON.stringify(manifest))})
calls = []
def real_run(cmd, **kw):
    calls.append(cmd[0])
    if cmd[0] == 'gpgv':
        probe = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        return SimpleNamespace(returncode=probe.returncode, stdout=probe.stdout)
    if cmd[0] == 'depmod':
        return SimpleNamespace(returncode=0)
    raise AssertionError('unexpected host tool: ' + cmd[0])
for attempt, ring, marker in (
    (base / 'ws-bad', base / 'keyring-bad.gpg', 'wrong keyring'),
    (base / 'ws', base / 'keyring.gpg', 'minted key'),
):
    (attempt / 'pi').mkdir(parents=True)
    (attempt / 'pi/manifest.json').write_text(json.dumps(manifest))
    try:
        compose.prepare('pi4', attempt, base / 'assets', download, ring, runner=real_run)
    except ValueError as error:
        assert marker == 'wrong keyring'
        assert 'signature mismatch' in str(error)
        assert 'depmod' not in calls
        print('wrong keyring refused by real gpgv')
    else:
        assert marker == 'minted key'
        overlay = attempt / 'overlay'
        assert (overlay / 'usr/lib/modules/6.18.50+rpt-rpi-v8/vmlinuz').read_bytes() == b'kernel-bytes'
        assert (overlay / 'boot/firmware/start.elf').read_bytes() == b'elf'
        assert 'gpgv' in calls and 'depmod' in calls
        print('minted-key staging verified through real gpgv')
`)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('wrong keyring refused by real gpgv')
      expect(result.stdout).toContain('minted-key staging verified through real gpgv')
    },
  )
  it.skipIf(rigInRelease === null)(
    'parses a real rig InRelease index listing [skips where the apt cache has no InRelease]',
    () => {
      const result = python(`
import sys
sys.path.insert(0, ${JSON.stringify(root)})
from check import parse_release_hashes
from pi.compose import clearsign_payload
entries = parse_release_hashes(clearsign_payload(${JSON.stringify(rigInRelease)}))
indexes = [entry for entry in entries if entry.endswith('/Packages.gz')]
assert indexes, 'real InRelease lists no Packages.gz index'
digest, size = entries[indexes[0]]
assert len(digest) == 64 and size > 0
print('real rig index parses: %d entries, %d Packages.gz' % (len(entries), len(indexes)))
`)
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/real rig index parses: \d+ entries, \d+ Packages\.gz/)
    },
  )
  it('refuses symlink roots, planted ancestors, redirected writes and missing sources', () => {
    const dir = directory()
    const result = python(`
import os, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from pi.compose import admit_tree, copy_regular, copy_tree
base = Path(${JSON.stringify(dir)})
work = base / 'work'
(work / 'overlay').mkdir(parents=True)
secret = base / 'secret'
secret.mkdir()
(secret / 'stolen').write_bytes(b'host-bytes')
os.symlink(secret, work / 'overlay' / 'usr')
try:
    copy_tree(work / 'overlay' / 'usr' / 'lib' / 'fw', work / 'boot', base=work)
except ValueError as error:
    assert 'unsafe archive member' in str(error)
    print('planted ancestor refused')
else:
    raise AssertionError('read through a planted ancestor')
os.symlink(work / 'overlay', base / 'linkroot')
try:
    copy_tree(base / 'linkroot', base / 'elsewhere', base=base)
except ValueError as error:
    assert 'unsafe archive member' in str(error)
    print('symlink root refused')
else:
    raise AssertionError('walked a symlink root')
real = base / 'real'
(real / 'sub').mkdir(parents=True)
(real / 'sub' / 'f.bin').write_bytes(b'x')
target = base / 'target'
target.mkdir()
(target / 'a').mkdir()
os.symlink(secret, target / 'a' / 'linkdir')
try:
    copy_tree(real / 'sub', target / 'a' / 'linkdir' / 'deep', base=base)
except ValueError as error:
    assert 'staging write' in str(error)
    assert not (secret / 'deep').exists()
    print('redirected destination refused')
else:
    raise AssertionError('wrote through a planted destination link')
farm = base / 'farm'
farm.mkdir()
outside = base / 'outside'
outside.mkdir()
(outside / 'vmlinuz-x').write_bytes(b'host-bytes')
os.symlink(outside, farm / 'boot')
try:
    copy_regular(farm / 'boot' / 'vmlinuz-x', base / 'got', base=farm)
except ValueError as error:
    assert 'unsafe archive member' in str(error)
    assert not (base / 'got').exists()
    print('symlink-ancestor read refused')
else:
    raise AssertionError('read host bytes through a symlink ancestor')
try:
    copy_tree(base / 'absent', base / 'missing-dest', base=base)
except ValueError as error:
    assert 'missing source' in str(error)
    assert not (base / 'missing-dest').exists()
    print('missing source refused')
else:
    raise AssertionError('silent success on a missing source')
absolute = base / 'absolute'
(absolute / 'sub').mkdir(parents=True)
(absolute / 'sub' / 'f.bin').write_bytes(b'x')
os.symlink('/usr/lib/raspi-firmware/fw.bin', absolute / 'sub' / 'abslink')
try:
    admit_tree(absolute, base=base)
except ValueError as error:
    assert 'unsafe archive member' in str(error)
    print('absolute link target refused')
else:
    raise AssertionError('admitted an absolute link target')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('planted ancestor refused')
    expect(result.stdout).toContain('symlink root refused')
    expect(result.stdout).toContain('redirected destination refused')
    expect(result.stdout).toContain('symlink-ancestor read refused')
    expect(result.stdout).toContain('missing source refused')
    expect(result.stdout).toContain('absolute link target refused')
  })
  it('bounds .deb members while streaming instead of after a full listing', () => {
    const result = python(`
import io, sys, tarfile
sys.path.insert(0, ${JSON.stringify(root)})
from pi import compose
def payload_of(specs):
    blob = io.BytesIO()
    with tarfile.open(fileobj=blob, mode='w:gz') as output:
        for info, content in specs:
            output.addfile(info, io.BytesIO(content) if content is not None else None)
    return blob.getvalue()
def reg(member_name, size):
    info = tarfile.TarInfo(member_name)
    info.size = size
    return (info, b'x' * size)
# Sixty members with a count budget of five: incremental admission must
# stop at the sixth header, never consume the listing.
many = payload_of([reg('f%02d' % index, 1) for index in range(60)])
seen = [0]
real_next = tarfile.TarFile.next
def counting(self, *args, **kwargs):
    seen[0] += 1
    return real_next(self, *args, **kwargs)
tarfile.TarFile.next = counting
try:
    compose.DEB_MEMBER_LIMIT = 5
    try:
        compose.admit_data('data.tar.gz', many)
    except ValueError as error:
        assert 'member limit' in str(error)
    else:
        raise AssertionError('accepted an over-budget member count')
finally:
    tarfile.TarFile.next = real_next
    compose.DEB_MEMBER_LIMIT = 65536
assert seen[0] < 60, 'admission consumed the whole listing before refusing'
print('member budget refused mid-stream after %d headers' % seen[0])
# Directories and links count toward the same budget.
entries = []
for index in range(3):
    info = tarfile.TarInfo('d%02d' % index)
    info.type = tarfile.DIRTYPE
    entries.append((info, None))
link = tarfile.TarInfo('x/link')
link.type = tarfile.SYMTYPE
link.linkname = '../d00'
entries.append((link, None))
compose.DEB_MEMBER_LIMIT = 3
try:
    try:
        compose.admit_data('data.tar.gz', payload_of(entries))
    except ValueError as error:
        assert 'member limit' in str(error)
        print('directories and links share the member budget')
    else:
        raise AssertionError('directories/links escaped the member budget')
finally:
    compose.DEB_MEMBER_LIMIT = 65536
# A small budget refuses an oversized payload while streaming.
compose.DEB_EXPANSION_LIMIT = 1024
try:
    try:
        compose.admit_data('data.tar.gz', payload_of([reg('big', 2048)]))
    except ValueError as error:
        assert 'expansion limit' in str(error)
        print('expansion budget refused mid-stream')
    else:
        raise AssertionError('admitted an over-budget payload')
finally:
    compose.DEB_EXPANSION_LIMIT = 256 * 1024 * 1024
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('member budget refused mid-stream')
    expect(result.stdout).toContain('directories and links share the member budget')
    expect(result.stdout).toContain('expansion budget refused mid-stream')
  })
  it.each([
    ['mkosi 27.1', 0, null],
    ['mkosi 27.10', 0, 'mkosi version mismatch'],
    ['mkosi 127.1', 0, 'mkosi version mismatch'],
    ['mkosi 26', 0, 'mkosi version mismatch'],
    ['failed to run mkosi 27.1', 1, 'mkosi version mismatch'],
    ['mkosi 27.1', 1, 'mkosi version mismatch'],
  ])('requires the exact pinned mkosi version token (%s)', (output, code, reason) => {
    const result = python(`
import sys
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(root)})
from build import check_mkosi_version
try:
    check_mkosi_version(SimpleNamespace(stdout=${JSON.stringify(output)}, returncode=${JSON.stringify(code)}), '27.1')
except ValueError as error:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is not None
    assert ${reason === null ? 'None' : JSON.stringify(reason)} in str(error)
    print('refused mkosi probe')
else:
    assert ${reason === null ? 'None' : JSON.stringify(reason)} is None
    print('exact mkosi version accepted')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      reason === null ? 'exact mkosi version accepted' : 'refused mkosi probe',
    )
  })
  it('enumerates upstream Node members under an evidence-sized skip ceiling', () => {
    const dir = directory()
    const result = python(`
import io, sys, tarfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
import build
base = Path(${JSON.stringify(dir)})
prefix = 'node-v24.18.0-linux-x64'
# 1,100 unwanted members would trip the old 1,024-member ceiling while the
# evidence-sized ceiling admits the two wanted files.
archive = base / 'node.tar.xz'
with tarfile.open(archive, 'w:xz') as output:
    for index in range(1100):
        docs = tarfile.TarInfo(prefix + '/docs/page%04d' % index)
        docs.size = 1
        output.addfile(docs, io.BytesIO(b'd'))
    for name, content in (('bin/node', b'n'), ('LICENSE', b'l')):
        member = tarfile.TarInfo(prefix + '/' + name)
        member.size = len(content)
        output.addfile(member, io.BytesIO(content))
dest = base / 'node'
build.extract_selected(archive, dest, prefix, ('bin/node', 'LICENSE'))
assert (dest / 'bin/node').read_bytes() == b'n'
assert (dest / 'LICENSE').read_bytes() == b'l'
assert not (dest / 'docs').exists()
print('evidence ceiling admits the upstream layout')
# Past the ceiling the same reader still refuses.
build.NODE_SKIP_LIMIT = 3
try:
    build.extract_selected(archive, base / 'node-too-big', prefix, ('bin/node', 'LICENSE'))
except ValueError as error:
    assert 'member limit' in str(error)
    print('skip ceiling still refuses')
else:
    raise AssertionError('enumerated past the skip ceiling')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('evidence ceiling admits the upstream layout')
    expect(result.stdout).toContain('skip ceiling still refuses')
  })
  it('fetches the unsigned InRelease trust root under the size bound', () => {
    const dir = directory()
    const result = python(`
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
import build
base = Path(${JSON.stringify(dir)})
source = base / 'source'
source.write_bytes(b'signed trust root')
build.download(source.as_uri(), None, base / 'asset')
assert (base / 'asset').read_bytes() == b'signed trust root'
build.DOWNLOAD_LIMIT = 1
try:
    build.download(source.as_uri(), None, base / 'big')
except ValueError as error:
    assert 'limit' in str(error)
    assert not (base / 'big').exists()
    print('unsigned fetch stays bounded')
else:
    raise AssertionError('fetched past the download limit')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('unsigned fetch stays bounded')
  })
})

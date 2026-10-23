// M110os OS4: the encrypted-/var crypttab entry, the cryptenroll and Tang
// bind scripts, and the boot signing hook. Live enrollment needs a LUKS
// device and a TPM, so the enroll/bind scripts are proven through argument
// validation and dry-run composition plus real JSON and tool checks; the
// real enrollment runs on hardware and in the OS6 QEMU boot. The signing
// hook does a real sbsign/sbverify round trip on an EFI binary found on
// the machine.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCommand, scratch } from './helpers/nodeOs'

const CRYPTTAB = fileURLToPath(new URL('../../os/crypt/crypttab.var', import.meta.url))
const ENROLL = fileURLToPath(new URL('../../os/crypt/enroll-var.sh', import.meta.url))
const BIND_TANG = fileURLToPath(new URL('../../os/crypt/tang/bind-tang.sh', import.meta.url))
const TANG_EXAMPLE = fileURLToPath(
  new URL('../../os/crypt/tang/tang.json.example', import.meta.url),
)
const SIGN_BOOT = fileURLToPath(new URL('../../os/crypt/sign-boot.sh', import.meta.url))
const isLinux = process.platform === 'linux'
const BASH = '/bin/bash'
const NULL_DEVICE = '/dev/null'
const EFI_CANDIDATES = [
  '/usr/lib/shim/mmx64.efi',
  '/usr/lib/shim/shimx64.efi',
  '/usr/lib/systemd/boot/efi/systemd-bootx64.efi',
  '/usr/lib/grub/x86_64-efi/monolithic/grubx64.efi',
  '/boot/efi/EFI/BOOT/BOOTX64.EFI',
]
const TANG_THUMBPRINT = 'v7q7v7q7v7q7v7q7v7q7v7q7v7q7v7q7v7q7v7q7vQ0'

function hasTool(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const HAS_CRYPTENROLL = isLinux && hasTool('systemd-cryptenroll')
const HAS_PYTHON = hasTool('python3')
const HAS_SBSIGN = isLinux && hasTool('sbsign') && hasTool('sbverify') && hasTool('openssl')

function findBlockDevice(): string | undefined {
  try {
    for (const name of readdirSync('/sys/block')) {
      const device = `/dev/${name}`
      try {
        if (statSync(device).isBlockDevice()) return device
      } catch {
        /* disappeared between listing and stat */
      }
    }
  } catch {
    return undefined
  }
  return undefined
}
const BLOCK_DEVICE = isLinux ? findBlockDevice() : undefined
const EFI_BINARY = isLinux ? EFI_CANDIDATES.find((candidate) => existsSync(candidate)) : undefined

/** A throwaway self-signed key pair for the signing round trips. */
function makeTestCert(dir: string): { key: string; cert: string } {
  const key = path.join(dir, 'key.pem')
  const cert = path.join(dir, 'cert.pem')
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '2',
    '-nodes',
    '-subj',
    '/CN=node-os-test',
  ])
  return { key, cert }
}

/** A copy of the machine's EFI binary, signed with the test key. */
function signCopy(
  dir: string,
  source: string,
  key: string,
  cert: string,
): { input: string; output: string } {
  const input = path.join(dir, 'input.efi')
  writeFileSync(input, readFileSync(source))
  const output = path.join(dir, 'signed-input.efi')
  const signed = runCommand(SIGN_BOOT, [
    '--key',
    key,
    '--cert',
    cert,
    '--input',
    input,
    '--output',
    output,
  ])
  expect(signed.status).toBe(0)
  return { input, output }
}

describe('encrypted /var crypttab entry', () => {
  it('unlocks var by TPM2 with console fallback and no stored secret', () => {
    const lines = readFileSync(CRYPTTAB, 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter((line) => line.length > 0)
    expect(lines).toHaveLength(1)
    const fields = (lines[0] ?? '').split(/\s+/)
    expect(fields).toHaveLength(4)
    expect(fields[0]).toBe('var')
    expect(fields[1]?.startsWith('/dev/disk/by-')).toBe(true)
    expect(fields[2]).toBe('-')
    const options = (fields[3] ?? '').split(',')
    expect(options).toHaveLength(3)
    expect(options).toContain('tpm2-device=auto')
    expect(options).toContain('tpm2-pcrs=7')
    expect(options).toContain('x-initrd.attach')
  })
})

describe.skipIf(!isLinux)('cryptenroll script', () => {
  it('refuses bad arguments before touching any device', () => {
    const key = path.join(scratch('node-os-enroll-'), 'key.pub')
    writeFileSync(key, 'public key bytes')
    const cases: { args: string[]; anchor: string }[] = [
      { args: [], anchor: '--device is required' },
      {
        args: [
          '--device',
          '/nonexistent',
          '--public-key',
          key,
          '--public-key-pcrs',
          '7',
          '--pcrs',
          'x',
        ],
        anchor: '--pcrs must look like',
      },
      {
        args: ['--device', '/nonexistent', '--public-key', key, '--public-key-pcrs', '4+'],
        anchor: '--public-key-pcrs must look like',
      },
      {
        args: [
          '--device',
          '/nonexistent',
          '--public-key',
          key,
          '--public-key-pcrs',
          '7',
          '--with-pin',
          'maybe',
        ],
        anchor: '--with-pin must be yes or no',
      },
      {
        args: [
          '--device',
          '/nonexistent',
          '--public-key',
          key,
          '--public-key-pcrs',
          '7',
          '--wipe-slot',
          'all',
        ],
        anchor: 'bad --wipe-slot',
      },
      {
        args: ['--device', NULL_DEVICE, '--public-key', key, '--public-key-pcrs', '7'],
        anchor: 'not a block device',
      },
    ]
    for (const { args, anchor } of cases) {
      const run = runCommand(ENROLL, args)
      expect(run.status).toBe(2)
      expect(run.out).toContain(anchor)
    }
  })

  it('dry-runs the exact cryptenroll invocations without needing the device', () => {
    const key = path.join(scratch('node-os-enroll-dry-'), 'key.pub')
    writeFileSync(key, 'public key bytes')
    const run = runCommand(ENROLL, [
      '--device',
      NULL_DEVICE,
      '--public-key',
      key,
      '--public-key-pcrs',
      '7',
      '--with-pin',
      'yes',
      '--wipe-slot',
      'password',
      '--dry-run',
    ])
    expect(run.status).toBe(0)
    const lines = run.out.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(
      `systemd-cryptenroll --tpm2-device=auto --tpm2-pcrs=7 --tpm2-public-key=${key} ` +
        `--tpm2-public-key-pcrs=7 --tpm2-with-pin=yes --wipe-slot=password ${NULL_DEVICE} <passphrase-on-stdin>`,
    )
    expect(lines[1]).toBe(`systemd-cryptenroll --recovery-key ${NULL_DEVICE} <passphrase-on-stdin>`)
  })

  it.runIf(BLOCK_DEVICE !== undefined)('refuses an unreadable public key on a live run', () => {
    const run = runCommand(ENROLL, [
      '--device',
      BLOCK_DEVICE ?? '',
      '--public-key',
      path.join(scratch('node-os-enroll-key-'), 'missing.pub'),
      '--public-key-pcrs',
      '7',
    ])
    expect(run.status).toBe(2)
    expect(run.out).toContain('not readable')
  })

  it.runIf(HAS_CRYPTENROLL && BLOCK_DEVICE !== undefined)(
    'refuses an empty stdin passphrase without invoking cryptenroll',
    () => {
      const key = path.join(scratch('node-os-enroll-empty-'), 'key.pub')
      writeFileSync(key, 'public key bytes')
      const run = runCommand(
        ENROLL,
        ['--device', BLOCK_DEVICE ?? '', '--public-key', key, '--public-key-pcrs', '7'],
        { input: '' },
      )
      expect(run.status).toBe(2)
      expect(run.out).toContain('no passphrase on stdin')
    },
  )
})

describe.skipIf(!isLinux)('tang bind script', () => {
  it.runIf(HAS_PYTHON)('validates the pin config before touching any device', () => {
    const dir = scratch('node-os-tang-')
    const valid = path.join(dir, 'valid.json')
    // eslint-disable-next-line unicorn/prefer-https -- Tang serves HTTP by design; the thumbprint check is the trust anchor, and the validator must accept the http shape.
    writeFileSync(valid, JSON.stringify({ url: 'http://tang.lan:7500', thp: TANG_THUMBPRINT }))
    const malformed = path.join(dir, 'malformed.json')
    writeFileSync(malformed, '{not json')
    const noUrl = path.join(dir, 'no-url.json')
    writeFileSync(noUrl, JSON.stringify({ thp: TANG_THUMBPRINT }))
    const badScheme = path.join(dir, 'bad-scheme.json')
    writeFileSync(badScheme, JSON.stringify({ url: 'ftp://tang.lan', thp: TANG_THUMBPRINT }))
    const shortThp = path.join(dir, 'short-thp.json')
    // eslint-disable-next-line unicorn/prefer-https -- Tang serves HTTP by design; the thumbprint check is the trust anchor, and the validator must accept the http shape.
    writeFileSync(shortThp, JSON.stringify({ url: 'http://tang.lan', thp: 'short' }))
    const cases: { args: string[]; anchor: string }[] = [
      { args: [], anchor: '--device is required' },
      {
        args: ['--device', '/nonexistent', '--config', malformed],
        anchor: 'invalid tang config',
      },
      { args: ['--device', '/nonexistent', '--config', noUrl], anchor: 'invalid tang config' },
      {
        args: ['--device', '/nonexistent', '--config', badScheme],
        anchor: 'invalid tang config',
      },
      {
        args: ['--device', '/nonexistent', '--config', shortThp],
        anchor: 'invalid tang config',
      },
      {
        args: ['--device', '/nonexistent', '--config', TANG_EXAMPLE],
        anchor: 'invalid tang config',
      },
      { args: ['--device', NULL_DEVICE, '--config', valid], anchor: 'not a block device' },
    ]
    for (const { args, anchor } of cases) {
      const run = runCommand(BIND_TANG, args)
      expect(run.status).toBe(2)
      expect(run.out).toContain(anchor)
    }
  })

  it.runIf(HAS_PYTHON)('dry-runs the clevis bind without needing the device', () => {
    const config = path.join(scratch('node-os-tang-dry-'), 'tang.json')
    // eslint-disable-next-line unicorn/prefer-https -- Tang serves HTTP by design; the thumbprint check is the trust anchor, and the validator must accept the http shape.
    writeFileSync(config, JSON.stringify({ url: 'http://tang.lan:7500', thp: TANG_THUMBPRINT }))
    const run = runCommand(BIND_TANG, ['--device', NULL_DEVICE, '--config', config, '--dry-run'])
    expect(run.status).toBe(0)
    expect(run.out.trim()).toBe(
      `clevis luks bind -d ${NULL_DEVICE} tang ` +
        // eslint-disable-next-line unicorn/prefer-https -- expected dry-run output echoes the http Tang URL above.
        `'{"url": "http://tang.lan:7500", "thp": "${TANG_THUMBPRINT}"}'`,
    )
  })
})

describe.skipIf(!isLinux)('boot signing hook', () => {
  it('refuses bad arguments without running sbsign', () => {
    const dir = scratch('node-os-sign-args-')
    const key = path.join(dir, 'key.pem')
    const cert = path.join(dir, 'cert.pem')
    const input = path.join(dir, 'input.efi')
    writeFileSync(key, 'key')
    writeFileSync(cert, 'cert')
    writeFileSync(input, 'efi')
    const output = path.join(dir, 'out.efi')
    const full = ['--key', key, '--cert', cert, '--input', input, '--output', output]
    const cases: { args: string[]; anchor: string }[] = [
      { args: [], anchor: '--key is required' },
      {
        args: full.filter((arg, index) => !(arg === '--cert' || full[index - 1] === '--cert')),
        anchor: '--cert is required',
      },
      {
        args: ['--verify-only', '--cert', cert, '--input', input, '--key', key],
        anchor: 'not used with --verify-only',
      },
      {
        args: [
          '--key',
          path.join(dir, 'missing'),
          '--cert',
          cert,
          '--input',
          input,
          '--output',
          output,
        ],
        anchor: 'key is not readable',
      },
    ]
    for (const { args, anchor } of cases) {
      const run = runCommand(SIGN_BOOT, args)
      expect(run.status).toBe(2)
      expect(run.out).toContain(anchor)
    }
  })

  it.runIf(existsSync(BASH))('reports missing signing tools as exit 3', () => {
    const dir = scratch('node-os-sign-notool-')
    symlinkSync(BASH, path.join(dir, 'bash'))
    const key = path.join(dir, 'key.pem')
    writeFileSync(key, 'key')
    const run = runCommand(
      SIGN_BOOT,
      ['--key', key, '--cert', key, '--input', key, '--output', path.join(dir, 'out.efi')],
      { env: { ...process.env, PATH: dir } },
    )
    expect(run.status).toBe(3)
    expect(run.out).toContain('not installed')
  })

  it.runIf(HAS_SBSIGN && EFI_BINARY !== undefined)(
    'signs a real EFI binary and verifies it',
    () => {
      const dir = scratch('node-os-sign-live-')
      const { key, cert } = makeTestCert(dir)
      const { input, output } = signCopy(dir, EFI_BINARY ?? '', key, cert)
      expect(statSync(output).size).toBeGreaterThan(statSync(input).size)
      const verified = runCommand(SIGN_BOOT, ['--verify-only', '--cert', cert, '--input', output])
      expect(verified.status).toBe(0)
    },
  )

  it.runIf(HAS_SBSIGN && EFI_BINARY !== undefined)('rejects unsigned and tampered binaries', () => {
    const dir = scratch('node-os-sign-red-')
    const { key, cert } = makeTestCert(dir)
    const unsigned = runCommand(SIGN_BOOT, [
      '--verify-only',
      '--cert',
      cert,
      '--input',
      EFI_BINARY ?? '',
    ])
    expect(unsigned.status).toBe(1)
    const { output } = signCopy(dir, EFI_BINARY ?? '', key, cert)
    const tampered = path.join(dir, 'tampered.efi')
    const bytes = readFileSync(output)
    bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] ?? 0) ^ 0xff
    writeFileSync(tampered, bytes)
    const checked = runCommand(SIGN_BOOT, ['--verify-only', '--cert', cert, '--input', tampered])
    expect(checked.status).toBe(1)
  })

  it.runIf(HAS_SBSIGN)('leaves no output behind when signing fails', () => {
    const dir = scratch('node-os-sign-fail-')
    const { key, cert } = makeTestCert(dir)
    const input = path.join(dir, 'broken.efi')
    writeFileSync(input, malformedPe())
    const output = path.join(dir, 'out.efi')
    const run = runCommand(SIGN_BOOT, [
      '--key',
      key,
      '--cert',
      cert,
      '--input',
      input,
      '--output',
      output,
    ])
    expect(run.status).toBe(1)
    expect(existsSync(output)).toBe(false)
  })
})

function malformedPe(): Buffer {
  const image = Buffer.alloc(0x4_00, 0)
  image.write('MZ', 0, 'utf8')
  image.writeUInt32LE(64, 0x3c)
  image.write('PE\0\0', 64, 'binary')
  image.writeUInt16LE(0x86_64, 68)
  image.writeUInt16LE(1, 70)
  image.writeUInt16LE(0xf0, 84)
  image.writeUInt16LE(0x22, 86)
  image.writeUInt16LE(0x2_0b, 88)
  image.writeUInt32LE(0x20_00, 148)
  image.writeUInt32LE(0x2_00, 152)
  image.writeUInt32LE(16, 196)
  image.write('.text\0\0\0', 328, 'binary')
  image.writeUInt32LE(0x2_00, 336)
  image.writeUInt32LE(0x10_00, 340)
  image.writeUInt32LE(0x2_00, 344)
  image.writeUInt32LE(0x2_00, 348)
  image.writeUInt32LE(0x60_00_00_20, 364)
  image.fill(0x90, 0x2_00, 0x4_00)
  return image
}

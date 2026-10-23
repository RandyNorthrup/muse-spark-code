// M110os OS5: the add-on manifest check, the NVIDIA key pin, the
// base-firmware check and the NVIDIA install gate. check-addon and
// check-firmware run as child processes against the shipped manifests,
// planted violations and recorded transcripts
// (test/fixtures/nodeos-nvidia/CAPTURE.md,
// test/fixtures/nodeos-firmware/CAPTURE.md); live-network cases run
// only where the network answers. Fixture hashes are pinned so drift
// fails the suite.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  acceptNvidiaTerms,
  createNvidiaState,
  loadNvidiaState,
  recordNvidiaInstalled,
  requestNvidiaInstall,
  saveNvidiaState,
} from '../../src/runtime/node/addons/nvidiaConsent'

const CHECK_ADDON = fileURLToPath(new URL('../../os/addons/check-addon.mjs', import.meta.url))
const CHECK_KEY = fileURLToPath(new URL('../../os/addons/chrome/check-key.mjs', import.meta.url))
const CHECK_FIRMWARE = fileURLToPath(
  new URL('../../os/firmware/check-firmware.mjs', import.meta.url),
)
const CHROME_MANIFEST = fileURLToPath(new URL('../../os/addons/chrome/addon.json', import.meta.url))
const NVIDIA_MANIFEST = fileURLToPath(new URL('../../os/addons/nvidia/addon.json', import.meta.url))
const NVIDIA_PINS = fileURLToPath(
  new URL('../../os/addons/nvidia/fingerprints.txt', import.meta.url),
)
const FIRMWARE = fileURLToPath(new URL('../../os/firmware/firmware.json', import.meta.url))
const NVIDIA_KEYRING = fileURLToPath(
  new URL('../../test/fixtures/nodeos-nvidia/8793F200.pub', import.meta.url),
)
const NVIDIA_TRANSCRIPT = fileURLToPath(
  new URL('../../test/fixtures/nodeos-nvidia/colons.txt', import.meta.url),
)
const FIRMWARE_TRANSCRIPTS = fileURLToPath(
  new URL('../../test/fixtures/nodeos-firmware/', import.meta.url),
)
const NVIDIA_PRIMARY = '02182E60104FCDC26EAE1B8597A5D4CB8793F200'
const PROBE_TIMEOUT_MS = 8000

function hasGpg(): boolean {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const HAS_GPG = hasGpg()

function hasSnapshot(): boolean {
  try {
    execFileSync(
      process.execPath,
      [
        '--eval',
        'fetch("https://snapshot.debian.org/mr/binary/firmware-iwlwifi/").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))',
      ],
      { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS },
    )
    return true
  } catch {
    return false
  }
}
const HAS_SNAPSHOT = hasSnapshot()

function runNode(script: string, args: string[]): { status: number | null; out: string } {
  const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function scratch(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function parseManifestObject(text: string): Record<string, unknown> {
  const data: unknown = JSON.parse(text)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('bad manifest fixture: not an object')
  }
  // The manifest fixtures are objects by construction; the check above
  // proves the shape, the cast only names the index signature.
  return data as Record<string, unknown>
}

function childOf(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value: unknown = parent[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`bad manifest fixture shape at ${key}`)
  }
  // Navigation over fixtures the test constructed; the check above
  // proves each level is an object before the cast names it.
  return value as Record<string, unknown>
}

function writeManifest(
  dir: string,
  name: string,
  mutate: (manifest: Record<string, unknown>) => void,
): string {
  const manifest = parseManifestObject(readFileSync(NVIDIA_MANIFEST, 'utf8'))
  mutate(manifest)
  const addonDir = path.join(dir, name)
  mkdirSync(addonDir, { recursive: true })
  writeFileSync(path.join(addonDir, 'fingerprints.txt'), readFileSync(NVIDIA_PINS))
  const manifestPath = path.join(addonDir, 'addon.json')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  return manifestPath
}

const SHIPPED_OS_RELEASE = 'ID=debian\nVERSION_ID=13\n'

function writeTree(
  dir: string,
  release: string | undefined,
  osRelease: string | undefined,
): string {
  const tree = path.join(dir, 'tree')
  if (release !== undefined) {
    const releaseDir = path.join(tree, 'usr', 'lib', 'extension-release.d')
    mkdirSync(releaseDir, { recursive: true })
    writeFileSync(path.join(releaseDir, 'extension-release.nvidia'), release)
  }
  if (osRelease !== undefined) {
    const osDir = path.join(tree, 'usr', 'lib')
    mkdirSync(osDir, { recursive: true })
    writeFileSync(path.join(osDir, 'os-release'), osRelease)
  }
  return tree
}

describe('check-addon', () => {
  it('accepts the shipped chrome and nvidia manifests', () => {
    for (const manifest of [CHROME_MANIFEST, NVIDIA_MANIFEST]) {
      const run = runNode(CHECK_ADDON, ['--manifest', manifest])
      expect(run.status).toBe(0)
      expect(run.out).toContain('manifest is sound')
    }
  })

  it('rejects planted manifest violations', () => {
    const dir = scratch('node-os-addon-bad-')
    const cases: {
      name: string
      mutate: (manifest: Record<string, unknown>) => void
      anchor: string
    }[] = [
      {
        name: 'nvidia',
        mutate: (manifest) => {
          manifest.bogus = true
        },
        anchor: 'unknown field: bogus',
      },
      {
        name: 'wrongdir',
        mutate: (manifest) => {
          manifest.name = 'nvidia'
        },
        anchor: 'does not match name',
      },
      {
        name: 'nvidia',
        mutate: (manifest) => {
          manifest.kind = 'deb'
        },
        anchor: 'kind must be sysext or confext',
      },
      {
        name: 'nvidia',
        mutate: (manifest) => {
          manifest.architectures = ['amd64', 'arm64', 'amd64']
        },
        anchor: 'architectures must be a unique non-empty list',
      },
      {
        name: 'nvidia',
        mutate: (manifest) => {
          const sources = childOf(manifest, 'sources')
          delete sources.arm64
        },
        anchor: 'sources must cover exactly the architectures',
      },
      {
        name: 'nvidia',
        mutate: (manifest) => {
          // eslint-disable-next-line unicorn/prefer-https -- the violation under test: the checker must refuse a non-https terms URL.
          manifest.terms = 'http://www.nvidia.com/en-us/drivers/nvidia-license/'
        },
        anchor: 'terms must be an https URL',
      },
      {
        name: 'nvidia',
        mutate: (manifest) => {
          const apt = childOf(childOf(childOf(manifest, 'sources'), 'amd64'), 'apt')
          apt.suite = 'stable'
        },
        anchor: 'suite and component together',
      },
      {
        name: 'nvidia',
        mutate: (manifest) => {
          const apt = childOf(childOf(childOf(manifest, 'sources'), 'amd64'), 'apt')
          apt.packages = ['not a package!']
        },
        anchor: 'apt.packages must be a unique non-empty list',
      },
      {
        name: 'nvidia',
        mutate: (manifest) => {
          const keyring = childOf(manifest, 'keyring')
          keyring.fingerprints = 'missing.txt'
        },
        anchor: 'fingerprints is not readable',
      },
      {
        name: 'nvidia',
        mutate: (manifest) => {
          manifest.kernelModules = { open: false, proprietary: false, mokSign: true }
        },
        anchor: 'at least one of open and proprietary',
      },
    ]
    for (const { name, mutate, anchor } of cases) {
      const manifestPath = writeManifest(dir, name, mutate)
      const run = runNode(CHECK_ADDON, ['--manifest', manifestPath])
      expect(run.status).toBe(2)
      expect(run.out).toContain(anchor)
    }
  })

  it('rejects a bad fingerprints file and malformed input', () => {
    const dir = scratch('node-os-addon-input-')
    const pins = path.join(dir, 'nvidia', 'pins.txt')
    mkdirSync(path.dirname(pins), { recursive: true })
    writeFileSync(pins, 'not-a-fingerprint\n')
    const manifestPath = writeManifest(dir, 'nvidia', (manifest) => {
      const keyring = childOf(manifest, 'keyring')
      keyring.fingerprints = 'pins.txt'
    })
    const badPins = runNode(CHECK_ADDON, ['--manifest', manifestPath])
    expect(badPins.status).toBe(2)
    expect(badPins.out).toContain('is not a fingerprint')
    const malformed = path.join(dir, 'malformed.json')
    writeFileSync(malformed, '{not json')
    const badJson = runNode(CHECK_ADDON, ['--manifest', malformed])
    expect(badJson.status).toBe(2)
    expect(badJson.out).toContain('not JSON')
    const missing = runNode(CHECK_ADDON, ['--manifest', path.join(dir, 'absent.json')])
    expect(missing.status).toBe(2)
    expect(missing.out).toContain('not readable')
    const noArgs = runNode(CHECK_ADDON, [])
    expect(noArgs.status).toBe(2)
    expect(noArgs.out).toContain('pass --manifest')
  })

  it('matches a good tree and refuses a bad one', () => {
    const dir = scratch('node-os-addon-tree-')
    const good = writeTree(dir, 'ID=debian\nVERSION_ID=13\nARCHITECTURE=arm64\n', undefined)
    const matched = runNode(CHECK_ADDON, ['--manifest', NVIDIA_MANIFEST, '--tree', good])
    expect(matched.status).toBe(0)
    expect(matched.out).toContain('matches its tree')
    const cases: { release: string | undefined; osRelease: string | undefined; anchor: string }[] =
      [
        {
          release: 'ID=debian\nVERSION_ID=12\n',
          osRelease: undefined,
          anchor: 'VERSION_ID 12 does not match 13',
        },
        {
          release: 'ID=ubuntu\nVERSION_ID=13\n',
          osRelease: undefined,
          anchor: 'ID ubuntu does not match debian',
        },
        { release: undefined, osRelease: undefined, anchor: 'missing extension-release file' },
        {
          release: 'ID=debian\nVERSION_ID=13\n',
          osRelease: SHIPPED_OS_RELEASE,
          anchor: 'must not ship usr/lib/os-release',
        },
        {
          release: 'ID=debian\nVERSION_ID=13\nARCHITECTURE=mips\n',
          osRelease: undefined,
          anchor: 'ARCHITECTURE mips is not one of the manifest architectures',
        },
        {
          release: 'ID=debian\nSYSEXT_LEVEL=99\n',
          osRelease: undefined,
          anchor: 'SYSEXT_LEVEL does not match the manifest',
        },
      ]
    for (const [index, { release, osRelease, anchor }] of cases.entries()) {
      const tree = writeTree(path.join(dir, `bad-${String(index)}`), release, osRelease)
      const run = runNode(CHECK_ADDON, ['--manifest', NVIDIA_MANIFEST, '--tree', tree])
      expect(run.status).toBe(1)
      expect(run.out).toContain(anchor)
    }
  })

  it('matches a declared sysext level', () => {
    const dir = scratch('node-os-addon-level-')
    const manifestPath = writeManifest(dir, 'nvidia', (manifest) => {
      const osRelease = childOf(manifest, 'osRelease')
      osRelease.sysextLevel = '42'
    })
    const tree = writeTree(dir, 'ID=debian\nSYSEXT_LEVEL=42\n', undefined)
    const run = runNode(CHECK_ADDON, ['--manifest', manifestPath, '--tree', tree])
    expect(run.status).toBe(0)
  })
})

describe('nvidia key pin', () => {
  it('matches the recorded keyring by transcript', () => {
    const run = runNode(CHECK_KEY, [
      '--transcript',
      NVIDIA_TRANSCRIPT,
      '--fingerprints',
      NVIDIA_PINS,
    ])
    expect(run.status).toBe(0)
    expect(run.out).toContain('carries all 1 pinned fingerprints')
  })

  it('refuses a wrong pin by transcript', () => {
    const wrong = path.join(scratch('node-os-nvidia-pin-'), 'wrong.txt')
    writeFileSync(wrong, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n')
    const run = runNode(CHECK_KEY, ['--transcript', NVIDIA_TRANSCRIPT, '--fingerprints', wrong])
    expect(run.status).toBe(1)
    expect(run.out).toContain('missing pinned fingerprint')
  })

  it.runIf(HAS_GPG)('matches the recorded keyring with the real gpg', () => {
    const run = runNode(CHECK_KEY, ['--keyring', NVIDIA_KEYRING, '--fingerprints', NVIDIA_PINS])
    expect(run.status).toBe(0)
  })

  it('pins the recorded fixtures against drift', () => {
    expect(sha256(NVIDIA_KEYRING)).toBe(
      '09edb5196bca272c091633d4e04dd6c8f3a07278834868220aa669c895f6cfd7',
    )
    const colons = readFileSync(NVIDIA_TRANSCRIPT, 'utf8')
    expect(colons).toContain(NVIDIA_PRIMARY)
    const fixtures: [string, string][] = [
      [
        'firmware-amd-graphics.json',
        '9eccdbcd52fe13f0aa92ecc322904a98bb9ccaa8b0ebe93c74f0ba6186d693f9',
      ],
      ['firmware-atheros.json', '4ad49ee66c528eef653619bb3f3f4f50f4a4cf47f4071e773f355467d6827bc3'],
      [
        'firmware-brcm80211.json',
        '550dd179ccffa3f72d0850667c3ff7c2393572099dc7a027b6daf1b61053a9b3',
      ],
      [
        'firmware-intel-graphics.json',
        '009b4116f675d389465bc466a73d5ca7a96ad97bf40919f0196f5d57a33b1e75',
      ],
      ['firmware-iwlwifi.json', 'f43cd314b763aeba2bddf3f3cdee821474c78021a4fe6a348a46d736d8092edd'],
      [
        'firmware-mediatek.json',
        'aeb1a9c8e72ae00315977a74ed1e346fae9782d4b352a9cfb2721e37f8c81f24',
      ],
      ['firmware-realtek.json', '896d97328b86c7d42ec9b27b9a09a9e06e403694699a488a57ea8c62584f2545'],
    ]
    for (const [file, digest] of fixtures) {
      expect(sha256(path.join(FIRMWARE_TRANSCRIPTS, file))).toBe(digest)
    }
  })
})

describe('check-firmware', () => {
  it('resolves the real firmware set from transcripts', () => {
    const run = runNode(CHECK_FIRMWARE, [
      '--firmware',
      FIRMWARE,
      '--transcript-dir',
      FIRMWARE_TRANSCRIPTS,
      '--snapshot-base',
      'https://invalid.invalid',
    ])
    expect(run.status).toBe(0)
    expect(run.out).toContain('all 7 packages resolve')
  })

  it('refuses an unknown package and a malformed set', () => {
    const dir = scratch('node-os-firmware-bad-')
    const unknown = path.join(dir, 'unknown.json')
    writeFileSync(
      unknown,
      JSON.stringify({ packages: { amd: ['no-such-firmware'], intel: ['x'], wifi: ['y'] } }),
    )
    const missing = runNode(CHECK_FIRMWARE, [
      '--firmware',
      unknown,
      '--transcript-dir',
      FIRMWARE_TRANSCRIPTS,
    ])
    expect(missing.status).toBe(1)
    expect(missing.out).toContain('no transcript for no-such-firmware')
    const malformed = path.join(dir, 'malformed.json')
    writeFileSync(malformed, JSON.stringify({ packages: { amd: [], intel: ['x'] } }))
    const badShape = runNode(CHECK_FIRMWARE, [
      '--firmware',
      malformed,
      '--transcript-dir',
      FIRMWARE_TRANSCRIPTS,
    ])
    expect(badShape.status).toBe(2)
    expect(badShape.out).toContain('exactly amd, intel and wifi')
    const badBase = runNode(CHECK_FIRMWARE, [
      '--firmware',
      FIRMWARE,
      '--snapshot-base',
      // eslint-disable-next-line unicorn/prefer-https -- the violation under test: the checker must refuse a non-https snapshot base.
      'http://snapshot.debian.org',
    ])
    expect(badBase.status).toBe(2)
    expect(badBase.out).toContain('must be an https URL')
  })

  it.runIf(HAS_SNAPSHOT)('resolves the real firmware set live', () => {
    const run = runNode(CHECK_FIRMWARE, ['--firmware', FIRMWARE])
    expect(run.status).toBe(0)
    expect(run.out).toContain('all 7 packages resolve')
  })
})

describe('nvidia consent', () => {
  it('installs only after the license and the click, with verified evidence', () => {
    const fresh = createNvidiaState()
    expect(requestNvidiaInstall(fresh, true)).toEqual({ ok: false, reason: 'terms' })
    const accepted = acceptNvidiaTerms(fresh)
    expect(requestNvidiaInstall(accepted, false)).toEqual({ ok: false, reason: 'click' })
    const requested = requestNvidiaInstall(accepted, true)
    if (!requested.ok) throw new Error('unreachable')
    expect(requestNvidiaInstall(requested.state, true).ok).toBe(true)
    expect(() =>
      recordNvidiaInstalled(requested.state, {
        version: '595.45.04-1',
        flavor: 'open',
        keyFingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        pinned: [NVIDIA_PRIMARY],
      }),
    ).toThrow('nvidia install evidence is not valid')
    expect(() =>
      recordNvidiaInstalled(fresh, {
        version: '595.45.04-1',
        flavor: 'open',
        keyFingerprint: NVIDIA_PRIMARY,
        pinned: [NVIDIA_PRIMARY],
      }),
    ).toThrow('nvidia install was not requested')
    const installed = recordNvidiaInstalled(requested.state, {
      version: '595.45.04-1',
      flavor: 'open',
      keyFingerprint: NVIDIA_PRIMARY.toLowerCase(),
      pinned: [NVIDIA_PRIMARY],
    })
    expect(installed.nvidiaInstalled).toBe(true)
    expect(installed.nvidiaFlavor).toBe('open')
    expect(installed.nvidiaKeyFingerprint).toBe(NVIDIA_PRIMARY)
    expect(requestNvidiaInstall(installed, true)).toEqual({ ok: false, reason: 'installed' })
    const dir = scratch('node-os-nvidia-state-')
    expect(loadNvidiaState(dir)).toBeNull()
    saveNvidiaState(dir, installed)
    expect(loadNvidiaState(dir)).toEqual(installed)
  })
})

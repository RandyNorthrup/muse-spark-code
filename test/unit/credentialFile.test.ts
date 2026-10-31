import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  credentialFileVerdict,
  keychainItemPresence,
} from '../../src/core/backends/musecode/credentialFile'
import {
  AUTH_SET_FILE,
  DEVICE_LOGIN_FILE,
  LOGOUT_SHELL,
  SLACK_CONNECTOR_ONLY,
} from './helpers/credentialShapes'

// The RLF-MACCRED macOS captures (2026-10-30, Muse Code 1.4.11-R6667.1):
// synthetic structures with placeholder values, proven by `muse serve`'s
// own start verdict and `account/read` per shape (provenance beside them).
function maccredFixture(
  name: 'v1-auth-set.json' | 'v1-browser-login.macos.json' | 'v2-empty.json',
): string {
  return readFileSync(new URL(`../fixtures/maccred/${name}`, import.meta.url), 'utf8')
}

// Not captured here: the macOS pointer a third party observed on 1.3.0
// (aonia §2.3); the probes of 2026-09-27 wrote the same shape to see what
// `muse serve` does with it.
const MAC_POINTER = JSON.stringify({
  schema_version: 2,
  providers: {
    meta: {
      mechanism: 'oauth',
      storage: 'keychain',
      obtained_via: 'device_code',
      api_base_url: 'https://api.meta.ai/v1',
    },
  },
})
// Synthetic, as the probes of 2026-09-27 wrote it: a version-1 `meta` whose
// storage is the Keychain (`muse serve` exits 3 with it on Windows and Linux).
const SCHEMA_1_POINTER = JSON.stringify({
  schema_version: 1,
  providers: { meta: { storage: 'keychain' } },
})

/** Synthetic: a version-1 file whose `meta` entry is `meta`, as given. */
function withMeta(meta: Record<string, string>): string {
  return JSON.stringify({ schema_version: 1, providers: { meta } })
}

/** Synthetic: `meta` beside a connector whose own entry uses the Keychain. */
function besideConnector(meta: Record<string, string>): string {
  return JSON.stringify({
    schema_version: 1,
    providers: { slack_connector: { storage: 'keychain' }, meta },
  })
}

describe('credentialFileVerdict', () => {
  it.each(['win32', 'linux', 'darwin'] as const)(
    'reads the file a sign-out leaves as empty on %s',
    (platform) => {
      expect(credentialFileVerdict(LOGOUT_SHELL, platform)).toBe('empty')
    },
  )

  // macOS 1.4.11 starts with both and answers `apiKey` / `accountLogin`
  // (test/fixtures/maccred/provenance.json), as 1.4.0–1.4.10 did off macOS.
  it.each(['win32', 'linux', 'darwin'] as const)(
    'reads a stored key or login as held in the file on %s',
    (platform) => {
      expect(credentialFileVerdict(AUTH_SET_FILE, platform)).toBe('inline')
      expect(credentialFileVerdict(DEVICE_LOGIN_FILE, platform)).toBe('inline')
    },
  )

  // The per-OS table the captures prove (darwin from 1.4.11 on 2026-10-30,
  // win32/linux from 1.4.0–1.4.10): a macOS expectation fails on a Windows
  // or Linux runner too, not only in macOS CI (the review of PR #49).
  it.each([
    ['v1-auth-set.json', 'inline', 'inline', 'inline'],
    ['v1-browser-login.macos.json', 'inline', 'inline', 'inline'],
    ['v2-empty.json', 'unsupportedHere', 'unsupportedHere', 'unrecognized'],
  ] as const)('reads the macOS capture %s as %s/%s/%s', (name, win32, linux, darwin) => {
    const text = maccredFixture(name)
    expect(credentialFileVerdict(text, 'win32')).toBe(win32)
    expect(credentialFileVerdict(text, 'linux')).toBe(linux)
    expect(credentialFileVerdict(text, 'darwin')).toBe(darwin)
  })

  // An empty version-2 file on macOS starts `muse serve` 1.4.11, which
  // answers `loggedOut` — but whether a Keychain item could sign such a
  // file in was not captured, so the CLI is still asked (RLF-MACCRED).
  it('reads a macOS Keychain pointer as needing the CLI on macOS', () => {
    expect(credentialFileVerdict(MAC_POINTER, 'darwin')).toBe('keychain')
    expect(credentialFileVerdict(SCHEMA_1_POINTER, 'darwin')).toBe('keychain')
    expect(credentialFileVerdict(maccredFixture('v2-empty.json'), 'darwin')).toBe('unrecognized')
  })

  // Only the captured inline shapes are a sign-in: no `storage` lane, and
  // an `api_key` string (the review of PR #49, narrowed by F94).
  it.each(['win32', 'linux', 'darwin'] as const)(
    'leaves a meta entry in any other shape to the CLI on %s',
    (platform) => {
      expect(credentialFileVerdict(withMeta({}), platform)).toBe('unrecognized')
      expect(credentialFileVerdict(withMeta({ storage: 'file' }), platform)).toBe('unrecognized')
      expect(
        credentialFileVerdict(withMeta({ storage: 'file', api_key: '<placeholder>' }), platform),
      ).toBe('unrecognized')
      expect(credentialFileVerdict(withMeta({ api_base_url: '<placeholder>' }), platform)).toBe(
        'unrecognized',
      )
    },
  )

  // `api_key` alone still starts `muse serve` 1.4.10-R6427.1 (`apiKey`,
  // captured 2026-10-17, F94) and 1.4.11 on macOS (`apiKey`, captured
  // 2026-10-30, RLF-MACCRED).
  it.each(['win32', 'linux', 'darwin'] as const)(
    'takes the key `muse auth set` writes as the sign-in on %s',
    (platform) => {
      expect(credentialFileVerdict(withMeta({ api_key: '<placeholder>' }), platform)).toBe('inline')
    },
  )

  // The same captures: `providers.meta.api_key must be a string` exits 3
  // (1.4.10 on macOS, F94), so a key that is not a string is not the
  // captured inline shape on any OS.
  it('leaves a key that is not a string to the CLI on every OS', () => {
    for (const key of ['123', 'null', 'true', '{"nested":1}']) {
      const text = `{"schema_version":1,"providers":{"meta":{"api_key":${key}}}}`
      expect(credentialFileVerdict(text, 'win32')).toBe('unrecognized')
      expect(credentialFileVerdict(text, 'linux')).toBe('unrecognized')
      expect(credentialFileVerdict(text, 'darwin')).toBe('unrecognized')
    }
  })

  // An `access_token` without `api_key` exits 3 ("malformed auth file"),
  // on macOS 1.4.10 (F94) as off it, so the CLI places it everywhere.
  it('leaves a token without its key to the CLI on every OS', () => {
    expect(credentialFileVerdict(withMeta({ access_token: '<placeholder>' }), 'win32')).toBe(
      'unrecognized',
    )
    expect(credentialFileVerdict(withMeta({ access_token: '<placeholder>' }), 'linux')).toBe(
      'unrecognized',
    )
    expect(credentialFileVerdict(withMeta({ access_token: '<placeholder>' }), 'darwin')).toBe(
      'unrecognized',
    )
  })

  // Each made `muse serve` exit 3 on 1.4.0-R4302.1, Windows and Linux
  // (isolated homes), the empty version-2 file included: "unsupported auth
  // schema version 2" (the review of PR #49; probe-v2-serve-win.json,
  // probe-v2-serve-linux.json).
  it.each(['win32', 'linux'] as const)(
    'names a macOS file Muse Code cannot start with on %s',
    (platform) => {
      expect(credentialFileVerdict(MAC_POINTER, platform)).toBe('unsupportedHere')
      expect(credentialFileVerdict(SCHEMA_1_POINTER, platform)).toBe('unsupportedHere')
      expect(credentialFileVerdict(maccredFixture('v2-empty.json'), platform)).toBe(
        'unsupportedHere',
      )
    },
  )

  // Only `meta` speaks for the sign-in (the review of PR #49).
  it.each(['win32', 'linux', 'darwin'] as const)(
    'leaves a file naming another provider alone to the CLI on %s',
    (platform) => {
      expect(credentialFileVerdict(SLACK_CONNECTOR_ONLY, platform)).toBe('unrecognized')
    },
  )

  it('decides on meta beside another provider, and on meta’s storage only, on every OS', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      expect(credentialFileVerdict(besideConnector({ api_key: '<placeholder>' }), platform)).toBe(
        'inline',
      )
    }
    expect(credentialFileVerdict(besideConnector({ storage: 'keychain' }), 'win32')).toBe(
      'unsupportedHere',
    )
  })

  it.each([
    ['not JSON', '{"schema_version": 1, "providers": '],
    ['a future schema', '{"schema_version": 3, "providers": {"meta": {}}}'],
    ['no providers', '{"schema_version": 1}'],
    ['a provider that is not an object', '{"schema_version": 1, "providers": {"meta": "x"}}'],
    ['a version that is not a number', '{"schema_version": "1", "providers": {}}'],
    ['an array', '[]'],
  ])('leaves %s to the CLI', (_name, text) => {
    expect(credentialFileVerdict(text, 'linux')).toBe('unrecognized')
  })
})

describe('keychainItemPresence', () => {
  it('reads the attribute lookup’s exit code', () => {
    expect(keychainItemPresence(0)).toBe('present')
    expect(keychainItemPresence(44)).toBe('absent')
    expect(keychainItemPresence(-1)).toBe('unknown')
    expect(keychainItemPresence(36)).toBe('unknown')
  })
})

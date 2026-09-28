import { describe, expect, it } from 'vitest'
import {
  credentialFileVerdict,
  keychainItemPresence,
} from '../../src/core/backends/musecode/credentialFile'
import {
  AUTH_SET_FILE,
  capturedInlineVerdict,
  DEVICE_LOGIN_FILE,
  LOGOUT_SHELL,
  SHIPPED_PLATFORMS,
  SLACK_CONNECTOR_ONLY,
} from './helpers/credentialShapes'

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
// Synthetic: the empty version-2 file the probes of 2026-09-27 gave `muse
// serve`, which exits 3 with it on Windows and Linux.
const EMPTY_V2 = '{"schema_version":2,"providers":{}}'

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

  it.each(['win32', 'linux'] as const)(
    'reads a stored key or login as held in the file on %s',
    (platform) => {
      expect(credentialFileVerdict(AUTH_SET_FILE, platform)).toBe('inline')
      expect(credentialFileVerdict(DEVICE_LOGIN_FILE, platform)).toBe('inline')
    },
  )

  // Whether macOS 1.4.0 reads or migrates a version-1 file holding the
  // credential was never captured: the CLI says (the review of PR #49).
  it('leaves a file holding the credential to the CLI on macOS', () => {
    expect(credentialFileVerdict(AUTH_SET_FILE, 'darwin')).toBe('unrecognized')
    expect(credentialFileVerdict(DEVICE_LOGIN_FILE, 'darwin')).toBe('unrecognized')
  })

  // The table the e2e tests read a real file against on the host OS, pinned
  // here for every OS: a macOS expectation fails on a Windows or Linux
  // runner too, not only in macOS CI (the review of PR #49).
  it('keeps the per-OS table the e2e tests expect in step with the read', () => {
    expect(SHIPPED_PLATFORMS.map((platform) => capturedInlineVerdict(platform))).toEqual([
      'inline',
      'inline',
      'unrecognized',
    ])
    for (const platform of SHIPPED_PLATFORMS) {
      expect(credentialFileVerdict(AUTH_SET_FILE, platform)).toBe(capturedInlineVerdict(platform))
      expect(credentialFileVerdict(DEVICE_LOGIN_FILE, platform)).toBe(
        capturedInlineVerdict(platform),
      )
    }
  })

  // An empty version-2 file on macOS was never captured either.
  it('reads a macOS Keychain pointer as needing the CLI on macOS', () => {
    expect(credentialFileVerdict(MAC_POINTER, 'darwin')).toBe('keychain')
    expect(credentialFileVerdict(SCHEMA_1_POINTER, 'darwin')).toBe('keychain')
    expect(credentialFileVerdict(EMPTY_V2, 'darwin')).toBe('unrecognized')
  })

  // Only the captured inline shapes are a sign-in: no `storage` lane, and
  // `api_key` or `access_token` (the review of PR #49).
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

  it('takes either captured credential key alone as the sign-in off macOS', () => {
    expect(credentialFileVerdict(withMeta({ access_token: '<placeholder>' }), 'linux')).toBe(
      'inline',
    )
    expect(credentialFileVerdict(withMeta({ api_key: '<placeholder>' }), 'linux')).toBe('inline')
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
      expect(credentialFileVerdict(EMPTY_V2, platform)).toBe('unsupportedHere')
    },
  )

  // Only `meta` speaks for the sign-in (the review of PR #49).
  it.each(['win32', 'linux', 'darwin'] as const)(
    'leaves a file naming another provider alone to the CLI on %s',
    (platform) => {
      expect(credentialFileVerdict(SLACK_CONNECTOR_ONLY, platform)).toBe('unrecognized')
    },
  )

  it('decides on meta beside another provider, and on meta’s storage only, off macOS', () => {
    expect(credentialFileVerdict(besideConnector({ api_key: '<placeholder>' }), 'win32')).toBe(
      'inline',
    )
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

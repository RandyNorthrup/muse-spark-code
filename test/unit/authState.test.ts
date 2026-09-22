import { describe, expect, it } from 'vitest'
import { deriveAuthStatus } from '../../src/host/auth/authState'

describe('deriveAuthStatus', () => {
  it('is signed out when no credential source exists', () => {
    expect(
      deriveAuthStatus({
        hasStoredKey: false,
        hasEnvironmentKey: false,
        credentialFileExists: false,
      }),
    ).toBe('signedOut')
  })

  it.each([
    ['a stored key', { hasStoredKey: true, hasEnvironmentKey: false, credentialFileExists: false }],
    [
      'an environment key',
      { hasStoredKey: false, hasEnvironmentKey: true, credentialFileExists: false },
    ],
    [
      'the CLI credential file',
      { hasStoredKey: false, hasEnvironmentKey: false, credentialFileExists: true },
    ],
  ])('is signed in with %s', (_label, evidence) => {
    expect(deriveAuthStatus(evidence)).toBe('signedIn')
  })
})

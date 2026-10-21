import { lstat, realpath } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { windowsTrustedPathVerifier } from '../../src/runtime/windowsTrustedPath'

const MISSING = String.raw`C:\no-such-dir\leaf.txt`
const MISSING_ROOT = String.raw`C:\no-such-dir`

function rejectLaunch(): Promise<never> {
  return Promise.reject(new Error('no process launcher on this check'))
}

function noLauncher(): (file: string, args: readonly string[]) => Promise<never> {
  return rejectLaunch
}

describe('windowsTrustedPathVerifier fail-closed denial', () => {
  it('refuses when a path query fails instead of trusting', async () => {
    // Real queries against a path nothing can stat: the native lstat fails
    // and the verifier answers refused, never trusted.
    const verifier = windowsTrustedPathVerifier(noLauncher(), { lstat, realpath })
    const result = await verifier.verify(MISSING, { leafKind: 'file', root: MISSING_ROOT })
    expect(result).toEqual({
      refused: true,
      component: MISSING,
      reason: 'path or security query failed',
    })
  })

  it('refuses a path outside its trusted root without querying', async () => {
    const verifier = windowsTrustedPathVerifier(noLauncher(), { lstat, realpath })
    const result = await verifier.verify(String.raw`C:\other\leaf.txt`, {
      leafKind: 'file',
      root: String.raw`C:\root`,
    })
    expect(result).toMatchObject({ refused: true, reason: 'outside its trusted root' })
  })
})

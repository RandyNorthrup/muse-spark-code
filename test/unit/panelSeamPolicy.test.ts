// D119 catch burn-down: only an unresolvable name reads as one. The
// resolver fails for real below; its own bugs keep their kind.
import { describe, expect, it } from 'vitest'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'

function seam(resolve: (host: string) => Promise<readonly string[]>) {
  return createModelsPanelSeam({
    configFile: 'providers.json',
    subscriptionModels: () => Promise.resolve([]),
    resolve,
  })
}

function coded(code: string): Error {
  return Object.assign(new Error(`getaddrinfo ${code} host.invalid`), { code })
}

describe('panel address resolution failures', () => {
  it('refuses an unresolvable name as unresolved-address', async () => {
    const verdict = await seam(() => Promise.reject(coded('ENOTFOUND'))).policy.check(
      'https://host.invalid',
    )
    expect(verdict).toEqual({ kind: 'refused', detail: 'unresolved-address' })
  })

  it('rethrows a resolver bug instead of refusing the address', async () => {
    const bug = new Error('resolver bug')
    await expect(seam(() => Promise.reject(bug)).policy.check('https://host.invalid')).rejects.toBe(
      bug,
    )
  })
})

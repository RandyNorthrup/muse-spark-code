// The native panel's GitHub lease: a bearer this window did not grant, or one
// past the local lease lifetime, is refused in words before any editor proxy
// call, and neither id is written to the log.
import { describe, expect, it } from 'vitest'
import { createNativeGitHub } from '../../src/runtime/panel/nativeGitHub'
import { GITHUB_LEASE_TTL_MS, UI_TEXT } from '../../src/shared/constants'
import type { HostServices } from '../../src/shared/hostApi/methods'
import { collectingLogger } from './helpers/collectingLogger'

const OWNER = '22222222-2222-4222-8222-222222222222'
const LEASE = '11111111-1111-4111-8111-111111111111'
const FOREIGN = '33333333-3333-4333-8333-333333333333'

function harness(now: () => number) {
  const asked: string[] = []
  const lines: string[] = []
  const host = {
    notify: () => undefined,
    request: (method: string) => {
      asked.push(method)
      if (method === 'auth/githubLease') return Promise.resolve({ leaseId: LEASE })
      const account = JSON.stringify({ login: 'lease-account', id: 7 })
      return method === 'github/request'
        ? Promise.resolve({ status: 200, body: account })
        : Promise.reject(new Error(`unexpected ${method}`))
    },
  }
  const native = createNativeGitHub({
    host: host as HostServices,
    workspaceUri: 'file:///workspace',
    ownerId: OWNER,
    userAgent: 'muse-test',
    signal: new AbortController().signal,
    log: collectingLogger(lines),
    now,
  })
  return { native, asked, lines }
}

describe('native GitHub lease', () => {
  it('refuses a foreign lease in words and does not ask the editor or log the id', async () => {
    const { native, asked, lines } = harness(() => 1_700_000_000_000)
    await expect(native.github.currentUser(FOREIGN)).rejects.toThrow(UI_TEXT.gitHubLeaseRefused)
    expect(asked).toEqual([])
    expect(lines.join('\n')).not.toContain(FOREIGN)
  })

  it('proxies a lease this window just granted', async () => {
    const { native, asked } = harness(() => 1_700_000_000_000)
    const lease = await native.githubToken('silent')
    expect(lease).toBe(LEASE)
    await expect(native.github.currentUser(LEASE)).resolves.toMatchObject({
      login: 'lease-account',
    })
    expect(asked).toEqual(['auth/githubLease', 'github/request'])
  })

  it('refuses that same lease in words once its lifetime has passed', async () => {
    let clock = 1_700_000_000_000
    const { native, asked, lines } = harness(() => clock)
    const lease = await native.githubToken('silent')
    expect(lease).toBe(LEASE)
    clock += GITHUB_LEASE_TTL_MS
    asked.length = 0
    await expect(native.github.currentUser(LEASE)).rejects.toThrow(UI_TEXT.gitHubLeaseRefused)
    expect(asked).toEqual([])
    expect(lines.join('\n')).not.toContain(LEASE)
  })
})

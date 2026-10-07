// Fake-only composition of P's request boundary with K's guarded credentials.
// M95's concrete registry/ModelApiHost and editor transports are not on this base.
import { describe, expect, it } from 'vitest'
import {
  AccountStore,
  accountClientLookup,
  type AccountClientPort,
  type AccountsMetadataPort,
} from '../../src/core/providers/accounts'
import type { AccountCredentialVault } from '../../src/core/providers/credentialRecord'
import { parseUsd } from '../../src/shared/usd'
import { FakeAccountProvider } from '../unit/helpers/accounts/fakes'
import { poolRig, poolRequest, POOL_NOW } from '../unit/helpers/accounts/pool'

const ORIGIN = 'https://provider.invalid'
function transport(t: ReturnType<typeof poolRig>) {
  const metadata: AccountsMetadataPort = {
    read: (provider) =>
      Promise.resolve({
        id: provider,
        policyProvider: 'anthropic',
        product: 'api',
        auth: 'apiKey',
        origin: ORIGIN,
        accounts: t.rows,
      }),
    writeAccounts: (_provider, accounts) => {
      t.rows.splice(0, t.rows.length, ...accounts)
      return Promise.resolve()
    },
  }
  const vault: AccountCredentialVault = {
    read: (binding) =>
      Promise.resolve({ ...binding, v: 1, auth: 'apiKey', secret: `fake-only-${binding.account}` }),
    readForRemoval: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  }
  const frames: { account: string; headers: { authorization: string; account: string } }[] = []
  const clients: AccountClientPort<{ authorization: string; account: string }, string> = {
    create: (binding, credential) => {
      if (credential === undefined) throw new Error('missing fake credential')
      return Promise.resolve({
        authorization: `Bearer ${credential.secret}`,
        account: binding.account,
      })
    },
    scan: (binding) => Promise.resolve(binding.account),
  }
  return { frames, clients: accountClientLookup(new AccountStore(metadata, vault), clients) }
}

describe('M108 fake-only accounts composition', () => {
  it('uses only B credentials and headers after A reaches its user cap', async () => {
    const t = poolRig(),
      tx = transport(t)
    t.rows[0]!.thresholds = { requests: { day: 1 } }
    const send = async (admission: Parameters<Parameters<typeof t.pool.run>[1]>[0]) => {
      const headers = await tx.clients.client('anthropic', admission.account, ORIGIN)
      admission.beforeSend()
      tx.frames.push({ account: admission.account, headers })
      return { value: admission.account, actualUsd: admission.estimate.costUsd }
    }
    expect(await t.pool.run(poolRequest(), send)).toBe('a')
    expect(await t.pool.run(poolRequest(), send)).toBe('b')
    expect(tx.frames).toEqual([
      { account: 'a', headers: { authorization: 'Bearer fake-only-a', account: 'a' } },
      { account: 'b', headers: { authorization: 'Bearer fake-only-b', account: 'b' } },
    ])
    expect(JSON.stringify(tx.frames[1])).not.toContain('fake-only-a')
    expect(JSON.stringify(t.events)).not.toContain('fake-only')
    expect(t.events[0]).toMatchObject({ type: 'swap', previousAccount: 'a', account: 'b' })
  })

  it('handles a turn and fan-out through per-account 429 and Retry-After without retry dispatch', async () => {
    const t = poolRig(),
      tx = transport(t)
    const provider = new FakeAccountProvider(
      new Map(
        t.rows.map((account) => [
          account.id,
          { requests: account.id === 'b' ? 2 : 1, windowMs: 60_000, retryAfterMs: 120_000 },
        ]),
      ),
      () => POOL_NOW,
    )
    const send = async (admission: Parameters<Parameters<typeof t.pool.run>[1]>[0]) => {
      const headers = await tx.clients.client('anthropic', admission.account, ORIGIN)
      admission.beforeSend()
      tx.frames.push({ account: admission.account, headers })
      const reply = provider.request(admission.account)
      if (reply.status === 429) {
        t.blocks.set(admission.account, {
          blocked: { reason: 'rateLimited', resetAt: new Date(reply.retryAt).toISOString() },
        })
        throw new Error('fake 429')
      }
      return { value: reply.account, actualUsd: parseUsd('0.1') }
    }
    expect(await t.pool.run(poolRequest(), send)).toBe('a')
    await expect(t.pool.run(poolRequest(), send)).rejects.toThrow('fake 429')
    expect(await t.pool.run(poolRequest(), send)).toBe('b')
    expect(await t.pool.run(poolRequest({ kind: 'worker', owner: 'subagent-one' }), send)).toBe('c')
    await expect(
      t.pool.run(poolRequest({ kind: 'worker', owner: 'subagent-one' }), send),
    ).rejects.toThrow('fake 429')
    expect(await t.pool.run(poolRequest({ kind: 'worker', owner: 'subagent-two' }), send)).toBe('b')
    expect(provider.calls.filter((call) => call.wasDuringRetry)).toEqual([])
    expect(provider.calls.filter((call) => call.account === 'a')).toHaveLength(2)
    expect(t.claims[1]).toMatchObject({ account: 'a', actual: null })
    expect(t.pool.current('conversation', 'main')).toBe('b')
  })
})

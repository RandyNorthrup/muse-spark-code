import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  redeemVaultExecLease,
  type VaultExecBrokerLeaseDeps,
} from '../../../src/core/vault/exec/brokerLease'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { brokerFixture, cleanTaint } from './brokerFixture'
import { use, metadata } from '../helpers/vault/fixtures'
import { envelope } from './execFixture'
import { UI_TEXT } from '../../../src/shared/constants'

const engines: VaultBroker[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose()
})

describe('M109 X private broker material adapter', () => {
  it('redeems a real broker ticket once and erases the independent byte owner at finish', async () => {
    const fixture = await brokerFixture()
    engines.push(fixture.broker)
    await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
    fixture.standing()
    const result = await fixture.broker.request(
      fixture.identity,
      fixture.stored.metadata.handle,
      use(),
      cleanTaint,
    )
    if (result.kind !== 'ticket') throw new Error('expected ticket')
    const revoked = new AbortController()
    const lifetime = {
      revoked: revoked.signal,
      close: vi.fn(() => {
        revoked.abort()
      }),
      terminate: vi.fn(() => Promise.resolve(true)),
    }
    const deps: VaultExecBrokerLeaseDeps = {
      broker: fixture.broker,
      requesterId: fixture.identity.id,
      lifetime: () => lifetime,
      oneTimeCode: () => Promise.reject(new Error('no code route')),
    }
    const approval = { ticket: result.ticket, use: use() }
    const lease = await redeemVaultExecLease(deps, approval, new AbortController().signal)
    expect(fixture.stored.material.kind).toBe('secret')
    if (fixture.stored.material.kind !== 'secret') throw new Error('expected secret')
    expect(lease.value).toEqual(fixture.stored.material.value)
    expect(lease.value).not.toBe(fixture.stored.material.value)
    await lease.close(true)
    expect(lease.value.every((byte) => byte === 0)).toBe(true)
    expect(lifetime.close).toHaveBeenCalled()
    await expect(
      redeemVaultExecLease(deps, approval, new AbortController().signal),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    await lease.close(true)
  })
  it.each(['cancel', 'revoke'])(
    'erases a copied value synchronously while the private material continuation is pending: %s',
    async (reason) => {
      const input = envelope()
      const controller = new AbortController()
      const revocation = new AbortController()
      const copied = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const lifetime = {
        revoked: revocation.signal,
        close: vi.fn(),
        terminate: vi.fn(() => Promise.resolve(true)),
      }
      const value = Buffer.from(randomBytes(32).toString('hex'))
      const item = { metadata: metadata(), material: { kind: 'secret' as const, value } }
      // The fake broker holds the original bytes; the adapter owns only its independent copy.
      const deps: VaultExecBrokerLeaseDeps = {
        requesterId: input.approvals[0]!.ticket.requesterId,
        lifetime: () => lifetime,
        oneTimeCode: () => Promise.reject(new Error('no code route')),
        broker: {
          redeem: vi.fn<VaultExecBrokerLeaseDeps['broker']['redeem']>(() =>
            Promise.resolve({
              kind: 'ticket',
              ticket: input.approvals[0]!.ticket,
              authority: { kind: 'user' },
            }),
          ),
          withApprovedMaterial: vi.fn<VaultExecBrokerLeaseDeps['broker']['withApprovedMaterial']>(
            async (_ticket, _requester, _use, run) => {
              await run(item)
              copied.resolve(undefined)
              await release.promise
            },
          ),
          finish: vi.fn(() => Promise.resolve()),
        },
      }
      const copies: Buffer[] = []
      const allocate = Buffer.alloc
      const allocation = vi.spyOn(Buffer, 'alloc').mockImplementation((size) => {
        const copy = allocate(size)
        copies.push(copy)
        return copy
      })
      try {
        const pending = redeemVaultExecLease(deps, input.approvals[0]!, controller.signal)
        const refused = expect(pending).rejects.toThrow(UI_TEXT.vault.noAccess)
        await copied.promise
        if (reason === 'cancel') controller.abort()
        else revocation.abort()
        for (const copy of copies) expect(copy.every((byte) => byte === 0)).toBe(true)
        release.resolve(undefined)
        await refused
        expect(lifetime.close).toHaveBeenCalled()
        expect(deps.broker.finish).toHaveBeenCalledWith(input.approvals[0]!.ticket.id, false)
        expect(copies.length).toBeGreaterThan(0)
        for (const copy of copies) expect(copy.every((byte) => byte === 0)).toBe(true)
        expect(value.some((byte) => byte !== 0)).toBe(true)
      } finally {
        release.resolve(undefined)
        allocation.mockRestore()
        value.fill(0)
      }
    },
  )
  it('only releases a current code from the broker callback and rejects a seed-shaped result', async () => {
    const input = envelope({ totp: 'secret://test-secret' })
    const revoked = new AbortController()
    const lifetime = {
      revoked: revoked.signal,
      close: vi.fn(),
      terminate: vi.fn(() => Promise.resolve(true)),
    }
    const fixture = await brokerFixture()
    engines.push(fixture.broker)
    const code = Buffer.from('123456')
    const deps: VaultExecBrokerLeaseDeps = {
      requesterId: input.approvals[0]!.ticket.requesterId,
      lifetime: () => lifetime,
      oneTimeCode: vi.fn(() => Promise.resolve(code)),
      broker: {
        redeem: () =>
          Promise.resolve({
            kind: 'ticket',
            ticket: input.approvals[0]!.ticket,
            authority: { kind: 'user' },
          }),
        withApprovedMaterial: async (_ticket, _requester, _use, run) => {
          await run(fixture.stored)
        },
        finish: () => Promise.resolve(),
      },
    }
    const lease = await redeemVaultExecLease(
      deps,
      input.approvals[0]!,
      new AbortController().signal,
    )
    expect(Buffer.from(lease.value).toString()).toBe('123456')
    expect(code.every((byte) => byte === 0)).toBe(true)
    await lease.close(true)
    const seed = Buffer.from(randomBytes(32).toString('hex'))
    const badDeps = { ...deps, oneTimeCode: () => Promise.resolve(seed) }
    await expect(
      redeemVaultExecLease(badDeps, input.approvals[0]!, new AbortController().signal),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(seed.every((byte) => byte === 0)).toBe(true)
  })
})

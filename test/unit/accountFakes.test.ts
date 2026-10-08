import { Usd as PortUsd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import {
  FakeAccountClock,
  FakeAccountJournal,
  FakeAccountProvider,
  FakeAccountDevice,
  type FakeAccountLimit,
  type FakeAccountReply,
  type FakeAccountUsage,
} from './helpers/accounts/fakes'
import type { AccountTrigger, AccountEvent, AccountUsageQuery } from '../../src/shared/accounts'

describe('M108 reusable account fakes', () => {
  it('counts per-account dispatch and preserves Retry-After across a window reset', () => {
    const clock = new FakeAccountClock(0)
    const limit: FakeAccountLimit = { requests: 1, windowMs: 60_000, retryAfterMs: 90_000 }
    const provider = new FakeAccountProvider(
      new Map([
        ['work', limit],
        ['personal', limit],
      ]),
      clock.now,
    )
    const reply: FakeAccountReply = provider.request('work')
    expect(reply).toEqual({ status: 200, account: 'work', remainingRequests: 0 })
    expect(provider.request('work')).toEqual({ status: 429, account: 'work', retryAt: 90_000 })
    expect(provider.request('personal').status).toBe(200)
    clock.advance(60_000)
    expect(provider.request('work').status).toBe(429)
    expect(provider.calls.at(-1)?.wasDuringRetry).toBe(true)
    // The repeated prohibited dispatch extended its own retry deadline.
    clock.advance(90_000)
    expect(provider.request('work').status).toBe(200)
    expect(provider.calls.filter((call) => call.account === 'work')).toHaveLength(4)
    expect(() => provider.request('missing')).toThrow('Unknown fake account')
    expect(() => {
      clock.advance(-1)
    }).toThrow()
  })

  it('reads generated journal rows by provider, account and half-open time window', () => {
    const journal = new FakeAccountJournal()
    const row: FakeAccountUsage = {
      provider: 'meta',
      account: 'work',
      time: '2026-10-05T12:00:00Z',
      settledUsd: PortUsd.from(1).toAmount(),
      reservedUsd: PortUsd.from(2).toAmount(),
      uncertainUsd: PortUsd.from(3).toAmount(),
      inputTokens: 10,
      outputTokens: 20,
      requests: 1,
    }
    journal.append(row)
    journal.append({ ...row, account: 'personal', settledUsd: PortUsd.from(100).toAmount() })
    journal.append({ ...row, provider: 'openai', settledUsd: PortUsd.from(100).toAmount() })
    journal.append({
      ...row,
      time: '2026-10-06T00:00:00Z',
      settledUsd: PortUsd.from(100).toAmount(),
    })
    const query: AccountUsageQuery = {
      provider: 'meta',
      account: 'work',
      start: '2026-10-05T00:00:00Z',
      end: '2026-10-06T00:00:00Z',
    }
    expect(journal.read(query)).toEqual({
      settledUsd: PortUsd.from(1).toAmount(),
      reservedUsd: PortUsd.from(2).toAmount(),
      uncertainUsd: PortUsd.from(3).toAmount(),
      inputTokens: 10,
      outputTokens: 20,
      requests: 1,
    })
    expect(journal.read({ ...query, account: 'missing' }).requests).toBe(0)
    const trigger: AccountTrigger = { kind: 'vendorLimit', reason: 'rateLimited', resetAt: null }
    const event: AccountEvent = {
      type: 'stop',
      provider: 'meta',
      account: 'work',
      time: row.time,
      trigger,
    }
    journal.record(event)
    expect(journal.events).toEqual([event])
    expect(() => {
      journal.record({ ...event, label: 'Work' })
    }).toThrow()
  })

  it('uses receiver-local admission while offering only headroom', () => {
    let isLocallyConfirmed = false
    const device = new FakeAccountDevice(() => isLocallyConfirmed)
    expect(device.offer({ meta: 'ample' })).toEqual({ meta: 'ample' })
    expect(device.receive('meta')).toBe(false)
    isLocallyConfirmed = true
    expect(device.receive('meta')).toBe(true)
    expect(() => device.offer({ meta: { account: 'work' } })).toThrow()
  })
})

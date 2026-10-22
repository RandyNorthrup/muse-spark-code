// The team quota identity (agent teams): the guard carries each admitted
// attempt's digest in its stash, and the host's recorder wrapper stamps
// observations with it, never re-read after the response.
import { describe, expect, it } from 'vitest'
import { restampTeamQuota, stampQuotaRow, teamQuotaStash } from '../../src/core/usage/quotaStamp'
import type { OwnedLimitInput, UsageRecording } from '../../src/core/usage/recording'
import { ownedRecording } from './helpers/ownedRecording'

const SCOPE = { accountId: 'account', generation: 'generation-1', backend: 'modelApi' } as const

/** The reservation's budget identity every row arrives stamped with. */
const RESERVATION = 'budget-account'

function limitRow(provider: string): OwnedLimitInput {
  return {
    backend: 'modelApi',
    provider,
    source: 'headers',
    observedAt: 1,
    windows: [],
    raw: {},
    observedAccount: RESERVATION,
  }
}

/** The stamps the real recording kept, in observation order. */
function stamps(port: UsageRecording): (string | undefined)[] {
  return (port.ownedLimits?.() ?? []).map((row) => row.snapshot.observedAccount)
}

describe('team quota stash', () => {
  it('carries the latest admitted digest', () => {
    const quota = teamQuotaStash()
    expect(quota.current()).toBeUndefined()
    quota.noteAttempt('transport-digest')
    expect(quota.current()).toBe('transport-digest')
  })
  it('an undefined admission never clears the carried digest', () => {
    const quota = teamQuotaStash()
    quota.noteAttempt('transport-digest')
    quota.noteAttempt(undefined)
    expect(quota.current()).toBe('transport-digest')
  })
  it('a newer attempt replaces the carried digest', () => {
    const quota = teamQuotaStash()
    quota.noteAttempt('first-digest')
    quota.noteAttempt('second-digest')
    expect(quota.current()).toBe('second-digest')
  })
})

describe('stampQuotaRow', () => {
  // P2-4: a bring-your-own model attributes its quota to the credential
  // the attempt used; Meta keeps the reservation's budget identity (which
  // also covers key-less flows the offer side cannot see); without a
  // carried digest the reservation stays, so a removed credential's old
  // quota gives no offer.
  it('stamps a bring-your-own row with the admitted digest', () => {
    expect(
      stampQuotaRow({
        provider: 'openai',
        attemptKeyDigest: 'transport-digest',
        reservationAccount: 'budget-account',
      }),
    ).toBe('transport-digest')
  })
  it('keeps the reservation for Meta rows', () => {
    expect(
      stampQuotaRow({
        provider: 'meta',
        attemptKeyDigest: 'transport-digest',
        reservationAccount: 'budget-account',
      }),
    ).toBe('budget-account')
  })
  it('keeps the reservation without a carried digest', () => {
    expect(
      stampQuotaRow({
        provider: 'openai',
        attemptKeyDigest: undefined,
        reservationAccount: 'budget-account',
      }),
    ).toBe('budget-account')
  })
})

describe('restampTeamQuota', () => {
  // Producers publish through the owner scope (M117), so the team stamp
  // must hold there, on a re-scope, and on the raw owned constructor; the
  // real recording keeps the stamp in the row team offers read.
  it('re-stamps scoped rows through a team stash, leaving Meta rows alone', () => {
    const quota = teamQuotaStash()
    quota.noteAttempt('transport-digest')
    const { port } = ownedRecording(1)
    const scoped = restampTeamQuota(port, quota)?.scopeLimits?.(SCOPE)
    if (scoped === undefined) throw new Error('Expected a scoped recording')
    scoped.limit(limitRow('openai'))
    scoped.limit(limitRow('meta'))
    expect(stamps(port)).toEqual(['transport-digest', 'budget-account'])
  })
  it('re-stamps a producer re-scoped to a new owner generation', () => {
    const quota = teamQuotaStash()
    quota.noteAttempt('transport-digest')
    const { port } = ownedRecording(1)
    const rescoped = restampTeamQuota(port, quota)
      ?.scopeLimits?.(SCOPE)
      .scopeLimits?.({ ...SCOPE, generation: 'generation-2' })
    if (rescoped === undefined) throw new Error('Expected a re-scoped recording')
    rescoped.limit(limitRow('openai'))
    expect(stamps(port)).toEqual(['transport-digest'])
  })
  it('re-stamps the raw owned constructor', () => {
    const quota = teamQuotaStash()
    quota.noteAttempt('transport-digest')
    const { port } = ownedRecording(1)
    const wrapped = restampTeamQuota(port, quota)
    if (wrapped === undefined) throw new Error('Expected a wrapped recording')
    wrapped.limit({
      ...limitRow('openai'),
      owner: { kind: 'account', id: 'account', providerId: 'openai', generation: 'generation-1' },
      sequence: 0,
    })
    expect(stamps(port)).toEqual(['transport-digest'])
  })
  it('records exactly what the session stamped without a team stash', () => {
    const { port } = ownedRecording(1)
    expect(restampTeamQuota(port, undefined)).toBe(port)
  })
  it('keeps the reservation when nothing was admitted yet', () => {
    const { port } = ownedRecording(1)
    const scoped = restampTeamQuota(port, teamQuotaStash())?.scopeLimits?.(SCOPE)
    if (scoped === undefined) throw new Error('Expected a scoped recording')
    scoped.limit(limitRow('openai'))
    expect(stamps(port)).toEqual(['budget-account'])
  })
})

// The team quota identity (agent teams): the guard carries each admitted
// attempt's digest in its stash, and the host's recorder wrapper stamps
// observations with it, never re-read after the response.
import { describe, expect, it } from 'vitest'
import { restampTeamQuota, stampQuotaRow, teamQuotaStash } from '../../src/core/usage/quotaStamp'
import type { UsageRecording } from '../../src/core/usage/recording'
import type { UsageLimitSnapshot } from '../../src/shared/usageJournal'

type LimitContext = Omit<
  UsageLimitSnapshot,
  'v' | 'id' | 'at' | 'day' | 'timezoneOffsetMins' | 'client' | 'type'
>

function blankRecording(): { readonly rows: LimitContext[]; readonly fake: UsageRecording } {
  const rows: LimitContext[] = []
  const fake: UsageRecording = {
    limits: () => [],
    note: () => undefined,
    limit: (context) => {
      rows.push({ ...context })
    },
    today: () => Promise.resolve([]),
    flush: () => Promise.resolve(),
  }
  return { rows, fake }
}

function limitRow(provider: string, observedAccount: string | undefined): LimitContext {
  return {
    backend: 'modelApi',
    provider,
    source: 'headers',
    observedAt: 1,
    windows: [],
    raw: {},
    observedAccount,
  }
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
  const recording = blankRecording
  const row = limitRow
  it('re-stamps rows through a team stash, leaving other rows alone', () => {
    const quota = teamQuotaStash()
    quota.noteAttempt('transport-digest')
    const inner = recording()
    const wrapped = restampTeamQuota(inner.fake, quota)
    if (wrapped === undefined) throw new Error('Expected a wrapped recording')
    wrapped.limit(row('openai', 'budget-account'))
    wrapped.limit(row('meta', 'budget-account'))
    expect(inner.rows.map((entry) => entry.observedAccount)).toEqual([
      'transport-digest',
      'budget-account',
    ])
  })
  it('records exactly what the session stamped without a team stash', () => {
    const inner = recording()
    expect(restampTeamQuota(inner.fake, undefined)).toBe(inner.fake)
  })
  it('keeps the reservation when nothing was admitted yet', () => {
    const inner = recording()
    const wrapped = restampTeamQuota(inner.fake, teamQuotaStash())
    if (wrapped === undefined) throw new Error('Expected a wrapped recording')
    wrapped.limit(row('openai', 'budget-account'))
    expect(inner.rows.map((entry) => entry.observedAccount)).toEqual(['budget-account'])
  })
})

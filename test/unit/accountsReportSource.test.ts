import { EN } from '../../src/shared/l10n/en'
import { describe, expect, it } from 'vitest'
import { Usd as PortUsd } from '../../src/shared/usd'
import { accountsSource } from '../../src/core/reporting/sources/accounts'
import { reportOptions, REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import type { AccountsFacts, SourceReadContext } from '../../src/core/reporting/sources/types'

const facts: AccountsFacts = {
  providers: [
    {
      provider: 'meta',
      product: 'muse',
      auth: 'oauth',
      accounts: [
        {
          id: 'primary',
          label: 'Primary',
          order: 1,
          limitGroup: 'group',
          thresholds: {
            spendUsd: [{ period: 'day', value: PortUsd.from(5).toAmount() }],
            counts: [],
            percents: [],
          },
        },
      ],
    },
  ],
  usage: [],
  events: [],
  confirmations: [],
}

function contextFor(kind: SourceReadContext['options']['kind']): SourceReadContext {
  return {
    reportText: EN,
    asOf: REPORT_FIXTURE_AS_OF,
    workspaceKey: 'fixture',
    options: reportOptions(kind),
    signal: new AbortController().signal,
  }
}

describe('accounts report source', () => {
  it('is not applicable to other kinds and unavailable without a reader', async () => {
    const bound = accountsSource({ read: () => Promise.resolve({ facts }) }, (text) => text)
    const foreign = await bound.read(contextFor('session'))
    expect(foreign.record.status).toBe('notApplicable')
    const project = await bound.read(contextFor('project'))
    expect(project.record.status).toBe('notApplicable')
    const unbound = accountsSource(undefined, (text) => text)
    const unread = await unbound.read(contextFor('accounts'))
    expect(unread.record.status).toBe('unavailable')
  })

  it('reads a missing registry as unavailable and validates its facts', async () => {
    const missing = accountsSource({ read: () => Promise.resolve(null) }, (text) => text)
    const absent = await missing.read(contextFor('accounts'))
    expect(absent.record.status).toBe('unavailable')
    const invalid = accountsSource(
      { read: () => Promise.resolve({ facts: { ...facts, usage: 'nope' } as never }) },
      (text) => text,
    )
    const rejected = await invalid.read(contextFor('accounts'))
    expect(rejected.record.status).toBe('partial')
    expect(rejected.record.reason).toContain(EN.reportSourceReasons.invalid)
    expect(rejected.data).not.toBeNull()
  })

  it('sorts providers, accounts, usage, events and confirmations by code unit', async () => {
    const shuffled: AccountsFacts = {
      ...facts,
      providers: [
        {
          provider: 'zeta',
          product: 'muse',
          auth: 'oauth',
          accounts: [
            {
              id: 'b',
              label: 'B',
              order: 1,
              limitGroup: null,
              thresholds: { spendUsd: [], counts: [], percents: [] },
            },
            {
              id: 'a',
              label: 'A',
              order: 0,
              limitGroup: null,
              thresholds: { spendUsd: [], counts: [], percents: [] },
            },
          ],
        },
        ...facts.providers,
      ],
    }
    const source = accountsSource(
      { read: () => Promise.resolve({ facts: shuffled }) },
      (text) => text,
    )
    const result = await source.read(contextFor('accounts'))
    expect(result.record.status).toBe('ok')
    expect(result.data!.providers.map((entry) => entry.provider)).toEqual(['meta', 'zeta'])
    expect(result.data!.providers[1]!.accounts.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('carries the partial reason through the scrub', async () => {
    const source = accountsSource(
      { read: () => Promise.resolve({ facts, partial: 'usage is private-canary' }) },
      (text) => text.replaceAll('private-canary', '[redacted]'),
    )
    const result = await source.read(contextFor('accounts'))
    expect(result.record).toMatchObject({ status: 'partial', reason: 'usage is [redacted]' })
  })
})

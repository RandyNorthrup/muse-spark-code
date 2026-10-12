import { EN } from '../../src/shared/l10n/en'
import { describe, expect, it } from 'vitest'
import { securitySource } from '../../src/core/reporting/sources/security'
import { reportOptions, REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import type { SecurityFacts, SourceReadContext } from '../../src/core/reporting/sources/types'

const facts: SecurityFacts = {
  vault: {
    state: 'unlocked',
    tier: 'osStore',
    itemCount: 1,
    itemsByKind: [{ kind: 'password', count: 1 }],
    grants: [{ scope: 'named/named', count: 1 }],
  },
  audit: [{ kind: 'environment', decision: 'allow', authority: 'grant', outcome: 'succeeded' }],
  developerAudit: [{ action: 'unlock', source: 'palette' }],
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

describe('security report source', () => {
  it('is not applicable to other kinds and unavailable without a reader', async () => {
    const bound = securitySource({ read: () => Promise.resolve({ facts }) }, (text) => text)
    const foreign = await bound.read(contextFor('usage'))
    expect(foreign.record.status).toBe('notApplicable')
    const project = await bound.read(contextFor('project'))
    expect(project.record.status).toBe('notApplicable')
    const unbound = securitySource(undefined, (text) => text)
    const unread = await unbound.read(contextFor('security'))
    expect(unread.record.status).toBe('unavailable')
  })

  it('reads missing audits as unavailable and validates its facts', async () => {
    const missing = securitySource({ read: () => Promise.resolve(null) }, (text) => text)
    const absent = await missing.read(contextFor('security'))
    expect(absent.record.status).toBe('unavailable')
    const invalid = securitySource(
      {
        read: () =>
          Promise.resolve({
            facts: { ...facts, vault: { ...facts.vault!, tier: 7 } } as never,
          }),
      },
      (text) => text,
    )
    const rejected = await invalid.read(contextFor('security'))
    expect(rejected.record.status).toBe('partial')
    expect(rejected.record.reason).toContain(EN.reportSourceReasons.invalid)
    expect(rejected.data).not.toBeNull()
  })

  it('sorts audit and developer audit groups by code unit', async () => {
    const shuffled: SecurityFacts = {
      ...facts,
      audit: [
        { kind: 'ssh', decision: 'deny', authority: 'user', outcome: 'denied' },
        ...facts.audit,
      ],
      developerAudit: [{ action: 'enable', source: 'page' }, ...facts.developerAudit],
    }
    const source = securitySource(
      { read: () => Promise.resolve({ facts: shuffled }) },
      (text) => text,
    )
    const result = await source.read(contextFor('security'))
    expect(result.record.status).toBe('ok')
    expect(result.data!.audit.map((entry) => entry.kind)).toEqual(['environment', 'ssh'])
    expect(result.data!.developerAudit.map((entry) => entry.action)).toEqual(['enable', 'unlock'])
  })

  it('keeps a locked vault null while reporting the developer audit', async () => {
    const source = securitySource(
      {
        read: () =>
          Promise.resolve({
            facts: { ...facts, vault: null, audit: [] },
            partial: 'vault is private-canary',
          }),
      },
      (text) => text.replaceAll('private-canary', '[redacted]'),
    )
    const result = await source.read(contextFor('security'))
    expect(result.record).toMatchObject({ status: 'partial', reason: 'vault is [redacted]' })
    expect(result.data!.vault).toBeNull()
    expect(result.data!.developerAudit).toHaveLength(1)
  })
})

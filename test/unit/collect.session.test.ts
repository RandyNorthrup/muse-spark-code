import { describe, expect, it } from 'vitest'
import { collectFixture, fullSnapshot, getSection } from './helpers/reporting/collect'
import { availableSource } from './helpers/reporting/snapshot'

describe('session collector', () => {
  it('retains actual turns and approval decisions independently of message count', () => {
    const report = collectFixture('session')
    expect(getSection(report, 'turns').rows[0]!.cells['count']).toEqual({ type: 'count', value: 1 })
    const decisions = getSection(report, 'approvals').rows.map((row) => [
      row.cells['kind'],
      row.cells['count'],
    ])
    expect(decisions).toEqual(
      expect.arrayContaining([
        [
          { type: 'text', value: 'approved' },
          { type: 'count', value: 1 },
        ],
        [
          { type: 'text', value: 'denied' },
          { type: 'count', value: 2 },
        ],
        [
          { type: 'text', value: 'auto' },
          { type: 'count', value: 0 },
        ],
        [
          { type: 'text', value: 'expired' },
          { type: 'count', value: 1 },
        ],
      ]),
    )
    expect(getSection(report, 'files').rows[0]!.cells).toMatchObject({
      files: { type: 'count', value: 1 },
      added: { type: 'count', value: 4 },
      removed: { type: 'count', value: 2 },
    })
    expect(getSection(report, 'tools').rows).toHaveLength(3)
    expect(getSection(report, 'paidUses').rows[0]!.cells['count']).toEqual({
      type: 'count',
      value: 1,
    })
    expect(getSection(report, 'checks').rows).toHaveLength(1)
    expect(getSection(report, 'questions').rows).toHaveLength(2)
    expect(
      report.needsYou.rows.some(
        (row) => row.cells['name']?.type === 'text' && row.cells['name'].value === 'q-current',
      ),
    ).toBe(true)
  })

  it('never converts a legacy missing turn or approval count to zero', () => {
    const snapshot = fullSnapshot()
    const session = snapshot.sources.session.data!
    const report = collectFixture(
      'session',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          session: availableSource('session', {
            ...session,
            activity: {
              turns: { status: 'unavailable', reason: 'Legacy turns missing' },
              approvals: { status: 'unavailable', reason: 'Legacy approvals missing' },
            },
          }),
        },
      },
    )
    expect(getSection(report, 'turns').rows[0]!.cells['reason']).toEqual({
      type: 'text',
      value: 'Legacy turns missing',
    })
    expect(getSection(report, 'approvals').rows[0]!.cells['count']).toEqual({
      type: 'label',
      value: 'unknown',
    })
    expect(getSection(report, 'approvals').rows[0]!.cells['reason']).toEqual({
      type: 'text',
      value: 'Legacy approvals missing',
    })
  })
})

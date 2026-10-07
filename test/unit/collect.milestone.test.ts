import { describe, expect, it } from 'vitest'
import { ReportScopeNotFound } from '../../src/core/reporting/collect/plan'
import { collectFixture, fullSnapshot, getSection } from './helpers/reporting/collect'
import { availableSource } from './helpers/reporting/snapshot'

describe('milestone collector', () => {
  it.each([false, true])('retains repeated checklist lines with unique keys (full=%s)', (full) => {
    const snapshot = fullSnapshot()
    const plan = snapshot.sources.plan.data!
    const checklist = [
      { text: 'All gates green', done: true },
      { text: 'All gates green', done: false },
      { text: 'All gates green', done: true },
    ]
    const collect = (items: typeof checklist) =>
      collectFixture(
        'milestone',
        { full },
        {
          ...snapshot,
          sources: {
            ...snapshot.sources,
            plan: availableSource('plan', {
              ...plan,
              milestones: plan.milestones.map((milestone) =>
                milestone.id === 'M12' ? { ...milestone, checklist: items } : milestone,
              ),
            }),
          },
        },
      )
    const report = collect(checklist)
    const rows = getSection(report, 'checklist').rows
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((row) => row.key)).size).toBe(3)
    expect(rows.map((row) => row.cells['name'])).toEqual(
      checklist.map(() => ({ type: 'text', value: 'All gates green' })),
    )
    expect(rows.filter((row) => row.cells['outcome']?.value === 'complete')).toHaveLength(2)
    expect(rows.filter((row) => row.cells['outcome']?.value === 'open')).toHaveLength(1)
    expect(getSection(report, 'certificationSummary').rows[0]!.cells).toMatchObject({
      count: { type: 'count', value: 2 },
      totals: { type: 'count', value: 3 },
    })
    expect(collect(checklist.toReversed())).toEqual(report)
  })

  it.each(['12', 'M12', 'm12'])(
    'matches %s exactly and retains declarations before gates run',
    (scope) => {
      const report = collectFixture('milestone', { scope })
      expect(getSection(report, 'gateDeclarations').rows.map((row) => row.cells['name'])).toEqual(
        expect.arrayContaining([
          { type: 'text', value: 'quality' },
          { type: 'text', value: 'check:reference' },
        ]),
      )
      expect(getSection(report, 'certificationSummary').rows[0]!.cells).toMatchObject({
        count: { type: 'count', value: 1 },
        totals: { type: 'count', value: 2 },
      })
      expect(getSection(report, 'checklist').rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cells: expect.objectContaining({
              name: { type: 'text', value: 'A certified renderer' },
              outcome: { type: 'label', value: 'open' },
            }),
          }),
        ]),
      )
      expect(getSection(report, 'milestoneDependencies').rows[0]!.cells['status']).toEqual({
        type: 'label',
        value: 'merged',
      })
    },
  )

  it.each(['M110a0', 'm91b'])('keeps suffixed id %s', (scope) => {
    expect(
      getSection(collectFixture('milestone', { scope }), 'milestoneStatus').rows[0]!.cells['name'],
    ).toEqual({ type: 'text', value: scope.toUpperCase().replace('A0', 'a0').replace('B', 'b') })
  })

  it('rejects unknown and prefix-only ids and returns deterministic nearest ids', () => {
    expect(() => collectFixture('milestone', { scope: 'M11' })).toThrow(ReportScopeNotFound)
    try {
      collectFixture('milestone', { scope: 'M999' })
    } catch (error) {
      expect(error).toBeInstanceOf(ReportScopeNotFound)
      if (error instanceof ReportScopeNotFound) {
        expect(error.code).toBe('notFound')
        expect(error.nearestIds).toContain('M91b')
      }
    }
  })

  it('does not mark an unknown dependency complete or discard residuals and relevant questions', () => {
    const snapshot = fullSnapshot()
    const plan = snapshot.sources.plan.data!
    const report = collectFixture(
      'milestone',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          plan: availableSource('plan', {
            ...plan,
            milestones: plan.milestones.map((milestone) =>
              milestone.id === 'M12' ? { ...milestone, dependencies: ['M999'] } : milestone,
            ),
          }),
        },
      },
    )
    expect(getSection(report, 'milestoneDependencies').rows[0]!.cells['status']).toEqual({
      type: 'label',
      value: 'unavailable',
    })
    expect(getSection(report, 'milestoneResiduals').rows).toHaveLength(1)
    expect(getSection(report, 'milestoneQuestions').rows).toHaveLength(1)
    expect(report.needsYou.rows[0]!.cells['name']).toEqual({ type: 'text', value: 'Q-M12' })
  })
})

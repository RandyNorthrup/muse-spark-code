import { describe, expect, it } from 'vitest'
import { createReportCollector } from '../../src/core/reporting/collect'
import {
  collectFixture,
  fixtureFinalize,
  fullSnapshot,
  getSection,
  noSources,
} from './helpers/reporting/collect'
import { availableSource, reportOptions, unavailableSource } from './helpers/reporting/snapshot'

describe('project report collector', () => {
  it('keeps distinct declarations when two lane tables use the same owner id', () => {
    const snapshot = fullSnapshot()
    const plan = snapshot.sources.plan.data!
    const milestone = plan.milestones[0]!
    const lane = milestone.lanes[0]!
    const lanes = [lane, { ...lane, scope: 'Command contributions' }]
    const collect = (declarations: typeof lanes) =>
      collectFixture(
        'project',
        { full: true },
        {
          ...snapshot,
          sources: {
            ...snapshot.sources,
            plan: availableSource('plan', {
              ...plan,
              milestones: [{ ...milestone, lanes: declarations }, ...plan.milestones.slice(1)],
            }),
          },
        },
      )
    const rows = getSection(collect(lanes), 'lanes').rows
    expect(
      rows.filter(
        (row) => row.cells['name']?.type === 'text' && row.cells['name'].value === lane.id,
      ),
    ).toHaveLength(2)
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
    expect(getSection(collect(lanes.toReversed()), 'lanes').rows).toEqual(rows)
  })

  it('puts owner questions, lagging channels and failing default-branch CI first', () => {
    const report = collectFixture('project')
    expect(report.needsYou.rows.map((row) => row.cells['name'])).toEqual([
      { type: 'text', value: 'Q-M12' },
      { type: 'text', value: 'npm' },
      { type: 'text', value: 'Quality' },
    ])
    expect(report.needsYou.rows.map((row) => row.key[0])).toEqual(['0', '1', '2'])
    expect(getSection(report, 'ci').rows).toHaveLength(1)
    expect(getSection(report, 'ci').rows[0]!.cells['scope']).toEqual({
      type: 'text',
      value: 'default-branch',
    })
  })

  it('uses delivery order for the next three ready milestones, never unmerged needs', () => {
    const report = collectFixture('project')
    expect(getSection(report, 'nextSteps').rows.map((row) => row.cells['name'])).toEqual(
      ['M12', 'M14', 'M110a0'].map((value) => ({ type: 'text', value })),
    )
    expect(getSection(report, 'milestones').rows).toHaveLength(3)
    expect(getSection(report, 'lanes').rows[0]!.cells['certification']).toEqual({
      type: 'text',
      value: 'docs/certification/m12-k.md',
    })
    expect(report.sections.map((section) => section.id)).toContain('risks')
    expect(getSection(report, 'totals').rows[0]!.cells['scope']).toEqual({
      type: 'text',
      value: '7d',
    })
  })
  it.each(['14', 'm14'])(
    'selects the ready milestone and its lanes for delivery alias %s',
    (id) => {
      const snapshot = fullSnapshot()
      const plan = snapshot.sources.plan.data!
      const report = collectFixture(
        'project',
        {},
        {
          ...snapshot,
          sources: {
            ...snapshot.sources,
            plan: availableSource('plan', {
              ...plan,
              deliveryOrder: plan.deliveryOrder.map((entry) =>
                entry.id === 'M14' ? { ...entry, id, needs: ['1'] } : entry,
              ),
              milestones: plan.milestones.map((milestone) =>
                milestone.id === 'M14'
                  ? { ...milestone, lanes: [{ ...plan.milestones[0]!.lanes[0]!, id: 'V' }] }
                  : milestone,
              ),
            }),
          },
        },
      )
      expect(getSection(report, 'nextSteps').rows.map((row) => row.cells['name'])).toContainEqual({
        type: 'text',
        value: id,
      })
      expect(getSection(report, 'milestones').rows.map((row) => row.cells['name'])).toContainEqual({
        type: 'text',
        value: 'M14',
      })
      expect(getSection(report, 'lanes').rows.map((row) => row.cells['milestones'])).toContainEqual(
        {
          type: 'text',
          value: 'M14',
        },
      )
    },
  )

  it('keeps every missing source and affected section with its reason', () => {
    const report = collectFixture('project', {}, noSources())
    for (const id of [
      'releases',
      'channels',
      'milestones',
      'lanes',
      'pullRequests',
      'ci',
      'totals',
      'risks',
      'nextSteps',
    ]) {
      expect(
        getSection(report, id).rows.some(
          (row) =>
            row.cells['status']?.type === 'label' && row.cells['status'].value === 'unavailable',
        ),
      ).toBe(true)
    }
    expect(report.sources).toHaveLength(21)
    expect(
      report.sources.every((source) => source.status === 'unavailable' && source.reason !== ''),
    ).toBe(true)
  })

  it('retains next-step identities when earlier delivery work completes', () => {
    const base = fullSnapshot()
    const snapshot = {
      ...base,
      sources: {
        ...base.sources,
        plan: availableSource('plan', {
          ...base.sources.plan.data!,
          deliveryOrder: base.sources.plan.data!.deliveryOrder.map((entry) =>
            entry.id === 'M15' ? { ...entry, needs: ['M999'] } : entry,
          ),
        }),
      },
    }
    const before = getSection(collectFixture('project', {}, snapshot), 'nextSteps')
    const after = getSection(
      collectFixture(
        'project',
        {},
        {
          ...snapshot,
          sources: {
            ...snapshot.sources,
            plan: availableSource('plan', {
              ...snapshot.sources.plan.data!,
              milestones: snapshot.sources.plan.data!.milestones.map((milestone) =>
                milestone.id === 'M12' ? { ...milestone, status: 'merged' } : milestone,
              ),
            }),
          },
        },
      ),
      'nextSteps',
    )
    const match = (rows: typeof before.rows) =>
      rows.find((row) => row.cells['name']?.type === 'text' && row.cells['name'].value === 'M14')!
    expect(match(after.rows).key).toBe(match(before.rows).key)
    expect(after.rows.map((row) => row.cells['name'])).toEqual(
      ['M14', 'M110a0', 'M91b'].map((value) => ({ type: 'text', value })),
    )
  })

  it('needs revision evidence for risks and preserves plan-format drift', () => {
    const snapshot = fullSnapshot()
    const report = createReportCollector({
      finalize: fixtureFinalize,
      nextStepLimit: 3,
      selections: {
        changes: () => unavailableSource('changesRange', 'No ancestry evidence'),
        changeBranches: () => unavailableSource('changeBranches', 'No branch ancestry evidence'),
        risksSinceRelease: () => unavailableSource('risksSinceRelease', 'No revision evidence'),
      },
    })(
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          plan: availableSource('plan', {
            ...snapshot.sources.plan.data!,
            drift: [{ code: 'unknown-status', line: 12, detail: 'New status phrase' }],
          }),
        },
      },
      reportOptions('project'),
    )
    expect(getSection(report, 'risks').rows[0]!.cells['reason']).toEqual({
      type: 'text',
      value: 'No revision evidence',
    })
    expect(getSection(report, 'planFormat').rows[0]!.cells['reason']).toEqual({
      type: 'text',
      value: 'New status phrase',
    })
  })
  it('supports quality-ledger and no-plan projects without guessing milestones', () => {
    const snapshot = fullSnapshot()
    for (const format of ['quality-ledger-v1', 'none'] as const) {
      const report = collectFixture(
        'project',
        {},
        {
          ...snapshot,
          sources: {
            ...snapshot.sources,
            plan: availableSource('plan', {
              ...snapshot.sources.plan.data!,
              format,
              milestones: [],
              deliveryOrder: [],
            }),
          },
        },
      )
      expect(getSection(report, 'milestones').rows).toHaveLength(0)
      expect(getSection(report, 'releases').rows).toHaveLength(2)
      expect(getSection(report, 'ci').rows).toHaveLength(1)
      expect(getSection(report, 'planFormat').rows[0]!.cells['status']).toEqual({
        type: 'label',
        value: format === 'none' ? 'notApplicable' : 'ok',
      })
    }
  })
})

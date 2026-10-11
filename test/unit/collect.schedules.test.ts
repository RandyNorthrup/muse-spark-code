import { describe, expect, it } from 'vitest'
import { schedulesSections, type SchedulesView } from '../../src/core/reporting/collect/schedules'
import { scheduleFireRecordSchema, scheduleV2Schema } from '../../src/shared/scheduleV2'
import { collectFixture, fullSnapshot, getSection } from './helpers/reporting/collect'
import {
  FIXTURE_WORKSPACE_KEY,
  fireFixture,
  scheduleFixture,
} from './helpers/reporting/reportKindFixtures'
import { availableSource, reportOptions } from './helpers/reporting/snapshot'

function schedule(overrides: Record<string, unknown> = {}) {
  return scheduleV2Schema.parse(scheduleFixture(FIXTURE_WORKSPACE_KEY, overrides))
}
function fire(overrides: Record<string, unknown> = {}) {
  return scheduleFireRecordSchema.parse(fireFixture(overrides))
}
// Source pre-rendered prose in the installed language; the collector must
// pass it through unchanged, never rebuild it.
const entry = (
  overrides: Record<string, unknown> = {},
  iso = '1970-01-01T00:00:02.000Z',
): SchedulesView['schedules'][number] => ({
  schedule: schedule(overrides),
  triggerText: 'every 3600000 ms',
  grantText: '0 rules, 0 destinations, cap 0',
  nextFireIso: iso,
})
const view: SchedulesView = {
  schedules: [
    entry(),
    entry({ id: 'sched-2', name: 'Evening build', nextFireAtMs: 2000 }),
    {
      ...entry(
        { id: 'sched-3', name: 'Paused job', paused: true, nextFireAtMs: 3000 },
        '1970-01-01T00:00:03.000Z',
      ),
    },
  ],
  fires: [
    { fire: fire(), scheduleName: 'Morning build', occurrenceIso: '1970-01-01T00:00:01.500Z' },
  ],
}

describe('schedules sections', () => {
  it('builds the five D93.4 sections', () => {
    const sections = schedulesSections(view, reportOptions('schedules'))
    expect(sections.map((section) => [section.id, section.label])).toEqual([
      ['schedules/timeline', 'timeline'],
      ['schedules/schedules', 'schedules'],
      ['schedules/fires', 'fires'],
      ['schedules/refusals', 'refusals'],
      ['schedules/cost', 'cost'],
    ])
  })

  it('flags timeline collisions between schedules sharing a fire time', () => {
    const sections = schedulesSections(view, reportOptions('schedules'))
    const timeline = sections[0]!
    // The paused job shares no timeline: it keeps its stored next-fire time
    // but the scheduler will not fire it.
    expect(timeline.rows).toHaveLength(2)
    const morning = timeline.rows.find(
      (row) => row.cells['name']?.type === 'text' && row.cells['name'].value === 'Morning build',
    )!
    expect(morning.cells['collision']).toEqual({ type: 'textList', value: ['Evening build'] })
    expect(morning.cells['date']).toEqual({
      type: 'timestamp',
      value: '1970-01-01T00:00:02.000Z',
    })
  })

  it('shows triggers, targets, grants, creators and paused state', () => {
    const sections = schedulesSections(view, reportOptions('schedules'))
    const rows = sections[1]!.rows
    expect(rows).toHaveLength(3)
    const byName = (name: string) =>
      rows.find((row) => row.cells['name']?.type === 'text' && row.cells['name'].value === name)!
        .cells
    expect(byName('Morning build')).toMatchObject({
      trigger: { type: 'text', value: 'every 3600000 ms' },
      target: { type: 'text', value: 'newConversation:modelApi' },
      delivery: { type: 'text', value: 'newConversation' },
      grant: { type: 'text', value: '0 rules, 0 destinations, cap 0' },
      creator: { type: 'label', value: 'user' },
      status: { type: 'label', value: 'active' },
    })
    expect(byName('Paused job')['status']).toEqual({ type: 'label', value: 'paused' })
  })

  it('keeps a paused schedule out of the timeline and collision lists', () => {
    const pausedAtSameTime: SchedulesView = {
      ...view,
      schedules: [
        entry(),
        entry({ id: 'sched-9', name: 'Paused twin', paused: true, nextFireAtMs: 2000 }),
      ],
      fires: [],
    }
    const sections = schedulesSections(pausedAtSameTime, reportOptions('schedules'))
    const timeline = sections[0]!
    expect(timeline.rows).toHaveLength(1)
    expect(timeline.rows[0]!.cells['collision']).toEqual({ type: 'text', value: '' })
    // The paused twin stays visible in the schedules table, never dropped.
    expect(sections[1]!.rows).toHaveLength(2)
  })

  it('lists refused fires with their refused actions and summed cost', () => {
    const sections = schedulesSections(view, reportOptions('schedules'))
    const refusals = sections[3]!
    expect(refusals.rows).toHaveLength(2)
    // Rows sort by stable key, not by insertion: compare as sets.
    expect(refusals.rows.map((row) => row.cells['action'])).toEqual(
      expect.arrayContaining([
        { type: 'text', value: '' },
        { type: 'text', value: 'shell:exec' },
      ]),
    )
    const cost = sections[4]!
    expect(cost.rows).toHaveLength(2)
    const costByName = (name: string) =>
      cost.rows.find(
        (row) => row.cells['name']?.type === 'text' && row.cells['name'].value === name,
      )!.cells
    expect(costByName('Morning build')).toMatchObject({
      cost: { type: 'usd', value: '1.25', certainty: 'estimated' },
      certainty: { type: 'label', value: 'estimated' },
    })
    // The total over one observed fire repeats its cost, never an invented zero.
    const total = cost.rows.find(
      (row) => row.cells['name']?.type === 'label' && row.cells['name'].value === 'total',
    )!.cells
    expect(total).toMatchObject({
      cost: { type: 'usd', value: '1.25', certainty: 'estimated' },
    })
  })

  it('reports no total and empty fire sections before the first delivery', () => {
    const sections = schedulesSections(
      { schedules: view.schedules, fires: [] },
      reportOptions('schedules'),
    )
    expect(sections[2]!.rows).toHaveLength(0)
    expect(sections[3]!.rows).toHaveLength(0)
    expect(sections[4]!.rows).toHaveLength(0)
  })

  it('forwards through the collector with status columns', () => {
    const options = reportOptions('schedules')
    const snapshot = fullSnapshot()
    const report = collectFixture(
      'schedules',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          schedules: availableSource('schedules', schedulesSections(view, options)),
        },
      },
    )
    const timeline = getSection(report, 'schedules/timeline')
    expect(timeline.columns.map((column) => column.key)).toEqual([
      'name',
      'date',
      'collision',
      'status',
      'reason',
    ])
    // The paused schedule has no timeline row: only the two live ones forward.
    expect(timeline.rows).toHaveLength(2)
  })
})

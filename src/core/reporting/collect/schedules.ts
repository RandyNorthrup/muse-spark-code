// Schedules report sections (M113 C-M113-4, PLAN.md D93.4 schedules row).
// Pure view-model to sections: the source validates and scrubs the store and
// fire record, then projects these facts; this module only builds stable
// rows. Until delivery is registered (CM1151) no v2 fire exists, so the fire
// sections stay honestly empty. Dates arrive pre-rendered because collectors
// never touch the clock.
import { sumUsd } from '../../../shared/usd'
import type { ReportOptions, ReportSection, ReportValue } from '../../../shared/reportSchema'
import type { ScheduleFireRecord, ScheduleV2 } from '../../../shared/scheduleV2'
import { label, list, row, section, text } from './common'

export interface SchedulesScheduleView {
  readonly schedule: ScheduleV2
  // Pre-rendered by the source in the installed language, like dates:
  // collectors read only the injected view, never the text table.
  readonly triggerText: string
  readonly targetText: string
  readonly deliveryText: string
  // The agent creator's translated label with its technical id spliced
  // after it; `undefined` for a user creator, which reads as the `user`
  // label instead.
  readonly creatorText: string | undefined
  readonly grantText: string
  readonly nextFireIso: string | undefined
}
export interface SchedulesFireView {
  readonly fire: ScheduleFireRecord
  readonly scheduleName: string
  readonly occurrenceIso: string | undefined
}
export interface SchedulesView {
  readonly schedules: readonly SchedulesScheduleView[]
  readonly fires: readonly SchedulesFireView[]
}

function dateCell(ms: number, iso: string | undefined): ReportValue {
  return iso === undefined ? text(String(ms)) : { type: 'timestamp', value: iso }
}

function triggerCell(entry: SchedulesScheduleView): ReportValue {
  // A parameterless `once` is a label; every other trigger arrives
  // pre-rendered by the source, like dates.
  return entry.schedule.trigger.kind === 'once' ? label('once') : text(entry.triggerText)
}

function creatorCell(entry: SchedulesScheduleView): ReportValue {
  // A user creator is a label; an agent id is technical detail spliced
  // after its translated label, pre-rendered by the source like dates.
  return entry.schedule.creator.kind === 'user' ? label('user') : text(entry.creatorText ?? '')
}

function certaintyLabel(certainty: ScheduleFireRecord['cost']['certainty']): ReportValue {
  // The report value vocabulary (reported/estimated/unknown) carries the
  // settlement vocabulary (exact/estimated/unknown); exact is reported.
  return { type: 'label', value: certainty === 'exact' ? 'reported' : certainty }
}

/** The honest lifecycle word for a schedule row. `nowMs` is the report's own
 * request stamp (`options.asOf`), never the clock, so the pure collector
 * stays deterministic. Paused wins over ended: a paused schedule that also
 * reached its end is still switched off, not due. */
function scheduleStatus(
  schedule: ScheduleV2,
  nowMs: number,
): 'paused' | 'ended' | 'complete' | 'active' {
  const isEnded =
    (schedule.end?.afterRuns !== undefined && schedule.fireCount >= schedule.end.afterRuns) ||
    (schedule.end?.atMs !== undefined && nowMs >= schedule.end.atMs)
  // The store drops the next-fire time when a time-advancing fire is
  // admitted, so a one-shot schedule with no next fire already fired.
  const isFiredOnce = schedule.trigger.kind === 'once' && schedule.nextFireAtMs === undefined
  switch (true) {
    case schedule.paused: {
      return 'paused'
    }
    case isEnded: {
      return 'ended'
    }
    case isFiredOnce: {
      return 'complete'
    }
    default: {
      return 'active'
    }
  }
}

export function schedulesSections(view: SchedulesView, options: ReportOptions): ReportSection[] {
  const nowMs = Date.parse(options.asOf)
  // The timeline is upcoming fires. A paused schedule keeps its stored
  // next-fire time but the scheduler will not fire it (`canRun` is false
  // while paused), so listing it would promise a fire that never comes. The
  // same holds for a schedule that reached its end (`canRun` is false once
  // `fireCount` meets `afterRuns` or `now` meets `end.atMs`) and for an
  // event trigger (the scheduler only fires those on events, never at the
  // stored time). Each stays in the schedules table with its honest status,
  // never silently dropped, and stays out of other schedules' collision
  // lists.
  const upcoming = view.schedules.filter(
    (entry): entry is SchedulesScheduleView & { schedule: ScheduleV2 & { nextFireAtMs: number } } =>
      entry.schedule.nextFireAtMs !== undefined &&
      entry.schedule.trigger.kind !== 'event' &&
      entry.schedule.trigger.kind !== 'afterEvent' &&
      scheduleStatus(entry.schedule, nowMs) === 'active',
  )
  const timeline = upcoming.map((entry) => {
    const atMs = entry.schedule.nextFireAtMs
    const colliding = upcoming
      .filter(
        (other) => other.schedule.nextFireAtMs === atMs && other.schedule.id !== entry.schedule.id,
      )
      .map((other) => other.schedule.name)
    return row(
      'fire',
      [entry.schedule.id, String(atMs)],
      {
        name: text(entry.schedule.name),
        date: dateCell(atMs, entry.nextFireIso),
        collision: colliding.length > 0 ? list(colliding) : text(''),
      },
      ['schedules'],
    )
  })
  const schedules = view.schedules.map((entry) => {
    const schedule = entry.schedule
    return row(
      'schedule',
      [schedule.id],
      {
        name: text(schedule.name),
        trigger: triggerCell(entry),
        target: text(entry.targetText),
        delivery: text(entry.deliveryText),
        grant: text(entry.grantText),
        creator: creatorCell(entry),
        status: label(scheduleStatus(schedule, nowMs)),
      },
      ['schedules'],
    )
  })
  const fires = view.fires.map((entry) =>
    row(
      'fire',
      [entry.fire.scheduleId, entry.fire.runId],
      {
        name: text(entry.scheduleName),
        run: text(entry.fire.runId),
        outcome: text(entry.fire.outcome),
        reason: text(entry.fire.reason ?? ''),
        date: dateCell(entry.fire.occurrenceMs, entry.occurrenceIso),
      },
      ['schedules'],
    ),
  )
  const refusals = view.fires.flatMap((entry) =>
    entry.fire.outcome === 'refused'
      ? [
          row(
            'refusal',
            [entry.fire.scheduleId, entry.fire.runId, 'fire'],
            {
              name: text(entry.scheduleName),
              action: text(''),
              reason: text(entry.fire.reason ?? ''),
              date: dateCell(entry.fire.occurrenceMs, entry.occurrenceIso),
            },
            ['schedules'],
          ),
          ...entry.fire.refusedActions.map((action) =>
            row(
              'refusal',
              [entry.fire.scheduleId, entry.fire.runId, action.actionClass, action.tool],
              {
                name: text(entry.scheduleName),
                action: text(`${action.actionClass}:${action.tool}`),
                reason: text(action.reason),
                date: dateCell(entry.fire.occurrenceMs, entry.occurrenceIso),
              },
              ['schedules'],
            ),
          ),
        ]
      : [],
  )
  const costs = view.fires.map((entry) =>
    row(
      'cost',
      [entry.fire.scheduleId, entry.fire.runId],
      {
        name: text(entry.scheduleName),
        cost: {
          type: 'usd',
          value: entry.fire.cost.usd,
          certainty: entry.fire.cost.certainty === 'exact' ? 'reported' : entry.fire.cost.certainty,
        },
        retained: {
          type: 'usd',
          value: entry.fire.cost.retainedLiabilityUsd,
          certainty: entry.fire.cost.certainty === 'exact' ? 'reported' : entry.fire.cost.certainty,
        },
        certainty: certaintyLabel(entry.fire.cost.certainty),
      },
      ['schedules'],
    ),
  )
  // A total over no observed fire would be an invented zero, so it appears
  // only with fires; its certainty is the weakest one summed.
  const firstFire = view.fires[0]
  if (firstFire !== undefined) {
    const rank = { reported: 0, estimated: 1, unknown: 2 } as const
    const certainties = view.fires.map((entry) =>
      entry.fire.cost.certainty === 'exact' ? 'reported' : entry.fire.cost.certainty,
    )
    const worst = certainties.toSorted((left, right) => rank[right] - rank[left])[0] ?? 'reported'
    const certainty = worst === 'reported' ? 'exact' : worst
    costs.push(
      row(
        'cost',
        ['total'],
        {
          name: label('total'),
          cost: {
            type: 'usd',
            value: sumUsd(...view.fires.map((entry) => entry.fire.cost.usd)),
            certainty: worst,
          },
          retained: {
            type: 'usd',
            value: sumUsd(...view.fires.map((entry) => entry.fire.cost.retainedLiabilityUsd)),
            certainty: worst,
          },
          certainty: certaintyLabel(certainty),
        },
        ['schedules'],
      ),
    )
  }
  return [
    section(
      'schedules/timeline',
      'timeline',
      [
        { key: 'name', label: 'name' },
        { key: 'date', label: 'date' },
        { key: 'collision', label: 'conflicts' },
      ],
      timeline,
      options,
    ),
    section(
      'schedules/schedules',
      'schedules',
      [
        { key: 'name', label: 'name' },
        { key: 'trigger', label: 'kind' },
        { key: 'target', label: 'scope' },
        { key: 'delivery', label: 'kind' },
        { key: 'grant', label: 'grants' },
        { key: 'creator', label: 'name' },
        { key: 'status', label: 'status' },
      ],
      schedules,
      options,
    ),
    section(
      'schedules/fires',
      'fires',
      [
        { key: 'name', label: 'name' },
        { key: 'run', label: 'name' },
        { key: 'outcome', label: 'outcome' },
        { key: 'reason', label: 'reason' },
        { key: 'date', label: 'date' },
      ],
      fires,
      options,
    ),
    section(
      'schedules/refusals',
      'refusals',
      [
        { key: 'name', label: 'name' },
        { key: 'action', label: 'kind' },
        { key: 'reason', label: 'reason' },
        { key: 'date', label: 'date' },
      ],
      refusals,
      options,
    ),
    section(
      'schedules/cost',
      'cost',
      [
        { key: 'name', label: 'name' },
        { key: 'cost', label: 'cost' },
        { key: 'retained', label: 'cost' },
        { key: 'certainty', label: 'certainty' },
      ],
      costs,
      options,
    ),
  ]
}

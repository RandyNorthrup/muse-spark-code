import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import type { PlanFacts, PlanMilestone, SourceSnapshot } from '../sources/types'
import {
  certificationRows,
  compare,
  count,
  label,
  list,
  row,
  isSameMilestone,
  sourcedSection,
  text,
} from './common'

export class ReportScopeNotFound extends Error {
  readonly code = 'notFound'
  constructor(
    readonly scope: string,
    readonly nearestIds: readonly string[],
  ) {
    super('report/notFound')
    this.name = 'ReportScopeNotFound'
  }
}

function distance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const leftIndices = Array.from({ length: left.length }, (_, index) => index)
  const rightIndices = Array.from({ length: right.length }, (_, index) => index)
  for (const index of leftIndices) {
    const current = [index + 1]
    for (const other of rightIndices) {
      current.push(
        Math.min(
          (current[other] ?? 0) + 1,
          (previous[other + 1] ?? 0) + 1,
          (previous[other] ?? 0) + (left[index] === right[other] ? 0 : 1),
        ),
      )
    }
    previous = current
  }
  return previous.at(-1) ?? 0
}

export function findMilestone(facts: PlanFacts, scope: string): PlanMilestone {
  const found = facts.milestones.find((milestone) => isSameMilestone(milestone.id, scope))
  if (found !== undefined) return found
  const normalized = scope.replace(/^m(?=\d)/i, '').toUpperCase()
  const nearest = facts.milestones
    .map((milestone) => milestone.id)
    .toSorted((left, right) => {
      const leftId = left.replace(/^m(?=\d)/i, '').toUpperCase()
      const rightId = right.replace(/^m(?=\d)/i, '').toUpperCase()
      return distance(normalized, leftId) - distance(normalized, rightId) || compare(left, right)
    })
  throw new ReportScopeNotFound(scope, nearest)
}

export function planFormat(snapshot: SourceSnapshot, options: ReportOptions): ReportSection {
  const source = snapshot.sources.plan
  const formatRows =
    source.data === null
      ? []
      : [
          row(
            'format',
            [source.data.format],
            {
              name: text(source.data.format),
              count: label('unknown'),
              status: label(source.data.format === 'none' ? 'notApplicable' : 'ok'),
              reason: text(source.data.format === 'none' ? 'PlanFacts.format=none' : ''),
            },
            [source.record.id],
          ),
        ]
  return sourcedSection(
    snapshot,
    options,
    'planFormat',
    'planFormat',
    ['name', 'count', 'reason'],
    [
      ...formatRows,
      ...(source.data?.drift.map((drift) =>
        row(
          'drift',
          [drift.code, String(drift.line), drift.detail],
          {
            name: text(drift.code),
            count: count(drift.line),
            reason: text(drift.detail),
            status: label('partial'),
          },
          [source.record.id],
        ),
      ) ?? []),
    ],
    ['plan'],
  )
}

export function laneRows(milestones: readonly PlanMilestone[], sourceId: string): ReportRow[] {
  return milestones.flatMap((milestone) =>
    milestone.lanes.map((lane) =>
      row(
        'lane',
        [milestone.id, lane.id],
        {
          name: text(lane.id),
          scope: text(lane.scope),
          milestones: text(milestone.id),
          branch: lane.branch === null ? label('unavailable') : text(lane.branch),
          status: label(lane.state),
          pullRequests: lane.pullRequest === null ? label('unavailable') : count(lane.pullRequest),
          certification:
            lane.certification === null
              ? label('unavailable')
              : text(lane.certification.replaceAll('\\', '/')),
        },
        [sourceId],
      ),
    ),
  )
}

export const LANE_COLUMNS = [
  'name',
  'scope',
  'milestones',
  'branch',
  'pullRequests',
  'certification',
] as const

export function nextSteps(
  facts: PlanFacts,
  limit: number,
): readonly { readonly id: string; readonly reason: string; readonly needs: readonly string[] }[] {
  const isComplete = (id: string) =>
    facts.milestones.some(
      (milestone) =>
        isSameMilestone(milestone.id, id) &&
        ['merged', 'released', 'complete', 'superseded'].includes(milestone.status),
    )
  return facts.deliveryOrder
    .filter((entry) => !isComplete(entry.id) && entry.needs.every((id) => isComplete(id)))
    .slice(0, limit)
}

export function deliveryRows(facts: PlanFacts, limit: number, sourceId: string): ReportRow[] {
  return nextSteps(facts, limit).map((entry) =>
    row(
      // The plan's declared priority persists when earlier work completes;
      // the filtered display position must never become the fact's identity.
      `step-${String(facts.deliveryOrder.indexOf(entry)).padStart(String(Number.MAX_SAFE_INTEGER).length, '0')}`,
      [entry.id],
      { name: text(entry.id), reason: text(entry.reason), dependencies: list(entry.needs) },
      [sourceId],
    ),
  )
}

export function collectMilestone(
  snapshot: SourceSnapshot,
  options: ReportOptions,
): ReportSection[] {
  const source = snapshot.sources.plan
  const facts = source.data
  const milestone = facts === null ? undefined : findMilestone(facts, options.scope)
  const ids = [source.record.id]
  const headings: Readonly<Record<string, Parameters<typeof sourcedSection>[3]>> = {
    checklist: 'certification',
    certificationSummary: 'certification',
    gateDeclarations: 'gates',
    milestoneQuestions: 'questions',
    milestoneRisks: 'risks',
    milestoneResiduals: 'residuals',
    milestoneStatus: 'status',
    milestoneGoal: 'goal',
    milestoneDependencies: 'dependencies',
  }
  const make = (
    id: string,
    columns: Parameters<typeof sourcedSection>[4],
    rows: readonly ReportRow[],
  ) => sourcedSection(snapshot, options, id, headings[id] ?? 'lanes', columns, rows, ['plan'])
  const sections = [
    make(
      'milestoneStatus',
      ['name', 'date'],
      milestone === undefined
        ? []
        : [
            row(
              'milestone',
              [milestone.id],
              {
                name: text(milestone.title),
                date: text(milestone.date),
                status: label(milestone.status),
              },
              ids,
            ),
          ],
    ),
    make(
      'milestoneGoal',
      ['goal'],
      milestone === undefined
        ? []
        : [row('goal', [milestone.id], { goal: text(milestone.goal) }, ids)],
    ),
    make(
      'milestoneDependencies',
      ['name'],
      milestone?.dependencies.map((id) => {
        const dependency = facts?.milestones.find((entry) => isSameMilestone(entry.id, id))
        return row(
          'dependency',
          [id],
          {
            name: text(id),
            status: label(dependency === undefined ? 'unavailable' : dependency.status),
          },
          ids,
        )
      }) ?? [],
    ),
    make(
      'milestoneLanes',
      LANE_COLUMNS,
      laneRows(milestone === undefined ? [] : [milestone], source.record.id),
    ),
    make(
      'certificationSummary',
      ['count', 'totals'],
      milestone === undefined
        ? []
        : [
            row(
              'checklist',
              [milestone.id],
              {
                count: count(milestone.checklist.filter((item) => item.done).length),
                totals: count(milestone.checklist.length),
              },
              ids,
            ),
          ],
    ),
    make(
      'checklist',
      ['name', 'outcome'],
      milestone?.checklist.map((item) =>
        row(
          'item',
          [item.text],
          {
            name: text(item.text),
            outcome: label(item.done ? 'complete' : 'open'),
          },
          ids,
        ),
      ) ?? [],
    ),
    make(
      'gateDeclarations',
      ['name'],
      milestone?.requiredGates.map((gate) => row('gate', [gate], { name: text(gate) }, ids)) ?? [],
    ),
    make(
      'milestoneRisks',
      ['name', 'reason'],
      facts?.risks
        .filter((risk) => risk.milestoneIds.some((id) => isSameMilestone(id, options.scope)))
        .map((risk) =>
          row('risk', [risk.id], { name: text(risk.id), reason: text(risk.text) }, ids),
        ) ?? [],
    ),
    make(
      'milestoneResiduals',
      ['name', 'reason'],
      facts?.residuals.map((residual) =>
        row(
          'residual',
          [residual.id],
          { name: text(residual.id), reason: text(residual.text) },
          ids,
        ),
      ) ?? [],
    ),
    make(
      'milestoneQuestions',
      ['name', 'questions'],
      facts?.questions
        .filter((question) =>
          question.milestoneIds.some((id) => isSameMilestone(id, options.scope)),
        )
        .map((question) =>
          row(
            'question',
            [question.id],
            {
              name: text(question.id),
              questions: text(question.text),
              status: label(question.state),
            },
            ids,
          ),
        ) ?? [],
    ),
  ]
  const certification = snapshot.sources.certification
  sections.push(
    sourcedSection(
      snapshot,
      options,
      'certificationRecords',
      'certification',
      ['milestones', 'files', 'count', 'totals'],
      certificationRows(
        certification.data?.records.filter((record) =>
          isSameMilestone(record.milestoneId, options.scope),
        ) ?? [],
        certification.record.id,
      ),
      ['certification'],
    ),
  )
  return sections
}

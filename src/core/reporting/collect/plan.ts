import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import type { PlanFacts, PlanMilestone, ReportQuestion, SourceSnapshot } from '../sources/types'
import {
  certificationRows,
  compare,
  count,
  label,
  list,
  planItemIdentities,
  row,
  isSameMilestone,
  normalizeMilestone,
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
  const normalized = normalizeMilestone(scope)
  const nearest = facts.milestones
    .map((milestone) => milestone.id)
    .toSorted((left, right) => {
      const leftId = normalizeMilestone(left)
      const rightId = normalizeMilestone(right)
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
  const entries = milestones.flatMap((milestone) =>
    milestone.lanes.map((lane) => ({ milestone, lane })),
  )
  // Separate declaration tables can reuse an owner id for distinct scopes;
  // a repeated triple still gets a unique key (RVCM1132D finding 1).
  const identities = planItemIdentities(
    entries.map(({ milestone, lane }) => ({
      identity: [milestone.id, lane.id, lane.scope],
      text: JSON.stringify([lane.branch, lane.state, lane.pullRequest, lane.certification]),
    })),
  )
  return entries.map(({ milestone, lane }, index) =>
    row(
      'lane',
      identities[index] ?? [milestone.id, lane.id, lane.scope],
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

/** Risk rows with duplicate-safe keys, shared by the milestone and project kinds. */
export function planRiskRows(risks: PlanFacts['risks'], sourceIds: readonly string[]): ReportRow[] {
  const identities = planItemIdentities(
    risks.map((risk) => ({ identity: [risk.id], text: risk.text })),
  )
  return risks.map((risk, index) =>
    row(
      'risk',
      identities[index] ?? [risk.id],
      { name: text(risk.id), reason: text(risk.text) },
      sourceIds,
    ),
  )
}

/** Residual rows with duplicate-safe keys, shared by the milestone and project kinds. */
export function planResidualRows(
  residuals: PlanFacts['residuals'],
  sourceIds: readonly string[],
): ReportRow[] {
  const identities = planItemIdentities(
    residuals.map((residual) => ({ identity: [residual.id], text: residual.text })),
  )
  return residuals.map((residual, index) =>
    row(
      'residual',
      identities[index] ?? [residual.id],
      { name: text(residual.id), reason: text(residual.text) },
      sourceIds,
    ),
  )
}

/** Question rows with duplicate-safe keys, shared by the milestone and session kinds. */
export function planQuestionRows(
  questions: readonly ReportQuestion[],
  sourceIds: readonly string[],
): ReportRow[] {
  const identities = planItemIdentities(
    questions.map((question) => ({ identity: [question.id], text: question.text })),
  )
  return questions.map((question, index) =>
    row(
      'question',
      identities[index] ?? [question.id],
      {
        name: text(question.id),
        questions: text(question.text),
        status: label(question.state),
      },
      sourceIds,
    ),
  )
}

function milestoneRiskRows(
  facts: PlanFacts | null,
  scope: string,
  sourceIds: readonly string[],
): ReportRow[] {
  return facts === null
    ? []
    : planRiskRows(
        facts.risks.filter((risk) => risk.milestoneIds.some((id) => isSameMilestone(id, scope))),
        sourceIds,
      )
}

function milestoneResidualRows(facts: PlanFacts | null, sourceIds: readonly string[]): ReportRow[] {
  return facts === null ? [] : planResidualRows(facts.residuals, sourceIds)
}

function milestoneQuestionRows(
  facts: PlanFacts | null,
  scope: string,
  sourceIds: readonly string[],
): ReportRow[] {
  return facts === null
    ? []
    : planQuestionRows(
        facts.questions.filter((question) =>
          question.milestoneIds.some((id) => isSameMilestone(id, scope)),
        ),
        sourceIds,
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
  const occurrences = new Map<string, number>()
  const checklist =
    milestone?.checklist
      .toSorted(
        (left, right) => compare(left.text, right.text) || Number(left.done) - Number(right.done),
      )
      .map((item) => {
        // An ordinal within equal text keeps duplicates unique and reordering deterministic.
        const ordinal = occurrences.get(item.text) ?? 0
        occurrences.set(item.text, ordinal + 1)
        return row(
          'item',
          ordinal === 0 ? [item.text] : [item.text, String(ordinal)],
          { name: text(item.text), outcome: label(item.done ? 'complete' : 'open') },
          ids,
        )
      }) ?? []
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
    make('checklist', ['name', 'outcome'], checklist),
    make(
      'gateDeclarations',
      ['name'],
      milestone?.requiredGates.map((gate) => row('gate', [gate], { name: text(gate) }, ids)) ?? [],
    ),
    make('milestoneRisks', ['name', 'reason'], milestoneRiskRows(facts, options.scope, ids)),
    make('milestoneResiduals', ['name', 'reason'], milestoneResidualRows(facts, ids)),
    make(
      'milestoneQuestions',
      ['name', 'questions'],
      milestoneQuestionRows(facts, options.scope, ids),
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

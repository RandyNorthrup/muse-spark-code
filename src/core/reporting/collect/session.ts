import { diffTally } from '../../../shared/diffTally'
import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import type { SourceSnapshot } from '../sources/types'
import { CHECK_COLUMNS, checkRows, count, label, row, sourcedSection, text } from './common'
import { usageSections } from './usage'

export function collectSession(snapshot: SourceSnapshot, options: ReportOptions): ReportSection[] {
  const source = snapshot.sources.session
  const facts = source.data
  const ids = [source.record.id]
  const make = (
    id: string,
    heading: Parameters<typeof sourcedSection>[3],
    columns: Parameters<typeof sourcedSection>[4],
    rows: readonly ReportRow[],
  ) => sourcedSection(snapshot, options, id, heading, columns, rows, ['session'])
  const activity = facts?.activity
  const tools = new Map<string, { tool: string; outcome: string; count: number }>()
  const paid = new Map<string, number>()
  const transcript = facts?.export.transcript ?? []
  for (const item of transcript) {
    if (item.kind !== 'toolCall') continue
    if (item.tool !== undefined) {
      const identity = JSON.stringify([item.tool, item.status])
      const group = tools.get(identity) ?? { tool: item.tool, outcome: item.status, count: 0 }
      group.count += 1
      tools.set(identity, group)
    }
    if (item.paid !== undefined) paid.set(item.paid, (paid.get(item.paid) ?? 0) + 1)
  }
  const tally = facts === null ? undefined : diffTally(facts.export.transcript)
  const questions = snapshot.sources.questions
  let approvalRows: ReportRow[] = []
  if (activity?.approvals.status === 'unavailable') {
    approvalRows = [
      row(
        'approvals',
        ['approvals'],
        {
          kind: label('unavailable'),
          count: label('unknown'),
          status: label('unavailable'),
          reason: text(activity.approvals.reason),
        },
        ids,
      ),
    ]
  } else if (activity?.approvals.status === 'available') {
    const { status: _status, ...counts } = activity.approvals
    approvalRows = Object.entries(counts).map(([decision, value]) =>
      row('approval', [decision], { kind: text(decision), count: count(value) }, ids),
    )
  }
  return [
    make(
      'sessionModel',
      'model',
      ['model', 'backend'],
      facts === null
        ? []
        : [
            row(
              'model',
              [facts.export.modelId, facts.backend],
              { model: text(facts.export.modelId), backend: text(facts.backend) },
              ids,
            ),
          ],
    ),
    make(
      'turns',
      'turns',
      ['count'],
      activity === undefined
        ? []
        : [
            row(
              'turns',
              ['turns'],
              activity.turns.status === 'available'
                ? { count: count(activity.turns.count) }
                : {
                    count: label('unavailable'),
                    status: label('unavailable'),
                    reason: text(activity.turns.reason),
                  },
              ids,
            ),
          ],
    ),
    ...usageSections(snapshot, options, 'session', 'session'),
    make(
      'tools',
      'tools',
      ['tool', 'outcome', 'count'],
      Array.from(tools, ([, group]) => group).map((group) =>
        row(
          'tool',
          [group.tool, group.outcome],
          { tool: text(group.tool), outcome: text(group.outcome), count: count(group.count) },
          ids,
        ),
      ),
    ),
    make(
      'files',
      'files',
      ['files', 'added', 'removed'],
      facts === null
        ? []
        : [
            row(
              'files',
              ['files'],
              tally === undefined
                ? {
                    files: label('unavailable'),
                    added: label('unknown'),
                    removed: label('unknown'),
                    status: label('unavailable'),
                    reason: text('patchSummary=undefined'),
                  }
                : {
                    files: count(tally.files),
                    added: count(tally.added),
                    removed: count(tally.removed),
                  },
              ids,
            ),
          ],
    ),
    make('approvals', 'approvals', ['kind', 'count'], approvalRows),
    sourcedSection(
      snapshot,
      options,
      'questions',
      'questions',
      ['name', 'questions'],
      questions.data?.map((question) =>
        row(
          'question',
          [question.id],
          {
            name: text(question.id),
            questions: text(question.text),
            status: label(question.state),
          },
          [questions.record.id],
        ),
      ) ?? [],
      ['questions'],
    ),
    make('checks', 'checks', CHECK_COLUMNS, checkRows(facts?.checkRuns ?? [], source.record.id)),
    make(
      'paidUses',
      'paidUses',
      ['kind', 'count'],
      [...paid].map(([kind, uses]) =>
        row('paid', [kind], { kind: text(kind), count: count(uses) }, ids),
      ),
    ),
  ]
}

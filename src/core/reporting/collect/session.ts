import { diffTally } from '../../../shared/diffTally'
import { FILE_EDIT_TOOLS } from '../../../shared/constants'
import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import type { SourceSnapshot } from '../sources/types'
import { CHECK_COLUMNS, checkRows, count, label, row, sourcedSection, text } from './common'
import { planQuestionRows } from './plan'
import { usageSections } from './usage'

export function collectSession(snapshot: SourceSnapshot, options: ReportOptions): ReportSection[] {
  const source = snapshot.sources.session
  const facts = source.data
  const ids = [source.record.id]
  // Checks run are the workspace journal's own rows, read and scrubbed once by
  // its source; the embedded session runs cover only a source that cannot
  // read. Both the rows and the section cite whichever source supplied them.
  const checkSource = snapshot.sources.checkRuns
  const checks = checkSource.data ?? facts?.checkRuns ?? []
  const checkSourceId = checkSource.data === null ? source.record.id : checkSource.record.id
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
  const isMissingEditSummary = transcript.some(
    (item) =>
      item.kind === 'toolCall' &&
      item.tool !== undefined &&
      FILE_EDIT_TOOLS.has(item.tool) &&
      item.patchSummary === undefined,
  )
  const tally =
    facts === null || isMissingEditSummary
      ? undefined
      : (diffTally(transcript) ??
        (source.record.status === 'ok' ? { files: 0, added: 0, removed: 0 } : undefined))
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
      // The registry schema requires unique ids; a repeated id still gets a
      // unique row key from the central section guarantee.
      planQuestionRows(questions.data ?? [], [questions.record.id]),
      ['questions'],
    ),
    sourcedSection(
      snapshot,
      options,
      'checks',
      'checks',
      CHECK_COLUMNS,
      checkRows(checks, checkSourceId),
      ['session', 'checkRuns'],
    ),
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

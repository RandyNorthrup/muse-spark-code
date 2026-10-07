import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import type { SourceSnapshot } from '../sources/types'
import { label, row, section, isSameMilestone, text } from './common'
import { channelRows, latestVersion } from './repository'

export function needsYou(snapshot: SourceSnapshot, options: ReportOptions): ReportSection {
  const rows: ReportRow[] = []
  const plan = snapshot.sources.plan
  const planQuestions = plan.data?.questions ?? []
  for (const question of planQuestions) {
    if (
      question.state !== 'open' ||
      (options.kind === 'milestone' &&
        question.milestoneIds.every((id) => !isSameMilestone(id, options.scope)))
    )
      continue
    rows.push(
      row(
        '0-question',
        [question.id],
        { name: text(question.id), reason: text(question.text), status: label('open') },
        [plan.record.id],
      ),
    )
  }
  if (options.kind === 'session') {
    const questions = snapshot.sources.questions
    const sessionQuestions = questions.data ?? []
    for (const question of sessionQuestions) {
      if (question.state !== 'open') continue
      rows.push(
        row(
          '0-session-question',
          [question.id],
          { name: text(question.id), reason: text(question.text), status: label('open') },
          [questions.record.id],
        ),
      )
    }
  }
  const channels = channelRows(snapshot, latestVersion(snapshot))
  for (const channel of channels) {
    if (channel.cells['status']?.type !== 'label' || channel.cells['status'].value === 'current')
      continue
    rows.push({
      key: `1-${channel.key}`,
      cells: {
        name: channel.cells['name'] ?? text(''),
        reason: channel.cells['reason'] ?? text(''),
        status: channel.cells['status'],
      },
      sourceIds: channel.sourceIds,
    })
  }
  const github = snapshot.sources.github
  const runs = github.data?.runs ?? []
  for (const run of runs) {
    if (run.ref.kind !== 'default-branch' || run.conclusion !== 'failure') continue
    rows.push(
      row(
        '2-ci',
        [run.ref.name, run.sha, run.workflow, run.url],
        { name: text(run.workflow), reason: text(run.url), status: label('failed') },
        [github.record.id],
      ),
    )
  }
  return section('needsYou', 'needsYou', ['name', 'reason', 'status'], rows, options)
}

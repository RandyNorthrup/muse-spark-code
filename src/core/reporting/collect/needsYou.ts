import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import type { SourceSnapshot } from '../sources/types'
import { label, row, section, isSameMilestone, text } from './common'
import { channelRows, latestVersion } from './repository'

export function needsYou(snapshot: SourceSnapshot, options: ReportOptions): ReportSection {
  const rows: ReportRow[] = []
  const plan = snapshot.sources.plan
  const planQuestions = plan.data?.questions ?? []
  // Row keys must stay unique or document validation throws the whole
  // report away: entries sharing an open-question id are read in full (id
  // and text) and byte-identical copies collapse to one row. Each
  // duplicated open id is then named once as a plan problem, reading only
  // the reader's own drift entries, so this collector stays locale-free
  // (RVCM1132C finding 2).
  const openPlan = planQuestions.filter(
    (question) =>
      question.state === 'open' &&
      !(
        options.kind === 'milestone' &&
        question.milestoneIds.every((id) => !isSameMilestone(id, options.scope))
      ),
  )
  const planCounts = new Map<string, number>()
  for (const question of openPlan)
    planCounts.set(question.id, (planCounts.get(question.id) ?? 0) + 1)
  const seenPlan = new Set<string>()
  for (const question of openPlan) {
    const isDuplicated = (planCounts.get(question.id) ?? 1) > 1
    const fingerprint = `${question.id} ${question.text}`
    if (isDuplicated && seenPlan.has(fingerprint)) continue
    seenPlan.add(fingerprint)
    rows.push(
      row(
        '0-question',
        isDuplicated ? [question.id, question.text] : [question.id],
        { name: text(question.id), reason: text(question.text), status: label('open') },
        [plan.record.id],
      ),
    )
  }
  const openIds = new Set(openPlan.map((question) => question.id))
  const planDrift = plan.data?.drift ?? []
  const namedDuplicates = new Set<string>()
  for (const entry of planDrift) {
    if (
      entry.code !== 'question-duplicate' ||
      !openIds.has(entry.detail) ||
      namedDuplicates.has(entry.detail)
    )
      continue
    namedDuplicates.add(entry.detail)
    rows.push(
      row(
        '0-question-duplicate',
        [entry.detail],
        { name: text(entry.code), reason: text(entry.detail), status: label('open') },
        [plan.record.id],
      ),
    )
  }
  if (options.kind === 'session') {
    const questions = snapshot.sources.questions
    const sessionQuestions = (questions.data ?? []).filter((question) => question.state === 'open')
    const sessionCounts = new Map<string, number>()
    for (const question of sessionQuestions)
      sessionCounts.set(question.id, (sessionCounts.get(question.id) ?? 0) + 1)
    const seenSession = new Set<string>()
    for (const question of sessionQuestions) {
      const isDuplicated = (sessionCounts.get(question.id) ?? 1) > 1
      const fingerprint = `${question.id} ${question.text}`
      if (isDuplicated && seenSession.has(fingerprint)) continue
      seenSession.add(fingerprint)
      rows.push(
        row(
          '0-session-question',
          isDuplicated ? [question.id, question.text] : [question.id],
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

// Issues report sections (M115w WU, PLAN.md D93.4 issues row). Pure
// view-model to sections: the source validates and scrubs the watchdog's
// records and pre-renders their words in the installed language; this
// module only builds stable rows. Rows sort by key and a key's order is
// its prefix, so the prefix opens with the stage's rank: what waits on the
// person comes first, then the repository, then the issue number.
import type { ReportOptions, ReportSection } from '../../../shared/reportSchema'
import { row, section, text } from './common'

export interface IssuesIssueView {
  readonly repository: string
  readonly number: number
  readonly title: string
  /** 0 waits on the person, 1 on the watchdog's next step, then the rest. */
  readonly rank: number
  /** The repository's place in the sorted list of watched repositories. */
  readonly repositoryIndex: number
  readonly stageText: string
  /** The verdict in the installed language; empty before a triage. */
  readonly verdictText: string
  readonly waitsText: string
  readonly pullRequestNumber: number | undefined
}
export interface IssuesPolicyView {
  readonly repository: string
  /** The person's own settings, as the words `watchdog policy` takes. */
  readonly settings: readonly { readonly name: string; readonly value: string }[]
}
export interface IssuesView {
  readonly issues: readonly IssuesIssueView[]
  readonly policies: readonly IssuesPolicyView[]
}

// Zero-padded so issue 9 sorts before issue 10 by code unit.
const REPOSITORY_INDEX_WIDTH = 4
const ISSUE_NUMBER_WIDTH = 12

function issuePrefix(entry: IssuesIssueView): string {
  const repository = String(entry.repositoryIndex).padStart(REPOSITORY_INDEX_WIDTH, '0')
  const number = String(entry.number).padStart(ISSUE_NUMBER_WIDTH, '0')
  return `${String(entry.rank)}-${repository}-${number}`
}

export function issuesSections(view: IssuesView, options: ReportOptions): ReportSection[] {
  const issues = view.issues.map((entry) =>
    row(
      issuePrefix(entry),
      [entry.repository, String(entry.number)],
      {
        name: text(`${entry.repository}#${String(entry.number)} ${entry.title}`),
        status: text(entry.stageText),
        verdict: text(entry.verdictText),
        reason: text(entry.waitsText),
        pullRequest: text(
          entry.pullRequestNumber === undefined ? '' : `#${String(entry.pullRequestNumber)}`,
        ),
      },
      ['issues'],
    ),
  )
  const limits = view.policies.flatMap((policy) =>
    policy.settings.map((setting) =>
      row(
        'limit',
        [policy.repository, setting.name],
        { name: text(`${policy.repository} ${setting.name}`), status: text(setting.value) },
        ['issues'],
      ),
    ),
  )
  return [
    section(
      'issues/issues',
      'issues',
      [
        { key: 'name', label: 'name' },
        { key: 'status', label: 'status' },
        { key: 'verdict', label: 'outcome' },
        { key: 'reason', label: 'reason' },
        { key: 'pullRequest', label: 'pullRequests' },
      ],
      issues,
      options,
    ),
    section(
      'issues/limits',
      'limits',
      [
        { key: 'name', label: 'name' },
        { key: 'status', label: 'status' },
      ],
      limits,
      options,
    ),
  ]
}

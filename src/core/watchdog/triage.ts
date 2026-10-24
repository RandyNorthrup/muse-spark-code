// M115w WT: the triage step. The charter tells the triage role what to
// judge and what to hand back; the evidence collector reads the rows the
// judgement needs (the default branch, the releases and tags, the commits
// naming the issue) and the pure matchers below decide the duplicate,
// already-fixed and in-hand questions the verdicts rest on. Nothing here
// posts: the findings go to the record, and decide acts on them.
import { WATCHDOG_MODEL_TEXT } from '../../shared/constants'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import {
  nextWatchdogState,
  triageFindingsSchema,
  type TriageFindings,
  type WatchdogIssue as WatchdogRecord,
  type WatchdogState,
} from '../../shared/watchdog'
import {
  type GitHubClient,
  type GitHubCommitMatch,
  type GitHubIssue,
  type GitHubRelease,
  type GitHubTag,
} from '../git/github'
import type { GitHubRepository } from '../git/githubRemote'
import { fenced } from '../export/transcriptMarkdown'
import { findEmbeddedInstructions } from './guard'
import { patchedWatchdogData, withWatchdogRepository, type WatchdogStore } from './store'

/** The triage charter, v1: the role's whole instruction, evidence aside. */
export function triageCharter(): string {
  const text = WATCHDOG_MODEL_TEXT
  return [
    fill(text.triageWho, { role: text.triageRole }),
    text.triageDescription,
    fill(text.triagePurpose, { description: text.triageMission }),
    text.triageWorkspace,
    fill(text.triageYouMay, { tools: text.triageTools }),
    text.triageMustNever,
    text.triageDone,
    text.triageHandBack,
    text.triageBody,
  ].join('\n\n')
}

function foldedTitle(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Whether `text` cites `number` as an issue (`#146`, not `WB-146`). */
function isIssueCited(text: string, number: number): boolean {
  return new RegExp(String.raw`#${String(number)}\b`).test(text)
}

/** Whether `text` names the issue's page (`issues/146`, not `issues/1460`). */
function isIssuePageCited(text: string, number: number): boolean {
  return new RegExp(String.raw`issues/${String(number)}\b`).test(text)
}

/** The open list's duplicate candidates for `issue`: the same folded
title, or an issue that cites this one. Self and pull requests are out. */
export function candidateDuplicates(
  issue: GitHubIssue,
  openIssues: readonly GitHubIssue[],
): GitHubIssue[] {
  const folded = foldedTitle(issue.title)
  return openIssues.filter(
    (other) =>
      other.number !== issue.number &&
      !other.isPullRequest &&
      ((folded !== '' && foldedTitle(other.title) === folded) ||
        isIssueCited(other.title, issue.number) ||
        isIssueCited(other.body, issue.number)),
  )
}

/** The commit rows whose message names the issue. GitHub's search is
broad (it matched `146 passed` and `WB-146` for 146); only `#146`
counts. */
export function issueCommits(
  commits: readonly GitHubCommitMatch[],
  number: number,
): GitHubCommitMatch[] {
  return commits.filter((commit) => isIssueCited(commit.message, number))
}

/** Numeric dotted-version order (`v0.19.0` beats `0.16.0`); undefined
when either side has no numeric reading, said, never guessed. */
export function compareVersions(left: string, right: string): -1 | 0 | 1 | undefined {
  const partsOf = (value: string): readonly number[] | undefined => {
    const parts = value.replace(/^v/i, '').split('.')
    const parsed: number[] = []
    for (const part of parts) {
      const match = /^(\d+)/.exec(part)
      if (match?.[1] === undefined) return undefined
      parsed.push(Number(match[1]))
    }
    return parsed
  }
  const leftParts = partsOf(left)
  const rightParts = partsOf(right)
  if (leftParts === undefined || rightParts === undefined) return undefined
  const width = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < width; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  return 0
}

export interface TriagePlanText {
  readonly relativePath: string
  readonly text: string
}

/** The plans already tracking the issue: a `#146` citation or its page. */
export function plansTrackingIssue(plans: readonly TriagePlanText[], number: number): string[] {
  return plans
    .filter((plan) => isIssueCited(plan.text, number) || isIssuePageCited(plan.text, number))
    .map((plan) => plan.relativePath)
}

export interface TriageEvidence {
  readonly issue: GitHubIssue
  readonly defaultBranch: string
  readonly duplicates: readonly GitHubIssue[]
  readonly releases: readonly GitHubRelease[]
  readonly tags: readonly GitHubTag[]
  readonly commits: readonly GitHubCommitMatch[]
  readonly commitsIncomplete: boolean
  readonly planRefs: readonly string[]
  /** Instruction-like phrases the issue's title and body trip, by name. */
  readonly embeddedInstructions: readonly string[]
}

export interface WatchdogEvidenceDeps {
  readonly client: GitHubClient
  readonly token: string
}

/** Reads the evidence rows for one issue. The caller's open list (the
poll's, newest first) feeds the duplicate match; the plans are the
person's own, read by the caller. */
export async function collectTriageEvidence(
  deps: WatchdogEvidenceDeps,
  repository: GitHubRepository,
  issue: GitHubIssue,
  openIssues: readonly GitHubIssue[],
  plans: readonly TriagePlanText[],
): Promise<TriageEvidence> {
  const facts = await deps.client.repositoryFacts(deps.token, repository)
  const releases = await deps.client.listReleases(deps.token, repository)
  const tags = await deps.client.listTags(deps.token, repository)
  const commits = await deps.client.searchCommits(
    deps.token,
    `repo:${repository.owner}/${repository.name} ${String(issue.number)}`,
  )
  return {
    issue,
    defaultBranch: facts.defaultBranch,
    duplicates: candidateDuplicates(issue, openIssues),
    releases,
    tags,
    commits: issueCommits(commits.commits, issue.number),
    commitsIncomplete: commits.incompleteResults,
    planRefs: plansTrackingIssue(plans, issue.number),
    embeddedInstructions: findEmbeddedInstructions(`${issue.title}\n${issue.body}`),
  }
}

function evidenceRows(lines: readonly string[], isIncomplete: boolean): string[] {
  if (lines.length === 0) return [WATCHDOG_MODEL_TEXT.triageEvidenceNone]
  return isIncomplete ? [...lines, WATCHDOG_MODEL_TEXT.triageEvidenceIncomplete] : [...lines]
}

/** The evidence pack the triage role reads after the charter. The issue
goes in fenced, as quoted text; the rows are identifiers, never prose. */
export function formatTriageEvidence(evidence: TriageEvidence): string {
  const text = WATCHDOG_MODEL_TEXT
  const sections: string[] = [
    `## ${text.triageEvidenceIssue}`,
    fenced(
      `Issue #${String(evidence.issue.number)}: ${evidence.issue.title}\n\n${evidence.issue.body}`,
      'markdown',
    ),
    `## ${text.triageEvidenceBranch}`,
    evidence.defaultBranch,
    `## ${text.triageEvidenceDuplicates}`,
    ...evidenceRows(
      evidence.duplicates.map(
        (item) => `- #${String(item.number)} ${item.title} (${item.state}): ${item.url}`,
      ),
      false,
    ),
    `## ${text.triageEvidenceReleases}`,
    ...evidenceRows(
      evidence.releases.map(
        (release) =>
          `- ${release.tag} (${release.publishedAt ?? release.createdAt}): ${release.url}`,
      ),
      false,
    ),
    `## ${text.triageEvidenceTags}`,
    ...evidenceRows(
      evidence.tags.map((tag) => `- ${tag.name} ${tag.sha}`),
      false,
    ),
    `## ${text.triageEvidenceCommits}`,
    ...evidenceRows(
      evidence.commits.map(
        (commit) =>
          `- ${commit.sha} ${(commit.message.split('\n', 1)[0] ?? '').trim()} (${commit.date})`,
      ),
      evidence.commitsIncomplete,
    ),
    `## ${text.triageEvidencePlans}`,
    ...evidenceRows(
      evidence.planRefs.map((ref) => `- ${ref}`),
      false,
    ),
    `## ${text.triageEvidenceInstructions}`,
    ...evidenceRows(
      evidence.embeddedInstructions.map((name) => `- ${name}`),
      false,
    ),
  ]
  return sections.join('\n\n')
}

/** Reads the triage turn's answer as findings. Anything else-shaped
refuses out loud; the record keeps the cause. */
export function parseTriageFindings(answer: string): TriageFindings {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer) as unknown
  } catch (error: unknown) {
    throw new Error(UI_TEXT.watchdog.triage.unreadable, { cause: error })
  }
  const findings = triageFindingsSchema.safeParse(parsed)
  if (!findings.success)
    throw new Error(UI_TEXT.watchdog.triage.unreadable, { cause: findings.error })
  return findings.data
}

export interface WatchdogTriageDeps {
  readonly store: WatchdogStore
  now(): number
}

export interface WatchdogTriageResult {
  readonly number: number
  readonly state: WatchdogState
  readonly findings: TriageFindings
}

/** Applies the triage turn's answer to an acknowledged issue. The
findings the schema proved go to the record with the `triaged` move and a
new triage round; anything else leaves the record untouched. */
export async function triageWatchdogIssue(
  deps: WatchdogTriageDeps,
  repository: string,
  number: number,
  answer: string,
): Promise<WatchdogTriageResult> {
  return await withWatchdogRepository(deps, repository, (live, { nowMs }) => {
    const record: WatchdogRecord | undefined = live.issues.find(
      (item) => item.issueNumber === number,
    )
    if (record?.state !== 'acknowledged')
      throw new Error(`watchdog cannot triage issue ${String(number)} before its acknowledgement`)
    const findings = parseTriageFindings(answer)
    const state = nextWatchdogState(record.state, 'triaged')
    return {
      data: patchedWatchdogData(live, number, nowMs, {
        state,
        findings,
        triageRound: record.triageRound + 1,
      }),
      result: { number, state, findings },
    }
  })
}

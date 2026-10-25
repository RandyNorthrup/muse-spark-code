// M115w WA: one poll cycle over a repository. Lists the issues, creates
// records for new ones, posts the acknowledgement where it is due and
// re-drives open flows from what changed. An acknowledgement is read,
// posted and recorded in one step under the repository's lock, so a second
// poller waits and then finds the record; a marker already on the issue is
// adopted, so a crash between the post and the record never posts twice.
// GitHub's own rate limit stops the poll out loud; nothing retries on its
// own.
import { createHash } from 'node:crypto'
import { UI_TEXT, WATCHDOG_ACK_TARGET_MS } from '../../shared/constants'
import {
  nextWatchdogState,
  type WatchdogEvent,
  type WatchdogIssue as WatchdogRecord,
  type WatchdogState,
} from '../../shared/watchdog'
import {
  GitHubError,
  repositoryFromFullName,
  type GitHubClient,
  type GitHubIssue,
  type GitHubIssueComment,
} from '../git/github'
import type { GitHubRepository } from '../git/githubRemote'
import { decideAck, isWatchdogPost, postAck, type AckSkipNote } from './ack'
import type { WatchdogStore } from './store'

export interface WatchdogPollDeps {
  readonly client: GitHubClient
  readonly token: string
  readonly store: WatchdogStore
  now(): number
  newRunId(): string
}

export interface WatchdogPollIssue {
  readonly number: number
  readonly state: WatchdogState | 'skipped'
  readonly posted: boolean
  readonly note?: AckSkipNote | 'ackPosted'
  readonly overdue: boolean
}

export interface WatchdogPollError {
  readonly number?: number
  readonly message: string
}

export interface WatchdogPollResult {
  readonly repository: string
  readonly created: boolean
  readonly paused: boolean
  readonly stopped?: string
  readonly issues: readonly WatchdogPollIssue[]
  readonly errors: readonly WatchdogPollError[]
}

/** What the findings were judged on: the title and the body. An edit
changes it; a label, a comment or a lock does not. */
function issueTextHash(issue: GitHubIssue): string {
  return createHash('sha256')
    .update(JSON.stringify([issue.title, issue.body]))
    .digest('hex')
}

function freshRecord(
  issue: GitHubIssue,
  repository: string,
  runId: string,
  nowMs: number,
): WatchdogRecord {
  return {
    repository,
    issueNumber: issue.number,
    issueId: issue.id,
    state: 'seen',
    runId,
    seenAtMs: nowMs,
    labelsApplied: [],
    triageRound: 0,
    lastTitle: issue.title,
    lastTextHash: issueTextHash(issue),
    lastCommentCount: issue.commentCount,
    lastIssueUpdatedAt: issue.updatedAt,
    updatedAtMs: nowMs,
  }
}

/** The record this issue's flow lives in: none for a new issue, a
recreated one (same number, another id) or a reopened one that was never
acknowledged, which are each owed a fresh flow. */
function flowRecord(
  records: readonly WatchdogRecord[],
  issue: GitHubIssue,
): WatchdogRecord | undefined {
  const record = records.find((item) => item.issueNumber === issue.number)
  const isOwed =
    record?.issueId !== issue.id || (record.state === 'closed' && record.ackCommentId === undefined)
  return isOwed ? undefined : record
}

function driveEvent(
  record: WatchdogRecord,
  issue: GitHubIssue,
  isAcked: boolean,
  isAnswered: boolean,
): WatchdogEvent {
  if (issue.state === 'closed') return record.state === 'closed' ? 'polled' : 'closed'
  if (record.state === 'closed') return 'reopened'
  if (isAcked && record.state === 'seen') return 'acknowledged'
  if (isAnswered && record.state === 'awaitingInfo') return 'infoReceived'
  const isEditable = ['acknowledged', 'triaged', 'awaitingInfo', 'replied'].includes(record.state)
  return isEditable && issueTextHash(issue) !== record.lastTextHash ? 'edited' : 'polled'
}

function refusal(error: unknown): string {
  // GitHub's own words, said out loud; anything else is a programming
  // error and fails the poll instead of recording a mystery.
  if (!(error instanceof GitHubError)) throw error
  return error.message
}

/** Whether the reporter answered the needs-info reply: one of their
comments, newer than the reply and not one of ours. */
export function isReporterAnswer(
  record: Pick<WatchdogRecord, 'replyCommentId'>,
  issue: GitHubIssue,
  comments: readonly GitHubIssueComment[],
): boolean {
  return comments.some(
    (comment) =>
      comment.id > (record.replyCommentId ?? 0) &&
      comment.author.login === issue.author.login &&
      !isWatchdogPost(comment.body),
  )
}

/** The acknowledgement step for one issue: read the live comments, post
or adopt, and record it, all under the repository's lock. */
async function acknowledgeIssue(
  deps: WatchdogPollDeps,
  repository: string,
  named: GitHubRepository,
  issue: GitHubIssue,
  nowMs: number,
): Promise<{ commentId: number; labels: readonly string[] } | undefined> {
  return await deps.store.exclusive(repository, async (live) => {
    const record = flowRecord(live.issues, issue)
    const comments = await deps.client.issueComments(deps.token, named, issue.number)
    const decision = decideAck(record, issue, comments, live.policy)
    if (decision.action === 'skip') return { data: live, result: undefined }
    const ack =
      decision.action === 'adopt'
        ? { commentId: decision.comment.id, labels: [] }
        : await postAck(deps.client, deps.token, named, issue, live.policy)
    const base = record ?? freshRecord(issue, repository, deps.newRunId(), nowMs)
    const recorded: WatchdogRecord = {
      ...base,
      ackCommentId: ack.commentId,
      labelsApplied: ack.labels.length > 0 ? [...ack.labels] : base.labelsApplied,
      updatedAtMs: nowMs,
    }
    return {
      data: {
        policy: live.policy,
        issues: [...live.issues.filter((item) => item.issueNumber !== issue.number), recorded],
      },
      result: decision.action === 'post' ? ack : undefined,
    }
  })
}

export async function pollWatchdogRepository(
  deps: WatchdogPollDeps,
  repository: string,
): Promise<WatchdogPollResult> {
  const named = repositoryFromFullName(repository)
  if (named === undefined) throw new Error(UI_TEXT.watchdog.cli.invalidRepository)
  const repos = await deps.store.list()
  const isKnown = repos.some((data) => data.policy.repository === repository)
  const nowMs = deps.now()
  const errors: WatchdogPollError[] = []

  const snapshot = await deps.store.exclusive(repository, (data) => ({ data, result: data }))
  if (snapshot.policy.paused)
    return { repository, created: false, paused: true, issues: [], errors }
  const policy = snapshot.policy

  let listed: GitHubIssue[]
  try {
    listed = await deps.client.listIssues(deps.token, named)
  } catch (error: unknown) {
    if (!(error instanceof GitHubError)) throw error
    return {
      repository,
      created: !isKnown,
      paused: false,
      stopped: refusal(error),
      issues: [],
      errors,
    }
  }

  // An acknowledgement is owed where the open issue has none; the step
  // itself re-reads the live record and comments under the lock.
  const posted = new Map<number, { commentId: number; labels: readonly string[] }>()
  const answered = new Set<number>()
  for (const issue of listed) {
    if (issue.isPullRequest || issue.state === 'closed') continue
    const record = flowRecord(snapshot.issues, issue)
    try {
      if (decideAck(record, issue, [], policy).action === 'post') {
        const ack = await acknowledgeIssue(deps, repository, named, issue, nowMs)
        if (ack !== undefined) posted.set(issue.number, ack)
      } else if (
        record?.state === 'awaitingInfo' &&
        issue.commentCount > record.lastCommentCount &&
        isReporterAnswer(
          record,
          issue,
          await deps.client.issueComments(deps.token, named, issue.number),
        )
      ) {
        answered.add(issue.number)
      }
    } catch (error: unknown) {
      if (!(error instanceof GitHubError)) throw error
      errors.push({ number: issue.number, message: refusal(error) })
    }
  }

  const rows: WatchdogPollIssue[] = []
  await deps.store.exclusive(repository, (live) => {
    const records = [...live.issues]
    for (const issue of listed) {
      if (issue.isPullRequest) {
        rows.push({
          number: issue.number,
          state: 'skipped',
          posted: false,
          note: 'skippedPullRequest',
          overdue: false,
        })
        continue
      }
      const at = records.findIndex((item) => item.issueNumber === issue.number)
      const previous = flowRecord(records, issue)
      // A closed issue needs no acknowledgement: record it closed, silently.
      if (previous === undefined && issue.state === 'closed') {
        const closed: WatchdogRecord = {
          ...freshRecord(issue, repository, deps.newRunId(), nowMs),
          state: 'closed',
        }
        if (at === -1) records.push(closed)
        else records[at] = closed
        rows.push({ number: issue.number, state: 'closed', posted: false, overdue: false })
        continue
      }
      if (previous?.state === 'closed' && issue.state === 'closed') {
        const stayed: WatchdogRecord = {
          ...previous,
          lastTitle: issue.title,
          lastTextHash: issueTextHash(issue),
          lastCommentCount: issue.commentCount,
          lastIssueUpdatedAt: issue.updatedAt,
          updatedAtMs: nowMs,
        }
        records[at] = stayed
        rows.push({ number: issue.number, state: 'closed', posted: false, overdue: false })
        continue
      }
      // A recreated issue (same number, another id) starts over honestly,
      // as does a reopen that was never acknowledged: both are owed an ack.
      const base = previous ?? {
        ...freshRecord(issue, repository, deps.newRunId(), nowMs),
        seenAtMs: records[at]?.seenAtMs ?? nowMs,
      }
      const decision = decideAck(base, issue, [], policy)
      const ack = posted.get(issue.number)
      const isAcked =
        base.ackCommentId !== undefined ||
        (decision.action === 'skip' && decision.note === 'alreadyAcked')
      const event = driveEvent(base, issue, isAcked, answered.has(issue.number))
      const next = nextWatchdogState(base.state, event)
      let note: WatchdogPollIssue['note']
      if (ack !== undefined) note = 'ackPosted'
      else if (decision.action === 'skip') note = decision.note
      // A reporter's answer or an edit stale-dates the findings: the flow
      // triages again.
      const isRestart = next === 'acknowledged' && base.state !== 'seen'
      const updated: WatchdogRecord = {
        ...base,
        state: next,
        ...(isRestart && {
          findings: undefined,
          outcome: undefined,
          replyCommentId: undefined,
        }),
        lastTitle: issue.title,
        lastTextHash: issueTextHash(issue),
        lastCommentCount: issue.commentCount,
        lastIssueUpdatedAt: issue.updatedAt,
        updatedAtMs: nowMs,
      }
      if (at === -1) records.push(updated)
      else records[at] = updated
      rows.push({
        number: issue.number,
        state: next,
        posted: ack !== undefined,
        ...(note !== undefined && { note }),
        overdue:
          next === 'seen' &&
          note === undefined &&
          nowMs - updated.seenAtMs > WATCHDOG_ACK_TARGET_MS,
      })
    }
    return { data: { policy: live.policy, issues: records }, result: undefined }
  })

  return { repository, created: !isKnown, paused: false, issues: rows, errors }
}

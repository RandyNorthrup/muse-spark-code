// M115w WA: one poll cycle over a repository. Lists the issues, creates
// records for new ones, posts the acknowledgement where it is due and
// re-drives open flows from what changed. One writer per repository at a
// time: the store lock serializes writes, and a next poll adopts any
// acknowledgement the marker finds, so a crash between the post and the
// record never posts twice. GitHub's own rate limit stops the poll out
// loud; nothing retries on its own.
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
import { decideAck, postAck, type AckSkipNote } from './ack'
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
    lastTitle: issue.title,
    lastCommentCount: issue.commentCount,
    lastIssueUpdatedAt: issue.updatedAt,
    updatedAtMs: nowMs,
  }
}

function driveEvent(record: WatchdogRecord, issue: GitHubIssue, isAcked: boolean): WatchdogEvent {
  if (issue.state === 'closed') return record.state === 'closed' ? 'polled' : 'closed'
  if (record.state === 'closed') return 'reopened'
  if (isAcked && record.state === 'seen') return 'acknowledged'
  if (
    issue.title !== record.lastTitle &&
    ['acknowledged', 'triaged', 'replied'].includes(record.state)
  )
    return 'edited'
  return issue.commentCount > record.lastCommentCount && record.state === 'awaitingInfo'
    ? 'infoReceived'
    : 'polled'
}

function refusal(error: unknown): string {
  // GitHub's own words, said out loud; anything else is a programming
  // error and fails the poll instead of recording a mystery.
  if (!(error instanceof GitHubError)) throw error
  return error.message
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
    return {
      repository,
      created: !isKnown,
      paused: false,
      stopped: refusal(error),
      issues: [],
      errors,
    }
  }

  // The acknowledgement decision needs the live comments only where the
  // record has none: already-acked and skipped issues cost no extra call.
  const comments = new Map<number, readonly GitHubIssueComment[]>()
  for (const issue of listed) {
    if (issue.isPullRequest || issue.state === 'closed') continue
    const record = snapshot.issues.find((item) => item.issueNumber === issue.number)
    if (decideAck(record, issue, [], policy).action !== 'post') continue
    try {
      comments.set(issue.number, await deps.client.issueComments(deps.token, named, issue.number))
    } catch (error: unknown) {
      errors.push({ number: issue.number, message: refusal(error) })
    }
  }

  const posted = new Map<number, { commentId: number; labels: readonly string[] }>()
  for (const issue of listed) {
    if (issue.isPullRequest || issue.state === 'closed') continue
    const record = snapshot.issues.find((item) => item.issueNumber === issue.number)
    if (decideAck(record, issue, comments.get(issue.number) ?? [], policy).action !== 'post')
      continue
    try {
      const ack = await postAck(deps.client, deps.token, named, issue, policy)
      posted.set(issue.number, { commentId: ack.commentId, labels: ack.labels })
    } catch (error: unknown) {
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
      const previous = records[at]
      // A closed issue needs no acknowledgement: record it closed, silently.
      if (previous === undefined && issue.state === 'closed') {
        const closed: WatchdogRecord = {
          ...freshRecord(issue, repository, deps.newRunId(), nowMs),
          state: 'closed',
        }
        records.push(closed)
        rows.push({ number: issue.number, state: 'closed', posted: false, overdue: false })
        continue
      }
      if (previous?.state === 'closed' && issue.state === 'closed') {
        const stayed: WatchdogRecord = {
          ...previous,
          lastTitle: issue.title,
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
      const isNew = previous === undefined
      const isRecreated = !isNew && previous.issueId !== issue.id
      const isUnackedReopen =
        previous?.state === 'closed' &&
        issue.state !== 'closed' &&
        previous.ackCommentId === undefined
      const base =
        isNew || isRecreated || isUnackedReopen
          ? {
              ...freshRecord(issue, repository, deps.newRunId(), nowMs),
              seenAtMs: previous?.seenAtMs ?? nowMs,
            }
          : previous
      const decision = decideAck(base, issue, comments.get(issue.number) ?? [], policy)
      const ack = posted.get(issue.number)
      const isAcked =
        ack !== undefined ||
        decision.action === 'adopt' ||
        (decision.action === 'skip' && decision.note === 'alreadyAcked')
      const event = driveEvent(base, issue, isAcked)
      const next = nextWatchdogState(base.state, event)
      let note: WatchdogPollIssue['note']
      if (decision.action === 'skip') note = decision.note
      else if (ack !== undefined) note = 'ackPosted'
      else if (decision.action === 'adopt') note = 'alreadyAcked'
      const updated: WatchdogRecord = {
        ...base,
        state: next,
        ...(ack !== undefined && { ackCommentId: ack.commentId, labelsApplied: [...ack.labels] }),
        ...(decision.action === 'adopt' && { ackCommentId: decision.comment.id }),
        // An edit stale-dates the findings: the flow triages again.
        ...(event === 'edited' && { findings: undefined, outcome: undefined }),
        lastTitle: issue.title,
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

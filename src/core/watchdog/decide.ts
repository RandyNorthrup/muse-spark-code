// M115w WD+WV: the decide step and the resolution step. Decide turns
// triaged findings into the outcome: spam holds without a post, valid
// and in-hand plan without a post, and the rest reply through the
// repository's gate and close by its policy. A reply already carrying
// the marker is adopted, so a crash between the post and the record
// never posts twice and a failed close is retried. Resolve posts the
// fixed-reply once the host's verification passes, and only then. The
// fix-lane outcome waits on M96's execution binding: valid issues plan
// until the board can run them.
import { UI_TEXT } from '../../shared/constants'
import {
  nextWatchdogState,
  type TriageFindings,
  type WatchdogIssue as WatchdogRecord,
  type WatchdogOutcome,
  type WatchdogPolicy,
  type WatchdogState,
  type WatchdogVerdict,
} from '../../shared/watchdog'
import { type GitHubClient, type GitHubIssueComment } from '../git/github'
import type { GitHubRepository } from '../git/githubRemote'
import { isWatchdogReply } from './ack'
import { resolvePostApproval, type PostApproval } from './guard'
import { composePlanDraft, composeReplyBody } from './reply'
import { snapshotWatchdogRepository, type WatchdogStore } from './store'
import { applyVerification } from './verify'

export interface WatchdogDecideDeps {
  readonly client: GitHubClient
  readonly token: string
  readonly store: WatchdogStore
  readonly isPostApproved: () => Promise<boolean>
  now(): number
}

export interface WatchdogDecision {
  readonly number: number
  readonly outcome: WatchdogOutcome
  readonly state: WatchdogState
  readonly posted: boolean
  readonly closed: boolean
  readonly reason?: string
  readonly planDraft?: string
}

export interface WatchdogResolution {
  readonly number: number
  readonly state: WatchdogState
  readonly posted: boolean
  readonly closed: boolean
  readonly notes?: string
  readonly reason?: string
}

function outcomeFor(verdict: WatchdogVerdict): WatchdogOutcome {
  switch (verdict) {
    case 'needsInfo': {
      return 'needsInfo'
    }
    case 'duplicate': {
      return 'duplicate'
    }
    case 'alreadyFixed': {
      return 'alreadyFixed'
    }
    case 'invalid': {
      return 'invalid'
    }
    case 'spam': {
      return 'spam'
    }
    case 'valid':
    case 'inHand': {
      return 'planEntry'
    }
  }
}

function triagedRecord(
  data: { issues: readonly WatchdogRecord[] },
  number: number,
): { record: WatchdogRecord; findings: TriageFindings } {
  const record = data.issues.find((item) => item.issueNumber === number)
  if (record?.state !== 'triaged' || record.findings === undefined)
    throw new Error(`watchdog cannot decide issue ${String(number)} before its triage`)
  return { record, findings: record.findings }
}

async function updateRecord(
  store: WatchdogStore,
  repository: string,
  number: number,
  nowMs: number,
  patch: Partial<WatchdogRecord> & { state: WatchdogState },
): Promise<void> {
  await store.exclusive(repository, (data) => ({
    data: {
      policy: data.policy,
      issues: data.issues.map((record) =>
        record.issueNumber === number ? { ...record, ...patch, updatedAtMs: nowMs } : record,
      ),
    },
    result: undefined,
  }))
}

/** The comments read and the gate resolved: an adopted reply posts
nothing, and a held gate stops the step with its reason. */
async function admittedWatchdogPost(
  deps: WatchdogDecideDeps,
  policy: WatchdogPolicy,
  named: GitHubRepository,
  number: number,
): Promise<{ isReplied: boolean; approval: PostApproval }> {
  const comments: readonly GitHubIssueComment[] = await deps.client.issueComments(
    deps.token,
    named,
    number,
  )
  const isReplied = comments.some((comment) => isWatchdogReply(comment.body))
  const approval = isReplied
    ? { allowed: true as const }
    : await resolvePostApproval(policy, deps.isPostApproved)
  return { isReplied, approval }
}

export async function decideWatchdogIssue(
  deps: WatchdogDecideDeps,
  repository: string,
  number: number,
): Promise<WatchdogDecision> {
  const { named, nowMs, snapshot } = await snapshotWatchdogRepository(deps, repository)
  const { record, findings } = triagedRecord(snapshot, number)
  const outcome = outcomeFor(findings.verdict)

  // Spam holds structurally: no gate overrides the hold.
  if (outcome === 'spam') {
    const state = nextWatchdogState(record.state, 'closed')
    await updateRecord(deps.store, repository, number, nowMs, { state, outcome })
    return {
      number,
      outcome,
      state,
      posted: false,
      closed: true,
      reason: UI_TEXT.watchdog.refusal.spamHeld,
    }
  }

  // Valid and in-hand plan; the draft goes to the host with the decision.
  if (outcome === 'planEntry') {
    const issue = await deps.client.issue(deps.token, named, number)
    const state = nextWatchdogState(record.state, 'planned')
    await updateRecord(deps.store, repository, number, nowMs, { state, outcome })
    return {
      number,
      outcome,
      state,
      posted: false,
      closed: false,
      planDraft: composePlanDraft(repository, number, issue.title, issue.body, findings),
    }
  }

  // A reply already out there is adopted; its close is (re)applied.
  const { isReplied, approval } = await admittedWatchdogPost(deps, snapshot.policy, named, number)
  if (!approval.allowed)
    return {
      number,
      outcome,
      state: record.state,
      posted: false,
      closed: false,
      reason: approval.reason,
    }
  if (!isReplied)
    await deps.client.postIssueComment(
      deps.token,
      named,
      number,
      composeReplyBody(outcome, findings),
    )
  // The wait stays open: a needs-info reply never closes its issue.
  const shouldClose = outcome !== 'needsInfo' && snapshot.policy.closePolicy === 'onReply'
  if (shouldClose) await deps.client.closeIssue(deps.token, named, number)
  const state = nextWatchdogState(
    record.state,
    outcome === 'needsInfo' ? 'infoRequested' : 'replied',
  )
  await updateRecord(deps.store, repository, number, nowMs, { state, outcome })
  return { number, outcome, state, posted: !isReplied, closed: shouldClose }
}

export async function resolveWatchdogIssue(
  deps: WatchdogDecideDeps,
  repository: string,
  number: number,
  evidence: unknown,
): Promise<WatchdogResolution> {
  const { named, nowMs, snapshot } = await snapshotWatchdogRepository(deps, repository)
  const record = snapshot.issues.find((item) => item.issueNumber === number)
  if (
    record?.state !== 'planned' ||
    record.findings === undefined ||
    (record.findings.verdict !== 'valid' && record.findings.verdict !== 'inHand') ||
    (record.outcome !== 'planEntry' && record.outcome !== 'fixLane')
  )
    throw new Error(`watchdog cannot resolve issue ${String(number)} before its plan`)
  const outcome = record.outcome
  const verified = applyVerification(evidence, snapshot.policy.closePolicy)
  if (!verified.verified)
    return { number, state: record.state, posted: false, closed: false, notes: verified.notes }

  const { isReplied, approval } = await admittedWatchdogPost(deps, snapshot.policy, named, number)
  if (!approval.allowed)
    return {
      number,
      state: record.state,
      posted: false,
      closed: false,
      reason: approval.reason,
    }
  if (!isReplied)
    await deps.client.postIssueComment(
      deps.token,
      named,
      number,
      composeReplyBody(outcome, record.findings, {
        pullRequestNumber: verified.resolution.pullRequestNumber,
        pullRequestUrl: verified.resolution.pullRequestUrl,
        version: verified.resolution.version,
      }),
    )
  if (verified.resolution.close) await deps.client.closeIssue(deps.token, named, number)
  const state = nextWatchdogState(record.state, 'replied')
  await updateRecord(deps.store, repository, number, nowMs, { state })
  return { number, state, posted: !isReplied, closed: verified.resolution.close }
}

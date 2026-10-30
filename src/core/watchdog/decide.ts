// M115w WD+WV: the decide step and the resolution step. Decide turns
// triaged findings into the outcome: spam holds without a post, valid
// and in-hand plan without a post, and the rest reply through the
// repository's gate and close by its policy. A reply already carrying
// this flow's marker for this round and kind is adopted, so a crash
// between the post and the record never posts twice and a failed close is
// retried. Each step reads, posts and records under the repository's
// lock: a second writer waits, then finds the record. Resolve posts the
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
import { composePlanDraft, composeReplyBody, replyKindFor } from './reply'
import { patchedWatchdogData, withWatchdogRepository, type WatchdogStore } from './store'
import { applyVerification } from './verify'

export interface WatchdogDecideDeps {
  readonly client: GitHubClient
  readonly token: string
  readonly store: WatchdogStore
  readonly isPostApproved: () => Promise<boolean>
  /** Report only (PLAN M115w acceptance 8): no post beyond the acknowledgement. */
  readonly isReportOnly: boolean
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
  /** The reply a held post would have made, shown so an approval is informed. */
  readonly proposedReply?: string
}

export interface WatchdogResolution {
  readonly number: number
  readonly state: WatchdogState
  readonly posted: boolean
  readonly closed: boolean
  readonly notes?: string
  readonly reason?: string
  readonly proposedReply?: string
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

/** A spam verdict closes the record and posts nothing. The GitHub issue
stays open, so this does not claim it was closed: the command must not
say "Closed.", and the next poll must keep the hold. */
export function spamHoldResult(state: WatchdogState, number: number): WatchdogDecision {
  return {
    number,
    outcome: 'spam',
    state: nextWatchdogState(state, 'closed'),
    posted: false,
    closed: false,
    reason: UI_TEXT.watchdog.refusal.spamHeld,
  }
}

/** The comments read and the gate resolved: a reply already out there
(this flow, this round, this kind) is adopted and posts nothing, and a
held gate stops the step with its reason. */
async function admittedWatchdogPost(
  deps: WatchdogDecideDeps,
  policy: WatchdogPolicy,
  named: GitHubRepository,
  record: WatchdogRecord,
  outcome: WatchdogOutcome,
): Promise<{ existing: GitHubIssueComment | undefined; approval: PostApproval }> {
  const comments: readonly GitHubIssueComment[] = await deps.client.issueComments(
    deps.token,
    named,
    record.issueNumber,
  )
  const kind = replyKindFor(outcome)
  const existing = comments.find((comment) => isWatchdogReply(comment.body, record, kind))
  // Report only holds every post, an adopted reply's close included.
  if (deps.isReportOnly)
    return { existing, approval: { allowed: false, reason: UI_TEXT.watchdog.refusal.reportOnly } }
  const approval =
    existing === undefined
      ? await resolvePostApproval(policy, deps.isPostApproved)
      : { allowed: true as const }
  return { existing, approval }
}

export async function decideWatchdogIssue(
  deps: WatchdogDecideDeps,
  repository: string,
  number: number,
): Promise<WatchdogDecision> {
  return await withWatchdogRepository<WatchdogDecision>(
    deps,
    repository,
    async (live, { named, nowMs }) => {
      const { record, findings } = triagedRecord(live, number)
      const outcome = outcomeFor(findings.verdict)

      // Spam holds structurally: no gate overrides the hold, and GitHub
      // is left open.
      if (outcome === 'spam') {
        const result = spamHoldResult(record.state, number)
        return {
          data: patchedWatchdogData(live, number, nowMs, {
            state: result.state,
            outcome: result.outcome,
          }),
          result,
        }
      }

      // Valid and in-hand plan; the draft goes to the host with the decision.
      if (outcome === 'planEntry') {
        const issue = await deps.client.issue(deps.token, named, number)
        const state = nextWatchdogState(record.state, 'planned')
        return {
          data: patchedWatchdogData(live, number, nowMs, { state, outcome }),
          result: {
            number,
            outcome,
            state,
            posted: false,
            closed: false,
            planDraft: composePlanDraft(repository, number, issue.title, issue.body, findings),
          },
        }
      }

      // A reply already out there is adopted; its close is (re)applied.
      const { existing, approval } = await admittedWatchdogPost(
        deps,
        live.policy,
        named,
        record,
        outcome,
      )
      if (!approval.allowed)
        return {
          data: live,
          result: {
            number,
            outcome,
            state: record.state,
            posted: false,
            closed: false,
            reason: approval.reason,
            proposedReply: composeReplyBody(outcome, findings, record),
          },
        }
      const reply =
        existing ??
        (await deps.client.postIssueComment(
          deps.token,
          named,
          number,
          composeReplyBody(outcome, findings, record),
        ))
      // The wait stays open: a needs-info reply never closes its issue.
      const shouldClose = outcome !== 'needsInfo' && live.policy.closePolicy === 'onReply'
      if (shouldClose) await deps.client.closeIssue(deps.token, named, number)
      const state = nextWatchdogState(
        record.state,
        outcome === 'needsInfo' ? 'infoRequested' : 'replied',
      )
      return {
        data: patchedWatchdogData(live, number, nowMs, {
          state,
          outcome,
          ...(outcome === 'needsInfo' && { replyCommentId: reply.id }),
        }),
        result: { number, outcome, state, posted: existing === undefined, closed: shouldClose },
      }
    },
  )
}

export async function resolveWatchdogIssue(
  deps: WatchdogDecideDeps,
  repository: string,
  number: number,
  evidence: unknown,
): Promise<WatchdogResolution> {
  return await withWatchdogRepository<WatchdogResolution>(
    deps,
    repository,
    async (live, { named, nowMs }) => {
      const record = live.issues.find((item) => item.issueNumber === number)
      if (
        record?.state !== 'planned' ||
        record.findings === undefined ||
        (record.findings.verdict !== 'valid' && record.findings.verdict !== 'inHand') ||
        (record.outcome !== 'planEntry' && record.outcome !== 'fixLane')
      )
        throw new Error(`watchdog cannot resolve issue ${String(number)} before its plan`)
      const outcome = record.outcome
      const verified = applyVerification(evidence, live.policy.closePolicy)
      if (!verified.verified)
        return {
          data: live,
          result: {
            number,
            state: record.state,
            posted: false,
            closed: false,
            notes: verified.notes,
          },
        }

      const fixedReply = composeReplyBody(outcome, record.findings, record, {
        pullRequestNumber: verified.resolution.pullRequestNumber,
        pullRequestUrl: verified.resolution.pullRequestUrl,
        version: verified.resolution.version,
      })
      const { existing, approval } = await admittedWatchdogPost(
        deps,
        live.policy,
        named,
        record,
        outcome,
      )
      if (!approval.allowed)
        return {
          data: live,
          result: {
            number,
            state: record.state,
            posted: false,
            closed: false,
            reason: approval.reason,
            proposedReply: fixedReply,
          },
        }
      if (existing === undefined)
        await deps.client.postIssueComment(deps.token, named, number, fixedReply)
      if (verified.resolution.close) await deps.client.closeIssue(deps.token, named, number)
      const state = nextWatchdogState(record.state, 'replied')
      return {
        data: patchedWatchdogData(live, number, nowMs, {
          state,
          pullRequestNumber: verified.resolution.pullRequestNumber,
        }),
        result: {
          number,
          state,
          posted: existing === undefined,
          closed: verified.resolution.close,
        },
      }
    },
  )
}

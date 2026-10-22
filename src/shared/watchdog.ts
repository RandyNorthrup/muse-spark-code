// M115w W0: the issue watchdog's contracts. The state machine, the
// per-issue record, triageFindings v1 and the per-repository policy.
// Report only until M109's taint lane merges (PLAN M115w): the machine
// acknowledges, triages and shows its findings, and posts nothing else.
import * as z from 'zod/mini'
import { WATCHDOG_DEFAULT_ACK_LABEL } from './constants'

export const watchdogStateSchema = z.enum([
  'seen',
  'acknowledged',
  'triaged',
  'awaitingInfo',
  'planned',
  'replied',
  'closed',
])
export type WatchdogState = z.infer<typeof watchdogStateSchema>

export const watchdogVerdictSchema = z.enum([
  'valid',
  'needsInfo',
  'duplicate',
  'alreadyFixed',
  'inHand',
  'invalid',
  'spam',
])
export type WatchdogVerdict = z.infer<typeof watchdogVerdictSchema>

/** triageFindings v1: the triage role's structured findings (PLAN WT).
Each verdict carries its evidence: a duplicate names its issue, a
needs-info asks its questions, an already-fixed names its version, an
in-hand names its plan or lane. The model either proves the verdict or
the findings refuse. */
export const triageFindingsSchema = z
  .strictObject({
    version: z.literal(1),
    verdict: watchdogVerdictSchema,
    summary: z.string(),
    questions: z.array(z.string()),
    duplicateOf: z.optional(z.number()),
    fixedIn: z.optional(z.string()),
    inHandRef: z.optional(z.string()),
  })
  .check(
    z.refine((findings) => {
      switch (findings.verdict) {
        case 'duplicate': {
          return findings.duplicateOf !== undefined
        }
        case 'needsInfo': {
          return findings.questions.length > 0
        }
        case 'alreadyFixed': {
          return findings.fixedIn !== undefined
        }
        case 'inHand': {
          return findings.inHandRef !== undefined
        }
        default: {
          return true
        }
      }
    }),
  )
export type TriageFindings = z.infer<typeof triageFindingsSchema>

export const watchdogApprovalSchema = z.enum(['ask', 'always', 'never'])
export type WatchdogApproval = z.infer<typeof watchdogApprovalSchema>

export const watchdogClosePolicySchema = z.enum(['never', 'onReply', 'onFixRelease'])
export type WatchdogClosePolicy = z.infer<typeof watchdogClosePolicySchema>

/** The per-repository policy (PLAN W0). No rate or count of ours: the only
bound is GitHub's own rate limit, which stops the poll out loud. */
export const watchdogPolicySchema = z.strictObject({
  repository: z.string(),
  paused: z.boolean(),
  ackLabel: z.string(),
  ackTemplate: z.optional(z.string()),
  watchLabels: z.array(z.string()),
  ignoreAuthors: z.array(z.string()),
  postsBeyondAck: watchdogApprovalSchema,
  closePolicy: watchdogClosePolicySchema,
})
export type WatchdogPolicy = z.infer<typeof watchdogPolicySchema>

export function defaultWatchdogPolicy(repository: string): WatchdogPolicy {
  return watchdogPolicySchema.parse({
    repository,
    paused: false,
    ackLabel: WATCHDOG_DEFAULT_ACK_LABEL,
    watchLabels: [],
    ignoreAuthors: [],
    postsBeyondAck: 'ask',
    closePolicy: 'never',
  })
}

export const watchdogOutcomeSchema = z.enum([
  'needsInfo',
  'duplicate',
  'alreadyFixed',
  'invalid',
  'spam',
  'planEntry',
  'fixLane',
])
export type WatchdogOutcome = z.infer<typeof watchdogOutcomeSchema>

/** One watched issue. `runId` is minted per flow: a record without one
(a restart that dropped it) must fail rather than post twice. */
export const watchdogIssueSchema = z.strictObject({
  repository: z.string(),
  issueNumber: z.number(),
  issueId: z.number(),
  state: watchdogStateSchema,
  runId: z.string(),
  seenAtMs: z.number(),
  ackCommentId: z.optional(z.number()),
  labelsApplied: z.array(z.string()),
  findings: z.optional(triageFindingsSchema),
  outcome: z.optional(watchdogOutcomeSchema),
  lastTitle: z.string(),
  lastCommentCount: z.number(),
  lastIssueUpdatedAt: z.string(),
  updatedAtMs: z.number(),
})
export type WatchdogIssue = z.infer<typeof watchdogIssueSchema>

export const watchdogEventSchema = z.enum([
  'polled',
  'acknowledged',
  'triaged',
  'infoRequested',
  'infoReceived',
  'planned',
  'replied',
  'closed',
  'reopened',
  'edited',
])
export type WatchdogEvent = z.infer<typeof watchdogEventSchema>

const TRANSITIONS: Readonly<
  Record<WatchdogState, Partial<Readonly<Record<WatchdogEvent, WatchdogState>>>>
> = {
  seen: { acknowledged: 'acknowledged', closed: 'closed' },
  acknowledged: { triaged: 'triaged', closed: 'closed', reopened: 'acknowledged' },
  triaged: {
    infoRequested: 'awaitingInfo',
    planned: 'planned',
    replied: 'replied',
    closed: 'closed',
  },
  awaitingInfo: {
    infoReceived: 'triaged',
    planned: 'planned',
    replied: 'replied',
    closed: 'closed',
  },
  planned: { replied: 'replied', closed: 'closed', reopened: 'planned' },
  replied: { closed: 'closed', reopened: 'replied', edited: 'acknowledged' },
  closed: { reopened: 'acknowledged', edited: 'closed', polled: 'closed' },
}

/** The machine's one step. `polled` and `edited` re-drive an open flow
without repeating a post; anything unlisted throws, never silently. An
edit drops the flow back to `acknowledged`: its findings are stale, and
the poll clears them. */
export function nextWatchdogState(state: WatchdogState, event: WatchdogEvent): WatchdogState {
  // An open flow re-reads its issue every poll and stays where it is.
  if (event === 'polled' && state !== 'closed') return state
  // An edited open issue is triaged again; a post is never repeated.
  if (event === 'edited' && (state === 'acknowledged' || state === 'triaged')) return 'acknowledged'
  const next = TRANSITIONS[state][event]
  if (next === undefined) throw new Error(`watchdog cannot move from ${state} on ${event}`)
  return next
}

/** The language detector's choice under rule 9: English. The templates
stay in the person's installed language; detection beyond English waits
for the pinned trigram table. */
export function detectWatchdogLanguage(_text: string): 'en' {
  return 'en'
}

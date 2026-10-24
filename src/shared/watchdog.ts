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

/** One watched issue. `runId` is minted per flow and names every reply it
posts: a record without one (a restart that dropped it) must fail rather
than post twice. `triageRound` counts the triages the flow has taken in,
so each round's reply is its own post. `lastTextHash` is the hash of the
title and body the findings were judged on: an edit changes it. */
export const watchdogIssueSchema = z.strictObject({
  repository: z.string(),
  issueNumber: z.number(),
  issueId: z.number(),
  state: watchdogStateSchema,
  // Written into the HTML comment that names each reply: nothing that could close it.
  runId: z.string().check(z.regex(/^[\w-]+$/u)),
  seenAtMs: z.number(),
  ackCommentId: z.optional(z.number()),
  /** The needs-info reply's comment: an answer is a later comment. */
  replyCommentId: z.optional(z.number()),
  labelsApplied: z.array(z.string()),
  triageRound: z.number(),
  findings: z.optional(triageFindingsSchema),
  outcome: z.optional(watchdogOutcomeSchema),
  lastTitle: z.string(),
  lastTextHash: z.string(),
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
  acknowledged: {
    triaged: 'triaged',
    closed: 'closed',
    reopened: 'acknowledged',
    edited: 'acknowledged',
  },
  triaged: {
    infoRequested: 'awaitingInfo',
    planned: 'planned',
    replied: 'replied',
    closed: 'closed',
    edited: 'acknowledged',
  },
  // The reporter's answer or edit makes the findings stale: the flow
  // returns to acknowledged and triages again, in a new round.
  awaitingInfo: { infoReceived: 'acknowledged', edited: 'acknowledged', closed: 'closed' },
  planned: { replied: 'replied', closed: 'closed', reopened: 'planned', edited: 'planned' },
  replied: { closed: 'closed', reopened: 'replied', edited: 'acknowledged' },
  closed: { reopened: 'acknowledged', edited: 'closed', polled: 'closed' },
}

/** The machine's one step. `polled` re-drives an open flow where it is;
anything unlisted throws, never silently. An edit (or the reporter's
answer) drops the flow back to `acknowledged`: its findings are stale, and
the poll clears them. A post is never repeated by it: each reply is named
by its flow, round and kind. */
export function nextWatchdogState(state: WatchdogState, event: WatchdogEvent): WatchdogState {
  // An open flow re-reads its issue every poll and stays where it is.
  if (event === 'polled' && state !== 'closed') return state
  const next = TRANSITIONS[state][event]
  if (next === undefined) throw new Error(`watchdog cannot move from ${state} on ${event}`)
  return next
}

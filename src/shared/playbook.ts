// M116 lane 0 / PLAN D96. Shared contracts only: policy belongs to lane P,
// rendering to U, and planners/adapters to I. No Node, DOM or vscode imports.
import * as z from 'zod/mini'
import {
  PLAYBOOK_CONFIGURABLE_RULES,
  PLAYBOOK_FINDING_CLASSES,
  PLAYBOOK_ID_MAX_CHARS,
  PLAYBOOK_PATCH_ROUNDS_MAX,
  PLAYBOOK_RECORD_FOLDER,
  PLAYBOOK_SAFETY_RULE,
  REVIEW_FINDING_PATH_MAX_CHARS,
  REVIEW_FINDING_TEXT_MAX_CHARS,
  REVIEW_FINDINGS_MAX,
} from './constants'
import { reviewResolutionSchema, type ReviewBlock, type ReviewResolution } from './reviewFindings'

export type PlaybookFindingClass = (typeof PLAYBOOK_FINDING_CLASSES)[number]
export type PlaybookConfigurableRule = (typeof PLAYBOOK_CONFIGURABLE_RULES)[number]
export type PlaybookRule = PlaybookConfigurableRule | typeof PLAYBOOK_SAFETY_RULE

const id = z.string().check(z.trim(), z.minLength(1), z.maxLength(PLAYBOOK_ID_MAX_CHARS))
const reason = z
  .string()
  .check(z.trim(), z.minLength(1), z.maxLength(REVIEW_FINDING_TEXT_MAX_CHARS))
const file = z.string().check(z.trim(), z.minLength(1), z.maxLength(REVIEW_FINDING_PATH_MAX_CHARS))
const timestamp = z.int().check(z.gte(0))

const ruleSetting = z.discriminatedUnion('enabled', [
  z.strictObject({ enabled: z.literal(true) }),
  z.strictObject({ enabled: z.literal(false), reason, actor: id, at: timestamp }),
])

const override = z.strictObject({ actor: z.enum(['lead', 'owner']), reason, at: timestamp })

/** G20: the user's pre-named reviewer for classifier-blocked reviews. Setting
 * or clearing it needs a real user decision through authorizeOverride; an
 * agent-supplied actor never grants it. Shown in settings and in every use. */
export const playbookFallbackReviewerSchema = z.strictObject({
  reviewerId: id,
  ...override.shape,
})

/** Strict keys deliberately reject a safety-rule switch and an increased ceiling. */
export const playbookSettingsSchema = z.strictObject({
  teamId: id,
  rules: z.record(z.enum(PLAYBOOK_CONFIGURABLE_RULES), ruleSetting),
  patchRoundsMax: z.int().check(z.gte(1), z.lte(PLAYBOOK_PATCH_ROUNDS_MAX)),
  fallbackReviewer: z.optional(playbookFallbackReviewerSchema),
})
export type PlaybookSettings = z.infer<typeof playbookSettingsSchema>

/** A fresh team's eight switches are on. Before M96, teamId is the workspace's panel. */
export function defaultPlaybookSettings(teamId: string): PlaybookSettings {
  return playbookSettingsSchema.parse({
    teamId,
    rules: Object.fromEntries(PLAYBOOK_CONFIGURABLE_RULES.map((rule) => [rule, { enabled: true }])),
    patchRoundsMax: PLAYBOOK_PATCH_ROUNDS_MAX,
  })
}

/** Unknown model classes survive parsing but do not create a new policy class. */
export function knownFindingClass(value: string | undefined): PlaybookFindingClass | undefined {
  return PLAYBOOK_FINDING_CLASSES.find((entry) => entry === value?.toLowerCase())
}

/** P assigns id once and journals each snapshot. A rename keeps that id;
 * splits/merges inherit the maximum predecessor round, per class and aggregate.
 * Any changed key/file set for existing code requires lineage. P refuses files
 * overlapping a struck module's last file set without lineage unless a recorded
 * lead/owner override exists. New lanes/branches cannot reset these counters. */
export const playbookModuleSchema = z.strictObject({
  id,
  key: file,
  files: z.array(file).check(z.minLength(1), z.maxLength(REVIEW_FINDINGS_MAX)),
  source: z.enum(['lane', 'team', 'directory']),
  lineage: z.optional(
    z.union([
      z.strictObject({ renamedFrom: id }),
      z.strictObject({ splitFrom: id }),
      z.strictObject({
        mergedFrom: z.array(id).check(z.minLength(2), z.maxLength(REVIEW_FINDINGS_MAX)),
      }),
    ]),
  ),
})
export type PlaybookModule = z.infer<typeof playbookModuleSchema>

const reviewAgents = z.strictObject({
  implementerId: id,
  reviewerId: id,
  implementerSessionId: id,
  reviewerSessionId: id,
})
/** Supplied by the harness from its lane registry, never from model metadata.
 * P refuses equal agent ids or shared sessions before consuming the review. */
export type PlaybookReviewAgents = z.infer<typeof reviewAgents>

const briefSection = z.string().check(z.trim(), z.minLength(1))
/** G3: the dispatch brief envelope. Rendered structurally (never by text
 * substitution), checked for required sections and placeholders, and hashed
 * before dispatch. M96's planner renders through the same envelope. */
export const playbookBriefSchema = z.strictObject({
  objective: briefSection,
  scope: z.array(briefSection).check(z.minLength(1)),
  acceptance: z.array(briefSection).check(z.minLength(1)),
  baseCommit: briefSection.check(z.regex(/^[a-f\d]+$/u)),
})
export type PlaybookBrief = z.infer<typeof playbookBriefSchema>

/** G17: what the orchestrator saw of the shared repository configuration
 * before a job: the effective hooks directory source and its file list.
 * Compared after the job; any difference is reported as config drift. */
export const playbookConfigSnapshotSchema = z.strictObject({
  hooksPath: z.string().check(z.maxLength(REVIEW_FINDING_PATH_MAX_CHARS)),
  files: z.array(file).check(z.maxLength(REVIEW_FINDINGS_MAX)),
})
export type PlaybookConfigSnapshot = z.infer<typeof playbookConfigSnapshotSchema>

/** Harness-issued identity; a release never makes an old generation valid. */
const leaseToken = z.strictObject({ moduleId: id, laneId: id, ownerId: id, generation: id })
export type PlaybookLease = z.infer<typeof leaseToken>

/** No review text or file contents in the journal: only host-assigned references. */
const findingRef = z.strictObject({
  id,
  file,
  severity: z.enum(['P1', 'P2', 'P3']),
  line: z.optional(z.int().check(z.gte(1))),
  class: z.optional(z.enum(PLAYBOOK_FINDING_CLASSES)),
})
const answer = z.discriminatedUnion('status', [
  z.strictObject({ findingId: id, status: z.literal('fixed') }),
  z.strictObject({ findingId: id, status: z.literal('disputed'), reason }),
  z.strictObject({
    findingId: id,
    status: z.literal('residual'),
    name: id,
    whySafe: reason,
    followUp: reason,
  }),
  z.strictObject({ findingId: id, status: z.literal('override'), ...override.shape }),
])

/** P requires every prior id's disposition: fix P1, fix P2 unless redesign is
 * needed; residuals must be named. A dispute grants no exception; an override
 * names lead/owner, reason and time. The adapter maps critical/high/other known
 * severities to P1/P2/P3; absent/unknown severity stays P1 until clarified. */
export const playbookRoundSchema = z.strictObject({
  module: playbookModuleSchema,
  ...reviewAgents.shape,
  lease: z.optional(leaseToken),
  // Omitted class is the module aggregate; named class is its own counter.
  class: z.optional(z.enum(PLAYBOOK_FINDING_CLASSES)),
  round: z.int().check(z.gte(1)),
  phase: z.enum(['build', 'fix', 'redesign']),
  findings: z.array(findingRef).check(z.maxLength(REVIEW_FINDINGS_MAX)),
  answers: z.array(answer).check(z.maxLength(REVIEW_FINDINGS_MAX)),
  // Redesign answers retain each prior id/outcome/reason, not only an aggregate.
  resolution: z.optional(z.array(reviewResolutionSchema).check(z.maxLength(REVIEW_FINDINGS_MAX))),
  at: timestamp,
})
export type PlaybookRound = z.infer<typeof playbookRoundSchema>

export const playbookDesignDecisionSchema = z.strictObject({
  id,
  module: playbookModuleSchema,
  class: z.optional(z.enum(PLAYBOOK_FINDING_CLASSES)),
  failureClass: reason,
  whyPatchesFailed: reason,
  structuralChange: reason,
  planLocation: file,
  redesignLane: id,
  // P closes only when every prior id has an impossible answer. Caught is
  // evidence of a gate, not structural closure; remains escalates to the user.
  outcome: z.enum(['pending', 'impossible', 'caught', 'remains']),
  at: timestamp,
})
export type PlaybookDesignDecision = z.infer<typeof playbookDesignDecisionSchema>

/** Render at use time from UI_TEXT; text is never evaluated at module load. */
export const playbookWhyNoteSchema = z.strictObject({
  rule: z.enum([...PLAYBOOK_CONFIGURABLE_RULES, PLAYBOOK_SAFETY_RULE]),
  code: z.enum([
    'checksPassed',
    'redesignRequired',
    'designRequired',
    'redesignOpen',
    'redesignEscalated',
    'coverageIncomplete',
    'answersPending',
    'lineageRequired',
    'reviewerConflict',
    'contractsPending',
    'prerequisiteMissing',
    'reordered',
    'offloaded',
    'localCheck',
    'ciGate',
    'integrationRequired',
    'drillMissing',
    'ownerFirst',
    'hookTampering',
    'hookVerificationFailed',
    'unverifiedCommit',
    'gateSkipped',
    'permissionLaundering',
    'classifierBlocked',
    'ruleDisabled',
    'briefRecorded',
    'configDrift',
    'fallbackReviewer',
    'residualOpen',
  ]),
  module: z.optional(file),
  laneId: z.optional(id),
  workerId: z.optional(id),
  round: z.optional(z.int().check(z.gte(1))),
  classes: z.optional(
    z.array(z.enum(PLAYBOOK_FINDING_CLASSES)).check(z.maxLength(PLAYBOOK_FINDING_CLASSES.length)),
  ),
  missing: z.optional(z.array(id).check(z.maxLength(REVIEW_FINDINGS_MAX))),
  actor: z.optional(id),
  reason: z.optional(reason),
  at: timestamp,
  needsUser: z.boolean(),
})
export type PlaybookWhyNote = z.infer<typeof playbookWhyNoteSchema>
export type PlaybookDecision =
  | { readonly kind: 'allow'; readonly note: PlaybookWhyNote; readonly lease?: PlaybookLease }
  | { readonly kind: 'refuse'; readonly note: PlaybookWhyNote }

/** Each JSONL line is validated. P supplies bounded retention and second scrubbing. */
export const playbookRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('module'),
    value: z.strictObject({
      module: playbookModuleSchema,
      override: z.optional(override),
      at: timestamp,
    }),
  }),
  z.strictObject({ kind: z.literal('round'), value: playbookRoundSchema }),
  z.strictObject({ kind: z.literal('design'), value: playbookDesignDecisionSchema }),
  z.strictObject({ kind: z.literal('note'), value: playbookWhyNoteSchema }),
  z.strictObject({ kind: z.literal('settings'), value: playbookSettingsSchema }),
  z.strictObject({
    kind: z.literal('lease'),
    value: z.strictObject({
      ...leaseToken.shape,
      status: z.enum(['held', 'released']),
      at: timestamp,
    }),
  }),
  z.strictObject({
    kind: z.literal('work'),
    value: z.strictObject({
      id,
      moduleId: id,
      refs: z.array(file).check(z.minLength(1)),
      baseline: z.array(id),
      hookDigest: id,
      /** G17: the shared-config snapshot at dispatch; drift is reported, never silent. */
      config: z.optional(playbookConfigSnapshotSchema),
      at: timestamp,
    }),
  }),
  z.strictObject({
    kind: z.literal('verification'),
    value: z.strictObject({
      workId: id,
      moduleId: id,
      commit: id,
      hookDigest: id,
      scope: z.enum(['commit', 'push']),
      result: z.enum(['pass', 'fail']),
      at: timestamp,
    }),
  }),
  z.strictObject({
    kind: z.literal('residual'),
    value: z.strictObject({
      milestoneId: id,
      name: id,
      status: z.literal('accepted'),
      actor: z.enum(['lead', 'owner']),
      reason,
      at: timestamp,
    }),
  }),
])
export type PlaybookRecord = z.infer<typeof playbookRecordSchema>

/** Relative to agentDataFolder; caller joins with its platform's path API. */
export function playbookRecordFile(workspaceKey: string): string {
  // Workspace hashes and safe slugs are valid; no path separators or dot segments.
  const safeKey = id.check(z.regex(/^[\w-]+$/u)).parse(workspaceKey)
  return `${PLAYBOOK_RECORD_FOLDER}/${safeKey}.jsonl`
}

export interface PlaybookLane {
  readonly id: string
  readonly milestoneId: string
  readonly kind: 'contracts' | 'patch' | 'redesign' | 'docs'
  readonly module: PlaybookModule
  /** Namespaced ids: a lane or a milestone; merged ids come from trusted board facts. */
  readonly starts: readonly string[]
  readonly estimateHours: number
  readonly merged: boolean
  readonly reviewed: boolean
  readonly addsTestsOrGates: boolean
  readonly drills: readonly PlaybookDrill[]
  readonly integrationTrunk: string
  readonly mergedTrunks: readonly string[]
  readonly designDecisionId?: string
}

export interface PlaybookDrill {
  readonly guard: string
  readonly mutation: string
  readonly test: string
  readonly observedFailure: string
  readonly beforeSha256: string
  readonly restoredSha256: string
}

export interface PlaybookBoard {
  readonly lanes: readonly PlaybookLane[]
  readonly mergedPrerequisites: readonly string[]
  readonly workers: readonly { readonly id: string; readonly available: boolean }[]
  readonly hasCi: boolean
}
export interface PlaybookPlanPort {
  readBoard(): PlaybookBoard
}

/** Trusted harness freezes these object ids before verification and push. */
export interface PlaybookPushRange {
  readonly remote: string
  readonly url: string
  readonly updates: readonly {
    readonly localRef: string
    readonly localOid: string
    readonly remoteRef: string
    readonly remoteOid: string
  }[]
}

/** Compare effect+subject, not spelling or requester, when guarding a retry. */
export interface PlaybookAction {
  readonly effect: string
  readonly subject: string
}
export type PlaybookCommand = PlaybookAction &
  (
    | { readonly kind: 'shell'; readonly command: string }
    | { readonly kind: 'edit'; readonly paths: readonly string[] }
    | { readonly kind: 'gate'; readonly gate: string; readonly skip: boolean }
  )
export interface PlaybookRequester {
  readonly agentId: string
  readonly teamId: string
}
export interface PlaybookOrderDecision {
  readonly kind: 'allow'
  readonly queue: readonly PlaybookLane[]
  readonly notes: readonly PlaybookWhyNote[]
}

export interface PlaybookCheck {
  readonly id: string
  readonly heavy: boolean
  readonly fullGate: boolean
}
export interface PlaybookCheckDecision {
  readonly kind: 'allow'
  readonly target:
    { readonly kind: 'local' | 'ci' } | { readonly kind: 'worker'; readonly id: string }
  readonly note: PlaybookWhyNote
}
export interface PlaybookReportItem {
  readonly id: string
  readonly needsUser: boolean
  readonly failing: boolean
}

/** Synchronous admission: adapters must check immediately before the effect.
 * No authorization is granted by this port; existing tool/paid gates still run.
 * Incomplete coverage is refused without incrementing any round. */
export interface PlaybookPolicy {
  beginWork(module: PlaybookModule, refs: readonly string[]): string
  verifyWork(
    workId: string,
    range?: PlaybookPushRange,
  ): { readonly decision: PlaybookDecision; readonly output: string }
  beforePush(workId: string, range: PlaybookPushRange): PlaybookDecision
  finishWork(workId: string): PlaybookDecision
  renewPatch(module: PlaybookModule, lease: PlaybookLease): PlaybookDecision
  releasePatch(module: PlaybookModule, lease: PlaybookLease): PlaybookDecision
  beforeDispatch(lane: PlaybookLane, board: PlaybookBoard): PlaybookDecision
  beforeReview(
    module: PlaybookModule,
    agents: PlaybookReviewAgents,
    lease?: PlaybookLease,
  ): PlaybookDecision
  afterReview(
    module: PlaybookModule,
    review: ReviewBlock,
    agents: PlaybookReviewAgents,
    lease?: PlaybookLease,
  ): PlaybookDecision
  beforeFixRound(module: PlaybookModule): PlaybookDecision
  beforeMerge(lane: PlaybookLane): PlaybookDecision
  beforeCommand(command: PlaybookCommand, requester: PlaybookRequester): PlaybookDecision
  beforeCheck(
    check: PlaybookCheck,
    board: PlaybookBoard,
  ): PlaybookCheckDecision | { readonly kind: 'refuse'; readonly note: PlaybookWhyNote }
  orderReport(items: readonly PlaybookReportItem[]): {
    readonly items: readonly PlaybookReportItem[]
    readonly note: PlaybookWhyNote
  }
  /** A cycle or unresolved dependency refuses ordering; there is no empty success. */
  order(
    queue: readonly PlaybookLane[],
  ): PlaybookOrderDecision | { readonly kind: 'refuse'; readonly note: PlaybookWhyNote }
  answerFindings(module: PlaybookModule, answers: PlaybookRound['answers']): PlaybookDecision
  recordDesignDecision(decision: PlaybookDesignDecision): PlaybookDecision
  resolveRedesign(
    module: PlaybookModule,
    resolutions: readonly ReviewResolution[],
  ): PlaybookDecision
  /** Call after an existing permission/classifier gate refuses an effect. */
  recordRefusal(
    action: PlaybookAction,
    requester: PlaybookRequester,
    source: 'permission' | 'classifier',
  ): void
  /** G3: render and record the dispatch brief before any effect. */
  recordBrief(module: PlaybookModule, brief: PlaybookBrief): PlaybookDecision
  /** G20: the user's pre-named fallback reviewer for the classifier-blocked
   * action, or the suggested agents unchanged (with no note) when no recorded
   * block, no named fallback, or a reviewer conflict applies. The blocked
   * action itself is never retried or rerouted; rule 9 stands. */
  applyFallbackReviewer(
    module: PlaybookModule,
    agents: PlaybookReviewAgents,
    action: PlaybookAction,
  ): { readonly agents: PlaybookReviewAgents; readonly note: PlaybookWhyNote | undefined }
  /** G24: accept a named residual with a real user decision. */
  acceptResidual(
    milestoneId: string,
    name: string,
    reason: string,
    lanes: readonly PlaybookLane[],
  ): PlaybookDecision
  /** G24: refuse while the milestone's residual register has open entries.
   * Lanes carry the module-to-milestone facts; the register derives the rest. */
  releaseReady(milestoneId: string, lanes: readonly PlaybookLane[]): PlaybookDecision
}

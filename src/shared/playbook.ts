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
import type { ReviewBlock, ReviewResolution } from './reviewFindings'

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

/** Strict keys deliberately reject a safety-rule switch and an increased ceiling. */
export const playbookSettingsSchema = z.strictObject({
  teamId: id,
  rules: z.record(z.enum(PLAYBOOK_CONFIGURABLE_RULES), ruleSetting),
  patchRoundsMax: z.int().check(z.gte(1), z.lte(PLAYBOOK_PATCH_ROUNDS_MAX)),
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

export const playbookModuleSchema = z.strictObject({
  key: file,
  files: z.array(file).check(z.minLength(1), z.maxLength(REVIEW_FINDINGS_MAX)),
  source: z.enum(['lane', 'team', 'directory']),
})
export type PlaybookModule = z.infer<typeof playbookModuleSchema>

/** No review text or file contents in the journal: only host-assigned references. */
const findingRef = z.strictObject({
  id,
  file,
  line: z.optional(z.int().check(z.gte(1))),
  class: z.optional(z.enum(PLAYBOOK_FINDING_CLASSES)),
})
const answer = z.discriminatedUnion('status', [
  z.strictObject({ findingId: id, status: z.literal('fixed') }),
  z.strictObject({ findingId: id, status: z.literal('disputed'), reason }),
])

export const playbookRoundSchema = z.strictObject({
  module: playbookModuleSchema,
  // Omitted class is the module aggregate; named class is its own counter.
  class: z.optional(z.enum(PLAYBOOK_FINDING_CLASSES)),
  round: z.int().check(z.gte(1)),
  phase: z.enum(['build', 'fix', 'redesign']),
  findings: z.array(findingRef).check(z.maxLength(REVIEW_FINDINGS_MAX)),
  answers: z.array(answer).check(z.maxLength(REVIEW_FINDINGS_MAX)),
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
    'gateSkipped',
    'permissionLaundering',
    'classifierBlocked',
    'ruleDisabled',
  ]),
  module: z.optional(file),
  laneId: z.optional(id),
  round: z.optional(z.int().check(z.gte(1))),
  classes: z.optional(z.array(z.enum(PLAYBOOK_FINDING_CLASSES))),
  missing: z.optional(z.array(id).check(z.maxLength(REVIEW_FINDINGS_MAX))),
  actor: z.optional(id),
  reason: z.optional(reason),
  at: timestamp,
  needsUser: z.boolean(),
})
export type PlaybookWhyNote = z.infer<typeof playbookWhyNoteSchema>
export type PlaybookDecision =
  | { readonly kind: 'allow'; readonly note: PlaybookWhyNote }
  | { readonly kind: 'refuse'; readonly note: PlaybookWhyNote }

/** Each JSONL line is validated. P supplies bounded retention and second scrubbing. */
export const playbookRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('round'), value: playbookRoundSchema }),
  z.strictObject({ kind: z.literal('design'), value: playbookDesignDecisionSchema }),
  z.strictObject({ kind: z.literal('note'), value: playbookWhyNoteSchema }),
  z.strictObject({ kind: z.literal('settings'), value: playbookSettingsSchema }),
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
  beforeDispatch(lane: PlaybookLane, board: PlaybookBoard): PlaybookDecision
  beforeReview(module: PlaybookModule): PlaybookDecision
  afterReview(module: PlaybookModule, review: ReviewBlock): PlaybookDecision
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
}

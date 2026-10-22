import type { UsageRecording } from '../../usage/recording'
// One `muse serve` process and the MSP sessions multiplexed over it.
//
// Built on the SDK's raw `Connection` rather than its `MuseClient` facade:
// `Connection.onNotification` holds a single handler, and the extension needs
// that handler for session-state notifications the facade does not surface.
// The process boundary (`MspHost`) is injected so unit tests drive the class
// through a fake in-memory transport.

import { editAutomaticallyChoice } from '../../agent/approvalRules'
import type { UnattendedRun, ScheduledAgentSession } from '../../schedules/unattended'
import { SessionOwner, type SessionToken, type SessionEffect } from '../../schedules/sessionOwner'
import type { ScheduleApprovalAction } from '../../../shared/scheduleV2'
import { mspApprovalMode } from '../../../shared/permissionModes'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { observeAgentItem, observeChildReceipt } from '../../agent/agentObservation'
import type { ChildProcess } from 'node:child_process'
import { spawnGuarded } from '../../guardedChildProcess'
import type { GuardedChildEnv } from '../../executables'
// Exact SDK pin: reuse bounded process teardown while wrapping actual submission.
import { ChildStdioTransport } from '@muse-code/sdk/dist/src/connection/spawn.js'
// Deep SDK imports (never the barrel): the barrel's facade, fold and
// pending layers would ride into dist/museCode.js unused. `connection.js`
// and `fingerprint.js` take only node:crypto and nothing, respectively.
import {
  Connection,
  MspError,
  ProtocolError,
  type DuplexTransport,
} from '@muse-code/sdk/dist/src/connection/connection.js'
import { checkServedFingerprint } from '@muse-code/sdk/dist/src/fingerprint.js'
import type {
  MspHandshake,
  SpawnMspConnectionOptions,
} from '@muse-code/sdk/dist/src/connection/spawn.js'
import type { MuseCodeAccountHome } from './accountHomes'
import type { ModeSyncOps } from './approvalModesEntry'
import * as z from 'zod/mini'
import {
  type AgentEvent,
  type ItemSnapshot,
  type QuestionAnswer,
  type RequirementRef,
  requirementRefSchema,
  type SessionGoal,
} from '../../../shared/agentEvents'
import {
  APPROVAL_REJECT_ATTEMPTS,
  APPROVAL_REJECT_DEADLINE_MS,
  CLARIFICATION_FORMAT,
  CONTRIBUTOR_MODEL_SUFFIX,
  GOAL_RECOVERY_MAX_PAGES,
  GOAL_RECOVERY_PAGE_LIMIT,
  JSON_RPC_ERRORS,
  MILLISECONDS_PER_SECOND,
  MSP_ATTACHMENT_FRAME_BUDGET_BYTES,
  MSP_COMMAND_ATTEMPTS,
  MSP_FRAME_LIMIT_BYTES,
  MSP_LONG_COMMANDS,
  MSP_RETRY_BASE_DELAY_MS,
  MSP_RETRY_MAX_DELAY_MS,
  MSP_RETRYABLE_REFUSALS,
  MSP_SESSION_LIST_MAX_LIMIT,
  MSP_STEER_NO_TURN_REASONS,
  QUESTION_DEFER_DEFAULT_SECONDS,
  MSP_UNRESPONSIVE_MISSES,
  MSP_UNRESPONSIVE_SILENCE_MS,
  STILL_WAITING_NOTICE_MS,
  MSP_USER_SHELL_CAPABILITY,
  MUSE_APPROVAL_LEDGER_FAULT,
  MUSE_APPROVAL_REPLAY_FAULT,
  MUSE_AUTO_REVIEW_PROFILE,
  MUSE_EVENT_LOG_FAULT,
  MUSE_EXIT_PERSISTENT_CODES,
  type EffortLevel,
  MSP_SETTLE_TIMEOUT_MS,
  type SubagentAction,
  UI_TEXT,
} from '../../../shared/constants'
import { isEffortLevel } from '../../../shared/effort'
import { fill } from '../../../shared/l10n/text'
import { DeadlineError, startStillWaiting, stillWaitingText, withDeadline } from '../../timeouts'
import { textFileInput } from '../../textAttachment'
import {
  type SubscriptionUsage,
  subscriptionUsageSchema,
  usageReadResultSchema,
} from '../../../shared/usage'
import { backgroundTaskRowSchema, sessionHookRowSchema } from '../../../shared/sessionLists'
import {
  type AgentHost,
  type ApprovalDecision,
  type CompactOutcome,
  type ComputerUseSettingsInfo,
  type ComputerUseSetup,
  type ForeignSkillImport,
  type GoalCommand,
  type GoalCommandOutcome,
  type GoalRefusal,
  type HostExit,
  type HostInfo,
  type ListSessionsOptions,
  type LoadedSession,
  type ModelSummary,
  type MuseCodeFault,
  type BackgroundTaskSummary,
  type OutputPage,
  type OutputPageRequest,
  type QueuedMessageRef,
  type SessionEventListener,
  type SessionHistoryOutcome,
  type SessionHookRow,
  type SessionListEvent,
  type SessionMcpServer,
  type SessionPage,
  type SessionPluginRow,
  type SessionLeave,
  type SessionRecap,
  type SkillActivation,
  type SkillActivationChange,
  type SkillSummary,
  type StartSessionOptions,
  type TurnPart,
  type TurnSubmission,
  type WithdrawOutcome,
  type WorkflowChildControl,
  DecisionNotAppliedError,
  GoalRefusedError,
  isPromptSettledError,
  MuseCodeFaultError,
  PromptSettledError,
  type PromptSettledReason,
  SessionNotLoadedError,
  SteerRefusedError,
} from '../../agent/agentBackend'

import type { CoreLogger } from '../../logging'
import { wireWordForLog } from '../../logging'
import { notify } from '../../events/notify'
import {
  MALFORMED_PARAMS,
  mapNotification,
  type MappedNotification,
  type MuseCodeLifecycleEvent,
  type MuseCodeLifecycleReader,
  UNKNOWN_METHOD,
  type WireNotification,
} from './mapNotification'
import type { MuseUsageDeltas, UsageNotesBundle } from './usageDeltas'
import { failureForLog } from './logText'
import { redactSecrets } from '../../../shared/redact'
import { PromptLedger } from './promptLedger'
import {
  NATIVE_FEEDBACK_READER,
  submitMuseFeedback,
  type FeedbackOutcomeReader,
  type FeedbackRequest,
} from './feedback'
import {
  historyOutcome,
  sessionClosedSchema,
  type SessionEnvelope,
  sessionEnvelopeSchema,
  sessionListChangedSchema,
  sessionListResultSchema,
  sessionRenameResultSchema,
} from './sessionRecords'

/** What the SDK's `SpawnedMspConnection` provides, narrowed to what we use. */
export interface MspHost {
  readonly connection: Connection
  /** Required for an account lease: owns the SDK transport submission boundary. */
  readonly commandOwner?: MuseCodeCommandOwner
  readonly initializeResult: unknown
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>
  close(): Promise<unknown>
}

/** The MSP host's identity plus what the extension logs about it. */
export interface MuseHostInfo extends HostInfo {
  readonly museHome: string
  /** Whether the host can enforce the sandbox (1.4.7); unknown when the host predates the field. */
  readonly sandboxAvailability?: string | undefined
  /** Why enforcement is impossible; set only when unavailable. */
  readonly sandboxUnavailableReason?: string | undefined
}

export interface MuseCodeEffortInfo {
  readonly variants?: readonly string[] | 'unknown' | undefined
  readonly reasoningEffortVariants?:
    | readonly {
        readonly tier: string
        readonly description?: string | undefined
      }[]
    | undefined
  readonly defaultReasoningEffort?: string | undefined
}

/**
Reads one `model/list` row's effort metadata (Muse Code 1.4.x carries the
tiers a model serves, a described subset and the default; verified
2026-10-18 on 1.4.10,
test/fixtures/muse-contributor/model-list-1.4.10.json). Unknown fields
stay absent, never guessed.
*/
export function parseMuseCodeEffortInfo(row: unknown): MuseCodeEffortInfo {
  const parsed = museCodeEffortRowSchema.safeParse(row)
  if (!parsed.success) return {}
  const { variants, reasoningEffortVariants, defaultReasoningEffort } = parsed.data
  return {
    ...(variants !== undefined && { variants }),
    ...(reasoningEffortVariants !== undefined && {
      reasoningEffortVariants: reasoningEffortVariants.map((variant) => ({
        tier: variant.tier,
        ...(variant.description !== undefined && { description: variant.description }),
      })),
    }),
    ...(defaultReasoningEffort !== undefined && { defaultReasoningEffort }),
  }
}

const museCodeEffortRowSchema = z.looseObject({
  variants: z.optional(z.union([z.literal('unknown'), z.array(z.string())])),
  reasoningEffortVariants: z.optional(
    z.array(z.looseObject({ tier: z.string(), description: z.optional(z.string()) })),
  ),
  defaultReasoningEffort: z.optional(z.string()),
})

/**
The slider steps and default for one model's effort metadata: the row's
tiers in order, kept only where they name a UI tier, deduplicated; the
row's default where it names one. Empty where the row carries nothing
the UI can offer (the static family table applies downstream).
*/
export function museModelEffortTiers(info: MuseCodeEffortInfo): {
  readonly levels: readonly EffortLevel[]
  readonly defaultEffort: EffortLevel | undefined
} {
  const names: readonly string[] =
    Array.isArray(info.variants) && info.variants.length > 0
      ? info.variants
      : (info.reasoningEffortVariants ?? []).map((variant) => variant.tier)
  const levels: EffortLevel[] = []
  for (const name of names) {
    if (isEffortLevel(name) && !levels.includes(name)) levels.push(name)
  }
  const fallback = info.defaultReasoningEffort
  return {
    levels,
    defaultEffort: fallback !== undefined && isEffortLevel(fallback) ? fallback : undefined,
  }
}

/** The default effort port: every host construction site supplies it. */
export const museCodeEffortPort = {
  modelEfforts: { parseModel: parseMuseCodeEffortInfo },
} satisfies Required<Pick<MuseCodeFeaturePorts, 'modelEfforts'>>

export interface MuseCodeModelSummary extends ModelSummary, MuseCodeEffortInfo {}

/** Readers are injected only after their raw frames have captured zod schemas. */
export interface MuseCodeFeaturePorts {
  readonly feedback?: FeedbackOutcomeReader
  readonly lifecycle?: MuseCodeLifecycleReader
  readonly modelEfforts?: {
    parseModel(row: unknown): MuseCodeEffortInfo
  }
  /**
  True while this host's `serve` runs with `--contributor-mode on` (the
  person's own Muse Code settings enabled it); absent reads as off. The
  CLI's `model/list` never names contributor-tier models (verified
  2026-10-18 on 1.4.10: the same four ids with and without the flag), so
  `listModels` derives each listed model's `-contributor` counterpart by
  name while this holds. The provider, not the product, decides whether
  the person may use one.
  */
  readonly contributorMode?: boolean
}

// The captured-frame reader every backend construction binds (C-M106-3R2):
// the note-only `feedback/submit` receipt
// (test/fixtures/m106/msp-1.4.4-host-feedback.json). The 1.4.4 `model/list`
// effort reader binds the same way, but the manager preloads its module on
// first spawn (see `MuseCodeBackendManager`), so it stays out of the
// activation bundle (lane K budget) while every spawn reads the same
// catalogue. No lifecycle reader: 1.4.4 sends no delete frames, so deletion
// stays refused with sessionDeleteUnsupported and History stays
// archive-only.
export const NATIVE_MUSE_CODE_FEATURE_PORTS: MuseCodeFeaturePorts = {
  feedback: NATIVE_FEEDBACK_READER,
}

const SESSION_LIST_CHANGED = 'session/listChanged'
const SESSION_CLOSED = 'session/closed'
const USAGE_CHANGED = 'usage/changed'
const USAGE_READ = 'usage/read'
// A resume asks for the folded snapshot (M45): the same items as `inline`
// plus the session's name, todo list and goal, which inline history lacks
// and which no notification repeats after a resume (captured 2026-09-25).
const HISTORY_PREFERENCE_SNAPSHOT = 'snapshot'
const VIEW_PAGE = 'view/page'

// Captured from Muse Code 1.3.0 on 2026-09-25: backward pages return
// ascending unframed notifications and a nullable cursor for the next page.
const viewPageResultSchema = z.object({
  events: z.array(z.object({ method: z.string(), params: z.record(z.string(), z.unknown()) })),
  nextCursor: z.nullable(z.string()),
})

const initializeResultSchema = z.object({
  serverInfo: z.object({ name: z.string(), version: z.string() }),
  museHome: z.string(),
  grantedCapabilities: z.optional(z.array(z.string())),
  // Whether this host can enforce the sandbox (1.4.7): absent reads as
  // unknown, never as available. Served 2026-10-17 by 1.4.9-R6297.1.
  sandboxAvailability: z.optional(z.string()),
  // Sent only when enforcement is impossible; never inferred when absent.
  sandboxUnavailableReason: z.optional(z.string()),
  // Logged once per start (D26); `platformOs` also gates rename and fork.
  platformOs: z.optional(z.string()),
  schema: z.optional(
    z.object({ version: z.optional(z.number()), fingerprint: z.optional(z.string()) }),
  ),
  // Absent reads as `durable` (msp.d.ts InitializeResult.sessionDurability).
  sessionDurability: z.optional(z.string()),
})

const WINDOWS_OS = 'windows'
const DURABLE_SESSIONS = 'durable'

const approvalDecideResultSchema = z.object({ terminal: z.optional(z.boolean()) })

// `approval/listPending`: the payloads of `session/resume`'s pending pointers.
const listPendingResultSchema = z.object({
  approvals: z.array(z.record(z.string(), z.unknown())),
  userInputs: z.array(z.record(z.string(), z.unknown())),
})
// One of them, as far as a failed decision's check reads it.
const pendingStageSchema = z.object({
  approvalId: z.string(),
  currentRequirementId: requirementRefSchema,
})

// The stage token a stale refusal names (`approvalRequirementStale`'s
// `currentRequirementId`, msp.d.ts ErrorData).
const REQUIREMENT_STALE = 'approvalRequirementStale'
const MSP_INTERNAL = 'internal'
// The Reject choice Muse Code offers on every stage (captured 2026-10-02).
const REJECT_DECISION = 'abort'

const sessionStartResultSchema = z.object({
  session: z.object({ sessionId: z.string(), modelId: z.nullable(z.string()) }),
})

// `session/setApprovalMode`'s folded effective mode (msp.d.ts
// SessionSetApprovalModeResult): the mode the CLI actually runs.
const approvalModeResultSchema = z.object({
  effectiveMode: z.object({ mode: z.string() }),
})

const turnStartResultSchema = z.object({
  turnId: z.string(),
  status: z.string(),
  disposition: z.optional(z.string()),
})

const turnSteerResultSchema = z.object({ turnId: z.string(), status: z.string() })

const compactResultSchema = z.object({ status: z.string(), reason: z.optional(z.string()) })

// The shared `goal/*` ack (msp.d.ts GoalCommandResult): `turnId` names the
// turn a set, edit or resume woke (idle) or joined (busy); pause and clear
// never name one (captured live 2026-09-25, M45).
const goalCommandResultSchema = z.object({ status: z.string(), turnId: z.optional(z.string()) })

// A goal command's refusal (live 2026-09-25): `commandRejected` with
// `data.reason` `missing_goal` (no goal) or `invalid_goal_state` (a finished
// goal paused, resumed or edited).
const COMMAND_REJECTED = 'commandRejected'
const GOAL_REFUSALS: ReadonlyMap<string, GoalRefusal> = new Map([
  ['missing_goal', 'noGoal'],
  ['invalid_goal_state', 'wrongState'],
])

/** A goal refusal as a `GoalRefusedError`; anything else unchanged. */
function goalRefusalOr(error: unknown): unknown {
  if (!(error instanceof MspError) || error.kind !== COMMAND_REJECTED) {
    return error
  }
  const reason = error.data['reason']
  const refusal = typeof reason === 'string' ? GOAL_REFUSALS.get(reason) : undefined
  return refusal === undefined ? error : new GoalRefusedError(refusal, error.message)
}

// `turn/unqueue` (M87), captured live 2026-10-04: the ack, and the
// `commandRejected` reasons for a turn that launched or was reclaimed already.
const turnUnqueueResultSchema = z.object({ turnId: z.string(), status: z.string() })
const QUEUED_DISPOSITION = 'queued'
const UNQUEUE_LAUNCHED = 'run_active'
const UNQUEUE_ALREADY_WON = 'already_applied'
const TOO_LATE: WithdrawOutcome = { status: 'tooLate' }

/** The `data.reason` of a `turn/unqueue` refusal; undefined for any other failure. */
function unqueueRefusal(error: unknown): string | undefined {
  if (!(error instanceof MspError) || error.kind !== COMMAND_REJECTED) {
    return undefined
  }
  const reason = error.data['reason']
  return typeof reason === 'string' ? reason : undefined
}

/** Exported for the M127 capture tests: parses the recorded `model/list` result. */
export const modelListResultSchema = z.object({
  models: z.array(
    z.looseObject({
      modelId: z.string(),
      displayLabel: z.string(),
      contextLimit: z.nullable(z.number()),
      // The row's `outputLimit` (M127): `null` when the catalog source
      // declared nothing; absent on older hosts. Served 2026-10-17 by
      // 1.4.9-R6297.1 (`muse schema generate-json-schema`).
      outputLimit: z.optional(z.nullable(z.number())),
      isDefault: z.boolean(),
      isActive: z.optional(z.boolean()),
    }),
  ),
})

/**
One recorded `model/list` row as the summary the picker reads (M127):
`null` limits read as absent. Exported for the capture tests.
*/
export function toModelSummary(
  model: z.infer<typeof modelListResultSchema>['models'][number],
  modelEfforts?: { parseModel(row: unknown): MuseCodeEffortInfo },
): MuseCodeModelSummary {
  const info = modelEfforts?.parseModel(model)
  const tiers = info === undefined ? undefined : museModelEffortTiers(info)
  return {
    modelId: model.modelId,
    displayLabel: model.displayLabel,
    contextLimit: model.contextLimit ?? undefined,
    outputLimit: model.outputLimit ?? undefined,
    isDefault: model.isDefault,
    isActive: model.isActive ?? false,
    ...info,
    // The row's own tiers light the slider; absent, the static family
    // table applies downstream (META-G05).
    ...(tiers !== undefined && tiers.levels.length > 0 && { effortLevels: [...tiers.levels] }),
    ...(tiers?.defaultEffort !== undefined && { defaultEffort: tiers.defaultEffort }),
  }
}

/**
One listed base model's contributor counterpart, by name: the CLI accepts
`<base>-contributor` at `session/start` for every listed base (verified
2026-10-18 on 1.4.10 for all four served ids, and the CLI's own bundled
code-review agent names `muse-wonder-full-1.0-contributor`), while
`model/list` never serves the row itself. Limits and effort support are
the base row's own; the label is the id, never an invented name; a
contributor session is never flagged active on the wire, so neither is
the derived row.
*/
export function toContributorSummary(base: MuseCodeModelSummary): MuseCodeModelSummary {
  return {
    modelId: `${base.modelId}${CONTRIBUTOR_MODEL_SUFFIX}`,
    displayLabel: `${base.modelId}${CONTRIBUTOR_MODEL_SUFFIX}`,
    contextLimit: base.contextLimit,
    ...(base.outputLimit !== undefined && { outputLimit: base.outputLimit }),
    isDefault: false,
    isActive: false,
    ...(base.variants !== undefined && { variants: base.variants }),
    ...(base.reasoningEffortVariants !== undefined && {
      reasoningEffortVariants: base.reasoningEffortVariants,
    }),
    ...(base.defaultReasoningEffort !== undefined && {
      defaultReasoningEffort: base.defaultReasoningEffort,
    }),
  }
}

/**
The contributor counterparts of a `model/list` reading: one per listed
base model, skipping rows that already name the tier (so a future CLI
that serves the rows itself never doubles them).
*/
export function contributorModelSummaries(
  models: readonly MuseCodeModelSummary[],
): readonly MuseCodeModelSummary[] {
  const listed = new Set(models.map((model) => model.modelId))
  return models
    .filter(
      (model) =>
        !model.modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX) &&
        !listed.has(`${model.modelId}${CONTRIBUTOR_MODEL_SUFFIX}`),
    )
    .map((model) => toContributorSummary(model))
}

/**
One recorded `skill/list` row as the summary the palette reads (M127):
the declared `title` rides along only when the skill sets one.
*/
export function toSkillSummary(
  skill: z.infer<typeof skillListResultSchema>['skills'][number],
): SkillSummary {
  return {
    selector: skill.selector,
    displayName: skill.displayName,
    ...(skill.title !== undefined && { title: skill.title }),
    description: skill.description,
    argumentHint: skill.argumentHint,
  }
}

/** Exported for the M127 capture tests. */
export const backgroundTaskListResultSchema = z.object({
  tasks: z.array(backgroundTaskRowSchema),
})

/** One recorded `task/list` row as the summary readers get. */
export function toBackgroundTaskSummary(
  task: z.infer<typeof backgroundTaskListResultSchema>['tasks'][number],
): BackgroundTaskSummary {
  return {
    taskId: task.taskId,
    kind: task.kind,
    status: task.status,
    ...(task.startedAt !== undefined && { startedAt: task.startedAt }),
    ...(task.tool !== undefined && { tool: task.tool }),
    ...(task.backgroundInitiator !== undefined && {
      backgroundInitiator: task.backgroundInitiator,
    }),
  }
}

/** Exported for the M127 capture tests. */
export const hookListResultSchema = z.object({
  hooks: z.array(sessionHookRowSchema),
})

/** One recorded `hook/list` row as readers get it. */
export function toSessionHookRow(
  hook: z.infer<typeof hookListResultSchema>['hooks'][number],
): SessionHookRow {
  return { key: hook.key, event: hook.event, handlerKind: hook.handlerKind, enabled: hook.enabled }
}

/** Exported for the M127 capture tests. */
export const pluginListResultSchema = z.object({
  plugins: z.array(
    z.object({
      id: z.string(),
      version: z.string(),
      enabled: z.boolean(),
      source: z.unknown(),
    }),
  ),
})

/** One recorded `plugin/list` row as readers get it. */
export function toSessionPluginRow(
  plugin: z.infer<typeof pluginListResultSchema>['plugins'][number],
): SessionPluginRow {
  return { id: plugin.id, version: plugin.version, enabled: plugin.enabled, source: plugin.source }
}

const skillImportFailureSchema = z.object({
  id: z.nullable(z.string()),
  reason: z.string(),
})

const skillImportQuarantineSchema = z.object({
  id: z.string(),
  reasons: z.array(z.string()),
})

/** Exported for the M127 capture tests. */
export const skillImportResultSchema = z.object({
  source: z.string(),
  dryRun: z.boolean(),
  status: z.string(),
  counts: z.object({
    installed: z.number(),
    quarantined: z.number(),
    skipped: z.number(),
    failed: z.number(),
  }),
  installed: z.array(z.string()),
  skipped: z.array(z.string()),
  quarantined: z.array(skillImportQuarantineSchema),
  failed: z.array(skillImportFailureSchema),
})

/** A recorded `skill/import` receipt as readers get it. */
export function toForeignSkillImport(
  result: z.infer<typeof skillImportResultSchema>,
): ForeignSkillImport {
  return {
    source: result.source,
    dryRun: result.dryRun,
    status: result.status,
    counts: result.counts,
    installed: result.installed,
    skipped: result.skipped,
    quarantined: result.quarantined.map((entry) => ({
      id: entry.id,
      reasons: entry.reasons,
    })),
    failed: result.failed.map((entry) => ({ id: entry.id, reason: entry.reason })),
  }
}

const recapRequestResultSchema = z.object({
  commandId: z.string(),
  status: z.string(),
})

/**
Claims a `recap/completed` settlement for its waiter by the request's
commandId (M127): removes the waiter and answers the recap, or answers
undefined when nobody asked (a late settlement past the wait). Exported
for the capture tests.
*/
export function claimRecapSettlement(
  pending: Map<
    string,
    { readonly sessionId: string; readonly settle: (recap: SessionRecap) => void }
  >,
  params: z.infer<typeof recapCompletedSchema>,
): SessionRecap | undefined {
  const waiting = pending.get(params.commandId)
  if (waiting === undefined) {
    return undefined
  }
  pending.delete(params.commandId)
  const recap: SessionRecap = {
    outcome: params.outcome,
    ...(params.title !== undefined && { title: params.title }),
    ...(params.text !== undefined && { text: params.text }),
    ...(params.reason !== undefined && { reason: params.reason }),
  }
  waiting.settle(recap)
  return recap
}

/**
Claims a `session/leaveCompleted` settlement for its waiter by the
request's commandId (M127, 1.4.11): removes the waiter and answers the
handoff, or answers undefined when nobody asked (a late settlement past
the wait). Exported for the capture tests.
*/
export function claimLeaveSettlement(
  pending: Map<
    string,
    { readonly sessionId: string; readonly settle: (leave: SessionLeave) => void }
  >,
  params: z.infer<typeof leaveCompletedSchema>,
): SessionLeave | undefined {
  const waiting = pending.get(params.commandId)
  if (waiting === undefined) {
    return undefined
  }
  pending.delete(params.commandId)
  const leave: SessionLeave = {
    outcome: params.outcome,
    ...(params.reason !== undefined && { reason: params.reason }),
  }
  waiting.settle(leave)
  return leave
}

const recapCompletedSchema = z.object({
  commandId: z.string(),
  // Open vocabularies: later splits stay additive (tdd SS3.28.2).
  outcome: z.string(),
  sessionId: z.string(),
  title: z.optional(z.string()),
  text: z.optional(z.string()),
  reason: z.optional(z.string()),
})

const computerUseSetupSchema = z.object({
  accessibility: z.string(),
  inputMonitoring: z.string(),
  screenRecording: z.string(),
  setup: z.string(),
  message: z.optional(z.string()),
  refused: z.optional(z.string()),
})

/** One grants-and-phase answer from a `computerUseSetup` result, however asked. */
function toComputerUseSetup(result: unknown): ComputerUseSetup {
  const parsed = computerUseSetupSchema.parse(result)
  return {
    accessibility: parsed.accessibility,
    inputMonitoring: parsed.inputMonitoring,
    screenRecording: parsed.screenRecording,
    setup: parsed.setup,
    ...(parsed.message !== undefined && { message: parsed.message }),
    ...(parsed.refused !== undefined && { refused: parsed.refused }),
  }
}

const workflowResumeResultSchema = z.object({
  commandId: z.string(),
  status: z.string(),
  turnId: z.string(),
})

/** Exported for the M127 capture tests: parses the recorded `session/leave` ack. */
export const sessionLeaveResultSchema = z.object({
  commandId: z.string(),
  status: z.string(),
})

/** A `session/leaveCompleted` settlement (1.4.11): outcome and reason are open. */
export const leaveCompletedSchema = z.object({
  commandId: z.string(),
  sessionId: z.string(),
  outcome: z.string(),
  reason: z.optional(z.string()),
})

/**
Exported for the M127 capture tests: the shared pause/cancel/child-control
ack (SDK `WorkflowControlResult`) — settlement arrives as the workflow
item's view events, never through the ack.
*/
export const workflowControlResultSchema = z.object({
  commandId: z.string(),
  status: z.string(),
})

/** Exported for the M127 capture tests: parses the `skill/setActivation` receipt. */
export const skillSetActivationResultSchema = z.object({
  activation: z.string(),
  commandId: z.string(),
  previous: z.string(),
  scope: z.string(),
  selector: z.string(),
  status: z.string(),
})

/** Exported for the M127 capture tests: parses the `computerUseSettings/read` answer. */
export const computerUseSettingsResultSchema = z.object({
  blockedApps: z.array(
    z.object({
      bundleId: z.string(),
      locked: z.boolean(),
      prefix: z.optional(z.boolean()),
    }),
  ),
  computerControl: z.string(),
  screenshots: z.string(),
  apps: z.optional(
    z.array(
      z.object({
        bundleId: z.string(),
        choice: z.string(),
        lastAskedAt: z.optional(z.string()),
        locked: z.optional(z.boolean()),
        lockedBy: z.optional(z.string()),
        name: z.optional(z.string()),
      }),
    ),
  ),
})

/** Exported for the M127 capture tests: parses the recorded `skill/list` result. */
export const skillListResultSchema = z.object({
  skills: z.array(
    z.object({
      selector: z.string(),
      displayName: z.string(),
      // The skill's declared human-readable name (1.4.7
      // `metadata.display-name`); absent when the skill declares none.
      title: z.optional(z.string()),
      description: z.string(),
      argumentHint: z.optional(z.string()),
    }),
  ),
})

const readOutputResultSchema = z.object({
  content: z.string(),
  encoding: z.string(),
  mediaType: z.string(),
  offsetBytes: z.number(),
  byteLen: z.number(),
  eof: z.boolean(),
})

function parseOutputPage(result: unknown): OutputPage {
  const page = readOutputResultSchema.parse(result)
  if (page.encoding !== BASE64_ENCODING) {
    return page
  }
  // Binary media arrives base64 (tdd SS4.7.4): shown only if it is text after all.
  let text: string
  try {
    text = STRICT_UTF8.decode(Buffer.from(page.content, BASE64_ENCODING))
  } catch (error: unknown) {
    throw new Error(`${UI_TEXT.outputIsBinary} (${page.mediaType})`, { cause: error })
  }
  return { ...page, content: text, encoding: UTF8_ENCODING }
}

const DEFAULT_DISPOSITION = 'started'

// The host mirrors a live approval or question as a JSON-RPC server request,
// and re-issues every pending one that way right after `session/resume`
// (tdd SS5.6). The answer is a presentation receipt (msp.d.ts
// RequestReceipt): `{}` says a surface shows or will show the prompt, the
// decision still travels as `approval/decide` / `userInput/answer`, and an
// error means "could not present", so the host re-issues it on the next
// subscribe. Each request is shown as the notification it mirrors (D26).
const PROMPT_SERVER_REQUESTS: ReadonlyMap<string, string> = new Map([
  ['approval/request', 'approval/requested'],
  ['userInput/request', 'userInput/requested'],
])
const PRESENTED: Record<string, never> = {}

const SESSION_NOT_LOADED = 'sessionNotLoaded'

// MSP refusals of a decision or answer that arrived after the prompt had
// moved (D26): nothing is wrong, and the card follows the host's own events.
const PROMPT_SETTLED_KINDS: ReadonlyMap<string, PromptSettledReason> = new Map([
  ['approvalAlreadyResolved', 'alreadySettled'],
  ['userInputAlreadySettled', 'alreadySettled'],
  ['approvalRequirementStale', 'movedOn'],
  ['approvalNotFound', 'gone'],
  ['userInputNotFound', 'gone'],
])

// An approval mode above the host's ceiling (M56, PLAN.md D43): MSP answers
// `session/start` and `session/setApprovalMode` with `commandRejected` and
// this reason, "approval mode exceeds or is incomparable with the sealed
// startup mode or the managed approval-mode set" (captured 2026-09-25).
const APPROVAL_MODE_CEILING = 'approval_mode_ceiling'

/** A refused approval mode as a reason the user can act on; anything else unchanged. */
function ceilingOr(error: unknown): unknown {
  return error instanceof MspError &&
    error.kind === COMMAND_REJECTED &&
    error.data['reason'] === APPROVAL_MODE_CEILING
    ? new Error(UI_TEXT.approvalModeCeiling, { cause: error })
    : error
}

/** A late decision or answer as a `PromptSettledError`; anything else unchanged. */
function settledOr(error: unknown): unknown {
  if (!(error instanceof MspError)) {
    return error
  }
  const reason = PROMPT_SETTLED_KINDS.get(error.kind)
  return reason === undefined ? error : new PromptSettledError(reason, error.message)
}

const FAULT_MARKERS: Readonly<Record<MuseCodeFault, string>> = {
  approvalReplay: MUSE_APPROVAL_REPLAY_FAULT,
  approvalLedger: MUSE_APPROVAL_LEDGER_FAULT,
}

/** Muse Code's own approval fault as a `MuseCodeFaultError`; anything else unchanged. */
function faultOr(error: unknown, fault: MuseCodeFault): unknown {
  return error instanceof MspError &&
    error.kind === MSP_INTERNAL &&
    error.message.includes(FAULT_MARKERS[fault])
    ? new MuseCodeFaultError(fault, error.message)
    : error
}

// A `task/*` command naming a task that is not (or no longer) there, as
// Muse Code 1.3.0 refuses it (captured 2026-09-25, M46): `commandRejected`
// with the reason `invalid_target`.
const INVALID_TARGET = 'invalid_target'

/** A refused `task/*` command in the user's words when the task is gone; anything else unchanged. */
function taskRefusalOr(error: unknown): unknown {
  return error instanceof MspError &&
    error.kind === COMMAND_REJECTED &&
    error.data['reason'] === INVALID_TARGET
    ? new Error(UI_TEXT.taskNotRunning)
    : error
}

// `item/readOutput` encodings: text media is always utf8, binary media base64.
const BASE64_ENCODING = 'base64'
const UTF8_ENCODING = 'utf8'
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true })

// The worst-case JSON-RPC envelope around a command's params, for the size check.
const FRAME_ENVELOPE = { jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER }

/**
How long a command may wait (PLAN.md D25); overridable for tests. An
unnamed wait has no deadline: the command is waited on until Muse Code
answers or the wait is stopped, saying so out loud while it waits (owner
2026-10-16: no arbitrary limits, no silent hangs).
*/
export interface CommandTimeouts {
  readonly normalMs?: number | undefined
  readonly longMs?: number | undefined
  /** The watchdog's silence (`MSP_UNRESPONSIVE_SILENCE_MS` unless a test shortens it). */
  readonly unresponsiveSilenceMs?: number
}

export const DEFAULT_COMMAND_TIMEOUTS: CommandTimeouts = {}

/** Which wait a command gets: the long one for whole-session loads, else the ordinary one. */
export function commandTimeoutMs(method: string, timeouts: CommandTimeouts): number | undefined {
  return MSP_LONG_COMMANDS.has(method) ? timeouts.longMs : timeouts.normalMs
}

/**
Whether `muse serve` still answers at all (the unresponsive-host watchdog,
CLI recovery 2026-10-03). Every frame from it (an answer, an event, a
server request) is heard here and clears the count. A command that
misses its named deadline counts once; a wait with none counts once per
notice period it spends silent, however many commands wait in that
period (PR #214 review: two long commands no longer count twice as fast
as one). At `MSP_UNRESPONSIVE_MISSES` in a row with nothing heard for the
silence, Muse Code is not answering: that is logged and told once, and
new commands fail at once until a frame comes. The waiting commands
themselves keep waiting.
*/
export class HostLiveness {
  private lastHeardAt = Date.now()
  private misses = 0
  private isSilent = false
  /** The notice period that last counted a still-waiting notice; -1 for none since a frame. */
  private lastNoticePeriod = -1

  public constructor(
    private readonly silenceMs: number,
    private readonly log: CoreLogger,
    private readonly onUnresponsive: () => void,
    private readonly noticeEveryMs: number,
  ) {}

  public get isUnresponsive(): boolean {
    return this.isSilent
  }

  /** A frame arrived from `muse serve`. */
  public heard(): void {
    this.lastHeardAt = Date.now()
    this.misses = 0
    this.lastNoticePeriod = -1
    if (!this.isSilent) {
      return
    }
    this.isSilent = false
    this.log.info('Muse Code answers again; commands are sent again')
  }

  /**
  A wait with no deadline is still waiting past a notice. Every waiting
  command tells once a notice period, so the period counts once.
  */
  public stillWaiting(method: string): void {
    // Periods count from the last frame heard: a frame resets both the
    // clock and the dedup, so a period counts once however many commands
    // wait in it, before a frame as after.
    const period = Math.floor((Date.now() - this.lastHeardAt) / this.noticeEveryMs)
    if (period === this.lastNoticePeriod) return
    this.lastNoticePeriod = period
    this.missed(method)
  }

  /** A command missed its named deadline. */
  public missed(method: string): void {
    this.misses += 1
    const silentMs = Date.now() - this.lastHeardAt
    if (this.isSilent || this.misses < MSP_UNRESPONSIVE_MISSES || silentMs < this.silenceMs) {
      return
    }
    this.isSilent = true
    this.log.warn(
      `Muse Code is not answering: ${String(this.misses)} commands in a row missed their deadline (the last ${method}) and nothing came from it for ${String(Math.round(silentMs / MILLISECONDS_PER_SECOND))} s; new commands fail at once until it answers or restarts`,
    )
    this.onUnresponsive()
  }
}

/** Local authority only: request ids and lease generations never add wire fields. */
export interface MuseCodeLeaseState {
  readonly generation: number
  readonly status: 'active' | 'revoked' | 'closed'
  readonly queued: ReadonlyMap<number, number>
}
export type MuseCodeLeaseEvent =
  | { readonly type: 'queue'; readonly id: number; readonly generation: number }
  | { readonly type: 'dispatch'; readonly id: number }
  | { readonly type: 'resume'; readonly generation: number }
  | { readonly type: 'revoke' }
  | { readonly type: 'close' }

/** One synchronous transition; only its admitted effect permits submission or adoption. */
export function stepMuseCodeLease(
  state: MuseCodeLeaseState,
  event: MuseCodeLeaseEvent,
): {
  readonly state: MuseCodeLeaseState
  readonly effects: { readonly admitted: boolean }
} {
  if (event.type === 'revoke' || event.type === 'close') {
    return {
      state: {
        ...state,
        status: event.type === 'close' || state.status === 'closed' ? 'closed' : 'revoked',
        queued: new Map(),
      },
      effects: { admitted: false },
    }
  }
  const generation = event.type === 'dispatch' ? state.queued.get(event.id) : event.generation
  const canAdmit = state.status === 'active' && generation === state.generation
  if (event.type === 'resume') return { state, effects: { admitted: canAdmit } }
  const queued = new Map(state.queued)
  if (canAdmit && event.type === 'queue') queued.set(event.id, event.generation)
  if (event.type === 'dispatch') queued.delete(event.id)
  return { state: { ...state, queued }, effects: { admitted: canAdmit } }
}

// SDK-owned outgoing JSON-RPC envelope, not a new Muse Code response shape.
const submissionSchema = z.object({
  id: z.optional(z.union([z.number(), z.string()])),
  method: z.optional(z.string()),
})

/** Serialized owner shared by the transport, host, retained sessions and resume. */
export class MuseCodeCommandOwner {
  private state: MuseCodeLeaseState
  private nextRequestId = 0
  private readonly lifetime = new AbortController()
  private connection: Connection | undefined
  public readonly generation: number
  public readonly signal: AbortSignal

  public constructor(public readonly accountHome?: MuseCodeAccountHome) {
    this.generation = accountHome?.generation ?? 0
    this.state = { generation: this.generation, status: 'active', queued: new Map() }
    this.signal =
      accountHome === undefined
        ? this.lifetime.signal
        : AbortSignal.any([this.lifetime.signal, accountHome.signal])
    this.signal.addEventListener(
      'abort',
      () => {
        this.step({ type: this.lifetime.signal.aborted ? 'close' : 'revoke' })
      },
      { once: true },
    )
    if (this.signal.aborted) this.step({ type: 'revoke' })
  }

  private step(event: MuseCodeLeaseEvent): boolean {
    const next = stepMuseCodeLease(this.state, event)
    this.state = next.state
    return next.effects.admitted
  }

  public assertCurrent(generation: number): void {
    if (this.state.status === 'closed') throw new Error(UI_TEXT.questionCancelled)
    try {
      this.accountHome?.assertCurrent()
      if (this.accountHome !== undefined && this.accountHome.generation !== this.generation)
        throw new Error(UI_TEXT.accounts.invalidAccount)
    } catch (error: unknown) {
      this.step({ type: 'revoke' })
      throw error
    }
    if (!this.step({ type: 'resume', generation })) throw new Error(UI_TEXT.accounts.invalidAccount)
  }

  /** The SDK calls write after its private write tail clears; no await separates guard and write. */
  public connect(transport: DuplexTransport): Connection {
    if (this.connection !== undefined) throw new Error(UI_TEXT.accounts.invalidAccount)
    const closeTransport = transport.close?.bind(transport)
    this.connection = new Connection(
      {
        incoming: transport.incoming,
        write: (chunk) => {
          this.assertCurrent(this.generation)
          const frame = submissionSchema.parse(JSON.parse(chunk))
          if (
            frame.method !== undefined &&
            frame.id !== undefined &&
            (typeof frame.id !== 'number' || !this.step({ type: 'dispatch', id: frame.id }))
          )
            throw new Error(UI_TEXT.accounts.invalidAccount)
          return transport.write(chunk)
        },
        ...(closeTransport !== undefined && { close: closeTransport }),
      },
      {
        mintRequestId: () => {
          this.assertCurrent(this.generation)
          this.nextRequestId += 1
          const id = this.nextRequestId
          if (!this.step({ type: 'queue', id, generation: this.generation }))
            throw new Error(UI_TEXT.accounts.invalidAccount)
          return id
        },
      },
    )
    return this.connection
  }

  public ownsConnection(connection: Connection): boolean {
    return this.connection === connection
  }

  public close(): void {
    this.step({ type: 'close' })
    this.lifetime.abort()
  }
}

/** What every command on one connection shares: its deadlines, its log and its watchdog. */
interface CommandChannel {
  readonly connection: Connection
  readonly timeouts: CommandTimeouts
  readonly log: CoreLogger
  readonly liveness: HostLiveness
  readonly generation: number
  readonly signal: AbortSignal
  readonly assertCurrent: (generation: number) => void
}

/** An MSP refusal that admitted nothing, so the same command may be sent again. */
function isRetryableRefusal(error: unknown): boolean {
  return (
    error instanceof MspError &&
    MSP_RETRYABLE_REFUSALS.some(
      (refusal) => refusal.code === error.code && refusal.kind === error.kind,
    )
  )
}

/**
A card that waits on the user, an approval or a question: shown again to a
later surface, it is marked replayed, so it is never approved on its own
and raises no new notice (M82).
*/
function isPendingPrompt(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'approvalRequested' | 'questionRequested' }> {
  return event.type === 'approvalRequested' || event.type === 'questionRequested'
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
A turn's parts as MSP takes them. `TurnInputPart` is text, image or skill
in 1.3.0. Text files are named text parts; PDFs are refused because an
unknown type is `invalidParams` (msp.d.ts, M54, sdk issue #48).
*/
function mspInput(parts: readonly TurnPart[]): readonly TurnPart[] {
  const input: TurnPart[] = []
  let attachmentBytes = 0
  for (const part of parts) {
    // U16 is not captured on this base. Never disguise media as an MSP image/file.
    if (
      part.type === 'media' ||
      ('mediaType' in part && /^(?:video|audio)\//u.test(part.mediaType))
    ) {
      throw new Error(UI_TEXT.media.museCodeRefusal)
    }
    if (part.type === 'file') {
      throw new Error(UI_TEXT.pdfNeedsModelApi)
    }
    const inputPart: TurnPart =
      part.type === 'textFile' ? { type: 'text', text: textFileInput(part) } : part
    if (part.type === 'image' || part.type === 'textFile') {
      attachmentBytes +=
        part.type === 'image'
          ? Buffer.byteLength(part.base64Data) +
            Buffer.byteLength(JSON.stringify({ ...part, base64Data: '' }))
          : Buffer.byteLength(JSON.stringify(inputPart))
      if (attachmentBytes > MSP_ATTACHMENT_FRAME_BUDGET_BYTES) {
        throw new Error(UI_TEXT.textFilesOverBudget)
      }
    }
    input.push(inputPart)
  }
  return input
}

/**
`Connection.command` without its memory (PLAN.md D26). Up to SDK 1.4.2 it
kept the canonical payload of every command for the connection's life,
an image turn's base64 included, to check replays across reconnects this
extension never makes (#35). 1.4.4 keeps a SHA-256 per command instead,
still never evicted; this stays because each attempt here is also fenced
by the host generation and heard by the watchdog (SDK144). The same
contract otherwise: the command id rides in the params, the ack must echo
it, and a refusal that admitted nothing (`overloaded`, `backpressured`)
is retried with the same id after a short, growing, jittered wait.
*/
async function sendCommand(
  channel: CommandChannel,
  generation: number,
  method: string,
  params: Record<string, unknown>,
  commandId: string,
  run?: UnattendedRun,
): Promise<Record<string, unknown>> {
  const { log } = channel
  const commandParams = { ...params, commandId }
  // The host drops an oversized frame without answering it (D26).
  const frame = JSON.stringify({ ...FRAME_ENVELOPE, method, params: commandParams })
  if (Buffer.byteLength(frame) > MSP_FRAME_LIMIT_BYTES) {
    throw new Error(UI_TEXT.commandTooLarge)
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      const send = () => answered(channel, generation, method, commandParams)
      const ack = await (run === undefined ? send() : run.dispatch(send))
      if (ack['commandId'] !== undefined && ack['commandId'] !== commandId) {
        throw new Error(`${method} ack did not echo its commandId ${commandId}`)
      }
      return ack
    } catch (error: unknown) {
      if (!isRetryableRefusal(error) || attempt >= MSP_COMMAND_ATTEMPTS) {
        throw error
      }
      const ceiling = Math.min(MSP_RETRY_MAX_DELAY_MS, MSP_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
      const delayMs = Math.floor(Math.random() * (ceiling + 1))
      log.warn(
        `${method} refused (${failureForLog(error)}); attempt ${String(attempt + 1)} in ${String(delayMs)} ms`,
      )
      await pause(delayMs)
    }
  }
}

/**
One request's answer, heard by the watchdog: a result, or an error the
host wrote. A late answer, after its deadline, is heard too.
*/
async function answered(
  channel: CommandChannel,
  generation: number,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  channel.assertCurrent(generation)
  try {
    const answer = await channel.connection.request(method, params)
    channel.assertCurrent(generation)
    channel.liveness.heard()
    return answer
  } catch (error: unknown) {
    channel.assertCurrent(generation)
    if (error instanceof MspError) {
      channel.liveness.heard()
    }
    throw error
  }
}

/**
A request with the wait its timeouts name, refused at once while Muse
Code is not answering (the watchdog). A wait with no deadline is waited
on until Muse Code answers or the wait is stopped, saying so out loud
(owner 2026-10-16); each notice period counts toward the watchdog like a
missed deadline did, so a truly wedged host is still detected.
*/
async function requestWithin<T>(
  channel: CommandChannel,
  generation: number,
  method: string,
  timeoutMs: number | undefined,
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (channel.liveness.isUnresponsive) {
    channel.log.info(`${method} was not sent: Muse Code is not answering`)
    throw new Error(UI_TEXT.museCodeNotAnswering)
  }
  channel.assertCurrent(generation)
  // A caller's stop (PR #214 review) ends the wait like the channel going.
  const stopSignal =
    signal === undefined ? channel.signal : AbortSignal.any([channel.signal, signal])
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new Error(UI_TEXT.questionCancelled))
    }
    stopSignal.addEventListener('abort', onAbort, { once: true })
  })
  const stopNoticing =
    timeoutMs === undefined
      ? startStillWaiting((elapsedMs) => {
          channel.log.info(stillWaitingText({ key: 'museCodeCommand', method }, elapsedMs))
          channel.liveness.stillWaiting(method)
        })
      : undefined
  try {
    const raced = Promise.race([request(), cancelled])
    const answer =
      timeoutMs === undefined
        ? await raced
        : await withDeadline(raced, timeoutMs, `Muse Code did not answer ${method} in time`)
    channel.assertCurrent(generation)
    return answer
  } catch (error: unknown) {
    channel.assertCurrent(generation)
    if (error instanceof DeadlineError) {
      channel.liveness.missed(method)
    }
    throw error
  } finally {
    stopNoticing?.()
    if (onAbort !== undefined) stopSignal.removeEventListener('abort', onAbort)
  }
}

/**
One MSP command with the wait its timeouts name (none by default).
`sessionNotLoaded` (the host evicted or closed the session) becomes a
`SessionNotLoadedError` the controller answers by resuming the session.
*/
async function commandWithin(
  channel: CommandChannel,
  generation: number,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
  commandId: string = channel.connection.mintCommandId(),
  run?: UnattendedRun,
): Promise<unknown> {
  const { log, timeouts } = channel
  const timeoutMs = commandTimeoutMs(method, timeouts)
  const startedAt = Date.now()
  try {
    const answer = await requestWithin(
      channel,
      generation,
      method,
      timeoutMs,
      () => sendCommand(channel, generation, method, params, commandId, run),
      signal,
    )
    log.trace(`${method} answered in ${String(Date.now() - startedAt)} ms`)
    return answer
  } catch (error: unknown) {
    log.trace(`${method} failed after ${String(Date.now() - startedAt)} ms`)
    const sessionId = params['sessionId']
    if (
      typeof sessionId === 'string' &&
      error instanceof MspError &&
      error.kind === SESSION_NOT_LOADED
    ) {
      throw new SessionNotLoadedError(sessionId, error.message)
    }
    throw error
  }
}

/** A process exit as the conversations see it (D25). */
export function describeExit(
  exit: { readonly code: number | null; readonly signal: string | null },
  isExpected: boolean,
): HostExit {
  if (exit.code === null) {
    return {
      description: fill(UI_TEXT.museStoppedBySignal, {
        signal: exit.signal ?? UI_TEXT.museUnknownSignal,
      }),
      isExpected,
      isPersistent: false,
      // A signal the close itself sent is the stop that was asked for.
      isFailure: !isExpected,
    }
  }
  // Exit codes are ids, not amounts: no digit grouping.
  const code = String(exit.code)
  const meaning = Object.entries(UI_TEXT.museExitMeanings).find(([known]) => known === code)?.[1]
  return meaning === undefined
    ? {
        description: fill(UI_TEXT.museExitedWithCode, { code }),
        isExpected,
        isPersistent: false,
        isFailure: exit.code !== 0,
      }
    : {
        description: fill(UI_TEXT.museExitMeaning, { meaning, code }),
        isExpected,
        isPersistent: MUSE_EXIT_PERSISTENT_CODES.has(exit.code),
        isFailure: exit.code !== 0,
      }
}

interface NativeFireToken {
  readonly run: UnattendedRun
  readonly token: SessionToken
}

export class MuseSession implements ScheduledAgentSession {
  private readonly observedAgents = new Map<string, ItemSnapshot>()

  private readonly listeners = new Set<SessionEventListener>()
  /** One card per prompt and stage, and the open ones for a late listener (D26). */
  private readonly prompts = new PromptLedger()
  /** A stage's callers share its eventual result, and Stop waits for it. */
  private readonly decisionsInFlight = new Map<string, Promise<void>>()
  /**
  What arrived before anyone listened (D26): the events right after
  `session/resume` (the re-issued prompts, a running turn's stream) land
  before the surface that asked for the session has attached. Held until
  the first listener, released with the handle.
  */
  private early: AgentEvent[] | undefined = []
  /** The surfaces holding this handle (PLAN.md D25): the last release disposes it. */
  private holders = 1
  private isDisposed = false
  /** Told when Muse Code reports this session's event log failed (CLI recovery). */
  private readonly logDamagedListeners = new Set<() => void>()
  /**
  Queued turns `turn/unqueued` withdrew (M87): MSP's authoritative removal,
  which a lost or failed `turn/unqueue` ack does not undo.
  */
  private readonly unqueuedTurns = new Set<string>()
  private readonly log: CoreLogger
  private readonly owner: SessionOwner
  private readonly scheduledItems = new Map<string, NativeFireToken>()
  private readonly scheduledApprovals = new Map<string, NativeFireToken>()
  private readonly scheduledQuestions = new Set<string>()
  private heldScheduleEvents: { event: AgentEvent; fire: NativeFireToken | undefined }[] | undefined
  private restoringScheduleMode: Promise<void> = Promise.resolve()
  /** Local M87 admission: queued authority cannot replace the user's live fire. */
  private readonly scheduledQueue = new Map<
    string,
    {
      readonly parts: readonly TurnPart[]
      readonly run: UnattendedRun
      readonly displayText: string | undefined
    }
  >()
  private drainingSchedules = false
  private modeOpsCache: ModeSyncOps | undefined
  private readonly leaseGeneration: number

  /** The host's feedback disclosure ports, bound by `track` (absent in tests). */
  public readonly previewFeedbackNote?: (note: string) => string
  public readonly submitFeedback?: (input: FeedbackRequest) => Promise<string>

  public constructor(
    public readonly sessionId: string,
    public modelId: string,
    private readonly channel: CommandChannel,
    private readonly onDispose: () => void,
    /** The host granted `userShell` at the handshake (M46): `!` commands may run. */
    private readonly canRunUserShell: boolean,
    private readonly usageDeltas?: MuseUsageDeltas,
    initialApprovalMode?: string,
    feedback?: {
      readonly previewNote: (note: string) => string
      readonly submit: (input: FeedbackRequest) => Promise<string>
    },
  ) {
    this.owner = new SessionOwner(initialApprovalMode)
    this.log = channel.log
    this.leaseGeneration = channel.generation
    if (feedback === undefined) {
      return
    }

    this.previewFeedbackNote = feedback.previewNote
    this.submitFeedback = feedback.submit
  }

  /** One MSP command against this session with a freshly minted commandId. */
  private async decideScheduledApproval(
    event: Extract<AgentEvent, { type: 'approvalRequested' | 'approvalUpdated' }>,
    fire: NativeFireToken,
  ): Promise<void> {
    const { run, token } = fire
    const subject = event.subject
    const isKnown = ['shell', 'fileAccess', 'fileWrite', 'network', 'tool'].includes(subject.kind)
    let actionClass: ScheduleApprovalAction['class'] = 'mcp'
    switch (subject.kind) {
      case 'shell': {
        actionClass = 'shell'
        break
      }
      case 'fileWrite': {
        actionClass = 'edit'
        break
      }
      case 'fileAccess': {
        actionClass = subject.access === 'write' ? 'edit' : 'mcp'
        break
      }
      case 'network': {
        actionClass = 'webFetch'
        break
      }
      // No default
    }
    const action: ScheduleApprovalAction = {
      id: event.approvalId,
      class: actionClass,
      tool:
        subject.toolName ?? (event.type === 'approvalRequested' ? event.toolName : subject.kind),
      ...(subject.command !== undefined && { command: subject.command }),
      paths: subject.path === undefined ? [] : [subject.path],
      requiresAsking: !isKnown || (event.type === 'approvalRequested' && event.isJudgeEscalated),
      protectedPath: event.type === 'approvalRequested' && event.isProtectedWrite,
    }
    let isAllowed = false
    let reason: string | undefined
    const pending = this.prompts.pending(event.approvalId)
    const isAutomatic =
      pending !== undefined && editAutomaticallyChoice(pending, run.context.mode) !== undefined
    try {
      const decision =
        this.owner.isFailed(run) || !this.owner.matches(token) || this.owner.run() !== run
          ? { allowed: false, reason: run.refuse(action, run.modelText.approvalRefused) }
          : await run.decide(action, !isAutomatic)
      isAllowed = decision.allowed && this.owner.matches(token) && this.owner.run() === run
      reason = decision.reason
    } catch (error: unknown) {
      // The decider failed; the turn is refused and the failure is recorded.
      this.log.warn(
        `Scheduled approval ${event.approvalId} decision failed: ${failureForLog(error)}; the turn is refused`,
      )
      reason = run.refuse(action, run.modelText.approvalRefused)
    }
    const choice = event.availableChoices.find((candidate) =>
      isAllowed
        ? candidate.decision === 'approved' && candidate.scope === 'once'
        : candidate.decision === 'abort',
    )
    if (choice === undefined) throw new Error('No safe scheduled approval choice')
    await this.decideApproval({
      approvalId: event.approvalId,
      requirementId: event.requirementId,
      choiceId: choice.choiceId,
      ...(reason !== undefined && { feedback: reason }),
    })
  }

  private async admitScheduled(
    waiter: SessionToken,
    run: UnattendedRun,
    send: (token: SessionToken) => Promise<TurnSubmission>,
    expectedTurnId?: string,
  ): Promise<TurnSubmission> {
    await this.restoringScheduleMode
    if (this.owner.quarantined)
      throw new Error(this.owner.quarantineCause ?? UI_TEXT.permissionReviewerMissing)
    const token = this.owner.claim(waiter, run, expectedTurnId)
    if (token === undefined) throw new SteerRefusedError(UI_TEXT.scheduleBusy)
    this.heldScheduleEvents = []
    try {
      const admittedMode = mspApprovalMode(run.context.mode)
      const modes = await import('./approvalModesEntry')
      await modes.applyModeChange(this.modeOps(), admittedMode, token, run)
      // While the unattended run is in charge the session reviews with the
      // host default `:auto-review`: the run answers what the grant allows
      // and refuses the rest itself, so the human reviewer must not be
      // installed here — on a Manual conversation `:ask-me` would turn every
      // unmatched command into a refusal instead of letting the judge allow
      // it, as it did before profiles existed.
      await modes.setSessionProfile(this.modeOps(), MUSE_AUTO_REVIEW_PROFILE, admittedMode)
      if (!run.isActive())
        throw expectedTurnId === undefined
          ? new Error(UI_TEXT.scheduleBusy)
          : new SteerRefusedError(UI_TEXT.scheduleBusy)
      const result = await send(token)
      this.restoreScheduleMode(this.owner.admitted(token, result.turnId))
      return result
    } catch (error: unknown) {
      this.restoreScheduleMode(this.owner.admissionFailed(token))
      await this.stopAfterFailedAdmission(run)
      throw error
    } finally {
      const events = this.heldScheduleEvents
      this.heldScheduleEvents = undefined
      for (const held of events) this.emit(held.event, true, held.fire)
    }
  }

  /**
  Best effort after a failed admission: a turn that kept running is
  stopped. A stop that fails is recorded and left running; the admission
  failure stays the failure the caller sees.
  */
  private async stopAfterFailedAdmission(run: UnattendedRun): Promise<void> {
    const cancellation = this.owner.token()
    try {
      if (this.owner.canCancel(cancellation, run)) await this.command('turn/cancel', {})
    } catch {
      this.log.warn('Scheduled admission failed; the turn could not be stopped')
    }
  }

  /**
  What the deferred mode sync needs from this session (built once, never at
  activation): the owner, the effect runners, the profile command and the log.
  */
  private modeOps(): ModeSyncOps {
    return (this.modeOpsCache ??= {
      owner: this.owner,
      applyEffect: (effect) => this.applyModeEffect(effect),
      sendProfile: (profileId) => this.command('session/setPermissionProfile', { profileId }),
      log: (level, message) => {
        this.log[level](message)
      },
    })
  }

  private restoreScheduleMode(effect: SessionEffect | undefined): void {
    if (effect === undefined) return
    // The gate resolves once the outcome is recorded: a failed restore must
    // not reject every later turn and mode change on the handle.
    this.restoringScheduleMode = (async () => {
      try {
        const modes = await import('./approvalModesEntry')
        await modes.restoreScheduleEffect(this.modeOps(), effect)
      } catch (error: unknown) {
        this.log.warn(
          `Scheduled mode or reviewer could not be restored (${failureForLog(error)}); new turns are refused until the permission mode is set again`,
        )
      }
    })()
  }

  private stopScheduledRun(run: UnattendedRun): void {
    if (this.getScheduledRun() !== run) return
    void this.cancel(run).catch(() => {
      this.log.warn('Scheduled turn could not be stopped')
    })
  }

  private async drainScheduledQueue(): Promise<void> {
    const isOpen = () => !this.isDisposed
    if (this.drainingSchedules || !isOpen()) return
    this.drainingSchedules = true
    try {
      await this.restoringScheduleMode
      if (!this.owner.isIdle || !isOpen()) return
      const next = this.scheduledQueue.entries().next().value
      if (next === undefined) return
      const [id, queued] = next
      this.scheduledQueue.delete(id)
      try {
        const submission = await this.sendScheduledTurn(
          queued.parts,
          queued.run,
          queued.displayText,
          id,
        )
        if (submission.turnId !== id)
          this.emit({
            type: 'userMessageTurnChanged',
            userMessageId: id,
            turnId: submission.turnId,
          })
      } catch (error: unknown) {
        // A failed scheduled turn is reported twice: the session sees its
        // terminal failure, and the log keeps the redacted cause.
        this.log.warn(`Scheduled turn failed (${failureForLog(error)})`)
        if (isOpen())
          this.emit({
            type: 'turnCompleted',
            turnId: id,
            terminal: 'failed',
            reason: UI_TEXT.scheduleCommandFailed,
          })
      }
    } catch {
      // Failed restoration quarantines the session; no queued authority is dispatched.
      this.log.warn('Scheduled queue could not restore its session mode')
    } finally {
      this.drainingSchedules = false
      if (this.owner.isIdle && isOpen() && this.scheduledQueue.size > 0)
        void this.drainScheduledQueue()
    }
  }

  private async command(
    method: string,
    params: Record<string, unknown>,
    commandId?: string,
    run?: UnattendedRun,
  ): Promise<unknown> {
    try {
      return await commandWithin(
        this.channel,
        this.leaseGeneration,
        method,
        {
          sessionId: this.sessionId,
          ...params,
        },
        undefined,
        commandId ?? this.channel.connection.mintCommandId(),
        run,
      )
    } catch (error: unknown) {
      this.noteLogFault(error)
      throw error
    }
  }

  /**
  Muse Code 1.4.2 answers every message of a session whose event log
  failed with that failure (the owner's session of 2026-10-02/03): the
  conversation is told, which takes no new message in it after this.
  */
  private noteLogFault(error: unknown): void {
    if (!(error instanceof MspError) || !error.message.includes(MUSE_EVENT_LOG_FAULT)) {
      return
    }
    this.log.warn(
      `Muse Code reported session ${this.sessionId}'s event log failed (${failureForLog(error)}); the session takes no new message`,
    )
    notify(this.logDamagedListeners, undefined, this.log, 'museCode.logDamaged', (event) => {
      this.reportListenerFailure(event)
    })
  }

  private finishDispose(): void {
    this.scheduledQueue.clear()
    this.isDisposed = true
    this.listeners.clear()
    this.logDamagedListeners.clear()
    notify([this.onDispose], undefined, this.log, 'museCode.disposed', (event) => {
      this.reportListenerFailure(event)
    })
  }

  /**
  A Stop under a multi-stage approval with a stage already decided rejects
  its waiting stage first, through `approval/decide`: a turn cancelled
  under such an approval leaves Muse Code 1.4.2 refusing every later
  `turn/start` of the session (the `approvalReplay` fault, captured live
  2026-10-02), while one whose approval was rejected first runs on.
  */
  private async rejectPartlyDecided(): Promise<void> {
    // A click locks the stage before its command settles. Let the host's
    // answer and stage update land before deciding what Stop must reject.
    while (this.decisionsInFlight.size > 0) {
      await Promise.allSettled(this.decisionsInFlight.values())
    }
    for (const approval of this.prompts.partlyDecided()) {
      await this.rejectWaitingStage(approval.approvalId)
    }
  }

  private async rejectWaitingStage(approvalId: string): Promise<void> {
    for (let attempt = 0; attempt < APPROVAL_REJECT_ATTEMPTS; attempt += 1) {
      const approval = this.prompts.pending(approvalId)
      const reject = approval?.availableChoices.find(
        (choice) => choice.decision === REJECT_DECISION,
      )
      if (approval === undefined || reject === undefined) {
        return
      }
      this.log.info(
        `Stop: approval ${approvalId} stage ${String(approval.requirementId.sourceIndex)} is rejected before the turn stops`,
      )
      // Bounded: a Stop never waits long on a host that does not answer.
      const deadlineMs = APPROVAL_REJECT_DEADLINE_MS
      try {
        await withDeadline(
          this.decideApproval({
            approvalId,
            choiceId: reject.choiceId,
            requirementId: approval.requirementId,
          }),
          deadlineMs,
          `the reject before the Stop did not answer within ${String(deadlineMs)} ms`,
        )
        return
      } catch (error: unknown) {
        // A stage that moved on is now the ledger's: rejected on the next pass.
        if (!isPromptSettledError(error) || error.reason !== 'movedOn') {
          this.log.warn(
            `Stop: rejecting approval ${approvalId} failed: ${failureForLog(error)}; the turn stops anyway`,
          )
          return
        }
      }
    }
  }

  /** The single wire decision whose outcome every caller of this stage sees. */
  private async sendApprovalDecision(decision: ApprovalDecision): Promise<void> {
    const { approvalId, requirementId } = decision
    let ack: unknown
    try {
      ack = await this.command('approval/decide', {
        approvalId,
        choiceId: decision.choiceId,
        requirementId,
        ...(decision.feedback !== undefined && { feedback: decision.feedback }),
      })
    } catch (error: unknown) {
      // The mapped failure below is what the caller sees; the failure as it
      // arrived is recorded here, never echoed.
      this.log.info(
        `Approval ${approvalId} stage ${String(requirementId.sourceIndex)} decision failed: ${failureForLog(error)}`,
      )
      throw await this.decisionFailed(requirementId, error)
    }
    // `terminal: true` closed the whole approval; a trailing stage update the
    // host can still send for it must not reopen the card (the facade's #37538).
    if (approvalDecideResultSchema.safeParse(ack).data?.terminal === true) {
      this.prompts.close(approvalId)
    }
  }

  /** What a failed `approval/decide` means for its card (PLAN.md D26). */
  private async decisionFailed(requirementId: RequirementRef, error: unknown): Promise<unknown> {
    const { approvalId } = requirementId
    if (error instanceof MspError && error.kind === REQUIREMENT_STALE) {
      // The stage moved on. The refusal names the stage the host waits on;
      // the card goes there when Muse Code does not say so itself.
      const waiting = requirementRefSchema.safeParse(error.data['currentRequirementId'])
      const update = waiting.success ? this.prompts.advanceTo(waiting.data) : undefined
      if (update !== undefined) {
        this.log.info(
          `Approval ${approvalId} stage ${String(requirementId.sourceIndex)} was stale; the card moves to stage ${String(update.requirementId.sourceIndex)}, where Muse Code waits`,
        )
        this.emit(update)
      }
      return settledOr(error)
    }
    const settled = settledOr(error)
    if (isPromptSettledError(settled)) {
      this.prompts.close(approvalId)
      return settled
    }
    const fault = faultOr(error, 'approvalLedger')
    if (fault !== error) {
      // The decision applied (#29, and every decision after the replay
      // fault); the card follows the host's resolve.
      return fault
    }
    // No answer (the deadline, a closed connection): the command may still
    // be queued in a busy Muse Code and apply later. On 2026-10-02 one sent
    // at 23:49:40 was taken in at 23:52:33, after two more for the same
    // stage, sent from a card reopened at each deadline, which it refused as
    // stale. The stage stays decided; the card follows the host's events.
    if (!(error instanceof MspError)) {
      this.log.info(
        `Approval ${approvalId} stage ${String(requirementId.sourceIndex)}: no answer; it may still apply, so it is not offered again`,
      )
      return error
    }
    if (await this.isStillWaiting(requirementId)) {
      this.prompts.unmarkDecided(requirementId)
      return new DecisionNotAppliedError(error.message)
    }
    return error
  }

  /**
  Whether the host, which answered the decision with a refusal, still
  waits on this very stage: then the decision did not apply and may be
  made again. A check that fails cannot tell, and the stage stays decided.
  */
  private async isStillWaiting(requirementId: RequirementRef): Promise<boolean> {
    let pending: z.infer<typeof listPendingResultSchema>
    try {
      pending = listPendingResultSchema.parse(await this.command('approval/listPending', {}))
    } catch (error: unknown) {
      this.log.warn(`approval/listPending after a failed decision failed: ${failureForLog(error)}`)
      return false
    }
    return pending.approvals.some((params) => {
      const parsed = pendingStageSchema.safeParse(params)
      return (
        parsed.success &&
        parsed.data.approvalId === requirementId.approvalId &&
        parsed.data.currentRequirementId.sourceIndex === requirementId.sourceIndex
      )
    })
  }

  /**
  What a failed `turn/steer` means for its message (CLI recovery,
  2026-10-03). On 2026-10-02 a steer Muse Code answered after the 60 s
  deadline had been taken for a refusal and sent again as a new turn, and
  Muse Code applied both. So only a refusal that says no turn was there is
  a `SteerRefusedError`; no answer (the deadline, a closed connection) is
  said as such; any other refusal keeps its own words.
  */
  private steerFailure(expectedTurnId: string, error: unknown): unknown {
    if (error instanceof MspError) {
      const reason = error.data['reason']
      const isNoTurn =
        typeof reason === 'string' &&
        error.kind === COMMAND_REJECTED &&
        MSP_STEER_NO_TURN_REASONS.has(reason)
      return isNoTurn ? new SteerRefusedError(error.message) : faultOr(error, 'approvalReplay')
    }
    if (error instanceof DeadlineError || error instanceof ProtocolError) {
      this.log.warn(
        `turn/steer into turn ${expectedTurnId} got no answer (${failureForLog(error)}); it may still reach the turn, so the message is not sent again`,
      )
      return new Error(UI_TEXT.steerUnconfirmed, { cause: error })
    }
    return error
  }

  /**
  Run the mode command for an effect. Returns the mode the host runs when
  the adoption tore (the ack arrived but a turn ended while it was in
  flight, so the host runs the mode with a reviewer that was never
  confirmed): the deferred caller quarantines with that mode named, so the
  surface shows it. A refused command releases the effect but keeps the
  mode (the host never changed).
  */
  private async applyModeEffect(effect: SessionEffect): Promise<string | undefined> {
    if (!this.owner.matches(effect.token)) {
      this.owner.modeApplied(effect, false)
      throw new Error(UI_TEXT.scheduleBusy)
    }
    try {
      const ack = await this.command('session/setApprovalMode', { mode: effect.mode })
      // The CLI echoes the mode it actually runs: a ceiling or managed
      // policy that changed it must show in the log, never misreport as set.
      const effective = approvalModeResultSchema.safeParse(ack).data?.effectiveMode.mode
      if (effective !== undefined && effective !== effect.mode) {
        this.log.warn(
          `Muse Code runs approval mode ${wireWordForLog(effective)} instead of the requested ${effect.mode}`,
        )
      }
      return this.owner.modeApplied(effect, true) ? undefined : (effective ?? effect.mode)
    } catch (error: unknown) {
      this.owner.modeApplied(effect, false)
      throw ceilingOr(error)
    }
  }

  /** Merge captured native attempt history for both live updates and local inspection. */
  public observeAgent(item: ItemSnapshot): ItemSnapshot {
    if (item.kind !== 'subagent' && item.kind !== 'workflow') return item
    const observed = observeAgentItem(this.observedAgents.get(item.itemId), item, Date.now())
    this.observedAgents.set(item.itemId, observed)
    return observed
  }
  public observeChild(sessionId: string, history: SessionHistoryOutcome): void {
    const observed = new Map(this.observedAgents)
    for (const item of observed.values()) {
      if (item.kind !== 'subagent' || item.childSessionId !== sessionId) continue
      const updated = observeChildReceipt(item, history.items, history.todos)
      this.emit({ type: 'itemUpdated', item: updated })
      this.observedAgents.set(item.itemId, updated)
    }
  }

  /** Muse Code reported this session's event log failed (`noteLogFault`). */
  public onLogDamaged(listener: () => void): () => void {
    this.logDamagedListeners.add(listener)
    return () => {
      this.logDamagedListeners.delete(listener)
    }
  }

  /** One more surface holds this handle (a second panel resumed the same session). */
  public retain(): void {
    this.holders += 1
  }

  /**
  The first listener gets what arrived before it; a later one (a second
  surface on the same session) gets the prompts still open, which the
  host will not announce again.
  */
  public onEvent(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    const backlog = this.early ?? this.prompts.open()
    this.early = undefined
    for (const event of backlog) {
      if (
        ((event.type === 'approvalRequested' || event.type === 'approvalUpdated') &&
          this.scheduledApprovals.has(event.approvalId)) ||
        (event.type === 'questionRequested' && this.scheduledQuestions.has(event.userInputId))
      )
        continue
      notify(
        [listener],
        isPendingPrompt(event) ? { ...event, isReplayed: true } : event,
        this.log,
        'museCode.replay',
        (diagnostic) => {
          this.reportListenerFailure(diagnostic)
        },
      )
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** @internal Called by the host dispatcher. */
  public receive(mapped: MappedNotification, isReplay = false): void {
    if ('closedApprovalId' in mapped) {
      this.prompts.close(mapped.closedApprovalId)
      return
    }
    this.usageDeltas?.receive(mapped.event, isReplay)
    if (mapped.event.type === 'turnWithdrawn') {
      this.unqueuedTurns.add(mapped.event.turnId)
    }
    this.emit(mapped.event)
  }

  /** @internal An event for this session's listeners, once, in arrival order. */
  public emit(event: AgentEvent, wasObserved = false, bufferedFire?: NativeFireToken): void {
    if (this.isDisposed) {
      return
    }
    const terminalRun =
      event.type === 'turnCompleted' || event.type === 'turnWithdrawn'
        ? this.owner.run(event.turnId)
        : undefined
    // Live evidence is observed once, including while UI delivery is held.
    if (!wasObserved) {
      if (event.type === 'turnStarted') this.owner.observedStart(event.turnId)
      else if (event.type === 'turnCompleted' || event.type === 'turnWithdrawn')
        this.restoreScheduleMode(this.owner.terminal(event.turnId))
      else if (event.type === 'approvalRequested' && event.turnId !== undefined)
        this.owner.observeFireTurn(event.turnId)
      else if (event.type === 'approvalModeChanged') this.owner.observeMode(event.mode)
      else if (
        event.type === 'sessionStatus' &&
        (event.status === 'idle' || event.status === 'stopped')
      )
        this.restoreScheduleMode(this.owner.stopped())
    }
    let turnId: string | undefined
    if ('turnId' in event) turnId = event.turnId
    else if ('item' in event) turnId = event.item.turnId
    const run = this.owner.run(turnId)
    const fire =
      bufferedFire ??
      (run === undefined
        ? undefined
        : {
            run,
            token: {
              generation: this.owner.token().generation,
              turnId: turnId ?? this.owner.currentTurnId ?? this.owner.token().turnId,
            },
          })
    if (fire !== undefined && event.type === 'itemStarted' && event.item.turnId !== undefined)
      this.scheduledItems.set(event.item.itemId, fire)
    if (this.heldScheduleEvents !== undefined) {
      this.heldScheduleEvents.push({ event, fire })
      return
    }
    switch (event.type) {
      case 'itemStarted':
      case 'itemUpdated':
      case 'itemCompleted': {
        event = { ...event, item: this.observeAgent(event.item) }
        break
      }
      default: {
        break
      }
    }
    const admitted = this.prompts.admit(event)
    if (admitted === undefined) {
      return
    }
    switch (admitted.type) {
      case 'approvalRequested':
      case 'approvalUpdated': {
        const ownership =
          admitted.type === 'approvalRequested'
            ? (this.scheduledItems.get(admitted.itemId) ?? fire)
            : this.scheduledApprovals.get(admitted.approvalId)
        if (ownership !== undefined) {
          this.scheduledApprovals.set(admitted.approvalId, ownership)
          void this.decideScheduledApproval(admitted, ownership)
            .catch(() => {
              this.log.warn('Scheduled approval failed')
              this.stopScheduledRun(ownership.run)
            })
            .finally(() => {
              if (this.prompts.pending(admitted.approvalId) === undefined)
                this.scheduledApprovals.delete(admitted.approvalId)
            })
          return
        }

        break
      }
      case 'questionRequested': {
        const ownership = this.scheduledItems.get(admitted.itemId) ?? fire
        if (ownership !== undefined) {
          const { run } = ownership
          this.scheduledQuestions.add(admitted.userInputId)
          void run
            .defer(admitted)
            .then(async (text) => {
              if (!this.owner.matches(ownership.token) || this.owner.run() !== run) return
              await this.clarifyQuestions(admitted.userInputId, text)
              this.prompts.admit({
                type: 'questionSettled',
                userInputId: admitted.userInputId,
                outcome: 'clarified',
                answers: [],
              })
              this.scheduledQuestions.delete(admitted.userInputId)
            })
            .catch(() => {
              this.log.warn('Scheduled question could not be deferred')
              this.stopScheduledRun(run)
            })
          return
        }

        break
      }
      case 'approvalResolved': {
        this.scheduledApprovals.delete(admitted.approvalId)
        break
      }
      case 'questionSettled': {
        this.scheduledQuestions.delete(admitted.userInputId)
        break
      }
      case 'turnCompleted':
      case 'turnWithdrawn': {
        const completedRun = terminalRun ?? bufferedFire?.run
        for (const [id, ownership] of this.scheduledItems)
          if (ownership.run === completedRun) this.scheduledItems.delete(id)
        this.restoreScheduleMode(this.owner.terminal(admitted.turnId))

        break
      }
      // No default
    }
    if (this.early !== undefined) {
      this.early.push(admitted)
      return
    }
    notify(this.listeners, admitted, this.log, 'museCode.event', (event) => {
      this.reportListenerFailure(event)
    })
    if (!wasObserved && (admitted.type === 'turnCompleted' || admitted.type === 'sessionStatus'))
      void this.drainScheduledQueue()
  }

  /** @internal Diagnostic delivery cannot recursively report a broken observer. */
  public reportListenerFailure(event: AgentEvent): void {
    notify(this.listeners, event, this.log, 'backend.diagnostic')
  }

  public getScheduledRun(turnId?: string): UnattendedRun | undefined {
    return this.owner.run(turnId)
  }

  /** Context is host-owned; MSP input stays in its captured ordinary shape. */
  public async sendScheduledTurn(
    parts: readonly TurnPart[],
    run: UnattendedRun,
    displayText?: string,
    queuedMessageId?: string,
  ): Promise<TurnSubmission> {
    const waiter = this.owner.token()
    await run.checkParts(parts)
    await this.restoringScheduleMode
    if (!this.owner.isIdle) {
      if (!this.owner.canQueue) throw new Error(UI_TEXT.scheduleBusy)
      if (this.isDisposed) throw new Error(UI_TEXT.surfaceClosed)
      const id = queuedMessageId ?? randomUUID()
      this.scheduledQueue.set(id, { parts, run, displayText })
      void this.drainScheduledQueue()
      return { turnId: id, userMessageId: id, disposition: QUEUED_DISPOSITION }
    }
    return await this.admitScheduled(waiter, run, () =>
      this.sendTurn(run.parts(parts), displayText, run),
    )
  }

  public async steerScheduledTurn(
    expectedTurnId: string,
    parts: readonly TurnPart[],
    run: UnattendedRun,
  ): Promise<TurnSubmission> {
    const waiter = this.owner.token()
    await run.checkParts(parts)
    await this.restoringScheduleMode
    return await this.admitScheduled(
      waiter,
      run,
      () => this.steer(expectedTurnId, run.parts(parts), run),
      expectedTurnId,
    )
  }

  /** Submit one user turn; queued behind a running turn by host default. */
  /**
  Submit a turn. `displayText` is the transcript's presentation form of the
  prompt (MSP: durable, never model-visible), used when the parts carry
  more than the user typed (editor context, M5).
  */
  public async sendTurn(
    parts: readonly TurnPart[],
    displayText?: string,
    scheduledOwner?: UnattendedRun,
  ): Promise<TurnSubmission> {
    const token = this.owner.token()
    await this.restoringScheduleMode
    if (this.owner.quarantined)
      throw new Error(this.owner.quarantineCause ?? UI_TEXT.permissionReviewerMissing)
    if (scheduledOwner !== undefined) await scheduledOwner.checkParts(parts)
    if (!this.owner.start(token, scheduledOwner)) throw new Error(UI_TEXT.scheduleBusy)
    let ack: unknown
    try {
      ack = await this.command(
        'turn/start',
        {
          input: mspInput(parts),
          ...(displayText !== undefined && { displayText }),
        },
        undefined,
        scheduledOwner,
      )
    } catch (error: unknown) {
      this.owner.startFailed(token)
      throw faultOr(error, 'approvalReplay')
    }
    const result = turnStartResultSchema.parse(ack)
    const disposition = result.disposition ?? DEFAULT_DISPOSITION
    this.owner.startAcknowledged(token, result.turnId, disposition === 'started')
    return { turnId: result.turnId, disposition }
  }

  /**
  Required by `AgentSession`; a no-op here. Muse Code manages its own
  turn bounds over MSP, so no caller allowance is bound.
  */
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- AgentSession requires the member so the compiler lists every implementer; Muse Code manages its own turn bounds over MSP, so this intentionally binds nothing (PLAN.md §8).
  public setModelCallAllowance(_remaining: (() => number) | undefined): void {}

  /**
  Inject input into the turn believed to be running. The host rejects the
  steer when that turn is no longer the running one, so input meant for one
  turn never leaks into the next. That refusal is a `SteerRefusedError`,
  after which the caller may send the input as a new turn; a steer with no
  answer may still reach the turn, and fails in words that say so.
  */
  public async steer(
    expectedTurnId: string,
    parts: readonly TurnPart[],
    scheduledOwner?: UnattendedRun,
  ): Promise<TurnSubmission> {
    if (this.owner.quarantined)
      throw new SteerRefusedError(this.owner.quarantineCause ?? UI_TEXT.permissionReviewerMissing)
    const token = this.owner.token()
    const run = scheduledOwner ?? this.getScheduledRun(expectedTurnId)
    if (run !== undefined) await run.checkParts(parts)
    if (!this.owner.canSteer(token, expectedTurnId, run))
      throw new SteerRefusedError(UI_TEXT.scheduleBusy)
    const input = mspInput(parts)
    let result: unknown
    try {
      result = await this.command('turn/steer', { expectedTurnId, input }, undefined, run)
    } catch (error: unknown) {
      throw this.steerFailure(expectedTurnId, error)
    }
    return { turnId: turnSteerResultSchema.parse(result).turnId, disposition: 'steered' }
  }

  /**
  Take back a submit acknowledged `queued` before it launches (M87, PLAN.md
  D66): MSP `turn/unqueue`. A steered message is in the running turn
  already, which `turn/unqueue` does not reach: too late. As captured live
  on 2026-10-04 (docs/certification/m87-c.md), the ack is admission and the
  race at once (`turn/unqueued` follows, or comes first); a reclaim after
  the launch is refused `run_active`, and one already won `already_applied`
  (it will not run either way). Once `turn/unqueued` named the turn, a
  timed-out or failed ack still reports the withdrawal (the review of lane
  C); any other failure or refusal fails as Muse Code said it. Muse Code
  keeps no image bytes, so none come back.
  */
  public async withdrawQueued(ref: QueuedMessageRef): Promise<WithdrawOutcome> {
    if (ref.disposition !== QUEUED_DISPOSITION) {
      return TOO_LATE
    }
    if (ref.userMessageId === ref.turnId && this.scheduledQueue.delete(ref.turnId)) {
      this.emit({ type: 'turnWithdrawn', turnId: ref.turnId, reason: UI_TEXT.turnUnqueued })
      return { status: 'withdrawn', images: undefined }
    }
    try {
      turnUnqueueResultSchema.parse(await this.command('turn/unqueue', { turnId: ref.turnId }))
    } catch (error: unknown) {
      // Every refusal below is a named `turn/unqueue` outcome; anything else
      // is rethrown. The failure as it arrived is recorded here, never echoed.
      this.log.info(`turn/unqueue for turn ${ref.turnId} failed: ${failureForLog(error)}`)
      const reason = unqueueRefusal(error)
      if (reason === UNQUEUE_LAUNCHED) {
        return TOO_LATE
      }
      // `turn/unqueued` can come before the ack (captured): once it came, a
      // timed-out or failed ack still means the message was taken back.
      if (reason !== UNQUEUE_ALREADY_WON && !this.unqueuedTurns.has(ref.turnId)) {
        throw error
      }
    }
    return { status: 'withdrawn', images: undefined }
  }

  /** Ask the host to stop the running turn gracefully. */
  public async cancel(scheduledOwner?: UnattendedRun): Promise<void> {
    const token = this.owner.token()
    await this.rejectPartlyDecided()
    if (
      !this.owner.matches(token) ||
      (scheduledOwner !== undefined && !this.owner.canCancel(token, scheduledOwner))
    )
      return
    await this.command('turn/cancel', {})
  }

  /** Stop the running turn immediately. */
  public async interrupt(): Promise<void> {
    const token = this.owner.token()
    await this.rejectPartlyDecided()
    if (!this.owner.matches(token)) return
    await this.command('turn/interrupt', {})
  }

  /** Durable model selection; applies from the next model call. */
  public async setModel(modelId: string): Promise<void> {
    await this.command('session/setModel', { model: { modelId } })
    this.modelId = modelId
  }

  /** The session's standing reasoning-effort default (wire vocabulary). */
  public async setReasoningEffort(reasoningEffort: string): Promise<void> {
    await this.command('session/setReasoningEffort', { reasoningEffort })
  }

  /**
  Select one of the host's preconfigured approval modes and keep the
  session's reviewer on the mode's. The orchestration (profile sync, put
  the previous mode back when it fails, quarantine with the running mode
  named when it cannot) lives in the deferred mode sync
  (`approvalModesEntry`, loaded on the first mode change), so activation
  carries only this shell. Every failure names the wire mode the host runs
  (`ModeKeptError` when the host kept running it, `PermissionReviewerError`
  with quarantine when it runs a mode whose reviewer is unconfirmed).
  */
  public async setApprovalMode(mode: string): Promise<void> {
    const token = this.owner.token()
    await this.restoringScheduleMode
    const modes = await import('./approvalModesEntry')
    await modes.runSetApprovalMode(this.modeOps(), token, mode)
  }

  /** Summarise older context; `status` is `noop` with a reason when nothing to do. */
  public async compact(): Promise<CompactOutcome> {
    const result = compactResultSchema.parse(await this.command('session/compact', {}))
    return { status: result.status, reason: result.reason }
  }

  /**
  Answer a gated tool call: one decision per stage (PLAN.md D26).
  `requirementId` is the stage token from the request; a stale one is
  rejected by the host, never silently applied. A second decision for a
  stage already decided is not sent (a repeated click, a re-rendered card,
  a second surface), nor one for a stage the approval has left.
  */
  public async decideApproval(decision: ApprovalDecision): Promise<void> {
    const { approvalId, requirementId } = decision
    const key = `${approvalId}\u{0}${String(requirementId.sourceIndex)}`
    const inFlight = this.decisionsInFlight.get(key)
    if (inFlight !== undefined) {
      await inFlight
      return
    }
    const stage = `approval ${approvalId} stage ${String(requirementId.sourceIndex)}`
    if (this.prompts.isClosed(approvalId)) {
      throw new PromptSettledError('alreadySettled', `${stage}: the approval is closed`)
    }
    if (this.prompts.isDecided(requirementId)) {
      this.log.info(`A second decision for ${stage} was not sent: one was sent already`)
      return
    }
    const waiting = this.prompts.pending(approvalId)?.requirementId
    if (waiting !== undefined && waiting.sourceIndex !== requirementId.sourceIndex) {
      // The card is behind the ledger: the update that moves it is on its way.
      this.log.info(
        `A decision for ${stage} was not sent: the approval waits on stage ${String(waiting.sourceIndex)}`,
      )
      throw new PromptSettledError('movedOn', `${stage}: the approval moved on`)
    }
    this.prompts.markDecided(requirementId)
    const pending = this.sendApprovalDecision(decision)
    this.decisionsInFlight.set(key, pending)
    try {
      await pending
    } finally {
      this.decisionsInFlight.delete(key)
    }
  }

  /** Answer every question of a `request_user_input` prompt. */
  public async answerQuestions(
    userInputId: string,
    answers: readonly QuestionAnswer[],
  ): Promise<void> {
    try {
      await this.command('userInput/answer', { userInputId, answers: [...answers] })
    } catch (error: unknown) {
      throw settledOr(error)
    }
  }

  /** Decline a `request_user_input` prompt (`userInput/cancel`, M16). */
  public async cancelQuestions(userInputId: string): Promise<void> {
    try {
      await this.command('userInput/cancel', { userInputId })
    } catch (error: unknown) {
      throw settledOr(error)
    }
  }

  /** M46's captured clarification settles the tool; only our reserved ids display Deferred. */
  public async deferQuestions(userInputId: string): Promise<void> {
    const bundle = await import('../../questions/deferralEntry')
    await bundle.deferMuseQuestions(
      this,
      userInputId,
      () => this.prompts.markQuestionDeferred(userInputId),
      () => {
        this.prompts.unmarkQuestionDeferred(userInputId)
      },
      // The deferral's own wait is the questions lane's (B22/C4), not an MSP
      // command wait: the questions' own default, as before.
      QUESTION_DEFER_DEFAULT_SECONDS * MILLISECONDS_PER_SECOND,
      UI_TEXT.questionAnswerUncertain,
    )
  }

  /** Explain instead of choosing (`userInput/clarify`, M46): the model decides again. */
  public async clarifyQuestions(userInputId: string, text: string): Promise<void> {
    try {
      await this.command('userInput/clarify', {
        userInputId,
        clarification: { format: CLARIFICATION_FORMAT, content: text },
      })
    } catch (error: unknown) {
      throw settledOr(error)
    }
  }

  /** `task/background` (M46): the running tool call goes on without its turn waiting. */
  public async moveToBackground(taskId: string): Promise<void> {
    try {
      await this.command('task/background', { taskId })
    } catch (error: unknown) {
      throw taskRefusalOr(error)
    }
  }

  /** `task/stop` (M46): one background task, by its row's id. */
  public async stopTask(taskId: string): Promise<void> {
    try {
      await this.command('task/stop', { taskId })
    } catch (error: unknown) {
      throw taskRefusalOr(error)
    }
  }

  /** `task/stopAll` (M46): every background task; accepted over none too. */
  public async stopAllTasks(): Promise<void> {
    await this.command('task/stopAll', {})
  }

  /**
  `session/userShell` (M46): the command runs at once, outside any turn;
  its row and output arrive as a `userShell` item.
  */
  public async runUserShell(command: string): Promise<void> {
    if (!this.canRunUserShell) {
      throw new Error(UI_TEXT.userShellNotGranted)
    }
    await this.command('session/userShell', { commandText: command })
  }

  /** Captured owner verbs on a child (M18); M48's uncaptured verbs stay unavailable. */
  public async controlSubagent(subagentId: string, action: SubagentAction): Promise<void> {
    if (action === 'continue' || action === 'retry') {
      throw new Error(
        action === 'retry' ? UI_TEXT.agentRetryUnavailable : UI_TEXT.agentContinueUnavailable,
      )
    }
    if (action === 'reopen' || action === 'readResult') {
      throw new Error(`subagent/${action}`)
    }
    await this.command(`subagent/${action}`, { subagentId })
  }

  /** `subagent/sendMessage` (a note while it runs) or `subagent/followupTask` (M18). */
  public async messageSubagent(
    subagentId: string,
    body: string,
    isFollowup: boolean,
  ): Promise<void> {
    await this.command(isFollowup ? 'subagent/followupTask' : 'subagent/sendMessage', {
      subagentId,
      body,
    })
  }

  /**
  `goal/set`, `edit`, `pause`, `resume` or `clear` (M45, PLAN.md D38).
  An idle set, edit or resume wakes a goal-driving turn, which then
  arrives as its own `turn/started`; the goal arrives as
  `session/goalChanged`.
  */
  public async controlGoal(command: GoalCommand): Promise<GoalCommandOutcome> {
    let ack: unknown
    try {
      ack = await this.command(
        `goal/${command.verb}`,
        command.verb === 'set' || command.verb === 'edit' ? { objective: command.objective } : {},
      )
    } catch (error: unknown) {
      throw goalRefusalOr(error)
    }
    return { turnId: goalCommandResultSchema.parse(ack).turnId }
  }

  /** One page of a stored tool output or patch document (`item/readOutput`). */
  public async readOutput(request: OutputPageRequest): Promise<OutputPage> {
    const result = await this.command('item/readOutput', {
      itemId: request.itemId,
      outputRef: request.outputRef,
      offsetBytes: request.offsetBytes,
      lengthBytes: request.lengthBytes,
    })
    return parseOutputPage(result)
  }

  /**
  Set the durable session name; resolves to the canonical name the host
  settled, or undefined when it will arrive as `session/nameChanged`.
  Muse Code 1.3.0 refuses this on Windows (UnsupportedPlatform, PLAN.md M6).
  */
  public async rename(name: string): Promise<string | undefined> {
    const result = sessionRenameResultSchema.parse(await this.command('session/rename', { name }))
    return result.name
  }

  /** The user-invocable skills in this session's workspace and plugins. */
  public async listSkills(): Promise<readonly SkillSummary[]> {
    const result = await this.command('skill/list', {})
    return skillListResultSchema.parse(result).skills.map((skill) => toSkillSummary(skill))
  }

  /** The session's live background-task inventory, oldest first (M127, `task/list` query). */
  public async listBackgroundTasks(): Promise<readonly BackgroundTaskSummary[]> {
    const result = await this.command('task/list', {})
    return backgroundTaskListResultSchema
      .parse(result)
      .tasks.map((task) => toBackgroundTaskSummary(task))
  }

  /** The session's installed hook rows (M127, `hook/list` query). */
  public async listSessionHooks(): Promise<readonly SessionHookRow[]> {
    const result = await this.command('hook/list', {})
    return hookListResultSchema.parse(result).hooks.map((hook) => toSessionHookRow(hook))
  }

  /** The installed plugin records (M127, `plugin/list` query). */
  public async listSessionPlugins(): Promise<readonly SessionPluginRow[]> {
    const result = await this.command('plugin/list', {})
    return pluginListResultSchema.parse(result).plugins.map((plugin) => toSessionPluginRow(plugin))
  }

  /**
  Import foreign skills through the host seam (M127, `skill/import`):
  `source` is `claude` or `codex`; `dryRun` previews without writing.
  The receipt answers per-skill ids plus counts, commandId-idempotent.
  */
  public async importForeignSkills(
    source: string,
    options?: { readonly dryRun?: boolean; readonly force?: boolean },
  ): Promise<ForeignSkillImport> {
    const commandId = this.channel.connection.mintCommandId()
    const result = await this.command(
      'skill/import',
      {
        source,
        ...(options?.dryRun === true && { dryRun: true }),
        ...(options?.force === true && { force: true }),
      },
      commandId,
    )
    return toForeignSkillImport(skillImportResultSchema.parse(result))
  }

  /**
  Resume a paused workflow run (M127, `workflow/resume`): host-driven,
  the reply names the driven turn. The read-only Tasks surface shows
  runs; resuming one from it is an owner UI decision (certification).
  */
  public async resumeWorkflowRun(
    workflowRunId: string,
  ): Promise<{ readonly status: string; readonly turnId: string }> {
    const commandId = this.channel.connection.mintCommandId()
    const result = await this.command('workflow/resume', { workflowRunId }, commandId)
    const parsed = workflowResumeResultSchema.parse(result)
    return { status: parsed.status, turnId: parsed.turnId }
  }

  /**
  Pause a live workflow run (M127, `workflow/pause`): admission-only, the
  run's view events carry the settlement. The read-only Tasks surface
  shows runs; driving one from it is an owner UI decision.
  */
  public async pauseWorkflowRun(workflowRunId: string): Promise<string> {
    const commandId = this.channel.connection.mintCommandId()
    const result = await this.command('workflow/pause', { workflowRunId }, commandId)
    return workflowControlResultSchema.parse(result).status
  }

  /**
  Cancel a workflow run (M127, `workflow/cancel`): admission-only, like
  the pause above.
  */
  public async cancelWorkflowRun(workflowRunId: string): Promise<string> {
    const commandId = this.channel.connection.mintCommandId()
    const result = await this.command('workflow/cancel', { workflowRunId }, commandId)
    return workflowControlResultSchema.parse(result).status
  }

  /**
  Skip or retry one workflow child (M127, `workflow/childControl`):
  admission-only, keyed by the `(childId, attempt)` pair the run's
  `children[]` carries. A stale attempt rejects `stale_attempt`: re-read
  the item and re-key, never guess.
  */
  public async controlWorkflowChild(control: WorkflowChildControl): Promise<string> {
    const commandId = this.channel.connection.mintCommandId()
    const result = await this.command(
      'workflow/childControl',
      {
        action: control.action,
        attempt: control.attempt,
        childId: control.childId,
        workflowRunId: control.workflowRunId,
      },
      commandId,
    )
    return workflowControlResultSchema.parse(result).status
  }

  /**
  Apply a skill activation (M127, `skill/setActivation`): the selector
  names a skill from the session's full catalog, the scope its source.
  Answers the activation in force plus what it replaced.
  */
  public async setSkillActivation(change: SkillActivationChange): Promise<SkillActivation> {
    const commandId = this.channel.connection.mintCommandId()
    const result = await this.command(
      'skill/setActivation',
      {
        activation: change.activation,
        scope: change.scope,
        selector: change.selector,
      },
      commandId,
    )
    const parsed = skillSetActivationResultSchema.parse(result)
    return {
      selector: parsed.selector,
      scope: parsed.scope,
      activation: parsed.activation,
      previous: parsed.previous,
      status: parsed.status,
    }
  }

  /**
  The session's computer-use setup state (M127, `computerUseSetup/read`):
  the same grants-and-phase answer as the check, for this session.
  */
  public async readComputerUseSetup(): Promise<ComputerUseSetup> {
    return toComputerUseSetup(await this.command('computerUseSetup/read', {}))
  }

  /** Releases this surface's hold; the last one forgets the session (D25). */
  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.holders -= 1
    if (this.holders > 0) {
      return
    }
    // The CLI process can outlive this handle. Stop its work while the
    // connection is still open, even when the turn that started it has ended.
    void this.stopAllTasks().catch((error: unknown) => {
      this.log.warn(
        `task/stopAll before releasing session ${this.sessionId} failed: ${failureForLog(error)}`,
      )
    })
    this.finishDispose()
  }

  /** The host is closing: the handle goes whoever still holds it. */
  public disposeAll(): void {
    if (this.isDisposed) {
      return
    }
    // The process has already closed, so there is no session command to send.
    this.holders = 0
    this.finishDispose()
  }
}

export class MuseCodeHost implements AgentHost {
  /** Injected once by the editor/runtime before hosts are constructed. */
  public static usageRecording: UsageRecording | undefined
  /**
  The deferred usage writers (dist/usageService.js), loaded on the first
  session. Unset outside the editor (unit tests drive the writers directly).
  */
  public static usageNotesLoader: (() => UsageNotesBundle) | undefined
  private readonly observedUsage = new Set<number>()
  private readonly sessions = new Map<string, MuseSession>()
  private readonly exitListeners = new Set<(exit: HostExit) => void>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  private readonly lifecycleListeners = new Set<(event: MuseCodeLifecycleEvent) => void>()
  private readonly deletionTerminalListeners = new Set<(event: MuseCodeLifecycleEvent) => void>()
  private readonly deletionStopped = new AbortController()
  /** In-flight `recap/request` settlements by request commandId (M127). */
  private readonly pendingRecaps = new Map<
    string,
    { readonly sessionId: string; readonly settle: (recap: SessionRecap) => void }
  >()
  /** In-flight `session/leave` settlements by request commandId (M127, 1.4.11). */
  private readonly pendingLeaves = new Map<
    string,
    { readonly sessionId: string; readonly settle: (leave: SessionLeave) => void }
  >()
  private readonly usageListeners = new Set<(usage: SubscriptionUsage) => void>()
  /** Set by `close()`: the exit that follows is the extension's, not a crash (D25). */
  private isClosing = false
  private readonly commandOwner: MuseCodeCommandOwner
  /**
  Session starts, resumes and forks in flight (D26). The SDK hands every
  frame of one read to the handlers before the awaiting command resumes,
  so the prompts re-issued right after a resume answer arrive before the
  handle exists. While one is in flight, events for an unknown session
  wait here for `track`.
  */
  private opening = 0
  private readonly unclaimed = new Map<string, MappedNotification[]>()
  /** Methods already logged as unshown or malformed: one line each per host (D26). */
  private readonly loggedMethods = new Set<string>()
  /** Told once each time Muse Code stops answering (the watchdog, CLI recovery). */
  private readonly unresponsiveListeners = new Set<() => void>()
  /** The deadlines, log and watchdog every command on this connection shares. */
  private readonly channel: CommandChannel
  public readonly info: MuseHostInfo

  public constructor(
    private readonly host: MspHost,
    private readonly log: CoreLogger,
    private readonly timeouts: CommandTimeouts = DEFAULT_COMMAND_TIMEOUTS,
    private readonly features: MuseCodeFeaturePorts = {},
    private readonly usageRecording = MuseCodeHost.usageRecording,
    private readonly accountHome?: MuseCodeAccountHome,
    private restartCause?: string | undefined,
  ) {
    if (
      accountHome !== undefined &&
      (host.commandOwner?.accountHome !== accountHome ||
        !host.commandOwner.ownsConnection(host.connection))
    )
      throw new Error(UI_TEXT.accounts.museCodeUnavailable)
    this.commandOwner = host.commandOwner ?? new MuseCodeCommandOwner()
    this.channel = {
      connection: host.connection,
      timeouts,
      log,
      generation: this.commandOwner.generation,
      signal: this.commandOwner.signal,
      assertCurrent: (generation) => {
        this.commandOwner.assertCurrent(generation)
      },
      liveness: new HostLiveness(
        timeouts.unresponsiveSilenceMs ?? MSP_UNRESPONSIVE_SILENCE_MS,
        log,
        () => {
          notify(
            this.unresponsiveListeners,
            undefined,
            this.log,
            'museCode.unresponsive',
            (event) => {
              this.reportListenerFailure(event)
            },
          )
        },
        STILL_WAITING_NOTICE_MS,
      ),
    }
    const parsed = initializeResultSchema.parse(host.initializeResult)
    const serverVersion = parsed.serverInfo.version
    this.info = {
      kind: 'museCode',
      serverName: parsed.serverInfo.name,
      serverVersion,
      museHome: parsed.museHome,
      grantedCapabilities: parsed.grantedCapabilities ?? [],
      ...(parsed.sandboxAvailability !== undefined && {
        sandboxAvailability: parsed.sandboxAvailability,
      }),
      ...(parsed.sandboxUnavailableReason !== undefined && {
        sandboxUnavailableReason: parsed.sandboxUnavailableReason,
      }),
      // Muse Code refuses `session/rename` and `session/fork` on Windows
      // (meta-models/muse-code-sdk#30, #31): verified on 1.3.0 (2026-09-22)
      // and 1.4.0 (2026-09-27), still refused on 1.4.3 (2026-10-05,
      // docs/certification/muse143.md) and 1.4.4-R5419.1 (2026-10-10,
      // docs/certification/m53.md). No release has fixed them, so every version
      // is limited there until one is verified (D26). A 1.3.0 ceiling showed
      // the failing actions again on 1.4.0 (0.9.1, release-0.9.1.md).
      canEditSessions: parsed.platformOs !== WINDOWS_OS,
      // No `canDeleteSessions`: the delete gate
      // (`./museDeleteGate.ts`, version plus the injected lifecycle reader)
      // lives outside the activation graph so the budget holds, so a Muse
      // Code host omits the field and History offers no Delete there.
      // Nothing is sent the CLI cannot answer (PLAN.md D26); the reader
      // injection wires the offer when it lands.
    }
    this.log.info(
      `MSP host on ${parsed.platformOs ?? 'an unreported OS'}, schema v${String(parsed.schema?.version ?? 'unreported')} ${parsed.schema?.fingerprint ?? ''}, sessions ${parsed.sessionDurability ?? DURABLE_SESSIONS}`,
    )
    if (parsed.sessionDurability !== undefined && parsed.sessionDurability !== DURABLE_SESSIONS) {
      this.log.warn(
        `This muse serve keeps ${parsed.sessionDurability} sessions: History and resume will not find them after it exits, and Muse Code 1.3.0 sent such a host's turns to no client (PLAN.md D43)`,
      )
    }
    // The SDK's connection keeps one handler; a throw inside it would end the
    // read loop and leave the connection deaf without a word (D25).
    host.connection.onNotification((notification) => {
      this.channel.liveness.heard()
      try {
        this.dispatch(notification)
      } catch (error: unknown) {
        this.log.error(`MSP ${notification.method} could not be handled: ${failureForLog(error)}`)
      }
    })
    host.connection.onServerRequest((request) => {
      this.channel.liveness.heard()
      return this.serverRequest(request)
    })
    // A dropped or unreadable frame gets fixed words, never its content.
    host.connection.onProtocolError(() => {
      this.log.warn('MSP protocol error (frame not logged)')
    })
    // A connection that ends while the process lives (a framing violation)
    // is as good as dead: the process is closed so the exit is reported.
    void host.connection.closed.then(() => {
      this.deletionStopped.abort(new Error(UI_TEXT.sessionDeleteConnectionClosed))
      this.commandOwner.close()
      if (this.isClosing) {
        return
      }
      this.log.warn('The MSP connection closed while muse serve was running; closing it')
      void this.host.close()
    })
    void host.exited.then((exit) => {
      this.deletionStopped.abort(new Error(UI_TEXT.sessionDeleteHostExited))
      this.commandOwner.close()
      const described = describeExit(exit, this.isClosing)
      if (described.isExpected) {
        this.log.info(`muse serve exited as asked (${described.description})`)
      } else {
        this.log.warn(`muse serve exited (${described.description})`)
      }
      notify(this.exitListeners, described, this.log, 'museCode.exit', (event) => {
        this.reportListenerFailure(event)
      })
    })
  }

  private reportListenerFailure(event: AgentEvent): void {
    for (const session of this.sessions.values()) {
      session.reportListenerFailure(event)
    }
  }

  /** One notification: a host-level event, or a session's. */
  private dispatch(notification: WireNotification): void {
    if (this.dispatchHostEvent(notification.method, notification.params)) {
      return
    }
    this.deliver(notification)
  }

  /** A session's notification to its handle; false when nothing can show it. */
  private deliver(notification: WireNotification, isReplay = false): boolean {
    const mapped = mapNotification(notification)
    if (mapped === UNKNOWN_METHOD || mapped === MALFORMED_PARAMS) {
      this.noteUnmapped(notification.method, mapped)
      return false
    }
    const admitted: MappedNotification =
      isReplay && 'event' in mapped && isPendingPrompt(mapped.event)
        ? { ...mapped, event: { ...mapped.event, isReplayed: true } }
        : mapped
    const session = this.sessions.get(admitted.sessionId)
    if (session !== undefined) {
      session.receive(admitted, isReplay)
      return true
    }
    if (this.opening > 0) {
      const waiting = this.unclaimed.get(admitted.sessionId) ?? []
      waiting.push(admitted)
      this.unclaimed.set(admitted.sessionId, waiting)
      return true
    }
    this.log.warn(`MSP event ${notification.method} for unknown session ${admitted.sessionId}`)
    return false
  }

  /** Once per method: the extension does not show it, or it failed its schema. */
  private noteUnmapped(
    method: string,
    outcome: typeof UNKNOWN_METHOD | typeof MALFORMED_PARAMS,
  ): void {
    if (this.loggedMethods.has(method)) {
      return
    }
    this.loggedMethods.add(method)
    if (outcome === MALFORMED_PARAMS) {
      this.log.warn(`MSP ${method} had an unexpected shape and was ignored (logged once)`)
    } else {
      this.log.info(`MSP ${method} is not shown by this extension (logged once)`)
    }
  }

  /** A server request: a prompt shown as the notification it mirrors, answered with the receipt. */
  private serverRequest(request: {
    readonly method: string
    readonly params?: Record<string, unknown> | undefined
  }): Promise<Record<string, unknown>> {
    const mirrored = PROMPT_SERVER_REQUESTS.get(request.method)
    if (mirrored === undefined) {
      this.log.warn(`Unsupported MSP server request ${request.method}; refusing`)
      return Promise.reject(
        new MspError({
          code: JSON_RPC_ERRORS.methodNotFound,
          message: `method not found: ${request.method}`,
          data: { kind: 'methodNotFound' },
        }),
      )
    }
    return this.deliver({ method: mirrored, params: request.params })
      ? Promise.resolve(PRESENTED)
      : Promise.reject(new Error(`no surface can show ${request.method}`))
  }

  /**
  Runs a session start, resume or fork with early events held for its
  handle (D26); whatever no handle claimed by the end is logged and dropped.
  */
  private async opened<T>(open: () => Promise<T>): Promise<T> {
    this.opening += 1
    try {
      return await open()
    } finally {
      this.opening -= 1
      if (this.opening === 0) {
        for (const [sessionId, waiting] of this.unclaimed) {
          this.log.warn(
            `${String(waiting.length)} MSP events for session ${sessionId} arrived while it was opening and no handle claimed them`,
          )
        }
        this.unclaimed.clear()
      }
    }
  }

  private async command(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return await commandWithin(this.channel, this.channel.generation, method, params, signal)
  }

  /**
  Host-level notifications bypass the per-session routing: the list
  stream (`sessionListStream` grant) is about stored sessions, loaded here
  or not, and `usage/changed` is about the account. True when the method
  was one of them.
  */
  private dispatchHostEvent(method: string, params: unknown): boolean {
    // A requested recap's settlement never reaches the conversation: it
    // resolves the waiter by the request's commandId. Anything else with
    // this method (a late settlement past the wait, or one nobody asked
    // for) falls through to the notice mapping.
    if (method === 'recap/completed') {
      const parsed = recapCompletedSchema.safeParse(params)
      if (!parsed.success) {
        this.warnShape(method)
        return true
      }
      return claimRecapSettlement(this.pendingRecaps, parsed.data) !== undefined
    }
    // A requested handoff's settlement never reaches the conversation: it
    // resolves the waiter by the request's commandId, like the recap above.
    if (method === 'session/leaveCompleted') {
      const parsed = leaveCompletedSchema.safeParse(params)
      if (!parsed.success) {
        this.warnShape(method)
        return true
      }
      return claimLeaveSettlement(this.pendingLeaves, parsed.data) !== undefined
    }
    if (
      this.features.lifecycle !== undefined &&
      (method === 'session/started' || method === 'session/deleteCompleted')
    ) {
      const event = this.features.lifecycle.parseNotification({ method, params })
      if (event.type === 'started') {
        notify(
          this.listListeners,
          { type: 'changed', record: event.record },
          this.log,
          'museCode.list',
        )
      }
      if (event.type === 'deleteCompleted' && event.outcome === 'completed') {
        this.sessions.get(event.sessionId)?.disposeAll()
      }
      notify(this.deletionTerminalListeners, event, this.log, 'museCode.deleteTerminal')
      notify(this.lifecycleListeners, event, this.log, 'museCode.lifecycle')
      return true
    }
    if (method === USAGE_CHANGED) {
      const parsed = subscriptionUsageSchema.safeParse(params)
      if (parsed.success) {
        const usage = parsed.data
        if (!this.observedUsage.has(usage.observedAtMs)) {
          this.observedUsage.add(usage.observedAtMs)
          this.recordLimitSnapshot(usage)
        }
        this.accountHome?.assertCurrent()
        this.accountHome?.observeUsage(parsed.data)
        notify(this.usageListeners, parsed.data, this.log, 'museCode.usage', (event) => {
          this.reportListenerFailure(event)
        })
      } else {
        this.warnShape(method)
      }
      return true
    }
    if (method !== SESSION_LIST_CHANGED && method !== SESSION_CLOSED) {
      return false
    }
    const event = this.parseListEvent(method, params)
    if (event === undefined) {
      this.warnShape(method)
      return true
    }
    notify(this.listListeners, event, this.log, 'museCode.list', (diagnostic) => {
      this.reportListenerFailure(diagnostic)
    })
    return true
  }

  private warnShape(method: string): void {
    this.log.warn(`MSP ${method} had an unexpected shape; ignored`)
  }

  /**
  The deferred usage writers, or undefined when the service bundle is not
  loaded (outside the editor) or cannot be read: journaling is best-effort,
  so a session without writers is kept but not recorded.
  */
  private usageNotes(): UsageNotesBundle | undefined {
    const loader = MuseCodeHost.usageNotesLoader
    if (loader === undefined) return undefined
    try {
      return loader()
    } catch {
      this.log.warn('Usage notes bundle unavailable; usage is not recorded for this session')
      return undefined
    }
  }

  /** One `usage/changed` meter reading, journaled through the deferred writers. */
  private recordLimitSnapshot(usage: SubscriptionUsage): void {
    const input = this.usageNotes()?.museCodeLimitInput(usage)
    if (input !== undefined) this.usageRecording?.limit(input)
  }

  /** The session's journal writers, loaded with the service bundle on first use. */
  private createUsageDeltas(
    recording: UsageRecording,
    sessionId: string,
    modelId: string,
    isNew: boolean,
  ): MuseUsageDeltas | undefined {
    const notes = this.usageNotes()
    return notes === undefined
      ? undefined
      : new notes.MuseUsageDeltas(recording, sessionId, modelId, isNew)
  }

  private parseListEvent(method: string, params: unknown): SessionListEvent | undefined {
    if (method === SESSION_LIST_CHANGED) {
      const parsed = sessionListChangedSchema.safeParse(params)
      return parsed.success ? { type: 'changed', record: parsed.data.session } : undefined
    }
    const parsed = sessionClosedSchema.safeParse(params)
    return parsed.success
      ? { type: 'closed', sessionId: parsed.data.sessionId, reason: parsed.data.reason }
      : undefined
  }

  /** Registers the handle for a session this connection now holds. */
  private track(
    record: { readonly sessionId: string },
    modelId: string,
    isNew = false,
    initialApprovalMode?: string,
  ): MuseSession {
    const existing = this.sessions.get(record.sessionId)
    if (existing !== undefined) {
      // A second surface on the same session: closing one must not deafen the other.
      existing.retain()
      return existing
    }
    const handle = new MuseSession(
      record.sessionId,
      modelId,
      this.channel,
      () => {
        this.sessions.delete(record.sessionId)
      },
      this.info.grantedCapabilities.includes(MSP_USER_SHELL_CAPABILITY),
      this.usageRecording === undefined
        ? undefined
        : this.createUsageDeltas(this.usageRecording, record.sessionId, modelId, isNew),
      initialApprovalMode,
      {
        previewNote: (note) => this.previewFeedbackNote(note),
        submit: (input) => this.submitFeedback(input),
      },
    )
    this.sessions.set(record.sessionId, handle)
    const waiting = this.unclaimed.get(record.sessionId) ?? []
    for (const mapped of waiting) {
      handle.receive(mapped)
    }
    this.unclaimed.delete(record.sessionId)
    return handle
  }

  private loaded(envelope: SessionEnvelope, modelId: string): LoadedSession {
    return {
      // The envelope serves the mode the host runs: the handle starts
      // knowing it, so the first mode change rolls back like a live one.
      session: this.track(envelope.session, modelId, false, envelope.session.approvalMode?.mode),
      record: envelope.session,
      history: historyOutcome(envelope),
      activeTurnId: envelope.session.activeTurnId ?? undefined,
    }
  }

  /**
  The pending prompts a resume's pointers name, pulled with
  `approval/listPending` (the documented dual of the re-issued requests,
  tdd SS5.7), so the cards appear however the re-issue was delivered; the
  ledger shows each once (D26).
  */
  private async presentPending(sessionId: string): Promise<void> {
    try {
      const pending = listPendingResultSchema.parse(
        await this.command('approval/listPending', { sessionId }),
      )
      for (const params of pending.approvals) {
        this.deliver({ method: 'approval/requested', params }, true)
      }
      for (const params of pending.userInputs) {
        this.deliver({ method: 'userInput/requested', params })
      }
    } catch (error: unknown) {
      this.channel.assertCurrent(this.channel.generation)
      this.log.warn(
        `approval/listPending after resuming ${sessionId} failed: ${failureForLog(error)}`,
      )
    }
  }

  private mcpConfig(
    mcpServers: Readonly<Record<string, SessionMcpServer>> | undefined,
  ): Record<string, unknown> {
    if (mcpServers === undefined) {
      return {}
    }
    return {
      config: {
        mcpServers: Object.fromEntries(
          Object.entries(mcpServers).map(([name, server]) => [
            name,
            // `optional`: a tool-server hiccup never blocks the session.
            'command' in server
              ? {
                  transport: 'stdio',
                  command: server.command,
                  args: server.args,
                  env: server.env,
                  mode: 'optional',
                }
              : {
                  transport: 'streamableHttp',
                  url: server.url,
                  headers: server.headers,
                  mode: 'optional',
                },
          ]),
        ),
      },
    }
  }

  /** Last durable goal event at the view head; an empty history means no goal. */
  private async goalFromView(sessionId: string): Promise<SessionGoal | null> {
    let cursor: string | undefined
    for (let page = 0; page < GOAL_RECOVERY_MAX_PAGES; page += 1) {
      const raw = await requestWithin(
        this.channel,
        this.channel.generation,
        VIEW_PAGE,
        this.timeouts.normalMs,
        () =>
          answered(this.channel, this.channel.generation, VIEW_PAGE, {
            sessionId,
            limit: GOAL_RECOVERY_PAGE_LIMIT,
            direction: 'backward',
            ...(cursor !== undefined && { cursor }),
          }),
      )
      const result = viewPageResultSchema.parse(raw)
      for (const frame of result.events.toReversed()) {
        if (frame.method !== 'session/goalChanged') {
          continue
        }
        const mapped = mapNotification(frame)
        if (
          typeof mapped === 'string' ||
          !('event' in mapped) ||
          mapped.sessionId !== sessionId ||
          mapped.event.type !== 'goalChanged'
        ) {
          throw new Error('Muse Code returned an invalid goal event in view history')
        }
        return mapped.event.goal
      }
      if (result.nextCursor === null) {
        return null
      }
      if (result.nextCursor === cursor) {
        throw new Error('Muse Code repeated a view history cursor')
      }
      cursor = result.nextCursor
    }
    throw new Error('Muse Code view history exceeded the goal recovery limit')
  }

  public onExit(listener: (exit: HostExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  /**
  Why the host this one replaced went away (`AgentHost.peekRestartCause`):
  every turn that fails for the lost sign-in names it — concurrent
  conversations on this shared host classify the same loss (Codex on PR
  #211) — until `clearRestartCause` proves the host. Set at construction
  by the backend manager, never over the wire: a restart cause is local
  process knowledge.
  */
  public peekRestartCause(): string | undefined {
    return this.restartCause
  }

  /** A turn that ran to completion proves the host (F94). */
  public clearRestartCause(): void {
    this.restartCause = undefined
  }

  /**
  Told once each time Muse Code stops answering (the watchdog): commands
  missed their deadlines and nothing came from it for a while. It answers
  again on its own only if a frame arrives; the window restarts it.
  */
  public onUnresponsive(listener: () => void): () => void {
    this.unresponsiveListeners.add(listener)
    return () => {
      this.unresponsiveListeners.delete(listener)
    }
  }

  /** The subscription window the CLI last observed; absent until a turn has run. */
  public async readUsage(): Promise<SubscriptionUsage | undefined> {
    const result = await this.command(USAGE_READ, {})
    const usage = usageReadResultSchema.parse(result).usage
    if (usage !== undefined) {
      this.accountHome?.assertCurrent()
      this.accountHome?.observeUsage(usage)
    }
    return usage
  }

  public onUsageChanged(listener: (usage: SubscriptionUsage) => void): () => void {
    this.usageListeners.add(listener)
    return () => {
      this.usageListeners.delete(listener)
    }
  }

  /** Stored-session changes on this host (needs the `sessionListStream` grant). */
  public onSessionListEvent(listener: (event: SessionListEvent) => void): () => void {
    this.listListeners.add(listener)
    return () => {
      this.listListeners.delete(listener)
    }
  }

  /**
  A "while you were away" recap (M127): the ack admits, then the request
  settles exactly once on `recap/completed` matched by commandId. Past
  `MSP_SETTLE_TIMEOUT_MS` the wait ends and a late settlement becomes
  a notice instead of a hang. One in flight per session, host-enforced.
  */
  public async requestSessionRecap(sessionId: string): Promise<SessionRecap> {
    for (const pending of this.pendingRecaps.values()) {
      if (pending.sessionId === sessionId) {
        throw new Error(`a recap is already in flight for session ${sessionId}`)
      }
    }
    // Arm before dispatch: the settlement can be in the same read as admission.
    const commandId = this.channel.connection.mintCommandId()
    let settle!: (recap: SessionRecap) => void
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Node 20 (VS Code 1.99's host) lacks Promise.withResolvers (PLAN.md §8); the executor assigns the resolver synchronously, so the settlement always has one.
    const settled = new Promise<SessionRecap>((resolve) => {
      settle = resolve
    })
    this.pendingRecaps.set(commandId, { sessionId, settle })
    try {
      const ack = recapRequestResultSchema.parse(
        await commandWithin(
          this.channel,
          this.channel.generation,
          'recap/request',
          { sessionId },
          undefined,
          commandId,
        ),
      )
      if (ack.commandId !== commandId) {
        throw new Error(`recap/request ack did not echo its commandId ${commandId}`)
      }
      return await withDeadline(
        settled,
        MSP_SETTLE_TIMEOUT_MS,
        `recap for session ${sessionId} did not settle in time`,
      )
    } finally {
      this.pendingRecaps.delete(commandId)
    }
  }

  /**
  Hand a loaded session to another host (M127, `session/leave`, 1.4.11):
  the ack admits, then the handoff settles exactly once on
  `session/leaveCompleted` matched by commandId. Past
  `MSP_SETTLE_TIMEOUT_MS` the wait ends and a late settlement becomes a
  notice instead of a hang. `stop` cancels unfinished work first.
  */
  public async leaveSession(
    sessionId: string,
    options?: { readonly stop?: boolean },
  ): Promise<SessionLeave> {
    // Arm before dispatch: the settlement can be in the same read as admission.
    const commandId = this.channel.connection.mintCommandId()
    let settle!: (leave: SessionLeave) => void
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Node 20 (VS Code 1.99's host) lacks Promise.withResolvers (PLAN.md §8); the executor assigns the resolver synchronously, so the settlement always has one.
    const settled = new Promise<SessionLeave>((resolve) => {
      settle = resolve
    })
    this.pendingLeaves.set(commandId, { sessionId, settle })
    try {
      const ack = sessionLeaveResultSchema.parse(
        await commandWithin(
          this.channel,
          this.channel.generation,
          'session/leave',
          {
            sessionId,
            ...(options?.stop === true && { stop: true }),
          },
          undefined,
          commandId,
        ),
      )
      if (ack.commandId !== commandId) {
        throw new Error(`session/leave ack did not echo its commandId ${commandId}`)
      }
      return await withDeadline(
        settled,
        MSP_SETTLE_TIMEOUT_MS,
        `leave for session ${sessionId} did not settle in time`,
      )
    } finally {
      this.pendingLeaves.delete(commandId)
    }
  }

  /**
  Cancel the session's in-flight recap (M127): it settles `cancelled`;
  idle is an accepted no-op. Answers the cancel's admission status.
  */
  public async cancelSessionRecap(sessionId: string): Promise<string> {
    const commandId = this.channel.connection.mintCommandId()
    const result = recapRequestResultSchema.parse(
      await commandWithin(
        this.channel,
        this.channel.generation,
        'recap/cancel',
        { sessionId },
        undefined,
        commandId,
      ),
    )
    return result.status
  }

  /**
  The host's computer-use setup state (M127, `computerUseSetup/check`):
  the three macOS grants with no prompt, never requesting one. Refusals
  (a Linux host answers `computerUseUnavailable`) flow as the MSP error.
  */
  public async checkComputerUseSetup(): Promise<ComputerUseSetup> {
    return toComputerUseSetup(await this.command('computerUseSetup/check', {}))
  }

  /**
  The host's computer-use settings (M127, `computerUseSettings/read`).
  Refusals (a host without computer use answers `computerUseUnavailable`)
  flow as the MSP error.
  */
  public async readComputerUseSettings(options?: {
    readonly installed?: boolean
    readonly showBuiltIns?: boolean
  }): Promise<ComputerUseSettingsInfo> {
    const result = await this.command('computerUseSettings/read', {
      ...(options?.installed === true && { installed: true }),
      ...(options?.showBuiltIns === true && { showBuiltIns: true }),
    })
    const parsed = computerUseSettingsResultSchema.parse(result)
    return {
      blockedApps: parsed.blockedApps,
      computerControl: parsed.computerControl,
      screenshots: parsed.screenshots,
      ...(parsed.apps !== undefined && { apps: parsed.apps }),
    }
  }

  /** Includes every returned deletion outcome; only known terminals settle a command. */
  public onMuseCodeLifecycleEvent(listener: (event: MuseCodeLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(listener)
    return () => {
      this.lifecycleListeners.delete(listener)
    }
  }

  /**
  The caller confirms permanent deletion before invoking this operation.
  Resolves once the terminal `deleteCompleted` notification arrives; that
  terminal itself reaches `onMuseCodeLifecycleEvent` listeners. (No caller
  uses the terminal return, so this resolves `void`.)
  */
  public async deleteSession(sessionId: string): Promise<void> {
    const reader = this.features.lifecycle
    if (reader === undefined)
      throw new Error(fill(UI_TEXT.sessionDeleteUnsupported, { version: this.info.serverVersion }))
    const signal = this.deletionStopped.signal
    signal.throwIfAborted()
    const commandId = this.channel.connection.mintCommandId()
    const deletion: {
      state:
        | { phase: 'pending' }
        | { phase: 'terminalValidated'; event: MuseCodeLifecycleEvent }
        | { phase: 'reported' }
    } = { state: { phase: 'pending' } }
    // Arm before dispatch: the notification can be in the same read as admission.
    let onTerminal: ((event: MuseCodeLifecycleEvent) => void) | undefined
    const terminal = new Promise<MuseCodeLifecycleEvent>((resolve) => {
      onTerminal = (event) => {
        if (
          deletion.state.phase !== 'pending' ||
          event.type !== 'deleteCompleted' ||
          event.sessionId !== sessionId ||
          event.commandId !== commandId ||
          (event.outcome !== 'completed' && event.outcome !== 'failed')
        ) {
          return
        }
        deletion.state = { phase: 'terminalValidated', event }
        resolve(event)
      }
      this.deletionTerminalListeners.add(onTerminal)
    })
    let onAbort: (() => void) | undefined
    const stopped = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new Error(UI_TEXT.sessionDeleteHostClosed))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    const raced = Promise.race([
      (async () => {
        reader.parseDeleteAdmission(
          await commandWithin(
            this.channel,
            this.channel.generation,
            'session/delete',
            { sessionId },
            undefined,
            commandId,
          ),
          commandId,
        )
        return await terminal
      })(),
      stopped,
    ])
    // The deletion is waited on until it is confirmed or the wait is
    // stopped, saying so out loud (owner 2026-10-16); no test names this
    // wait, so it names no deadline at all.
    const stopNoticing = startStillWaiting((elapsedMs) => {
      this.log.info(stillWaitingText({ key: 'sessionDeletion' }, elapsedMs))
    })
    try {
      await raced
      return
    } catch (error: unknown) {
      // Dispatch validated the terminal before shutdown; async admission may still be resuming.
      if (deletion.state.phase === 'terminalValidated') {
        this.log.info(
          `session/delete for session ${sessionId} failed after its terminal was validated (${failureForLog(error)}); the validated terminal stands`,
        )
        return
      }
      throw error
    } finally {
      stopNoticing()
      deletion.state = { phase: 'reported' }
      if (onTerminal !== undefined) this.deletionTerminalListeners.delete(onTerminal)
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
    }
  }

  /** Captured item/readOutput also reads a child without loading its session. */
  public async readSessionOutput(
    sessionId: string,
    request: OutputPageRequest,
  ): Promise<OutputPage> {
    return parseOutputPage(await this.command('item/readOutput', { sessionId, ...request }))
  }

  /** One page of this workspace's stored sessions, newest activity first. */
  public async listSessions(options: ListSessionsOptions): Promise<SessionPage> {
    const result = await this.command('session/list', {
      workspaceRoot: options.workspaceRoot,
      limit: Math.min(options.limit, MSP_SESSION_LIST_MAX_LIMIT),
      ...(options.cursor !== undefined && { cursor: options.cursor }),
    })
    const page = sessionListResultSchema.parse(result)
    return { sessions: page.sessions, nextCursor: page.nextCursor ?? undefined }
  }

  /**
  Load a stored session on this connection with its history as a folded
  snapshot where the host's budget allows (the served mode is reported):
  the items, and the name, todo list and goal beside them (M45).
  `modelId` is the caller's standing selection: the record's own
  `modelId` is the metadata fold's and not to be trusted (PLAN.md M6).
  */
  public async resumeSession(
    sessionId: string,
    modelId: string,
    mcpServers?: Readonly<Record<string, SessionMcpServer>>,
    options?: { readonly requireSideChat?: boolean; readonly permissionProfile?: string },
  ): Promise<LoadedSession> {
    const { loaded, hasPending } = await this.opened(async () => {
      const envelope = sessionEnvelopeSchema.parse(
        await this.command('session/resume', {
          sessionId,
          history: HISTORY_PREFERENCE_SNAPSHOT,
          // The launch permission-profile pick (1.4.8): refused before
          // anything is written when the host does not offer it.
          ...(options?.permissionProfile !== undefined && {
            permissionProfile: options.permissionProfile,
          }),
          ...this.mcpConfig(mcpServers),
        }),
      )
      return {
        loaded: this.loaded(envelope, modelId),
        hasPending: (envelope.pendingRequests ?? []).length > 0,
      }
    })
    try {
      if (hasPending) await this.presentPending(sessionId)
      let history = loaded.history
      if (history.goal === undefined) {
        try {
          history = { ...history, goal: await this.goalFromView(sessionId) }
        } catch {
          this.channel.assertCurrent(this.channel.generation)
          // Ordinary page failures must not strand an attached session.
          this.log.warn('Muse Code could not recover the goal from view history after resume')
        }
      }
      this.channel.assertCurrent(this.channel.generation)
      return { ...loaded, history }
    } catch (error: unknown) {
      this.sessions.get(sessionId)?.disposeAll()
      throw error
    }
  }

  /** A point-in-time read with items, without loading the session. */
  public async readSession(
    sessionId: string,
    options?: { readonly recoverGoal?: boolean },
  ): Promise<SessionHistoryOutcome> {
    const result = await this.command('session/read', {
      sessionId,
      excludeItems: false,
    })
    const read = historyOutcome(sessionEnvelopeSchema.parse(result))
    const session = this.sessions.get(sessionId)
    const history = {
      ...read,
      items: read.items.map((item) => session?.observeAgent(item) ?? item),
    }
    for (const parent of this.sessions.values()) parent.observeChild(sessionId, history)
    return options?.recoverGoal === true && history.goal === undefined
      ? { ...history, goal: await this.goalFromView(sessionId) }
      : history
  }

  /**
  Copy a session's completed turns (through `lastTurnId`, or all of them)
  into a new session, loaded here. Muse Code 1.3.0 refuses this on
  Windows ("invalid fork boundary ... WriteFailed", PLAN.md M6).
  */
  public async forkSession(
    sessionId: string,
    modelId: string,
    lastTurnId?: string,
  ): Promise<LoadedSession> {
    if (!this.info.canEditSessions) {
      throw new Error(UI_TEXT.sessionEditsUnsupported)
    }
    return await this.opened(async () => {
      const result = await this.command('session/fork', {
        sessionId,
        ...(lastTurnId !== undefined && { cutPoint: { lastTurnId } }),
      })
      return this.loaded(sessionEnvelopeSchema.parse(result), modelId)
    })
  }

  /**
  The visible model catalogue; with a session id the active row is
  flagged. While this host runs with `--contributor-mode on`, each
  listed model's `-contributor` counterpart rides along (the CLI serves
  no such row itself); otherwise the wire reading stands as served.
  */
  public async listModels(
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<readonly MuseCodeModelSummary[]> {
    // The caller's stop joins the channel's own cancel in the shared wait
    // (PR #214 review); the read-only listing still settles underneath.
    signal?.throwIfAborted()
    const result = await this.command(
      'model/list',
      {
        ...(sessionId !== undefined && { sessionId }),
      },
      signal,
    )
    const models = modelListResultSchema.parse(result).models.map((model) => {
      try {
        return toModelSummary(model, this.features.modelEfforts)
      } catch (error: unknown) {
        // A malformed row reads as before instead of failing the whole
        // catalogue (C-M106-3R3): the row's identity is logged, its
        // content stays out of the log. Anything else is a reader bug
        // and fails the listing instead of hiding behind tierless rows.
        // The zod failure is matched by name (registry.ts): minification
        // must not decide which rows keep their tiers.
        if (!(error instanceof Error && error.name === '$ZodError')) throw error
        this.log.warn(
          `model/list row for ${model.modelId} has malformed effort extras; reading it without tiers`,
        )
        return toModelSummary(model)
      }
    })
    return this.features.contributorMode === true
      ? [...models, ...contributorModelSummaries(models)]
      : models
  }

  /** Registered literal secrets remain in the host; only the scrubbed note is previewed. */
  public previewFeedbackNote(note: string): string {
    return redactSecrets(note, this.features.feedback?.secretLiterals?.() ?? [])
  }

  /** The user's confirmed disclosure choices; send once, never replay an upload. */
  public async submitFeedback(input: FeedbackRequest): Promise<string> {
    const reader = this.features.feedback
    if (reader === undefined || !this.info.grantedCapabilities.includes('feedback')) {
      throw new Error(UI_TEXT.feedbackFailed)
    }
    return await submitMuseFeedback(
      input,
      {
        scrubNote: (note) => Promise.resolve(this.previewFeedbackNote(note)),
        submit: async (request) =>
          reader.parseOutcome(
            await requestWithin(
              this.channel,
              this.channel.generation,
              'feedback/submit',
              this.timeouts.normalMs,
              () => {
                // The registry may change during the async scrub. Recheck it in
                // the dispatch tick and send only the preview the person approved.
                const note = this.previewFeedbackNote(request.note)
                if (note !== request.note) throw new Error(UI_TEXT.feedbackFailed)
                return answered(this.channel, this.channel.generation, 'feedback/submit', {
                  ...request,
                  note,
                })
              },
            ),
          ),
      },
      input.note,
    )
  }

  public async startSession(options: StartSessionOptions): Promise<MuseSession> {
    return await this.opened(async () => {
      let result: unknown
      try {
        result = await this.command('session/start', {
          workspaceRoot: options.workspaceRoot,
          modelId: options.modelId,
          approvalMode: options.approvalMode,
          // The initial permission profile (1.4.6): select, never create.
          // An older host ignores the unknown member and keeps its default
          // profile; 1.4.7 commits it (amendment 42624).
          ...(options.permissionProfile !== undefined && {
            permissionProfile: options.permissionProfile,
          }),
          ...this.mcpConfig(options.mcpServers),
        })
      } catch (error: unknown) {
        throw ceilingOr(error)
      }
      const { session } = sessionStartResultSchema.parse(result)
      return this.track(session, session.modelId ?? options.modelId, true, options.approvalMode)
    })
  }

  public get sessionCount(): number {
    return this.sessions.size
  }

  public async close(): Promise<void> {
    // The exit that follows is the extension's own (D25).
    this.isClosing = true
    this.deletionStopped.abort(new Error(UI_TEXT.sessionDeleteHostClosed))
    this.commandOwner.close()
    // Close the process first: the host emits session/statusChanged for every
    // loaded session on the way down, and those must still find their session.
    try {
      await this.host.close()
    } finally {
      for (const session of this.sessions.values()) {
        session.disposeAll()
      }
    }
  }
}

/** Account-only handshake: the SDK's public spawner hides the submission transport. */
export function spawnAccountMspConnection(
  options: Pick<
    SpawnMspConnectionOptions,
    'command' | 'args' | 'cwd' | 'onStderr' | 'shutdownTimeoutMs'
  > & {
    /**
    The child's whole environment: the guarded serve environment for its
    cwd, so a raw environment does not type-check here.
    */
    readonly env: GuardedChildEnv
  },
  accountHome: MuseCodeAccountHome,
  /** The resource governor's registration of the spawned tree (M107). */
  onSpawn?: (child: ChildProcess) => void,
) {
  accountHome.assertCurrent()
  const hasProcessGroup = process.platform !== 'win32'
  const child = spawnGuarded(options.command, [...(options.args ?? [])], {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    env: options.env,
    detached: hasProcessGroup,
    windowsHide: true,
  })
  onSpawn?.(child)
  const transport = new ChildStdioTransport(
    child,
    options.onStderr,
    options.shutdownTimeoutMs,
    hasProcessGroup,
  )
  const commandOwner = new MuseCodeCommandOwner(accountHome)
  const connection = commandOwner.connect(transport)
  const close = async () => {
    commandOwner.close()
    try {
      await connection.close()
    } finally {
      // Even a framing/write failure must finish the SDK-owned process teardown.
      await transport.close()
    }
    return await transport.exited
  }
  let isInitialized = false
  return {
    exited: transport.exited,
    close,
    initialize: async (params: Parameters<MspHandshake['initialize']>[0]) => {
      if (isInitialized) throw new Error('initialize may be sent only once per connection')
      isInitialized = true
      const initializeResult = initializeResultSchema.parse(
        await connection.request('initialize', { ...params }),
      )
      const fingerprint = initializeResult.schema?.fingerprint
      if (fingerprint === undefined) throw new Error('initialize result has no schema fingerprint')
      connection.notify('initialized')
      await connection.flush()
      return {
        connection,
        commandOwner,
        initializeResult,
        fingerprintWarning: checkServedFingerprint(fingerprint),
        exited: transport.exited,
        close,
      }
    },
  }
}

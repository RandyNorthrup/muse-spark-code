import { Usd, legacyUsdSchema, nonnegativeUsdSchema } from './usd'
// M115's internal, editor-independent contracts. M52's v1 on-disk schema stays
// in schedule.ts until lane S has verified and removed every migrated job.
import * as z from 'zod/mini'
import {
  AGENT_SCHEDULE_MAX_DEPTH,
  CRON_FIELD_COUNT,
  CRON_MAX_HOUR,
  CRON_MAX_MINUTE,
  CRON_MAX_WEEKDAY,
  PAID_FEATURES,
  SCHEDULE_ACTION_CLASSES,
  SCHEDULE_BACKGROUND_CHOICES,
  SCHEDULE_DELIVERIES,
  SCHEDULE_DEFAULT_POLICY,
  SCHEDULE_FIRE_OUTCOMES,
  SCHEDULE_ID_MAX_CHARS,
  SCHEDULE_MAX_DESTINATIONS,
  SCHEDULE_MAX_GRANT_RULES,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_MAX_WEEKLY_TIMES,
  SCHEDULE_MIN_INTERVAL_MS,
  SCHEDULE_MODES,
  SCHEDULE_NAME_MAX_CHARS,
  SCHEDULE_RULE_MAX_CHARS,
  SCHEDULE_RUN_ID_MAX_CHARS,
  SCHEDULE_REPORT_FORMATS,
  SCHEDULE_TIMELINE_HOURS,
} from './constants'
import {
  SCHEDULE_EVENT_KINDS,
  scheduleEventSchema,
  scheduleEventTriggerSchema,
  type ScheduleEvent,
} from './scheduleEvents'
import { scheduledPromptSchema, type ScheduledPrompt } from './schedule'

const timestamp = z.int().check(z.gte(0))
const identifier = z
  .string()
  .check(z.minLength(1), z.maxLength(SCHEDULE_ID_MAX_CHARS), z.regex(/^[\w-][\w.-]*$/))
const text = z.string().check(z.minLength(1), z.maxLength(SCHEDULE_RULE_MAX_CHARS))
const runId = z.string().check(z.minLength(1), z.maxLength(SCHEDULE_RUN_ID_MAX_CHARS))
// v2 numeric files and JSON drafts normalize at this schema boundary.
const money = z.codec(
  z.union([z.number().check(z.nonnegative()), nonnegativeUsdSchema]),
  nonnegativeUsdSchema,
  {
    decode: (amount) => (typeof amount === 'number' ? legacyUsdSchema.parse(amount) : amount),
    encode: (amount) => nonnegativeUsdSchema.parse(amount),
  },
)
const weekday = z.int().check(z.gte(0), z.lte(CRON_MAX_WEEKDAY - 1))
const clockTime = z.strictObject({
  hour: z.int().check(z.gte(0), z.lte(CRON_MAX_HOUR)),
  minute: z.int().check(z.gte(0), z.lte(CRON_MAX_MINUTE)),
})
const times = z.array(clockTime).check(z.minLength(1), z.maxLength(SCHEDULE_MAX_WEEKLY_TIMES))

export const scheduleZoneSchema = z.string().check(
  z.refine((zone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone })
      return !/^[+-]/.test(zone)
    } catch {
      return false
    }
  }),
)

export const scheduleTimeTriggerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('once'), atMs: timestamp }),
  z.strictObject({
    kind: z.literal('interval'),
    everyMs: z.int().check(z.gte(SCHEDULE_MIN_INTERVAL_MS)),
    // Reference occurrence; migration keeps the outstanding v1 fire.
    anchorMs: timestamp,
  }),
  z.strictObject({
    kind: z.literal('daily'),
    everyDays: z.int().check(z.gte(1)),
    times,
    anchorDate: z.iso.date(),
  }),
  z.strictObject({ kind: z.literal('weekdays'), times }),
  z.strictObject({
    kind: z.literal('weekly'),
    days: z
      .array(z.strictObject({ weekday, times }))
      .check(z.minLength(1), z.maxLength(CRON_MAX_WEEKDAY)),
  }),
  z.strictObject({
    kind: z.literal('cron'),
    expression: text.check(
      z.refine((value) => value.trim().split(/\s+/).length === CRON_FIELD_COUNT),
    ),
  }),
])
export type ScheduleTimeTrigger = z.infer<typeof scheduleTimeTriggerSchema>
export const scheduleTriggerSchema = z.union([
  scheduleTimeTriggerSchema,
  scheduleEventTriggerSchema,
  z.strictObject({
    kind: z.literal('afterEvent'),
    event: scheduleEventTriggerSchema,
    time: scheduleTimeTriggerSchema,
  }),
])

export const scheduleTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('conversation'),
    sessionId: identifier,
    backend: z.enum(['museCode', 'modelApi']),
  }),
  z.strictObject({ kind: z.literal('newConversation'), backend: z.enum(['museCode', 'modelApi']) }),
  z.strictObject({ kind: z.literal('worker'), workerId: identifier }),
  z.strictObject({ kind: z.literal('role'), teamId: identifier, roleId: identifier }),
  z.strictObject({ kind: z.literal('team'), teamId: identifier }),
  z.strictObject({
    kind: z.literal('node'),
    nodeId: identifier,
    sessionId: z.optional(identifier),
  }),
])
export type ScheduleTarget = z.infer<typeof scheduleTargetSchema>

// Path syntax is confined here; lane U checks canonical paths, protected
// paths and glob semantics before matching a rule. No credential is stored.
const relativeGlob = text.check(
  z.refine(
    (value) =>
      !/^(?:[\\/]|[a-z]:)/i.test(value) &&
      !/\p{Cc}/u.test(value) &&
      !value.split(/[\\/]/).includes('..'),
  ),
)
export const scheduleGrantRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: identifier, kind: z.literal('command'), prefix: text }),
  z.strictObject({ id: identifier, kind: z.literal('tool'), name: text }),
  z.strictObject({
    id: identifier,
    kind: z.literal('path'),
    glob: relativeGlob,
    access: z.enum(['read', 'edit']),
  }),
])
export type ScheduleGrantRule = z.infer<typeof scheduleGrantRuleSchema>

// M113 owns execution and destination verification. Future cloud/SMS kinds
// remain typed as unavailable capabilities, with no production sender here.
export const scheduleReportDestinationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: identifier,
    kind: z.literal('save'),
    rootId: identifier,
    directory: text,
    nameTemplate: text,
    retention: z.int().check(z.gte(1)),
  }),
  z.strictObject({
    id: identifier,
    kind: z.literal('browser'),
    location: z.enum(['local', 'node']),
    nodeId: z.optional(identifier),
    whenInactive: z.literal('wait'),
  }),
  z.strictObject({
    id: identifier,
    kind: z.literal('email'),
    recipientId: identifier,
    connectionId: identifier,
  }),
  z.strictObject({
    id: identifier,
    kind: z.literal('post'),
    provider: z.enum(['github', 'gitlab']),
    repository: text,
    target: z.enum(['issue', 'pullRequest', 'statusIssue']),
    number: z.optional(z.int().check(z.gte(1))),
  }),
  z.strictObject({
    id: identifier,
    kind: z.literal('cloud'),
    availability: z.literal('planned'),
    provider: z.enum(['googleDrive', 'oneDrive', 'dropbox', 's3']),
    connectionId: identifier,
    folderId: text,
  }),
  z.strictObject({
    id: identifier,
    kind: z.literal('sms'),
    availability: z.literal('planned'),
    recipientId: identifier,
    connectionId: identifier,
  }),
])
export type ScheduleReportDestination = z.infer<typeof scheduleReportDestinationSchema>
export const scheduleGrantSchema = z.strictObject({
  rules: z.array(scheduleGrantRuleSchema).check(z.maxLength(SCHEDULE_MAX_GRANT_RULES)),
  destinationIds: z.array(identifier).check(z.maxLength(SCHEDULE_MAX_DESTINATIONS)),
  paidCapUsd: money,
})
export type ScheduleGrant = z.infer<typeof scheduleGrantSchema>

export const scheduleActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('prompt'),
    prompt: z.string().check(z.minLength(1), z.maxLength(SCHEDULE_MAX_PROMPT_CHARS)),
  }),
  z.strictObject({
    kind: z.literal('report'),
    reportKind: identifier,
    args: z.record(identifier, z.union([text, z.number(), z.boolean()])),
    format: z.enum(SCHEDULE_REPORT_FORMATS),
    destinations: z.array(scheduleReportDestinationSchema).check(
      z.minLength(1),
      z.maxLength(SCHEDULE_MAX_DESTINATIONS),
      z.refine((items) => new Set(items.map((item) => item.id)).size === items.length),
    ),
  }),
])
export type ScheduleReportAction = Extract<z.infer<typeof scheduleActionSchema>, { kind: 'report' }>
export const schedulePaidConsentSchema = z.strictObject({
  modelId: text,
  accountId: text,
  priceTier: text,
  grantedAtMs: timestamp,
  dailyCapUsd: money.check(z.refine((amount) => amount !== '0')),
  sharedDailyBudgetUsd: money.check(z.refine((amount) => amount !== '0')),
  extras: z.array(z.enum(PAID_FEATURES)),
})
export const scheduleCreatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user') }),
  z.strictObject({
    kind: z.literal('agent'),
    agentId: identifier,
    sessionId: identifier,
    teamId: z.optional(identifier),
    orchestratorId: identifier,
  }),
])
export type ScheduleCreator = z.infer<typeof scheduleCreatorSchema>
export const scheduleEndSchema = z
  .strictObject({ atMs: z.optional(timestamp), afterRuns: z.optional(z.int().check(z.gte(1))) })
  .check(z.refine((end) => end.atMs !== undefined || end.afterRuns !== undefined))

const scheduleShape = {
  version: z.literal(2),
  revision: z.int().check(z.gte(0)),
  id: identifier,
  name: z.string().check(z.minLength(1), z.maxLength(SCHEDULE_NAME_MAX_CHARS)),
  workspaceKey: identifier,
  action: scheduleActionSchema,
  trigger: scheduleTriggerSchema,
  target: scheduleTargetSchema,
  delivery: z.enum(SCHEDULE_DELIVERIES),
  whenClosed: z.enum(['open', 'skip']),
  catchUp: z.enum(['runOnce', 'skip']),
  mode: z.enum(SCHEDULE_MODES),
  grant: scheduleGrantSchema,
  paidConsent: z.optional(schedulePaidConsentSchema),
  paidCapUsd: money,
  parallel: z.boolean(),
  creator: scheduleCreatorSchema,
  depth: z.int().check(z.gte(0)),
  allowAgentReschedule: z.boolean(),
  pinned: z.boolean(),
  zone: scheduleZoneSchema,
  end: z.optional(scheduleEndSchema),
  paused: z.boolean(),
  pauseReason: z.optional(text),
  createdAtMs: timestamp,
  updatedAtMs: timestamp,
  nextFireAtMs: z.optional(timestamp),
  fireCount: z.int().check(z.gte(0)),
  lastFireAtMs: z.optional(timestamp),
  consecutiveFailures: z.int().check(z.gte(0)),
  migration: z.optional(
    z.strictObject({
      version: z.literal(1),
      sessionId: identifier,
      workspaceRoot: text,
      accountId: text,
    }),
  ),
}
const scheduleV2BaseSchema = z.strictObject(scheduleShape)
type SchedulePolicy = Pick<
  z.infer<typeof scheduleV2BaseSchema>,
  'parallel' | 'delivery' | 'target' | 'paidCapUsd' | 'grant' | 'action'
>
function isSchedulePolicyValid(schedule: SchedulePolicy): boolean {
  return (
    (!schedule.parallel || schedule.delivery === 'newConversation') &&
    (schedule.target.kind !== 'newConversation' || schedule.delivery === 'newConversation') &&
    Usd.from(schedule.paidCapUsd).compare(Usd.from(schedule.grant.paidCapUsd)) <= 0 &&
    (schedule.action.kind !== 'report' ||
      (schedule.paidCapUsd === '0' && schedule.grant.paidCapUsd === '0'))
  )
}
function isScheduleDepthValid(schedule: { depth: number; allowAgentReschedule: boolean }): boolean {
  return schedule.depth <= AGENT_SCHEDULE_MAX_DEPTH || schedule.allowAgentReschedule
}
export const scheduleV2Schema = scheduleV2BaseSchema.check(
  z.refine(isSchedulePolicyValid),
  z.refine(isScheduleDepthValid),
  z.refine(
    (schedule) =>
      schedule.paidConsent === undefined ||
      Usd.from(schedule.paidConsent.dailyCapUsd).compare(Usd.from(schedule.paidCapUsd)) <= 0,
  ),
  z.refine((schedule) => schedule.action.kind !== 'report' || schedule.paidConsent === undefined),
)
export type ScheduleV2 = z.infer<typeof scheduleV2Schema>

export const scheduleRunContextSchema = z
  .strictObject({
    unattended: z.literal(true),
    scheduleId: identifier,
    runId,
    grant: scheduleGrantSchema,
    creator: scheduleCreatorSchema,
    mode: z.enum(SCHEDULE_MODES),
    depth: z.int().check(z.gte(0)),
    allowAgentReschedule: z.boolean(),
  })
  .check(z.refine(isScheduleDepthValid))
export type ScheduleRunContext = z.infer<typeof scheduleRunContextSchema>

export const scheduleApprovalActionSchema = z.strictObject({
  id: identifier,
  class: z.enum(SCHEDULE_ACTION_CLASSES),
  tool: text,
  command: z.optional(text),
  paths: z.array(text),
  requiresAsking: z.boolean(),
  protectedPath: z.boolean(),
})
export type ScheduleApprovalAction = z.infer<typeof scheduleApprovalActionSchema>
export const scheduleGrantAuditSchema = z.strictObject({
  scheduleId: identifier,
  atMs: timestamp,
  kind: z.enum(['created', 'changed', 'revoked', 'used']),
  runId: z.optional(runId),
  ruleId: z.optional(identifier),
  destinationId: z.optional(identifier),
  actionClass: z.optional(z.enum(SCHEDULE_ACTION_CLASSES)),
})

// M113 Q's application-level settlement, not a provider wire response.
export const scheduleReportOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('delivered'), attempts: z.int().check(z.gte(0)) }),
  z.strictObject({
    status: z.literal('deferred'),
    attempts: z.int().check(z.gte(0)),
    reason: z.literal('inactiveSession'),
  }),
  z.strictObject({
    status: z.enum(['failed', 'uncertain', 'refused']),
    attempts: z.int().check(z.gte(0)),
  }),
])
export const scheduleReportResultsSchema = z.record(identifier, scheduleReportOutcomeSchema)

export const scheduleFireRecordSchema = z.strictObject({
  runId,
  scheduleId: identifier,
  workspaceKey: identifier,
  occurrenceMs: timestamp,
  observedAtMs: timestamp,
  target: scheduleTargetSchema,
  delivery: z.enum(SCHEDULE_DELIVERIES),
  outcome: z.enum(SCHEDULE_FIRE_OUTCOMES),
  reason: z.optional(text),
  refusedActions: z.array(
    z.strictObject({ actionClass: z.enum(SCHEDULE_ACTION_CLASSES), tool: text, reason: text }),
  ),
  cost: z.strictObject({
    usd: money,
    certainty: z.enum(['exact', 'estimated', 'unknown']),
    retainedLiabilityUsd: money,
  }),
  event: z.optional(scheduleEventSchema),
  report: z.optional(scheduleReportResultsSchema),
})
export type ScheduleFireRecord = z.infer<typeof scheduleFireRecordSchema>

export function noScheduleCost(): ScheduleFireRecord['cost'] {
  return scheduleFireRecordSchema.shape.cost.parse({
    usd: '0',
    certainty: 'exact',
    retainedLiabilityUsd: '0',
  })
}

export interface ScheduleStoreV2 {
  /** New ids start at revision zero and are never reused after removal. */
  create(schedule: ScheduleV2): Promise<void>
  list(workspaceKey: string): Promise<readonly ScheduleV2[]>
  /** Atomic compare-and-swap against schedule.revision; success increments it.
   * False means missing or stale. Re-read and merge intent before retrying;
   * never replay a stale authority snapshot against a fresh revision. */
  update(schedule: ScheduleV2): Promise<boolean>
  remove(workspaceKey: string, scheduleId: string): Promise<boolean>
  /** Atomic, durable, never rolled back after a crash or refusal. */
  claim(runId: string): Promise<boolean>
  record(fire: ScheduleFireRecord): Promise<void>
  fires(workspaceKey: string): Promise<readonly ScheduleFireRecord[]>
}
/** Complete, run-scoped final settlement, parsed with scheduleFireRecordSchema. */
export type ScheduleDeliveryResult = ScheduleFireRecord
/** Target-owned durable admission ledger. Absent means definitely unsent;
 * admitted is owned queued/running work; uncertain is terminal and must carry
 * honest accounting for a dispatched request whose response was lost. */
export const scheduleDeliveryStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('absent') }),
  z.strictObject({ status: z.literal('admitted') }),
  z
    .strictObject({ status: z.enum(['settled', 'uncertain']), fire: scheduleFireRecordSchema })
    .check(
      z.refine((state) => state.status !== 'uncertain' || state.fire.cost.certainty === 'unknown'),
    ),
])
export type ScheduleDeliveryState = z.infer<typeof scheduleDeliveryStateSchema>
export interface ScheduleHostPort {
  now(): number
  monotonicNow(): number
  holds(workspaceKey: string): boolean
  lookupRun(runId: string): Promise<ScheduleDeliveryState>
  /** Resolves at final settlement, never at send/steer/queue admission.
   * Queued, steered and idle-held work keeps this promise pending until its
   * run finishes or is withdrawn; withdrawals settle as skipped/missed.
   * The target durably admits context.runId BEFORE sending, refuses duplicates
   * even after restart and exposes that receipt through lookupRun. Delivery
   * identities survive the schedule's complete fence retention window. Recovery
   * of an ambiguous sent request returns uncertain, informs the person and never
   * sends it again. Failures after dispatch settle as failed with known/uncertain cost and
   * retained liability. The result keeps context.runId and occurrenceMs. */
  deliver(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult>
}
export interface ScheduleGrantMatcher {
  matches(grant: ScheduleGrant, action: ScheduleApprovalAction): ScheduleGrantRule | undefined
}
export interface ScheduleNoEscalation {
  bounded(request: ScheduleGrant, creator: ScheduleGrant): ScheduleGrant
}
export interface ScheduleSessionPort {
  readonly backend: 'museCode' | 'modelApi'
  readonly sessionId: string
  isRunning(): boolean
  isOpen(): boolean
  steer(prompt: string, context: ScheduleRunContext): Promise<void>
  /** Same path as Stop, including rejection of partly-decided approvals. */
  cancel(): Promise<void>
  queue(prompt: string, context: ScheduleRunContext): Promise<string>
  withdraw(messageId: string): Promise<boolean>
  send(prompt: string, context: ScheduleRunContext): Promise<void>
}

export const scheduleBackgroundConsentSchema = z.strictObject({
  choice: z.enum(SCHEDULE_BACKGROUND_CHOICES),
  decidedAtMs: timestamp,
})
export const scheduleBackgroundStatusSchema = z
  .strictObject({ registered: z.boolean(), nextWakeAtMs: z.optional(timestamp) })
  .check(z.refine((status) => status.registered || status.nextWakeAtMs === undefined))
export interface ScheduleBackgroundPort {
  status(): Promise<z.infer<typeof scheduleBackgroundStatusSchema>>
  register(
    nextWakeAtMs: number,
    consent: z.infer<typeof scheduleBackgroundConsentSchema>,
  ): Promise<void>
  remove(): Promise<void>
}

/** Pure mapping only: lane S copies, verifies, then removes the v1 source.
 * Old per-run consent never grants unattended spend or tool approval. */
export function scheduleV1ToV2(
  job: ScheduledPrompt,
  workspaceKey: string,
  zone: string,
): ScheduleV2 {
  const old = scheduledPromptSchema.parse(job)
  // M52 can recover a crash receipt from fractional filesystem mtimeMs.
  // Round forward: never replay that receipt or run its successor early.
  const nextFireAtMs = Math.ceil(old.nextFireAtMs)
  return scheduleV2Schema.parse({
    version: 2,
    revision: 0,
    id: old.id,
    name: old.id,
    workspaceKey,
    action: { kind: 'prompt', prompt: old.prompt },
    trigger: old.cadence.kind === 'cron' ? old.cadence : { ...old.cadence, anchorMs: nextFireAtMs },
    target: { kind: 'conversation', sessionId: old.sessionId, backend: 'modelApi' },
    ...SCHEDULE_DEFAULT_POLICY,
    delivery: 'whenIdle',
    grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
    paidCapUsd: 0,
    creator: { kind: 'user' },
    zone,
    end: { atMs: Math.ceil(old.expiresAtMs) },
    paused: true,
    pauseReason: 'migrationConsentRequired',
    createdAtMs: Math.ceil(old.createdAtMs),
    updatedAtMs: Math.ceil(old.createdAtMs),
    nextFireAtMs,
    fireCount: old.fireCount,
    ...(old.lastFireAtMs !== undefined && { lastFireAtMs: Math.ceil(old.lastFireAtMs) }),
    consecutiveFailures: 0,
    migration: {
      version: 1,
      sessionId: old.sessionId,
      workspaceRoot: old.workspaceRoot,
      accountId: old.accountId,
    },
  })
}

export function scheduleTimeRunId(scheduleId: string, occurrenceMs: number): string {
  identifier.parse(scheduleId)
  timestamp.parse(occurrenceMs)
  return `${scheduleId}:${String(occurrenceMs)}`
}

/** Projection deliberately omits the account digest and old workspace path. */
const {
  migration: _migrationSchema,
  paidConsent: _consentSchema,
  ...scheduleViewShape
} = scheduleShape
export const scheduleViewV2Schema = z
  .strictObject(scheduleViewShape)
  .check(z.refine(isSchedulePolicyValid), z.refine(isScheduleDepthValid))
export function scheduleViewV2Of(schedule: ScheduleV2): z.infer<typeof scheduleViewV2Schema> {
  const { migration: _migration, paidConsent: _paidConsent, ...view } = schedule
  return scheduleViewV2Schema.parse(view)
}
export const scheduleTimelineEntrySchema = z.strictObject({
  scheduleId: identifier,
  atMs: timestamp,
  target: scheduleTargetSchema,
  collisionIds: z.array(identifier),
  creator: scheduleCreatorSchema,
})
export const scheduleTimelineRangeSchema = z.union(
  SCHEDULE_TIMELINE_HOURS.map((hours) => z.literal(hours)),
)

// The editor supplies a draft. Ids, creators, consent and migration provenance
// are assigned by the admitting host, never accepted from postMessage.
export const scheduleDraftSchema = z
  .strictObject({
    name: scheduleShape.name,
    action: scheduleShape.action,
    trigger: scheduleShape.trigger,
    target: scheduleShape.target,
    delivery: scheduleShape.delivery,
    whenClosed: scheduleShape.whenClosed,
    catchUp: scheduleShape.catchUp,
    mode: scheduleShape.mode,
    grant: scheduleShape.grant,
    paidCapUsd: scheduleShape.paidCapUsd,
    parallel: scheduleShape.parallel,
    zone: scheduleShape.zone,
    end: scheduleShape.end,
    pinned: scheduleShape.pinned,
  })
  .check(z.refine(isSchedulePolicyValid))
export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>

const scheduleHistoryRangeSchema = z
  .strictObject({ fromMs: timestamp, toMs: timestamp })
  .check(z.refine((range) => range.fromMs < range.toMs))
export const scheduleSourceCapabilitySchema = z.discriminatedUnion('available', [
  z.strictObject({ available: z.literal(true) }),
  z.strictObject({ available: z.literal(false), reason: text }),
])
const scheduleHistoryPreviewSchema = z.discriminatedUnion('available', [
  z.strictObject({
    available: z.literal(true),
    matchedCount: z.int().check(z.gte(0)),
    events: z.array(scheduleEventSchema),
  }),
  z.strictObject({ available: z.literal(false), reason: text }),
])

// Shared by postMessage and MHP. A bridge translates only its envelope; these
// method names and payloads are the binding for M104, ACP and the companion.
export const scheduleRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('schedules/list'), workspaceKey: identifier }),
  z.strictObject({
    method: z.literal('schedules/create'),
    workspaceKey: identifier,
    draft: scheduleDraftSchema,
  }),
  z.strictObject({
    method: z.literal('schedules/update'),
    workspaceKey: identifier,
    id: identifier,
    revision: scheduleShape.revision,
    draft: scheduleDraftSchema,
  }),
  z.strictObject({
    method: z.enum([
      'schedules/remove',
      'schedules/runNow',
      'schedules/pause',
      'schedules/resume',
      'schedules/revokeGrant',
      'schedules/fire',
    ]),
    workspaceKey: identifier,
    id: identifier,
  }),
  z.strictObject({
    method: z.literal('schedules/timeline'),
    workspaceKey: identifier,
    hours: scheduleTimelineRangeSchema,
  }),
  z.strictObject({
    method: z.literal('schedules/background'),
    consent: scheduleBackgroundConsentSchema,
  }),
  z.strictObject({
    method: z.literal('schedules/grantAudit'),
    workspaceKey: identifier,
    id: identifier,
  }),
  z.strictObject({ method: z.literal('schedules/eventSources'), workspaceKey: identifier }),
  z.strictObject({
    method: z.literal('schedules/historyPreview'),
    workspaceKey: identifier,
    trigger: scheduleEventTriggerSchema,
    range: scheduleHistoryRangeSchema,
  }),
  z.strictObject({
    method: z.enum(['schedules/backgroundStatus', 'schedules/backgroundRemove']),
  }),
])
export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>
export const scheduleResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('list'), schedules: z.array(scheduleViewV2Schema) }),
  z.strictObject({ kind: z.literal('timeline'), entries: z.array(scheduleTimelineEntrySchema) }),
  z.strictObject({ kind: z.literal('accepted'), id: z.optional(identifier) }),
  z.strictObject({ kind: z.literal('refused'), reason: text }),
  z.strictObject({
    kind: z.literal('grantAudit'),
    scheduleId: identifier,
    entries: z.array(scheduleGrantAuditSchema),
  }),
  z.strictObject({
    kind: z.literal('eventSources'),
    sources: z.array(
      z.strictObject({
        id: identifier,
        kinds: z.array(z.enum(SCHEDULE_EVENT_KINDS)),
        capability: scheduleSourceCapabilitySchema,
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal('historyPreview'),
    trigger: scheduleEventTriggerSchema,
    range: scheduleHistoryRangeSchema,
    preview: scheduleHistoryPreviewSchema,
  }),
  z.strictObject({ kind: z.literal('backgroundStatus'), status: scheduleBackgroundStatusSchema }),
])

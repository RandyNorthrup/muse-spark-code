// M124 (D106): the connector's strict contracts. Every object rejects
// unknown fields, every number is a safe integer and every string is
// bounded, so a client hint or an extra `confirm` field can never reach a
// decision (docs/design/mcp-connector.md §3). Shared by the lazy runtime
// bundle and the tests; nothing here is read at activation.
import * as z from 'zod/mini'
import { CONNECTOR_LIMITS, CONNECTOR_SCHEMA_VERSION, REPORT_KINDS } from './constants'

const encoder = new TextEncoder()
function withinBytes(max: number) {
  return z.refine<string>((text) => encoder.encode(text).byteLength <= max)
}

export const connectorIdSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(CONNECTOR_LIMITS.idChars), z.regex(/^[\w.:-]+$/u))
export const connectorTextSchema = z
  .string()
  .check(z.minLength(1), withinBytes(CONNECTOR_LIMITS.textBytes))
export const connectorBriefSchema = z
  .string()
  .check(z.minLength(1), withinBytes(CONNECTOR_LIMITS.briefBytes))
export const connectorGenerationSchema = z.number().check(z.int(), z.nonnegative())
export const connectorPageSchema = z.strictObject({
  cursor: z.optional(connectorIdSchema),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(CONNECTOR_LIMITS.pageMax))),
})
const tagsSchema = z
  .array(connectorTextSchema)
  .check(z.minLength(1), z.maxLength(CONNECTOR_LIMITS.tagsMax))
const variableNameSchema = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(CONNECTOR_LIMITS.variableNameChars),
    z.regex(/^[A-Za-z_][\w-]*$/u),
  )
const variablesSchema = z
  .record(variableNameSchema, z.string().check(withinBytes(CONNECTOR_LIMITS.textBytes)))
  .check(
    z.refine((values) => Object.keys(values).length <= CONNECTOR_LIMITS.variablesMax),
    z.refine(
      (values) =>
        Object.values(values).reduce((sum, value) => sum + encoder.encode(value).byteLength, 0) <=
        CONNECTOR_LIMITS.variablesTotalBytes,
    ),
  )

/** The OAuth-style scope families of design §5; a local grant names them too. */
export const CONNECTOR_SCOPES = [
  'fleet:read',
  'evidence:read',
  'operations:read',
  'advice:read',
  'reports:read',
  'schedules:read',
  'prompts:read',
  'sharing:read',
  'content:read',
  'lanes:run',
  'teams:run',
  'schedules:write',
  'prompts:write',
  'sharing:write',
  'paid:request',
  'control:stop',
] as const
export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number]
export const connectorScopeSchema = z.enum(CONNECTOR_SCOPES)

/** The bounded failure reasons of design §3; a tool never answers empty success. */
export const CONNECTOR_REASONS = [
  'unavailable',
  'forbidden',
  'invalid_input',
  'approval_unavailable',
  'denied',
  'expired',
  'stale_target',
  'budget_exceeded',
  'rate_limited',
  'audit_unavailable',
] as const
export type ConnectorReason = (typeof CONNECTOR_REASONS)[number]

/** What `muse_operation_get` shows: a projection of the call states below. */
export type ConnectorOperationState =
  'awaitingApproval' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'

/**
 * The one state machine every call walks (design §3a): received → admitted
 * → (awaitingApproval → approved →) dispatching → settled, or refused,
 * cancelled or failed. Its transition table is operations.ts's.
 */
export const CONNECTOR_CALL_STATES = [
  'received',
  'admitted',
  'awaitingApproval',
  'approved',
  'dispatching',
  'settled',
  'refused',
  'cancelled',
  'failed',
] as const
export type ConnectorCallState = (typeof CONNECTOR_CALL_STATES)[number]

/** Why the authority cancelled a call: the one place cancellation is decided. */
export const CONNECTOR_CANCEL_CAUSES = [
  'client',
  'deadline',
  'disconnect',
  'killSwitch',
  'revoked',
  'stop',
  'denied',
  'expired',
  'stale',
] as const
export type ConnectorCancelCause = (typeof CONNECTOR_CANCEL_CAUSES)[number]

/** What a tool's own code says its effect is; never read from a client. */
export type ConnectorClass = 'read' | 'write' | 'run' | 'stop'

const workspaceGrantSchema = z.strictObject({
  id: connectorIdSchema,
  /** Shown to the owner only; never returned to a client. */
  root: z.string().check(z.minLength(1)),
  /** A short label the client may see (the folder's base name). */
  label: connectorTextSchema,
  content: z.boolean(),
})

/** The owner-created local grant (outside every repository, owner-only file). */
export const connectorGrantSchema = z.strictObject({
  schemaVersion: z.literal(CONNECTOR_SCHEMA_VERSION),
  connectionId: z
    .string()
    .check(
      z.minLength(1),
      z.maxLength(CONNECTOR_LIMITS.connectionIdChars),
      z.regex(/^[a-z\d][\w-]*$/u),
    ),
  generation: connectorGenerationSchema,
  createdAt: z.iso.datetime({ offset: true }),
  revoked: z.boolean(),
  scopes: z.array(connectorScopeSchema),
  userLibrary: z.boolean(),
  /** Zero until our UI can enable paid authority (Q-M124.4). */
  paidCapMicrousd: z.literal(0),
  workspaces: z.array(workspaceGrantSchema).check(z.maxLength(CONNECTOR_LIMITS.workspacesMax)),
})
export type ConnectorGrant = z.infer<typeof connectorGrantSchema>
export type ConnectorWorkspaceGrant = ConnectorGrant['workspaces'][number]

export const connectorKillSwitchSchema = z.strictObject({
  on: z.boolean(),
  at: z.iso.datetime({ offset: true }),
})

const workspaceField = { workspaceId: connectorIdSchema }
const optionalWorkspace = { workspaceId: z.optional(connectorIdSchema) }
const change = { requestId: connectorIdSchema, expectedGeneration: connectorGenerationSchema }
const promptScope = z.enum(['user', 'workspace'])

/** The inputs of the tools this build backs; every object is strict. */
export const connectorInputSchemas = {
  muse_operation_get: z.strictObject({ operationId: connectorIdSchema }),
  // Stop's authority follows the operation's own scope: a user-library
  // operation stops with the user-library grant, whatever workspace is named.
  muse_stop: z.strictObject({
    ...optionalWorkspace,
    target: z.strictObject({
      kind: z.enum(['lane', 'team', 'operation']),
      id: connectorIdSchema,
    }),
  }),
  muse_prompt_list: z.strictObject({
    ...optionalWorkspace,
    scope: promptScope,
    query: z.optional(connectorTextSchema),
    tags: z.optional(tagsSchema),
    page: z.optional(connectorPageSchema),
  }),
  muse_prompt_get: z.strictObject({ ...optionalWorkspace, promptId: connectorIdSchema }),
  muse_prompt_prepare: z.strictObject({
    ...optionalWorkspace,
    promptId: connectorIdSchema,
    expectedGeneration: connectorGenerationSchema,
    variables: variablesSchema,
  }),
  muse_prompt_save: z.strictObject({
    ...change,
    ...optionalWorkspace,
    scope: promptScope,
    title: connectorTextSchema,
    body: connectorBriefSchema,
    tags: z.optional(tagsSchema),
  }),
  muse_share_preview: z.strictObject({
    ...optionalWorkspace,
    source: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('prompt'), promptId: connectorIdSchema }),
      z.strictObject({
        kind: z.literal('chat'),
        sessionId: connectorIdSchema,
        mode: z.enum(['conversation', 'full']),
      }),
    ]),
    format: z.enum(['markdown', 'html', 'json']),
  }),
  muse_schedule_list: z.strictObject({ ...workspaceField, page: z.optional(connectorPageSchema) }),
  muse_schedule_cancel: z.strictObject({ ...workspaceField, scheduleId: connectorIdSchema }),
  muse_report: z.strictObject({
    ...workspaceField,
    kind: z.enum(REPORT_KINDS),
    subjectId: z.optional(connectorIdSchema),
    // M113's in-process surface renders Markdown; JSON joins with its port.
    format: z.enum(['markdown']),
  }),
} as const
export type ConnectorBackedTool = keyof typeof connectorInputSchemas

/**
 * One scrubbed, schema-versioned audit line (design §6); no raw text or
 * token. A call's line is one transition (`from` → `event`); `transport`
 * is a frame refused before any call existed (its JSON-RPC code only);
 * `control` is the owner's own command.
 */
export const connectorAuditSchema = z.strictObject({
  schemaVersion: z.literal(CONNECTOR_SCHEMA_VERSION),
  at: z.iso.datetime({ offset: true }),
  connectionId: z.string(),
  grantGeneration: z.optional(connectorGenerationSchema),
  event: z.enum(['initialize', 'list', 'transport', 'control', ...CONNECTOR_CALL_STATES]),
  from: z.optional(z.enum(CONNECTOR_CALL_STATES)),
  cause: z.optional(z.enum(CONNECTOR_CANCEL_CAUSES)),
  rpcCode: z.optional(z.number().check(z.int())),
  /** A tallied line: this many identical best-effort receipts met a full journal backlog. */
  count: z.optional(z.number().check(z.int(), z.positive())),
  control: z.optional(z.enum(['grant', 'revoke', 'kill', 'resume'])),
  callId: z.optional(z.string()),
  tool: z.optional(z.string()),
  toolClass: z.optional(z.enum(['read', 'write', 'run', 'stop'])),
  workspaceId: z.optional(z.string()),
  operationId: z.optional(z.string()),
  reason: z.optional(z.enum(CONNECTOR_REASONS)),
  /** Keyed digest of the exact payload; private text never enters the journal. */
  payloadDigest: z.optional(z.string()),
  resultDigest: z.optional(z.string()),
})
export type ConnectorAuditRecord = z.infer<typeof connectorAuditSchema>

/** What the approval page may post back; the bearer and Origin checks precede it. */
export const connectorDecisionSchema = z.strictObject({
  type: z.literal('decide'),
  intentId: connectorIdSchema,
  digest: z.string().check(z.regex(/^[a-f\d]{64}$/u)),
  approve: z.boolean(),
})
export type ConnectorDecision = z.infer<typeof connectorDecisionSchema>

/** One pending intent as the approval page shows it: scrubbed, exact and bound. */
export const connectorIntentViewSchema = z.strictObject({
  intentId: z.string(),
  digest: z.string(),
  client: z.string(),
  connectionId: z.string(),
  workspace: z.string(),
  tool: z.string(),
  toolClass: z.enum(['write', 'run']),
  generation: z.number(),
  priceMicrousd: z.number(),
  expiresAt: z.number(),
  fields: z.array(z.strictObject({ label: z.string(), value: z.string() })),
})
export type ConnectorIntentView = z.infer<typeof connectorIntentViewSchema>
export const connectorPageEventSchema = z.strictObject({
  type: z.literal('intents'),
  intents: z.array(connectorIntentViewSchema),
})

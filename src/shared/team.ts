// The team: agents, roles, pools, tasks and the ledger (M96, PLAN.md D75),
// as the host, the wire protocol and the webview share them. Lane 0 owns
// these shapes; the lanes that fill them (R: configuration, A: pools and
// meters, I: workspaces, T: tools and roster, L: history, U: the panel)
// parse every message across postMessage with them before use (rule 7).
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.
//
// The Roles section's editor messages (`roles/*`, `agents/*`) live in
// `src/shared/modelsPanel.ts` once M95's panel shell lands (lane U1); the
// data they carry is here, so both surfaces read one shape.

import * as z from 'zod/mini'
import {
  TEAM_BRIEF_MAX_CHARS,
  TEAM_EXHAUSTED_POLICIES,
  TEAM_ROLE_IDS,
  TEAM_RUBRIC_REASON_CODES,
  TEAM_TOOL_GROUPS,
} from './constants'

// An agent is a model the user can run, by who runs the tools (D75): the
// extension (`engine`, on the Model API or an M95 provider), a hidden
// session in the window's `muse serve` (`museCode`, on the subscription),
// or an agent CLI over ACP (`external`, paid however that CLI is paid).
export const teamAgentKinds = ['engine', 'museCode', 'external'] as const
export const teamAgentKindSchema = z.enum(teamAgentKinds)
export type TeamAgentKind = z.infer<typeof teamAgentKindSchema>

// Who pays sets the meters (D75): a key bills dollars (a paid use, rule
// 12), a subscription spends a plan's limits, a local model is free.
export const teamAgentPays = ['key', 'subscription', 'local'] as const
export const teamAgentPaysSchema = z.enum(teamAgentPays)
export type TeamAgentPays = z.infer<typeof teamAgentPaysSchema>

/** One agent a pool entry runs on: its kind, the user's agent, and its model. */
export const teamAgentRefSchema = z.object({
  kind: teamAgentKindSchema,
  agentId: z.string().check(z.minLength(1)),
  model: z.string().check(z.minLength(1)),
  provider: z.optional(z.string()),
  pays: teamAgentPaysSchema,
})
export type TeamAgentRef = z.infer<typeof teamAgentRefSchema>

// A cap's measures (D75): `tokens` is input plus output; `spendUsd` only on
// priced entries.
export const teamCapMeasures = [
  'tokens',
  'inputTokens',
  'outputTokens',
  'spendUsd',
  'tasks',
] as const
export const teamCapMeasureSchema = z.enum(teamCapMeasures)
export type TeamCapMeasure = z.infer<typeof teamCapMeasureSchema>

// A cap's windows (D75): one task, the local day, or the workspace's
// lifetime until reset.
export const teamCapWindows = ['task', 'day', 'lifetime'] as const
export const teamCapWindowSchema = z.enum(teamCapWindows)
export type TeamCapWindow = z.infer<typeof teamCapWindowSchema>

/** One cap of a pool entry: a measure, an amount, and a window. */
export const teamCapSchema = z.object({
  measure: teamCapMeasureSchema,
  window: teamCapWindowSchema,
  amount: z.number().check(z.nonnegative()),
})
export type TeamCap = z.infer<typeof teamCapSchema>

/** The settings an entry carries that its model supports (D75). */
export const teamModelSettingsSchema = z.object({
  effort: z.optional(z.string()),
  thinking: z.optional(z.boolean()),
  thinkingBudget: z.optional(z.int().check(z.gte(1))),
  tier: z.optional(z.string()),
  outputCap: z.optional(z.int().check(z.gte(1))),
  temperature: z.optional(z.number()),
  topP: z.optional(z.number()),
  verbosity: z.optional(z.string()),
  parallelToolCalls: z.optional(z.boolean()),
  windowCap: z.optional(z.int().check(z.gte(1))),
})
export type TeamModelSettings = z.infer<typeof teamModelSettingsSchema>

/**
 * One pool entry: an agent with its own limits. An entry without an agent
 * is Default: whatever the orchestrator slot resolves to when the task
 * starts. Default alone never turns the team on (acceptance 47).
 */
export const teamPoolEntrySchema = z.object({
  id: z.string().check(z.minLength(1)),
  agent: z.optional(teamAgentRefSchema),
  concurrent: z.int().check(z.gte(1)),
  caps: z.array(teamCapSchema),
  settings: z.optional(teamModelSettingsSchema),
})
export type TeamPoolEntry = z.infer<typeof teamPoolEntrySchema>

// A role's workspace mode (D75), held by the harness, never by a prompt.
export const teamWorkspaceModes = ['read-only', 'own-branch', 'in-place'] as const
export const teamWorkspaceModeSchema = z.enum(teamWorkspaceModes)
export type TeamWorkspaceMode = z.infer<typeof teamWorkspaceModeSchema>

// A role's report shape (D75): `summary` by default, `review` for code
// review, `qa` for test runs.
export const teamReportShapes = ['summary', 'review', 'qa'] as const
export const teamReportShapeSchema = z.enum(teamReportShapes)
export type TeamReportShape = z.infer<typeof teamReportShapeSchema>

/** One role of the workspace's team: its pool, policy and role keys. */
export const teamRoleConfigSchema = z.object({
  role: z.string().check(z.minLength(1)),
  workspace: z.optional(teamWorkspaceModeSchema),
  tools: z.optional(z.array(z.enum(TEAM_TOOL_GROUPS))),
  writePaths: z.optional(z.array(z.string())),
  skills: z.optional(z.array(z.string())),
  report: z.optional(teamReportShapeSchema),
  delegates: z.optional(z.array(z.string())),
  permissionMode: z.optional(z.string()),
  exhausted: z.optional(z.enum(TEAM_EXHAUSTED_POLICIES)),
  continueOnNext: z.optional(z.boolean()),
  tasksPerTurn: z.optional(z.int().check(z.gte(1))),
  minutesPerTask: z.optional(z.int().check(z.gte(1))),
  pool: z.array(teamPoolEntrySchema),
})
export type TeamRoleConfig = z.infer<typeof teamRoleConfigSchema>

// The intensity control, from Minimal to Max (D75).
export const teamIntensityLevels = ['minimal', 'light', 'balanced', 'heavy', 'max'] as const
export const teamIntensitySchema = z.enum(teamIntensityLevels)
export type TeamIntensity = z.infer<typeof teamIntensitySchema>

/** The rubric's reason codes (D75): one per delegated task and kept item. */
export const teamRubricReasonSchema = z.enum(TEAM_RUBRIC_REASON_CODES)
export type TeamRubricReason = z.infer<typeof teamRubricReasonSchema>

// A worker's report status (D75). `unstructured` is assigned by the parser
// to a last message with no valid block, never sent by a worker.
export const teamReportStatuses = [
  'done',
  'partial',
  'blocked',
  'failed',
  'capped',
  'unstructured',
] as const
export const teamReportStatusSchema = z.enum(teamReportStatuses)
export type TeamReportStatus = z.infer<typeof teamReportStatusSchema>

/** A report in its fenced block, parsed with zod as M70's `muse-review` is. */
export const teamReportSchema = z.object({
  status: teamReportStatusSchema,
  summary: z.string().check(z.minLength(1)),
  files: z.optional(z.array(z.string())),
  checks: z.optional(z.array(z.string())),
  sources: z.optional(z.array(z.string())),
  questions: z.optional(z.array(z.string())),
  next: z.optional(z.string()),
})
export type TeamReport = z.infer<typeof teamReportSchema>

// A task's live state (D75, lane K): active while it can still move, idle
// once finished but still open to `continue`, the rest terminal.
export const teamTaskStates = [
  'queued',
  'ready',
  'running',
  'waitingApproval',
  'waitingForYou',
  'blocked',
  'throttled',
  'idle',
  'finished',
  'failed',
  'stopped',
  'exhausted',
  'interrupted',
] as const
export const teamTaskStateSchema = z.enum(teamTaskStates)
export type TeamTaskState = z.infer<typeof teamTaskStateSchema>

// What the ledger records a task's end as (D75). Only the orchestrator's
// `merge` writes to the user's tree from a worker's branch.
export const teamLedgerOutcomes = [
  'done',
  'merged',
  'discarded',
  'failed',
  'stopped',
  'capped',
  'cancelled',
  'interrupted',
] as const
export const teamLedgerOutcomeSchema = z.enum(teamLedgerOutcomes)
export type TeamLedgerOutcome = z.infer<typeof teamLedgerOutcomeSchema>

/** One delegation: a role, the entry chosen, a brief, and its worker. */
export const teamTaskSchema = z.object({
  id: z.string().check(z.minLength(1)),
  role: z.string().check(z.minLength(1)),
  entryId: z.string().check(z.minLength(1)),
  brief: z.string().check(z.minLength(1)),
  reason: teamRubricReasonSchema,
  state: teamTaskStateSchema,
  branch: z.optional(z.string()),
})
export type TeamTask = z.infer<typeof teamTaskSchema>

// Why the runner moved a role to another entry (D75): a spent cap, no free
// slot, a rate or usage limit, an unavailable entry, or a return after a
// reset or a new day.
export const teamSwitchReasons = [
  'cap',
  'concurrency',
  'rateLimited',
  'usageLimit',
  'unavailable',
  'reset',
] as const
export const teamSwitchReasonSchema = z.enum(teamSwitchReasons)
export type TeamSwitchReason = z.infer<typeof teamSwitchReasonSchema>

/** `TeamAgentSwitch` (D75): one switch, with the cap it moved on. */
export const teamAgentSwitchSchema = z.object({
  roleId: z.string().check(z.minLength(1)),
  fromEntryId: z.string().check(z.minLength(1)),
  toEntryId: z.string().check(z.minLength(1)),
  fromAgent: z.optional(teamAgentRefSchema),
  toAgent: z.optional(teamAgentRefSchema),
  reason: teamSwitchReasonSchema,
  measure: z.optional(teamCapMeasureSchema),
  window: z.optional(teamCapWindowSchema),
  amount: z.optional(z.number()),
  used: z.optional(z.number()),
  taskId: z.optional(z.string()),
  parentSessionId: z.optional(z.string()),
})
export type TeamAgentSwitch = z.infer<typeof teamAgentSwitchSchema>

/** Tokens by kind, each marked reported or estimated where it shows. */
export const teamUsageSchema = z.object({
  input: z.int().check(z.nonnegative()),
  cachedInput: z.int().check(z.nonnegative()),
  output: z.int().check(z.nonnegative()),
  reasoning: z.int().check(z.nonnegative()),
  modelCalls: z.int().check(z.nonnegative()),
  costUsd: z.optional(z.number().check(z.nonnegative())),
  estimated: z.boolean(),
})
export type TeamUsage = z.infer<typeof teamUsageSchema>

/**
 * One ledger row per delegation (D75): who and how, the bounded brief
 * through `redactSecrets` (no other prompt text or code), when, the
 * outcome, what it cost, and its links. Resets and per-window totals are
 * rows of their own, so a spent `lifetime` cap never refills when old task
 * rows age out.
 */
export const teamLedgerTaskRowSchema = z.object({
  kind: z.literal('task'),
  taskId: z.string().check(z.minLength(1)),
  role: z.string().check(z.minLength(1)),
  entryId: z.string().check(z.minLength(1)),
  agent: z.optional(teamAgentRefSchema),
  model: z.string().check(z.minLength(1)),
  provider: z.optional(z.string()),
  settings: z.optional(teamModelSettingsSchema),
  workspaceMode: teamWorkspaceModeSchema,
  branch: z.optional(z.string()),
  brief: z.string().check(z.maxLength(TEAM_BRIEF_MAX_CHARS)),
  reasonCode: teamRubricReasonSchema,
  startMs: z.number(),
  endMs: z.optional(z.number()),
  outcome: z.optional(teamLedgerOutcomeSchema),
  usage: teamUsageSchema,
  hookTokens: z.optional(z.int().check(z.nonnegative())),
  paidToolTokens: z.optional(z.int().check(z.nonnegative())),
  transcriptRef: z.optional(z.string()),
  diffRef: z.optional(z.string()),
  findingsRef: z.optional(z.string()),
})
export type TeamLedgerTaskRow = z.infer<typeof teamLedgerTaskRowSchema>

/** An entry's meter totals per window: kept until Reset, never pruned. */
export const teamLedgerTotalsRowSchema = z.object({
  kind: z.literal('totals'),
  entryId: z.string().check(z.minLength(1)),
  window: teamCapWindowSchema,
  usage: teamUsageSchema,
  updatedMs: z.number(),
})
export type TeamLedgerTotalsRow = z.infer<typeof teamLedgerTotalsRowSchema>

/** A reset, kept with its time and what it cleared. */
export const teamLedgerResetRowSchema = z.object({
  kind: z.literal('reset'),
  window: teamCapWindowSchema,
  entryId: z.optional(z.string()),
  clearedAtMs: z.number(),
})
export type TeamLedgerResetRow = z.infer<typeof teamLedgerResetRowSchema>

/** A worker as the tree shows it: brief, branch, status, time and cost. */
export const teamTreeWorkerSchema = z.object({
  taskId: z.string().check(z.minLength(1)),
  role: z.string().check(z.minLength(1)),
  entryId: z.string().check(z.minLength(1)),
  brief: z.string(),
  state: teamTaskStateSchema,
  branch: z.optional(z.string()),
  elapsedMs: z.optional(z.number().check(z.nonnegative())),
  usage: z.optional(teamUsageSchema),
})
export type TeamTreeWorker = z.infer<typeof teamTreeWorkerSchema>

/** One pool entry as the tree shows it, with its running workers. */
export const teamTreeEntrySchema = z.object({
  entryId: z.string().check(z.minLength(1)),
  agent: z.optional(teamAgentRefSchema),
  running: z.int().check(z.nonnegative()),
  concurrent: z.int().check(z.gte(1)),
  state: z.string().check(z.minLength(1)),
  workers: z.array(teamTreeWorkerSchema),
})
export type TeamTreeEntry = z.infer<typeof teamTreeEntrySchema>

/** One role as the tree shows it, with its pool in order. */
export const teamTreeRoleSchema = z.object({
  role: z.string().check(z.minLength(1)),
  mode: z.optional(teamWorkspaceModeSchema),
  tools: z.array(z.string()),
  entries: z.array(teamTreeEntrySchema),
})
export type TeamTreeRole = z.infer<typeof teamTreeRoleSchema>

/**
 * The Agent map's tree (D75): the orchestrator at the root, then roles
 * with their pools and workers. Queued, unmerged and interrupted tasks
 * have nodes of their own. In single-model mode the panel shows today's
 * map instead: no role node, no pool, no Traffic tab.
 */
export const teamTreeSchema = z.object({
  orchestrator: z.object({
    model: z.string().check(z.minLength(1)),
    backend: z.string().check(z.minLength(1)),
    isDefault: z.boolean(),
  }),
  roles: z.array(teamTreeRoleSchema),
  queued: z.array(teamTreeWorkerSchema),
  unmerged: z.array(teamTreeWorkerSchema),
  interrupted: z.array(teamTreeWorkerSchema),
})
export type TeamTree = z.infer<typeof teamTreeSchema>

/** The whole workspace team as the Roles section edits it. */
export const teamSnapshotSchema = z.object({
  roles: z.array(teamRoleConfigSchema),
  intensity: teamIntensitySchema,
  orchestratorModel: z.optional(z.string()),
})
export type TeamSnapshot = z.infer<typeof teamSnapshotSchema>

// The panel's messages (M96, lane 0 seam for lane U1's `roles/*` and
// `agents/*` region of `src/shared/modelsPanel.ts`): the host pushes state,
// the panel saves drafts back.
export const teamRolesUpdateSchema = z.object({
  type: z.literal('teamRolesUpdate'),
  snapshot: teamSnapshotSchema,
})
export type TeamRolesUpdate = z.infer<typeof teamRolesUpdateSchema>

export const teamRolesSaveSchema = z.object({
  type: z.literal('teamRolesSave'),
  requestId: z.string().check(z.minLength(1)),
  snapshot: teamSnapshotSchema,
})
export type TeamRolesSave = z.infer<typeof teamRolesSaveSchema>

export const teamAgentsUpdateSchema = z.object({
  type: z.literal('teamAgentsUpdate'),
  tree: teamTreeSchema,
})
export type TeamAgentsUpdate = z.infer<typeof teamAgentsUpdateSchema>

// What the chat panel's tree sends back (lane U2): one action on a task or
// entry, drawn from the task, never from worker text. The `type` literal
// rides along so the schema drops straight into the postMessage union.
export const teamTreeActions = [
  'openTranscript',
  'stop',
  'reviewDiff',
  'merge',
  'discard',
  'resume',
  'resetEntry',
  'resetRecord',
  'takeBack',
  'moveToBridge',
] as const
export const teamTreeActionSchema = z.object({
  type: z.literal('teamTreeAction'),
  action: z.enum(teamTreeActions),
  taskId: z.optional(z.string()),
  entryId: z.optional(z.string()),
  role: z.optional(z.string()),
})
export type TeamTreeAction = z.infer<typeof teamTreeActionSchema>

// The tree pushed to the chat panel (lane U2): the ledger's live view.
export const teamTreeUpdateSchema = z.object({
  type: z.literal('teamTree'),
  tree: teamTreeSchema,
})
export type TeamTreeUpdate = z.infer<typeof teamTreeUpdateSchema>

// The built-in role ids, for lanes that switch on them.
export const teamBuiltInRoleSchema = z.enum(TEAM_ROLE_IDS)
export type TeamBuiltInRole = z.infer<typeof teamBuiltInRoleSchema>

// The tool groups a role checklist may offer (the type lives beside the
// table as `TeamToolGroup` in constants.ts).
export const teamToolGroupSchema = z.enum(TEAM_TOOL_GROUPS)

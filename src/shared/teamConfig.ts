// M96 configuration schemas are independent of scheduler/runner wire shapes.
import * as z from 'zod/mini'
import {
  TEAM_TOOL_GROUPS,
  TEAM_EXHAUSTED_POLICIES,
  TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
  AGENT_FILE_MAX_BYTES,
  AGENT_ID_PATTERN,
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
  role: z.string().check(z.minLength(1), z.regex(AGENT_ID_PATTERN)),
  purpose: z.optional(z.string().check(z.maxLength(TEAM_ROLE_WHEN_TO_USE_MAX_CHARS))),
  done: z.optional(z.string().check(z.maxLength(TEAM_ROLE_WHEN_TO_USE_MAX_CHARS))),
  guidance: z.optional(z.string().check(z.maxLength(AGENT_FILE_MAX_BYTES))),
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

/** The whole workspace team as the Roles section edits it. */
export const teamSnapshotSchema = z
  .object({
    roles: z.array(teamRoleConfigSchema),
    intensity: teamIntensitySchema,
    orchestratorModel: z.optional(z.string().check(z.minLength(1))),
    orchestrator: z.optional(
      z.strictObject({
        agent: z.optional(teamAgentRefSchema),
        settings: z.optional(teamModelSettingsSchema),
      }),
    ),
  })
  .check(
    z.refine(
      (snapshot) =>
        snapshot.orchestratorModel === undefined ||
        snapshot.orchestrator?.agent === undefined ||
        snapshot.orchestratorModel === snapshot.orchestrator.agent.model,
    ),
  )
export type TeamSnapshot = z.infer<typeof teamSnapshotSchema>

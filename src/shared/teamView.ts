// The team's webview-facing shapes (M96 lane U2, PLAN.md D75): the Agent
// map's tree, the Usage Team section, and the transcript cards' data. This
// is U2's explicit seam: lanes 0 (strings, `src/shared/team.ts`), R, A, T
// and W fill these from the workspace team, the pools, the ledger and the
// orchestrator's tools; the webview only renders what it is given. Every
// message across postMessage carrying these is parsed with these schemas
// before use. A field the wire may add later is shown as it came, never
// dropped (D36): unknown item kinds keep today's `item` row.

import * as z from 'zod/mini'

/** How the entry's model bills: a key (paid), a plan, or nothing (D75). */
export const teamPayKindSchema = z.enum(['key', 'subscription', 'local'])
export type TeamPayKind = z.infer<typeof teamPayKindSchema>

/** One cap as the tree shows it: "used of amount", reported or estimated. */
export const teamCapSchema = z.object({
  label: z.string(),
  used: z.number(),
  amount: z.optional(z.number()),
  estimated: z.optional(z.boolean()),
})
export type TeamCap = z.infer<typeof teamCapSchema>

/** A pool entry's running or finished worker, as its tree node shows it. */
export const teamWorkerSchema = z.object({
  taskId: z.string(),
  brief: z.string(),
  reason: z.optional(z.string()),
  branch: z.optional(z.string()),
  status: z.string(),
  elapsedMs: z.optional(z.number()),
  inputTokens: z.optional(z.number()),
  outputTokens: z.optional(z.number()),
  costUsd: z.optional(z.number()),
  estimated: z.optional(z.boolean()),
})
export type TeamWorker = z.infer<typeof teamWorkerSchema>

/** One pool entry in order, with its headroom, state and workers. */
export const teamEntrySchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.optional(z.string()),
  payKind: teamPayKindSchema,
  caps: z.readonly(z.array(teamCapSchema)),
  running: z.number(),
  concurrentMax: z.optional(z.number()),
  state: z.string(),
  stateDetail: z.optional(z.string()),
  warnings: z.readonly(z.array(z.string())),
  workers: z.readonly(z.array(teamWorkerSchema)),
})
export type TeamEntry = z.infer<typeof teamEntrySchema>

/** A role node: its charter summary, mode, tool groups and ordered pool. */
export const teamRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.optional(z.string()),
  mode: z.string(),
  toolGroups: z.readonly(z.array(z.string())),
  entries: z.readonly(z.array(teamEntrySchema)),
  /** Queued delegations, unmerged and interrupted tasks: nodes of their own. */
  queued: z.readonly(z.array(teamWorkerSchema)),
  unmerged: z.readonly(z.array(teamWorkerSchema)),
  interrupted: z.readonly(z.array(teamWorkerSchema)),
})
export type TeamRole = z.infer<typeof teamRoleSchema>

/** The tree's root: the orchestrator, on either backend. */
export const teamOrchestratorSchema = z.object({
  model: z.string(),
  backend: z.string(),
  slot: z.enum(['default', 'override']),
})
export type TeamOrchestrator = z.infer<typeof teamOrchestratorSchema>

/** The Agent map's team tree, the ledger's live view (D75). */
export const teamTreeSchema = z.object({
  orchestrator: teamOrchestratorSchema,
  roles: z.readonly(z.array(teamRoleSchema)),
  spentUsdToday: z.optional(z.number()),
  budgetUsdToday: z.optional(z.number()),
})
export type TeamTreeData = z.infer<typeof teamTreeSchema>

/** One figure group: tasks, tokens and cost, reported or estimated. */
export const teamUsageFiguresSchema = z.object({
  tasks: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  estimated: z.boolean(),
})
export type TeamUsageFigures = z.infer<typeof teamUsageFiguresSchema>

/** The Usage Team section: today and this window, per role and per entry. */
export const teamUsageSchema = z.object({
  today: teamUsageFiguresSchema,
  window: teamUsageFiguresSchema,
  byRole: z.readonly(
    z.array(
      z.object({
        roleId: z.string(),
        name: z.string(),
        figures: teamUsageFiguresSchema,
      }),
    ),
  ),
  byEntry: z.readonly(
    z.array(
      z.object({
        entryId: z.string(),
        roleId: z.string(),
        label: z.string(),
        payKind: teamPayKindSchema,
        figures: teamUsageFiguresSchema,
      }),
    ),
  ),
})
export type TeamUsageSummary = z.infer<typeof teamUsageSchema>

export const TEAM_PLAN_DISPOSITIONS = ['delegated', 'kept'] as const
export const TEAM_MERGE_REVIEWS = ['reviewed', 'same-model', 'not-reviewed'] as const

/** One line of the delegation plan card: delegated, or kept, with its reason. */
export const teamPlanItemSchema = z.object({
  disposition: z.enum(TEAM_PLAN_DISPOSITIONS),
  role: z.string(),
  brief: z.optional(z.string()),
  reason: z.string(),
  entry: z.optional(z.string()),
})
export type TeamPlanItem = z.infer<typeof teamPlanItemSchema>

/**
 * A worker's own card, routed to the main panel (D75): the role, the agent
 * and the task, drawn by the panel's chrome, never by the worker.
 */
export const teamWorkerLabelSchema = z.object({
  roleId: z.string(),
  agentLabel: z.string(),
  taskId: z.string(),
})
export type TeamWorkerLabel = z.infer<typeof teamWorkerLabelSchema>

/** The host item fields behind each transcript card (M96 lane U2). */
export const teamItemFields = {
  /** `delegate`'s plan card, or a `dry_run`'s: each item delegated or kept. */
  teamPlan: z.optional(
    z.object({
      items: z.readonly(z.array(teamPlanItemSchema)),
      dryRun: z.boolean(),
    }),
  ),
  /** One transcript row per switch: the role, from and to, and the reason. */
  teamSwitch: z.optional(
    z.object({
      roleId: z.string(),
      fromEntry: z.string(),
      toEntry: z.string(),
      reason: z.string(),
    }),
  ),
  /** The all-exhausted `ask` policy's four choices. */
  teamWaiting: z.optional(
    z.object({
      waitingId: z.string(),
      roleId: z.string(),
      brief: z.optional(z.string()),
      reasonText: z.optional(z.string()),
    }),
  ),
  /** The merge card: the task, its branch, review state and conflicts. */
  teamMerge: z.optional(
    z.object({
      taskId: z.string(),
      roleId: z.string(),
      brief: z.string(),
      branch: z.string(),
      filesChanged: z.optional(z.number()),
      review: z.enum(TEAM_MERGE_REVIEWS),
      branchMoved: z.optional(z.boolean()),
      conflicted: z.optional(z.boolean()),
    }),
  ),
  /** A finished task's report row. */
  teamReport: z.optional(
    z.object({
      taskId: z.string(),
      roleId: z.string(),
      brief: z.optional(z.string()),
      summary: z.string(),
    }),
  ),
  /** A worker's own card: the panel draws the label from this (D75). */
  teamWorker: z.optional(teamWorkerLabelSchema),
  /**
   * The confirmed answer to a waiting card or a merge card, folded back
   * into the row on the host's next update.
   */
  teamDecision: z.optional(z.string()),
} as const
export const teamItemFieldsSchema = z.object(teamItemFields)
export type TeamItemFields = z.infer<typeof teamItemFieldsSchema>

/** The item kinds U2 maps to cards instead of today's `item` row. */
export const TEAM_ITEM_KINDS: ReadonlySet<string> = new Set([
  'teamPlan',
  'teamSwitch',
  'teamWaiting',
  'teamMerge',
  'teamReport',
])

// The engine's existing durable task format, shared with configuration history.
import * as z from 'zod/mini'
import {
  teamAgentRefSchema,
  teamPoolEntrySchema,
  teamRoleConfigSchema,
  teamUsageSchema,
} from '../../shared/team'
import { teamReportSchema } from '../../shared/teamReport'
import { teamHandoffRecordSchema } from '../../shared/teamHandoff'
import { reviewFindingSchema } from '../../shared/reviewFindings'
import { TEAM_LEARNED_RECENT_TASKS, UI_TEXT } from '../../shared/constants'
import type { TeamRoleRecord } from './autofill'
import type { TeamStatePort } from './teamHostService'

export const TEAM_TASKS_STATE_KEY = 'museSpark.team.tasks'
const TASK_PHASES = [
  'queued',
  'starting',
  'running',
  'done',
  'failed',
  'stopped',
  'merged',
  'discarded',
  'continued',
  'interrupted',
] as const
export type TaskPhase = (typeof TASK_PHASES)[number]
const workspaceSchema = z.object({
  folder: z.string(),
  baseCommit: z.string(),
  branch: z.optional(z.string()),
  agentsRef: z.optional(z.string()),
})
const outcomeSchema = z.object({
  report: teamReportSchema,
  usage: teamUsageSchema,
  branch: z.optional(z.string()),
  baseCommit: z.optional(z.string()),
  head: z.optional(z.string()),
  changedFiles: z.optional(z.array(z.string())),
  folder: z.optional(z.string()),
  agentsRef: z.optional(z.string()),
})
const storedTaskSchema = z.object({
  taskId: z.string(),
  role: teamRoleConfigSchema,
  brief: z.string(),
  files: z.array(z.string()),
  reason: z.string(),
  sessionId: z.string(),
  startMs: z.number(),
  endMs: z.optional(z.number()),
  entry: z.optional(z.object({ ...teamPoolEntrySchema.shape, agent: teamAgentRefSchema })),
  isDefault: z.optional(z.boolean()),
  phase: z.enum(TASK_PHASES),
  usage: teamUsageSchema,
  workspace: z.optional(workspaceSchema),
  outcome: z.optional(outcomeSchema),
  failure: z.optional(z.string()),
  reviewedHead: z.optional(z.string()),
  review: z.optional(z.enum(['reviewed', 'same-model'])),
  reviewSummary: z.optional(z.string()),
  reviewVerdict: z.optional(z.string()),
  reviewFindings: z.optional(z.array(reviewFindingSchema)),
  continueFrom: z.optional(z.string()),
  // M120 lane P: the task's handoff chain, oldest first; Move to… links it.
  handoff: z.optional(teamHandoffRecordSchema),
  writerModels: z.optional(z.array(z.string())),
  ordinal: z.optional(z.number()),
  isRaised: z.optional(z.boolean()),
  claims: z.optional(
    z.array(
      z.object({
        ordinal: z.number(),
        atMs: z.number(),
        usage: teamUsageSchema,
        isSettled: z.boolean(),
        reported: z.optional(teamUsageSchema),
      }),
    ),
  ),
})
export const storedTasksSchema = z.union([
  z.array(storedTaskSchema),
  z.object({ tasks: z.array(storedTaskSchema), resets: z.record(z.string(), z.number()) }),
])

/** Read the real saved task history; malformed history is unavailable, never empty. */
export function readTeamRoleRecords(state: Pick<TeamStatePort, 'get'>): readonly TeamRoleRecord[] {
  const raw = state.get(TEAM_TASKS_STATE_KEY)
  if (raw === undefined) return []
  const parsed = storedTasksSchema.safeParse(raw)
  if (!parsed.success) throw new Error(UI_TEXT.teamBudgetUnavailable)
  const tasks = Array.isArray(parsed.data) ? parsed.data : parsed.data.tasks
  const latest = new Map(tasks.map((task) => [task.taskId, task]))
  const records = new Map<string, number[]>()
  const ordered = Array.from(latest, ([, task]) => task).toSorted(
    (a, b) => (a.endMs ?? a.startMs) - (b.endMs ?? b.startMs),
  )
  for (const task of ordered) {
    if (
      ['queued', 'starting', 'running', 'interrupted'].includes(task.phase) ||
      task.usage.modelCalls === 0 ||
      task.usage.estimated ||
      task.claims?.some((claim) => !claim.isSettled)
    )
      continue
    const samples = records.get(task.role.role) ?? []
    // Reasoning and cached input are subsets of output and input, never extra tokens.
    samples.push(task.usage.input + task.usage.output)
    records.set(task.role.role, samples.slice(-TEAM_LEARNED_RECENT_TASKS))
  }
  return [...records].map(([role, taskTokens]) => ({ role, taskTokens }))
}

// The team host service's implementation (M96 lane X, C-M96-3). It owns one
// workspace team's tasks in one window: the decision a conversation reads
// when it starts, the roster, the five tools' runner, the "waiting for you"
// and merge cards, the review before merge, the meters behind every cap, and
// the Agent map's tree. Every effect goes through the ports in
// teamHostService.ts, so the VS Code host, the ACP agent and the other
// editors' panels drive the same code. Task records are written through the
// state port at every change, so a reload finds them again (interrupted when
// they were running).
//
// Loads with dist/teamHost.js, and only for a workspace that stores a team.

import * as z from 'zod/mini'
import {
  MILLISECONDS_PER_SECOND,
  TEAM_EXHAUSTED_DEFAULT,
  TEAM_MODEL_TEXT,
  TEAM_QUEUE_MAX,
  TEAM_QUEUE_MAX_WAIT_MS,
  TEAM_ROLE_TOOLSETS,
  TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { redactSecrets } from '../redact'
import { isProtectedPath } from '../protectedPaths'
import {
  teamAgentRefSchema,
  teamPoolEntrySchema,
  teamReportSchema,
  teamRoleConfigSchema,
  teamSnapshotSchema,
  teamUsageSchema,
  type TeamAgentRef,
  type TeamCap,
  type TeamPoolEntry,
  type TeamRoleConfig,
  type TeamSnapshot,
  type TeamUsage,
} from '../../shared/team'
import type { TeamTreeData, TeamWorker } from '../../shared/teamView'
import type { TeamWorkerConfirmation } from '../../shared/paid'
import {
  TEAM_WORKSPACE_KEYS,
  decideTeamConversationMode,
  readTeamWorkspaceHint,
} from '../../shared/teamConversation'
import { builtinRoles, type BuiltinRole } from './builtInRoles'
import { isSameTeamModel } from './sameModel'
import { cancelArgs, collectArgs, delegateArgs, mergeArgs, type DelegateArgs } from './teamTools'
import type {
  TeamDecisionSource,
  TeamStableRole,
  TeamToolContext,
  TeamToolResult,
} from './teamSeams'
import type {
  TeamCardItem,
  TeamHostService,
  TeamHostServiceDeps,
  TeamMergeDecision,
  TeamMergeOutcome,
  TeamStatePort,
  TeamTaskWorkspace,
  TeamWaitingChoice,
  TeamWorkerOutcome,
} from './teamHostService'

/** The workspace-state key the tasks are written under (one window's team record). */
export const TEAM_TASKS_STATE_KEY = 'museSpark.team.tasks'
const REVIEW_ROLE = 'code-review'

type StaffedEntry = TeamPoolEntry & {
  readonly agent: TeamAgentRef
  /** Default: the orchestrator slot's own model and backend (acceptance 34). */
  readonly isDefault: boolean
}

type DelegateItem = DelegateArgs['tasks'][number]

/** Where a task is. `starting` holds its slot while consent is asked. */
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
type TaskPhase = (typeof TASK_PHASES)[number]
/** Finished tasks that may still hold a copy to merge, discard or recover. */
const SETTLED_PHASES: ReadonlySet<TaskPhase> = new Set(['done', 'failed', 'interrupted'])

interface TeamTaskRecord {
  readonly taskId: string
  readonly role: TeamRoleConfig
  readonly brief: string
  readonly files: readonly string[]
  readonly reason: string
  readonly sessionId: string
  readonly startMs: number
  readonly controller: AbortController
  /** The entry it runs on; unset while queued. */
  entry: StaffedEntry | undefined
  phase: TaskPhase
  usage: TeamUsage
  /** Key-billed models (provider and model) the user approved for this task. */
  consented: ReadonlySet<string>
  continueFrom?: TeamTaskRecord | undefined
  /** A review task: the task whose branch it reviews. */
  reviewOf?: TeamTaskRecord | undefined
  workspace?: TeamTaskWorkspace | undefined
  queueTimer?: ReturnType<typeof setTimeout> | undefined
  endMs?: number
  outcome?: TeamWorkerOutcome
  failure?: string
  /** The cap that stopped it, as the user reads it. */
  capped?: string
  /** A merge card waiting for the user's answer. */
  awaiting?: ((decision: TeamMergeDecision | 'cancelled') => void) | undefined
  /** A merge or discard is writing: a second one is refused. */
  isBusy: boolean
  /** The branch head a reviewer passed, how, and what it said. */
  reviewedHead?: string | undefined
  review?: 'reviewed' | 'same-model' | undefined
  reviewSummary?: string | undefined
  reviewVerdict?: string | undefined
}

/** One planned delegation: refused with its reason, waiting for the user, placed or queued. */
type PlanStep =
  | { readonly item: DelegateItem; readonly refused: string }
  | {
      readonly item: DelegateItem
      readonly role: TeamRoleConfig
      readonly ask: string
      readonly usable: readonly StaffedEntry[]
    }
  | {
      readonly item: DelegateItem
      readonly role: TeamRoleConfig
      readonly entry: StaffedEntry
      readonly continueFrom?: TeamTaskRecord | undefined
      /** Raise: the user let this one task past its entry's limits. */
      readonly isRaised?: boolean
    }
  | { readonly item: DelegateItem; readonly role: TeamRoleConfig; readonly queue: true }

const ZERO_USAGE: TeamUsage = {
  input: 0,
  cachedInput: 0,
  output: 0,
  reasoning: 0,
  modelCalls: 0,
  estimated: false,
}

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
})
const storedTasksSchema = z.array(storedTaskSchema)

/** The stored team, parsed; anything that does not parse is no team. */
export function readStoredTeam(state: TeamStatePort): TeamSnapshot | undefined {
  const parsed = teamSnapshotSchema.safeParse(state.get(TEAM_WORKSPACE_KEYS.team))
  return parsed.success ? parsed.data : undefined
}

function builtinRole(roleId: string): BuiltinRole | undefined {
  return builtinRoles().find((role) => role.id === roleId)
}

function custom(entry: TeamPoolEntry): StaffedEntry | undefined {
  return entry.agent === undefined ? undefined : { ...entry, agent: entry.agent, isDefault: false }
}

function answer(value: unknown, visible: string): TeamToolResult {
  return { output: JSON.stringify(value), visibleOutput: visible }
}

function refusal(reason: string): TeamToolResult {
  return { output: `Error: ${reason}`, visibleOutput: reason }
}

function describeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

function roleMode(role: TeamRoleConfig): 'read-only' | 'own-branch' | 'in-place' {
  return role.workspace ?? builtinRole(role.role)?.workspace ?? 'read-only'
}

function toolGroups(role: TeamRoleConfig): readonly string[] {
  const builtin = builtinRole(role.role)
  return role.tools ?? (builtin === undefined ? [] : TEAM_ROLE_TOOLSETS[builtin.id])
}

/** The paid scope a consent names: the provider and the model. */
function paidScope(agent: TeamAgentRef): string {
  return `${agent.provider ?? 'meta'}\n${agent.model}`
}

/** An entry's identity for its readiness: a changed model or agent needs a new probe. */
function agentIdentity(agent: TeamAgentRef): string {
  return JSON.stringify([agent.kind, agent.agentId, agent.model, agent.provider ?? '', agent.pays])
}

/** One cap's measure of one task's usage. */
function measureOf(usage: TeamUsage, cap: TeamCap): number {
  switch (cap.measure) {
    case 'tokens': {
      return usage.input + usage.output
    }
    case 'inputTokens': {
      return usage.input
    }
    case 'outputTokens': {
      return usage.output
    }
    case 'spendUsd': {
      return usage.costUsd ?? 0
    }
    default: {
      return 1
    }
  }
}

function isActive(phase: TaskPhase): boolean {
  return phase === 'starting' || phase === 'running'
}

/** The worker node's status words, as `teamWorkerStatusLabel` knows them. */
function workerStatus(task: TeamTaskRecord): string {
  switch (task.phase) {
    case 'done': {
      if (task.awaiting !== undefined) return 'waitingForApproval'
      if (task.capped !== undefined) return 'capped'
      return task.outcome?.report.status === 'failed' ? 'failed' : 'done'
    }
    case 'starting': {
      return 'queued'
    }
    case 'stopped': {
      return 'cancelled'
    }
    case 'continued': {
      return 'closed'
    }
    default: {
      return task.phase
    }
  }
}

function describePlan(planned: readonly PlanStep[]) {
  return planned.map((step) => {
    if ('refused' in step) return { role: step.item.role, refused: step.refused }
    if ('entry' in step)
      return { role: step.item.role, entry: step.entry.id, model: step.entry.agent.model }
    return { role: step.item.role, state: 'ask' in step ? 'ask' : 'queued' }
  })
}

function confirmationFor(role: string, entry: StaffedEntry): TeamWorkerConfirmation {
  return {
    ...(entry.agent.provider !== undefined && { provider: entry.agent.provider }),
    role,
    modelId: entry.agent.model,
    taskCeilingTokens:
      entry.caps.find((cap) => cap.measure === 'tokens' && cap.window === 'task')?.amount ?? 0,
  }
}

/** What the tree's Merge says when the gate refuses, in the user's words. */
function userMergeRefusal(reason: string): string {
  switch (reason) {
    case TEAM_MODEL_TEXT.hostUntrusted: {
      return UI_TEXT.teamMergeUntrusted
    }
    case TEAM_MODEL_TEXT.hostMergeNoConversation: {
      return UI_TEXT.teamMergeNeedsConversation
    }
    case TEAM_MODEL_TEXT.hostMergePlanMode: {
      return UI_TEXT.teamMergePlanMode
    }
    case TEAM_MODEL_TEXT.hostTaskBusy: {
      return UI_TEXT.teamTaskBusy
    }
    default: {
      return UI_TEXT.teamTaskUnknown
    }
  }
}

export function createTeamHostService(deps: TeamHostServiceDeps): TeamHostService {
  let snapshot = readStoredTeam(deps.state)
  let isDisposed = false
  /** Read through a call: an await may have closed the service meanwhile. */
  const isClosed = (): boolean => isDisposed
  /** Each probed entry's readiness, kept with the agent identity it was probed for. */
  const probes = new Map<string, { readonly identity: string; readonly isReady: boolean }>()
  const probeGenerations = new Map<string, number>()
  const tasks = new Map<string, TeamTaskRecord>()
  const allTasks = (): TeamTaskRecord[] => Array.from(tasks.values(), (task) => task)
  /** Tasks counted against each entry's caps since its last reset. */
  const resets = new Map<string, number>()
  const listeners = new Set<(tree: TeamTreeData | undefined) => void>()
  /** `collect` calls waiting for a task to change, each with its bound. */
  const waiters = new Set<() => void>()
  /** "Waiting for you" cards, by id, until the user answers. */
  const waiting = new Map<string, (choice: TeamWaitingChoice | 'cancelled') => void>()
  /** The last conversation model seen: the orchestrator the tree and Default show. */
  let lastModel: string | undefined
  const orchestratorModel = (): string => lastModel ?? deps.orchestrator.modelId()

  const roles = (): readonly TeamRoleConfig[] => snapshot?.roles ?? []
  const customEntries = (): readonly StaffedEntry[] =>
    roles().flatMap((role) => role.pool.flatMap((entry) => custom(entry) ?? []))
  /**
   * A role's pool in order, Default resolved live to the orchestrator slot
   * (a picker change applies to the next delegation). Default needs no probe:
   * the orchestrator's own model is the one in use.
   */
  const pool = (role: TeamRoleConfig): readonly StaffedEntry[] =>
    role.pool.flatMap((entry): StaffedEntry[] => {
      if (entry.agent !== undefined) return [{ ...entry, agent: entry.agent, isDefault: false }]
      const agent = deps.orchestrator.defaultAgent?.(orchestratorModel())
      return agent === undefined ? [] : [{ ...entry, agent, isDefault: true }]
    })

  const isProbedReady = (entry: StaffedEntry): boolean => {
    const probe = probes.get(entry.id)
    return probe?.isReady === true && probe.identity === agentIdentity(entry.agent)
  }

  const decisionSource = (orchestratorModelId?: string): TeamDecisionSource | undefined => {
    if (snapshot === undefined) return undefined
    if (orchestratorModelId !== undefined) lastModel = orchestratorModelId
    const entries = customEntries()
    return {
      teamSwitchOn: deps.settings.isTeamOn(),
      soloTemplate: readTeamWorkspaceHint(deps.state).soloTemplate,
      orchestratorModelId: orchestratorModel(),
      customEntries: entries.map((entry) => ({
        entryId: entry.id,
        modelId: entry.agent.model,
        kind: entry.agent.kind === 'museCode' ? 'musecode' : entry.agent.kind,
        billsKey: entry.agent.pays === 'key',
        isAvailable: deps.workers.canRun(entry.agent),
      })),
      isSameModel: isSameTeamModel,
      isEntryReady: (entryId) => {
        const entry = entries.find((candidate) => candidate.id === entryId)
        return entry !== undefined && isProbedReady(entry)
      },
      teamWorkersOn: deps.settings.isTeamWorkersOn(),
    }
  }

  const isTeamRunning = (): boolean => {
    const source = decisionSource()
    return source !== undefined && decideTeamConversationMode(source).mode === 'team'
  }

  /** Tasks holding a slot (running, or reserved while consent is asked). */
  const running = (entryId?: string): number =>
    allTasks().filter(
      (task) => isActive(task.phase) && (entryId === undefined || task.entry?.id === entryId),
    ).length

  /** One cap's use on one entry over its window: every task the entry ran since the window began. */
  const capUsed = (entry: StaffedEntry, cap: TeamCap): number => {
    if (cap.window === 'task') {
      return Math.max(
        0,
        ...allTasks()
          .filter((task) => task.entry?.id === entry.id && isActive(task.phase))
          .map((task) => measureOf(task.usage, cap)),
      )
    }
    const since = Math.max(
      resets.get(entry.id) ?? 0,
      cap.window === 'day' ? new Date(deps.now()).setHours(0, 0, 0, 0) : 0,
    )
    return allTasks()
      .filter((task) => task.entry?.id === entry.id && task.startMs >= since)
      .reduce((sum, task) => sum + measureOf(task.usage, cap), 0)
  }

  /** The entry can run at all: its worker exists, it is loaded, it may bill, it is not limited. */
  const isUsable = (entry: StaffedEntry): boolean =>
    deps.workers.canRun(entry.agent) &&
    deps.workers.isLimited?.(entry.agent) !== true &&
    (entry.agent.pays !== 'key' || deps.settings.isTeamWorkersOn()) &&
    (entry.isDefault ||
      (isProbedReady(entry) && !isSameTeamModel(entry.agent.model, orchestratorModel())))

  /** D75's selection: a usable entry with a free slot and room under every day and lifetime cap. */
  const hasHeadroom = (entry: StaffedEntry, taken = 0): boolean =>
    isUsable(entry) &&
    running(entry.id) + taken < entry.concurrent &&
    entry.caps.every(
      (cap) =>
        cap.window === 'task' ||
        capUsed(entry, cap) + (cap.measure === 'tasks' ? taken : 0) < cap.amount,
    )

  const entryState = (entry: StaffedEntry): string => {
    if (hasHeadroom(entry)) return 'ready'
    return isUsable(entry) ? 'capped' : 'unavailable'
  }

  const stableRoles = (): readonly TeamStableRole[] =>
    roles().map((role) => ({
      roleId: role.role,
      workspaceMode: roleMode(role),
      toolGroups: toolGroups(role),
      exhaustedPolicy: role.exhausted ?? TEAM_EXHAUSTED_DEFAULT,
      whenToUse: (builtinRole(role.role)?.whenToUse ?? '').slice(
        0,
        TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
      ),
      pool: pool(role).map((entry) => ({
        entryId: entry.id,
        agentLabel: entry.agent.agentId,
        modelId: entry.agent.model,
        kind: entry.agent.kind === 'museCode' ? 'musecode' : entry.agent.kind,
        caps: entry.caps.map((cap) => `${String(cap.amount)} ${cap.measure}/${cap.window}`),
      })),
    }))

  const workerNode = (task: TeamTaskRecord): TeamWorker => ({
    taskId: task.taskId,
    brief: task.brief,
    reason: task.reason,
    ...(task.outcome?.branch !== undefined && { branch: task.outcome.branch }),
    status: workerStatus(task),
    elapsedMs: (task.endMs ?? deps.now()) - task.startMs,
    inputTokens: task.usage.input,
    outputTokens: task.usage.output,
    ...(task.usage.costUsd !== undefined && { costUsd: task.usage.costUsd }),
    estimated: task.usage.estimated,
  })

  /** A task the user can still merge, discard or recover: it holds a copy. */
  const hasCopy = (task: TeamTaskRecord): boolean =>
    task.outcome?.folder !== undefined ||
    (task.phase === 'interrupted' && task.workspace !== undefined)

  const tree = (): TeamTreeData | undefined => {
    if (snapshot === undefined || (!isTeamRunning() && tasks.size === 0)) return undefined
    const all = allTasks()
    const ofRole = (
      role: TeamRoleConfig,
      isKept: (task: TeamTaskRecord) => boolean,
    ): TeamWorker[] =>
      all
        .filter((task) => task.role.role === role.role && isKept(task))
        .map((task) => workerNode(task))
    return {
      orchestrator: {
        model: orchestratorModel(),
        backend: deps.orchestrator.backend(),
        slot: 'default',
      },
      roles: roles().map((role) => ({
        id: role.role,
        name: builtinRole(role.role)?.name ?? role.role,
        mode: roleMode(role),
        toolGroups: toolGroups(role),
        entries: pool(role).map((entry) => ({
          id: entry.id,
          provider: entry.agent.provider ?? entry.agent.agentId,
          model: entry.agent.model,
          payKind: entry.agent.pays,
          caps: entry.caps.map((cap) => ({
            label: `${cap.measure}/${cap.window}`,
            used: capUsed(entry, cap),
            amount: cap.amount,
            estimated: all.some((task) => task.entry?.id === entry.id && task.usage.estimated),
          })),
          running: running(entry.id),
          concurrentMax: entry.concurrent,
          state: entryState(entry),
          warnings: [],
          workers: all
            .filter((task) => task.entry?.id === entry.id && isActive(task.phase))
            .map((task) => workerNode(task)),
        })),
        queued: ofRole(role, (task) => task.phase === 'queued'),
        unmerged: ofRole(
          role,
          (task) => (task.phase === 'done' || task.phase === 'failed') && hasCopy(task),
        ),
        interrupted: ofRole(role, (task) => task.phase === 'interrupted'),
      })),
    }
  }

  const persist = async (): Promise<void> => {
    const records = allTasks().map((task) => ({
      taskId: task.taskId,
      role: task.role,
      brief: task.brief,
      files: [...task.files],
      reason: task.reason,
      sessionId: task.sessionId,
      startMs: task.startMs,
      ...(task.endMs !== undefined && { endMs: task.endMs }),
      ...(task.entry !== undefined && {
        entry: {
          id: task.entry.id,
          agent: task.entry.agent,
          concurrent: task.entry.concurrent,
          caps: task.entry.caps,
        },
        isDefault: task.entry.isDefault,
      }),
      phase: task.phase,
      usage: task.usage,
      ...(task.workspace !== undefined && { workspace: task.workspace }),
      ...(task.outcome !== undefined && { outcome: task.outcome }),
      ...(task.failure !== undefined && { failure: task.failure }),
      ...(task.reviewedHead !== undefined && { reviewedHead: task.reviewedHead }),
      ...(task.review !== undefined && { review: task.review }),
      ...(task.reviewSummary !== undefined && { reviewSummary: task.reviewSummary }),
    }))
    try {
      await deps.state.update(TEAM_TASKS_STATE_KEY, records)
    } catch (error: unknown) {
      deps.log.warn(`The team's task record could not be written: ${describeError(error)}`)
    }
  }

  const changed = (): void => {
    for (const wake of waiters) wake()
    if (isDisposed) return
    void persist()
    const current = tree()
    for (const listener of listeners) listener(current)
  }

  /** A reload finds the window's earlier tasks; those that were running are interrupted. */
  const restore = (): void => {
    const parsed = storedTasksSchema.safeParse(deps.state.get(TEAM_TASKS_STATE_KEY))
    if (!parsed.success) return
    for (const stored of parsed.data) {
      const wasActive = ['queued', 'starting', 'running'].includes(stored.phase)
      const phase: TaskPhase = wasActive ? 'interrupted' : stored.phase
      tasks.set(stored.taskId, {
        taskId: stored.taskId,
        role: stored.role,
        brief: stored.brief,
        files: stored.files,
        reason: stored.reason,
        sessionId: stored.sessionId,
        startMs: stored.startMs,
        ...(stored.endMs !== undefined && { endMs: stored.endMs }),
        controller: new AbortController(),
        entry:
          stored.entry === undefined
            ? undefined
            : { ...stored.entry, isDefault: stored.isDefault === true },
        phase,
        usage: stored.usage,
        consented: new Set(),
        workspace: stored.workspace,
        ...(stored.outcome !== undefined && { outcome: stored.outcome }),
        ...(stored.failure !== undefined && { failure: stored.failure }),
        isBusy: false,
        reviewedHead: stored.reviewedHead,
        review: stored.review,
        reviewSummary: stored.reviewSummary,
      })
    }
  }
  restore()

  /** The service's hold on a running task: every request is admitted here first. */
  const admitRequest = (task: TeamTaskRecord): void => {
    if (isDisposed || task.controller.signal.aborted || task.phase !== 'running')
      throw new Error(TEAM_MODEL_TEXT.hostStopped)
    if (!deps.settings.isTrusted()) throw new Error(TEAM_MODEL_TEXT.hostUntrusted)
    const entry = task.entry
    if (entry === undefined) throw new Error(TEAM_MODEL_TEXT.hostStopped)
    if (entry.agent.pays === 'key' && !deps.settings.isTeamWorkersOn())
      throw new Error(TEAM_MODEL_TEXT.hostPaidOff)
    for (const cap of entry.caps) {
      if (cap.measure === 'tasks') continue
      const used = cap.window === 'task' ? measureOf(task.usage, cap) : capUsed(entry, cap)
      if (used >= cap.amount) {
        task.capped = `${String(cap.amount)} ${cap.measure}/${cap.window}`
        throw new Error(fill(TEAM_MODEL_TEXT.hostCapReached, { cap: task.capped }))
      }
    }
  }

  const settleReview = (task: TeamTaskRecord): void => {
    if (task.phase !== 'done') return
    const reviewed = task.reviewOf
    const report = task.outcome?.report
    const head = reviewed?.outcome?.head
    if (
      reviewed === undefined ||
      head === undefined ||
      report === undefined ||
      ['failed', 'unstructured'].includes(report.status)
    )
      return
    reviewed.reviewedHead = head
    reviewed.review =
      task.entry !== undefined &&
      reviewed.entry !== undefined &&
      isSameTeamModel(task.entry.agent.model, reviewed.entry.agent.model)
        ? 'same-model'
        : 'reviewed'
    reviewed.reviewVerdict = report.status
    reviewed.reviewSummary = report.summary
  }

  const finish = (task: TeamTaskRecord, phase: TaskPhase, failure?: string): void => {
    if (!isActive(task.phase) && task.phase !== 'queued') return
    if (task.queueTimer !== undefined) clearTimeout(task.queueTimer)
    task.phase = phase
    task.endMs = deps.now()
    if (failure !== undefined) task.failure = failure
    const previous = task.continueFrom
    // A continuation that left no copy of its own hands the earlier one back.
    if (previous?.phase === 'continued' && !hasCopy(task)) previous.phase = 'done'
    settleReview(task)
    if (!isDisposed) pump()
    changed()
  }

  const launch = (task: TeamTaskRecord, entry: StaffedEntry): void => {
    if (isClosed() || task.controller.signal.aborted) return
    if (task.queueTimer !== undefined) clearTimeout(task.queueTimer)
    task.entry = entry
    task.phase = 'running'
    if (task.continueFrom !== undefined) task.continueFrom.phase = 'continued'
    deps.log.info(`Team task ${task.taskId} started: role ${task.role.role}, entry ${entry.id}`)
    void deps.workers
      .run(
        {
          taskId: task.taskId,
          role: task.role,
          entry,
          brief: task.brief,
          files: task.files,
          parentSessionId: task.sessionId,
          continueFrom: task.continueFrom?.outcome,
          reviewOf: task.reviewOf?.outcome,
          meter: {
            admitRequest: () => {
              admitRequest(task)
            },
            noteUsage: (usage) => {
              task.usage = usage
              changed()
            },
            noteWorkspace: (workspace) => {
              task.workspace = workspace
              changed()
            },
          },
        },
        task.controller.signal,
      )
      .then((outcome) => {
        task.outcome =
          task.capped === undefined
            ? outcome
            : { ...outcome, report: { ...outcome.report, status: 'capped' } }
        task.usage = outcome.usage
        // A writer keeps its copy whatever its report: merge, discard or recover it.
        finish(
          task,
          outcome.report.status === 'failed' && outcome.folder === undefined ? 'failed' : 'done',
        )
      })
      .catch((error: unknown) => {
        finish(task, 'failed', task.capped ?? describeError(error))
      })
  }

  /**
   * Queued tasks start in order as soon as their role has headroom again, and
   * only on an entry their consent covers: a key-billed entry the user did not
   * approve for that task is passed over.
   */
  function pump(): void {
    if (isClosed()) return
    for (const task of allTasks()) {
      if (task.phase !== 'queued') continue
      if (!deps.settings.isTrusted()) return
      const entry = pool(task.role).find(
        (candidate) =>
          hasHeadroom(candidate) &&
          (candidate.agent.pays !== 'key' || task.consented.has(paidScope(candidate.agent))),
      )
      if (entry !== undefined) launch(task, entry)
    }
  }

  const record = (
    role: TeamRoleConfig,
    item: Pick<DelegateItem, 'brief' | 'files' | 'reason'>,
    sessionId: string,
    phase: TaskPhase,
    entry?: StaffedEntry,
  ): TeamTaskRecord => {
    const task: TeamTaskRecord = {
      taskId: deps.newId(),
      role,
      brief: item.brief,
      files: item.files ?? [],
      reason: item.reason.code,
      sessionId,
      startMs: deps.now(),
      controller: new AbortController(),
      entry,
      phase,
      usage: ZERO_USAGE,
      consented: new Set(),
      isBusy: false,
    }
    tasks.set(task.taskId, task)
    return task
  }

  const enqueue = (task: TeamTaskRecord): void => {
    task.queueTimer = setTimeout(() => {
      finish(task, 'failed', TEAM_MODEL_TEXT.hostQueueTimedOut)
    }, TEAM_QUEUE_MAX_WAIT_MS)
  }

  const ownTask = (taskId: string, context: TeamToolContext): TeamTaskRecord | undefined => {
    const task = tasks.get(taskId)
    return task?.sessionId === context.sessionId ? task : undefined
  }

  /** The first entry with headroom among `candidates`, counting what this call already took. */
  const choose = (
    candidates: readonly StaffedEntry[],
    taken: Map<string, number>,
  ): StaffedEntry | undefined => {
    const chosen = candidates.find((entry) => hasHeadroom(entry, taken.get(entry.id) ?? 0))
    if (chosen !== undefined) taken.set(chosen.id, (taken.get(chosen.id) ?? 0) + 1)
    return chosen
  }

  const plan = (args: unknown, context: TeamToolContext): readonly PlanStep[] | undefined => {
    if (context.orchestratorModelId !== undefined) lastModel = context.orchestratorModelId
    const parsed = delegateArgs.safeParse(args)
    if (!parsed.success) return undefined
    const taken = new Map<string, number>()
    return parsed.data.tasks.map((item): PlanStep => {
      const role = roles().find((candidate) => candidate.role === item.role)
      if (role === undefined || builtinRole(item.role) === undefined) {
        return { item, refused: fill(TEAM_MODEL_TEXT.hostRoleNotOffered, { role: item.role }) }
      }
      if (roleMode(role) === 'in-place') {
        return { item, refused: TEAM_MODEL_TEXT.hostInPlaceNotOffered }
      }
      const previous = item.continue === undefined ? undefined : ownTask(item.continue, context)
      if (
        item.continue !== undefined &&
        (previous?.phase !== 'done' ||
          previous.awaiting !== undefined ||
          previous.isBusy ||
          previous.role.role !== role.role ||
          previous.outcome?.folder === undefined)
      ) {
        return { item, refused: TEAM_MODEL_TEXT.hostContinueNotReady }
      }
      const candidates = pool(role).filter(
        (entry) => item.entry === undefined || entry.id === item.entry,
      )
      if (candidates.length === 0) {
        return { item, refused: fill(TEAM_MODEL_TEXT.hostNotStaffed, { role: item.role }) }
      }
      const chosen = choose(candidates, taken)
      if (chosen !== undefined) return { item, role, entry: chosen, continueFrom: previous }
      const usable = candidates.filter((entry) => isUsable(entry))
      const exhausted = fill(TEAM_MODEL_TEXT.hostExhausted, { role: item.role })
      const policy = role.exhausted ?? TEAM_EXHAUSTED_DEFAULT
      // `queue` waits only for a reason that recovers: a usable entry at its limits.
      if (policy === 'self' || usable.length === 0) return { item, refused: exhausted }
      return policy === 'queue'
        ? { item, role, queue: true }
        : { item, role, ask: exhausted, usable }
    })
  }

  /** The "waiting for you" card: the orchestrator gets the user's answer. */
  const askUser = async (
    step: Extract<PlanStep, { readonly ask: string }>,
    context: TeamToolContext,
  ): Promise<TeamWaitingChoice | 'cancelled'> => {
    const waitingId = deps.newId()
    const card = {
      itemId: `team-waiting-${waitingId}`,
      kind: 'teamWaiting' as const,
      teamWaiting: {
        waitingId,
        roleId: step.role.role,
        brief: step.item.brief,
        reasonText: step.ask,
      },
    }
    deps.cards.show(context.sessionId, { ...card, status: 'inProgress' })
    const choice = await new Promise<TeamWaitingChoice | 'cancelled'>((resolve) => {
      waiting.set(waitingId, resolve)
      context.signal.addEventListener('abort', () => {
        resolve('cancelled')
      })
    })
    waiting.delete(waitingId)
    deps.cards.show(context.sessionId, { ...card, status: 'completed', teamDecision: choice })
    return choice
  }

  /** Each waiting step resolved with the user's answer, before any spend is asked. */
  const settle = async (
    planned: readonly PlanStep[],
    context: TeamToolContext,
  ): Promise<readonly PlanStep[]> => {
    const settled: PlanStep[] = []
    for (const step of planned) {
      if (!('ask' in step)) {
        settled.push(step)
        continue
      }
      const choice = await askUser(step, context)
      const entry = step.usable.find((candidate) => isUsable(candidate))
      if (choice === 'queue') settled.push({ item: step.item, role: step.role, queue: true })
      else if (choice === 'raise' && entry !== undefined)
        settled.push({ item: step.item, role: step.role, entry, isRaised: true })
      else
        settled.push({
          item: step.item,
          refused:
            choice === 'self'
              ? TEAM_MODEL_TEXT.hostWaitingSelf
              : TEAM_MODEL_TEXT.hostWaitingCancelled,
        })
    }
    return settled
  }

  /**
   * After the cards, the plan is checked again and every slot is taken in one
   * synchronous step: two calls awaiting consent can never hold one free slot.
   */
  const reserve = (
    planned: readonly PlanStep[],
    context: TeamToolContext,
  ): { readonly steps: readonly PlanStep[]; readonly reserved: Map<PlanStep, TeamTaskRecord> } => {
    const reserved = new Map<PlanStep, TeamTaskRecord>()
    const steps = planned.map((step): PlanStep => {
      if (!('entry' in step)) return step
      // Each reservation is a task record at once, so the next choice counts it.
      const entry =
        step.isRaised === true && isUsable(step.entry)
          ? step.entry
          : choose(
              pool(step.role).filter(
                (candidate) => step.item.entry === undefined || candidate.id === step.item.entry,
              ),
              new Map(),
            )
      if (entry === undefined) {
        return {
          item: step.item,
          refused: fill(TEAM_MODEL_TEXT.hostExhausted, { role: step.item.role }),
        }
      }
      const placed = { ...step, entry }
      reserved.set(placed, record(step.role, step.item, context.sessionId, 'starting', entry))
      return placed
    })
    return { steps, reserved }
  }

  const release = (reserved: Map<PlanStep, TeamTaskRecord>): void => {
    for (const task of reserved.values()) tasks.delete(task.taskId)
    changed()
  }

  const taskView = (task: TeamTaskRecord) => ({
    task_id: task.taskId,
    role: task.role.role,
    ...(task.entry !== undefined && { entry: task.entry.id, model: task.entry.agent.model }),
    state: workerStatus(task),
    elapsed_ms: (task.endMs ?? deps.now()) - task.startMs,
    usage: task.usage,
    ...(task.capped !== undefined && { capped: task.capped }),
    ...(task.failure !== undefined && { failure: task.failure }),
    ...(task.outcome !== undefined && {
      report: task.outcome.report,
      ...(task.outcome.branch !== undefined && { branch: task.outcome.branch }),
      ...(task.outcome.changedFiles !== undefined && {
        changed_files: task.outcome.changedFiles,
      }),
    }),
    ...(task.review !== undefined && { review: task.review, review_summary: task.reviewSummary }),
  })

  /** Waits until a task changes, the bound passes or the call is cancelled. */
  const waitForChange = async (ms: number, signal: AbortSignal): Promise<void> => {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        waiters.delete(done)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      waiters.add(done)
      signal.addEventListener('abort', done)
    })
  }

  /** Runs one merge or discard on a task at a time; a second is refused. */
  const exclusive = async <T>(task: TeamTaskRecord, work: () => Promise<T>): Promise<T> => {
    if (task.isBusy) throw new Error(UI_TEXT.teamTaskBusy)
    task.isBusy = true
    changed()
    try {
      return await work()
    } finally {
      task.isBusy = false
      changed()
    }
  }

  const discard = async (task: TeamTaskRecord): Promise<void> => {
    await exclusive(task, async () => {
      const outcome =
        task.outcome ??
        (task.workspace === undefined
          ? undefined
          : {
              report: { status: 'failed' as const, summary: '' },
              usage: task.usage,
              ...task.workspace,
            })
      await deps.merges.discard({ taskId: task.taskId, role: task.role, outcome })
      task.phase = 'discarded'
      task.endMs ??= deps.now()
    })
  }

  const stop = async (task: TeamTaskRecord): Promise<void> => {
    if (isActive(task.phase) || task.phase === 'queued') {
      task.controller.abort()
      finish(task, 'stopped')
    } else if (SETTLED_PHASES.has(task.phase)) {
      task.awaiting?.('cancelled')
      if (hasCopy(task)) await discard(task)
      else {
        task.phase = 'discarded'
        changed()
      }
    }
  }

  /** The conversation's approval mode now, or the call's when no surface reports it. */
  const modeOf = (task: TeamTaskRecord, fallback?: string): string | undefined =>
    deps.orchestrator.approvalMode?.(task.sessionId) ?? fallback

  /** One gate for every merge, from the model or the tree: refused in Plan and untrusted. */
  const mergeRefusal = (task: TeamTaskRecord, mode: string | undefined): string | undefined => {
    if (!deps.settings.isTrusted()) return TEAM_MODEL_TEXT.hostUntrusted
    if (mode === undefined) return TEAM_MODEL_TEXT.hostMergeNoConversation
    if (mode === 'denyUnmatched') return TEAM_MODEL_TEXT.hostMergePlanMode
    if (task.isBusy) return TEAM_MODEL_TEXT.hostTaskBusy
    return task.phase !== 'done' ||
      task.outcome?.branch === undefined ||
      task.awaiting !== undefined
      ? TEAM_MODEL_TEXT.hostMergeNotReady
      : undefined
  }

  /** A reviewer with headroom, preferring a model that did not write the branch. */
  const reviewerFor = (task: TeamTaskRecord): StaffedEntry | undefined => {
    const reviewRole = roles().find((role) => role.role === REVIEW_ROLE)
    if (reviewRole === undefined) return undefined
    const ready = pool(reviewRole).filter((entry) => hasHeadroom(entry))
    const writer = task.entry?.agent.model
    return (
      ready.find((entry) => writer === undefined || !isSameTeamModel(entry.agent.model, writer)) ??
      ready[0]
    )
  }

  /**
   * Review before merge (acceptance 19): with a reviewer that has headroom,
   * a branch head nobody reviewed starts a review task first; the merge waits
   * for it. Answers the refusal the caller passes on, or undefined to merge.
   */
  const requireReview = async (
    task: TeamTaskRecord,
    context: TeamToolContext,
  ): Promise<string | undefined> => {
    const head = task.outcome?.head
    if (head === undefined || task.reviewedHead === head) return undefined
    const running = allTasks().find(
      (candidate) => candidate.reviewOf === task && isActive(candidate.phase),
    )
    if (running !== undefined)
      return fill(TEAM_MODEL_TEXT.hostReviewRunning, { task: running.taskId })
    const reviewer = reviewerFor(task)
    const reviewRole = roles().find((role) => role.role === REVIEW_ROLE)
    if (reviewer === undefined || reviewRole === undefined) return undefined
    const review = record(
      reviewRole,
      {
        brief: fill(TEAM_MODEL_TEXT.hostReviewBrief, {
          task: task.taskId,
          role: task.role.role,
          brief: task.brief,
        }),
        files: [...(task.outcome?.changedFiles ?? [])],
        reason: { code: 'different_model', detail: TEAM_MODEL_TEXT.hostReviewReason },
      },
      task.sessionId,
      'starting',
      reviewer,
    )
    review.reviewOf = task
    if (
      reviewer.agent.pays === 'key' &&
      !(await deps.paid.allowKeyTasks([confirmationFor(REVIEW_ROLE, reviewer)], undefined, context))
    ) {
      tasks.delete(review.taskId)
      changed()
      return TEAM_MODEL_TEXT.hostPaidDeclined
    }
    if (isClosed()) {
      tasks.delete(review.taskId)
      return TEAM_MODEL_TEXT.hostStopped
    }
    review.consented = new Set([paidScope(reviewer.agent)])
    launch(review, reviewer)
    changed()
    return fill(TEAM_MODEL_TEXT.hostReviewStarted, { task: review.taskId })
  }

  const mergeCard = (task: TeamTaskRecord, outcome: TeamWorkerOutcome) => {
    const files = outcome.changedFiles ?? []
    return {
      itemId: `team-merge-${task.taskId}`,
      kind: 'teamMerge' as const,
      teamMerge: {
        taskId: task.taskId,
        roleId: task.role.role,
        brief: task.brief,
        branch: outcome.branch ?? '',
        filesChanged: files.length,
        affectedFiles: files,
        protectedPaths: files.filter((file) => isProtectedPath(file.toLowerCase())),
        review: task.review ?? ('not-reviewed' as const),
        ...(task.reviewVerdict !== undefined && { reviewVerdict: task.reviewVerdict }),
        ...(task.reviewSummary !== undefined && { reviewerFindings: [task.reviewSummary] }),
      },
    }
  }

  /** The merge card asks; the answer, after the gate again, merges or discards. */
  const askAndMerge = async (
    task: TeamTaskRecord,
    outcome: TeamWorkerOutcome,
    signal: AbortSignal,
    fallbackMode: string | undefined,
  ): Promise<TeamToolResult> => {
    const card = mergeCard(task, outcome)
    const show = (item: TeamCardItem): void => {
      deps.cards.show(task.sessionId, item)
    }
    show({ ...card, status: 'inProgress' })
    const decision = await new Promise<TeamMergeDecision | 'cancelled'>((resolve) => {
      task.awaiting = resolve
      signal.addEventListener('abort', () => {
        resolve('cancelled')
      })
      changed()
    })
    task.awaiting = undefined
    show({ ...card, status: 'completed', teamDecision: decision })
    changed()
    if (decision === 'cancelled' || isClosed()) return refusal(TEAM_MODEL_TEXT.hostMergeCancelled)
    if (decision === 'discard') {
      await discard(task)
      return answer({ task_id: task.taskId, state: 'discarded' }, UI_TEXT.teamWorkerDiscarded)
    }
    // The card may have waited while trust or the mode changed.
    const refused = mergeRefusal(task, modeOf(task, fallbackMode))
    if (refused !== undefined) return refusal(refused)
    try {
      const merged: TeamMergeOutcome = await exclusive(task, async () => {
        signal.throwIfAborted()
        const result = await deps.merges.merge(
          { taskId: task.taskId, role: task.role, outcome },
          signal,
          { allowProtected: card.teamMerge.protectedPaths.length > 0 },
        )
        if (result.status === 'merged') task.phase = 'merged'
        return result
      })
      return answer(
        { task_id: task.taskId, ...merged },
        merged.status === 'merged' ? UI_TEXT.teamWorkerMerged : UI_TEXT.teamMergeRework,
      )
    } catch (error: unknown) {
      return refusal(describeError(error))
    }
  }

  const runner: TeamHostService['teamRunner'] = {
    preview: (args, context) => {
      const planned = plan(args, context)
      return Promise.resolve(
        planned === undefined
          ? refusal(TEAM_MODEL_TEXT.hostInvalidArguments)
          : answer({ dry_run: true, plan: describePlan(planned) }, UI_TEXT.teamPlanShown),
      )
    },
    delegate: async (args, context) => {
      if (!deps.settings.isTrusted()) return refusal(TEAM_MODEL_TEXT.hostUntrusted)
      const initial = plan(args, context)
      if (initial === undefined) return refusal(TEAM_MODEL_TEXT.hostInvalidArguments)
      const settledSteps = await settle(initial, context)
      if (isClosed()) return refusal(TEAM_MODEL_TEXT.hostStopped)
      const placedCount = settledSteps.filter((step) => 'entry' in step).length
      if (running() + placedCount > deps.settings.maxWorkers()) {
        return refusal(
          fill(TEAM_MODEL_TEXT.hostMaxWorkers, { max: String(deps.settings.maxWorkers()) }),
        )
      }
      const queuedNow = allTasks().filter((task) => task.phase === 'queued').length
      if (queuedNow + settledSteps.filter((step) => 'queue' in step).length > TEAM_QUEUE_MAX) {
        return refusal(fill(TEAM_MODEL_TEXT.hostQueueFull, { max: String(TEAM_QUEUE_MAX) }))
      }
      const { steps, reserved } = reserve(settledSteps, context)
      changed()
      // One popup names every key model these tasks may run on, queued ones included.
      const named = new Map<PlanStep, readonly StaffedEntry[]>()
      for (const step of steps) {
        if ('entry' in step && step.entry.agent.pays === 'key') named.set(step, [step.entry])
        if ('queue' in step)
          named.set(
            step,
            pool(step.role).filter((entry) => entry.agent.pays === 'key' && isUsable(entry)),
          )
      }
      const confirmations = [...named].flatMap(([step, entries]) =>
        entries.map((entry) => confirmationFor(step.item.role, entry)),
      )
      if (
        confirmations.length > 0 &&
        !(await deps.paid.allowKeyTasks(confirmations, undefined, context))
      ) {
        release(reserved)
        return refusal(TEAM_MODEL_TEXT.hostPaidDeclined)
      }
      if (isClosed() || context.signal.aborted) {
        release(reserved)
        return refusal(TEAM_MODEL_TEXT.hostStopped)
      }
      const started = steps.map((step) => {
        if ('refused' in step) return { role: step.item.role, refused: step.refused }
        if ('entry' in step) {
          const task = reserved.get(step)
          if (task === undefined)
            return { role: step.item.role, refused: TEAM_MODEL_TEXT.hostStopped }
          task.consented = new Set([paidScope(step.entry.agent)])
          task.continueFrom = step.continueFrom
          launch(task, step.entry)
          return taskView(task)
        }
        if ('queue' in step) {
          const task = record(step.role, step.item, context.sessionId, 'queued')
          task.consented = new Set((named.get(step) ?? []).map((entry) => paidScope(entry.agent)))
          enqueue(task)
          return taskView(task)
        }
        return { role: step.item.role, refused: TEAM_MODEL_TEXT.hostStopped }
      })
      pump()
      changed()
      const count = started.filter((step) => 'task_id' in step).length
      return answer({ tasks: started }, fill(UI_TEXT.teamTasksStarted, { count: String(count) }))
    },
    collect: async (args, context) => {
      const parsed = collectArgs.safeParse(args)
      if (!parsed.success) return refusal(TEAM_MODEL_TEXT.hostInvalidArguments)
      const ids = parsed.data.task_ids
      const chosen = (): readonly (TeamTaskRecord | undefined)[] =>
        ids === undefined
          ? allTasks().filter((task) => task.sessionId === context.sessionId)
          : ids.map((id) => ownTask(id, context))
      const waitMs = (parsed.data.wait_seconds ?? 0) * MILLISECONDS_PER_SECOND
      if (
        waitMs > 0 &&
        chosen().some(
          (task) => task !== undefined && (isActive(task.phase) || task.phase === 'queued'),
        )
      ) {
        await waitForChange(waitMs, context.signal)
      }
      return answer(
        {
          tasks: chosen().map((task, index) =>
            task === undefined
              ? { task_id: ids?.[index], refused: TEAM_MODEL_TEXT.hostUnknownTask }
              : taskView(task),
          ),
        },
        '',
      )
    },
    cancel: async (args, context) => {
      const parsed = cancelArgs.safeParse(args)
      if (!parsed.success) return refusal(TEAM_MODEL_TEXT.hostInvalidArguments)
      const results = []
      for (const id of parsed.data.task_ids) {
        const task = ownTask(id, context)
        if (task === undefined) {
          results.push({ task_id: id, refused: TEAM_MODEL_TEXT.hostUnknownTask })
          continue
        }
        try {
          await stop(task)
          results.push({ task_id: id, state: workerStatus(task) })
        } catch (error: unknown) {
          results.push({ task_id: id, refused: describeError(error) })
        }
      }
      return answer({ tasks: results }, '')
    },
    merge: async (args, context) => {
      const parsed = mergeArgs.safeParse(args)
      if (!parsed.success) return refusal(TEAM_MODEL_TEXT.hostInvalidArguments)
      const task = ownTask(parsed.data.task_id, context)
      if (task === undefined) return refusal(TEAM_MODEL_TEXT.hostUnknownTask)
      const refused = mergeRefusal(task, modeOf(task, context.approvalMode))
      if (refused !== undefined) return refusal(refused)
      const review = await requireReview(task, context)
      if (review !== undefined) return refusal(review)
      const outcome = task.outcome
      return outcome === undefined
        ? refusal(TEAM_MODEL_TEXT.hostMergeNotReady)
        : await askAndMerge(task, outcome, context.signal, context.approvalMode)
    },
  }

  const known = (taskId: string): TeamTaskRecord => {
    const task = tasks.get(taskId)
    if (task === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
    return task
  }

  return {
    teamDecisionSource: decisionSource,
    teamRosterData: () => {
      if (snapshot === undefined) return
      const live = customEntries().map((entry) => ({
        entryId: entry.id,
        roleId: roles().find((role) => role.pool.some((item) => item.id === entry.id))?.role ?? '',
        headroom: `${String(entry.concurrent - running(entry.id))}/${String(entry.concurrent)} free`,
        state: entryState(entry),
      }))
      return {
        stable: stableRoles(),
        live: {
          entries: live,
          queueDepth: allTasks().filter((task) => task.phase === 'queued').length,
          unmergedTasks: allTasks().filter((task) => task.phase === 'done' && hasCopy(task)).length,
          budgetLeft: '',
        },
      }
    },
    teamRunner: runner,
    isTeamInPlaceActive: () =>
      allTasks().some((task) => isActive(task.phase) && roleMode(task.role) === 'in-place'),
    tree,
    onTreeChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    stopTask: async (taskId) => {
      await stop(known(taskId))
    },
    stopAllTasks: async () => {
      const open = allTasks().filter((task) => isActive(task.phase) || task.phase === 'queued')
      for (const task of open) await stop(task)
      return open.length
    },
    answerWaiting: async (waitingId, choice) => {
      const resolve = waiting.get(waitingId)
      if (resolve === undefined) throw new Error(UI_TEXT.teamWaitingUnknown)
      resolve(choice)
      await Promise.resolve()
    },
    decideMerge: async (taskId, decision) => {
      const task = known(taskId)
      if (task.awaiting !== undefined) {
        task.awaiting(decision)
        return
      }
      if (decision === 'discard') {
        if (!SETTLED_PHASES.has(task.phase)) throw new Error(UI_TEXT.teamTaskUnknown)
        await discard(task)
        return
      }
      // The tree's Merge goes through the model's gate and opens the merge card.
      const mode = modeOf(task)
      const refused = mergeRefusal(task, mode)
      if (refused !== undefined) throw new Error(userMergeRefusal(refused))
      const context = {
        sessionId: task.sessionId,
        approvalMode: mode ?? '',
        signal: task.controller.signal,
      }
      const review = await requireReview(task, context)
      if (review !== undefined) throw new Error(UI_TEXT.teamReviewStarted)
      const outcome = task.outcome
      if (outcome === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
      void askAndMerge(task, outcome, task.controller.signal, mode).then((result) => {
        if (result.output.startsWith('Error:'))
          deps.log.warn(`Team merge of ${taskId} from the tree: ${result.visibleOutput}`)
      })
    },
    taskDiff: async (taskId) => {
      const outcome = known(taskId).outcome
      if (outcome?.head === undefined) throw new Error(UI_TEXT.teamTaskNoDiff)
      return await deps.merges.diff(outcome)
    },
    resetEntry: async (entryId) => {
      resets.set(entryId, deps.now())
      pump()
      changed()
      await Promise.resolve()
    },
    probeEntries: async () => {
      // The declared setup probes run only where the team could run: never
      // with the switch off, on Solo, for the orchestrator's own model, for an
      // agent this editor cannot run, or for a key entry while `teamWorkers` is off.
      if (isClosed() || !deps.settings.isTeamOn() || readTeamWorkspaceHint(deps.state).soloTemplate)
        return
      for (const entry of customEntries()) {
        if (
          !deps.workers.canRun(entry.agent) ||
          isSameTeamModel(entry.agent.model, orchestratorModel()) ||
          (entry.agent.pays === 'key' && !deps.settings.isTeamWorkersOn())
        )
          continue
        const identity = agentIdentity(entry.agent)
        const generation = (probeGenerations.get(entry.id) ?? 0) + 1
        probeGenerations.set(entry.id, generation)
        let isReady = false
        try {
          isReady = await deps.workers.probe(entry.agent)
        } catch {
          // A failed current probe is unavailable; a stale failure has no owner.
        }
        if (isClosed()) return
        if (probeGenerations.get(entry.id) === generation)
          probes.set(entry.id, { identity, isReady })
      }
      pump()
      changed()
    },
    reload: () => {
      for (const [id, generation] of probeGenerations) probeGenerations.set(id, generation + 1)
      snapshot = readStoredTeam(deps.state)
      changed()
    },
    dispose: async () => {
      isDisposed = true
      listeners.clear()
      for (const resolve of waiting.values()) resolve('cancelled')
      for (const task of tasks.values()) {
        task.awaiting?.('cancelled')
        if (task.queueTimer !== undefined) clearTimeout(task.queueTimer)
        if (isActive(task.phase) || task.phase === 'queued') task.controller.abort()
      }
      for (const wake of waiters) wake()
      await Promise.resolve()
    },
  }
}

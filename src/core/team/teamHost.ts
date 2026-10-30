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

import {
  MILLISECONDS_PER_SECOND,
  stopContinuationLimitFor,
  TEAM_EXHAUSTED_DEFAULT,
  TEAM_MERGE_PAUSE_STATE_KEY,
  TEAM_MODEL_TEXT,
  TEAM_ROLE_TOOLSETS,
  TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { Usd, sumUsd } from '../../shared/usd'
import { canonicalUsd, compareUsdAmounts, type UsdAmount } from '../../shared/usdSchema'
import { usageLocalDay } from '../usage/localDay'
import { failureForLog } from '../backends/musecode/logText'
import { redactSecrets } from '../redact'
import {
  teamRescheduleSchema,
  teamSnapshotSchema,
  teamUsageSchema,
  type TeamAgentRef,
  type TeamCap,
  type TeamPoolEntry,
  type TeamRoleConfig,
  type TeamSnapshot,
  type TeamUsage,
} from '../../shared/team'
import type { ReviewFinding } from '../../shared/reviewFindings'
import type { TeamTreeData, TeamWorker } from '../../shared/teamView'
import type { TeamWorkerConfirmation } from '../../shared/paid'
import {
  TEAM_WORKSPACE_KEYS,
  decideTeamConversationMode,
  isTeamAvailable,
  readTeamWorkspaceHint,
} from '../../shared/teamConversation'
import { teamAgentSwitchFields, teammateIdleFields } from '../backends/modelapi/extensionHooks'
import {
  recordTeamSwitch,
  switchReasonText,
  switchHookPayload,
  teamSubagentStartFields,
  teamSubagentStopFields,
  type TeamAgentProfile,
  type TeamEntryExhaustion,
} from './teamPool'
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
  TeamHostService,
  TeamHostServiceDeps,
  TeamMergeDecision,
  TeamMergeQueueEvent,
  TeamMergeRefusal,
  TeamStatePort,
  TeamTaskWorkspace,
  TeamTaskSpec,
  TeamWaitingChoice,
  TeamWorkerOutcome,
} from './teamHostService'
import type { TeamSchedulingDeps, TeamSchedulingPort } from './teamScheduling'
import { runScheduledDelegate } from './scheduledDelegate'
import { isResourceSlotAvailable } from './scheduler/slots'
import { randomUUID } from 'node:crypto'
import { orderMergeQueue, type MergeCandidate } from './mergeQueue'
import { isProtectedPath } from '../protectedPaths'
import type * as teamMergeFlow from './teamMergeFlow'

import { TEAM_TASKS_STATE_KEY, storedTasksSchema, type TaskPhase } from './teamTaskState'
export { TEAM_TASKS_STATE_KEY } from './teamTaskState'
const REVIEW_ROLE = 'code-review'

export type StaffedEntry = TeamPoolEntry & {
  readonly agent: TeamAgentRef
  /** Default: the orchestrator slot's own model and backend (acceptance 34). */
  readonly isDefault: boolean
}

type DelegateItem = DelegateArgs['tasks'][number]

/** Finished tasks that may still hold a copy to merge, discard or recover. */
const SETTLED_PHASES: ReadonlySet<TaskPhase> = new Set(['done', 'failed', 'interrupted'])

export interface TeamTaskRecord {
  delegateGroup?: string | undefined
  pipelineId?: string | undefined
  childSessionId?: string | undefined
  hasStoppedHook?: boolean | undefined
  readonly taskId: string
  readonly role: TeamRoleConfig
  readonly brief: string
  readonly files: readonly string[]
  readonly reason: string
  readonly sessionId: string
  readonly startMs: number
  /** Replaced on stall recovery: the aborted signal stays with the torn-down run. */
  controller: AbortController
  /** The entry it runs on; unset while queued. */
  entry: StaffedEntry | undefined
  phase: TaskPhase
  usage: TeamUsage
  /** Persisted dispatch claims: missing reports retain their maximum liability. */
  claims: {
    ordinal: number
    attempt?: number | undefined
    /** The entry that spent it: retries keep each attempt on its own entry. */
    entryId?: string | undefined
    atMs: number
    usage: TeamUsage
    isSettled: boolean
    reported?: TeamUsage | undefined
    /** A dispatch marker: one per attempt start, counted by the tasks cap. */
    isDispatch?: boolean | undefined
  }[]
  ordinal: number
  selectedEntry?: string | undefined
  schedulerAttempt?: number | undefined
  /** The window that owns this task's dispatches; restore never overwrites it. */
  owner: { windowInstanceId: string; released?: boolean | undefined } | undefined
  /** The stall detector flagged this run: retire it into the retry pin. */
  stallReassign: boolean
  retryFrom?: TeamWorkerOutcome | undefined
  /** A stall handoff's instruction and data block, prepended once at launch. */
  handoffBrief?: string | undefined
  isRaised: boolean
  writerModels: string[]
  lease?: { release: () => void } | undefined
  mergePhase: 'idle' | 'reviewing' | 'awaiting-decision' | 'merging' | 'done' | 'failed'
  mergeCompletion?: Promise<TeamToolResult> | undefined
  mergeReady?: (() => void) | undefined
  /** Key-billed models (provider and model) the user approved for this task. */
  consented: ReadonlySet<string>
  continueFrom?: TeamTaskRecord | undefined
  /** A review task: the task whose branch it reviews. */
  reviewOf?: TeamTaskRecord | undefined
  workspace?: TeamTaskWorkspace | undefined
  endMs?: number | undefined
  outcome?: TeamWorkerOutcome | undefined
  failure?: string | undefined
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
  reviewFindings?: readonly ReviewFinding[] | undefined
}

/** One planned delegation: refused with its reason, waiting for the user, placed or queued. */
export type PlanStep =
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

/** Exact amounts never go below zero: a usage report cannot unspend money. */
function maxUsdZero(amount: Usd): UsdAmount {
  return amount.compare(Usd.from(0)) < 0 ? canonicalUsd(0) : amount.toAmount()
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
      // Headroom and display only, like the token counts: the persisted
      // claim money stays exact and the reserve gate compares exactly.
      return usage.costUsd === undefined ? 0 : Number(usage.costUsd)
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

function confirmationFor(
  role: string,
  entry: StaffedEntry,
  rates?: TeamWorkerConfirmation['rates'],
): TeamWorkerConfirmation {
  return {
    ...(entry.agent.provider !== undefined && { provider: entry.agent.provider }),
    role,
    modelId: entry.agent.model,
    ...(rates !== undefined && { rates }),
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
  /** One identity for this window's board and task claims, shared with the scheduler. */
  const myWindowId = deps.windowInstanceId ?? randomUUID()
  let snapshot = readStoredTeam(deps.state)
  let isDisposed = false
  /** Read through a call: an await may have closed the service meanwhile. */
  const isTaskStopped = (task: TeamTaskRecord): boolean => task.controller.signal.aborted
  const isClosed = (): boolean => isDisposed
  /** Each probed entry's readiness, kept with the agent identity it was probed for. */
  const probes = new Map<string, { readonly identity: string; readonly isReady: boolean }>()
  const probeGenerations = new Map<string, number>()
  const tasks = new Map<string, TeamTaskRecord>()
  /** Tasks this run restored as interrupted: Resume reconciles them. */
  const restoredInterrupted = new Set<string>()
  const leases = new Map<string, string>()
  const copyOwners = new Set<string>()
  let ordinal = 0
  let saveQueue = Promise.resolve()
  let saveFailure: Error | undefined

  const allTasks = (): TeamTaskRecord[] => Array.from(tasks.values(), (task) => task)
  /** Tasks counted against each entry's caps since its last reset. */
  const resets = new Map<string, number>()
  const listeners = new Set<(tree: TeamTreeData | undefined) => void>()
  /** `collect` calls waiting for a task to change, each with its bound. */
  const waiters = new Set<() => void>()
  const executions = new Map<string, Promise<void>>()
  /** "Waiting for you" cards, by id, until the user answers. */
  const waiting = new Map<string, (choice: TeamWaitingChoice | 'cancelled') => void>()
  /** The last landing refusal per task, while it sits in review. */
  const mergeRefusals = new Map<string, TeamMergeRefusal>()
  /** The merge queue: reviewed tasks waiting for landing, in enqueue order. */
  const mergeQueueEntries: {
    taskId: string
    enqueuedAt: number
    sessionId: string
    approvalMode: string
    onConflict: 'rework' | 'markers'
    reviewOnly: boolean
    /** The requester's cancellation: the queued turn stays cancellable. */
    signal: AbortSignal
  }[] = []
  /** The head item the queue processor is landing, if any. */
  let mergeActive: string | undefined
  /** Recorded merge-queue transitions backing depth and time-to-merge. */
  const mergeEventLog: TeamMergeQueueEvent[] = []
  /** One turn per queued task: card-open and turn-end signals for waiters. */
  const mergeTurns = new Map<
    string,
    {
      card: Promise<void>
      cardResolve: () => void
      end: Promise<TeamToolResult | undefined>
      endResolve: (result: TeamToolResult | undefined) => void
    }
  >()
  const mergeQueueController = new AbortController()
  /** The last conversation model seen: the orchestrator the tree and Default show. */
  let lastModel: string | undefined
  const orchestratorModel = (): string => lastModel ?? deps.orchestrator.modelId()

  const roles = (): readonly TeamRoleConfig[] => snapshot?.roles ?? []
  const customEntries = (): readonly StaffedEntry[] =>
    roles().flatMap((role) => role.pool.flatMap((entry) => custom(entry) ?? []))
  /**
  A role's pool in order, Default resolved live to the orchestrator slot
  (a picker change applies to the next delegation). Default needs no probe:
  the orchestrator's own model is the one in use.
  */
  let delegateOrdinal = 0
  const selectedEntries = new Map<string, StaffedEntry>()
  const exhaustedHookRoles = new Set<string>()
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
      teamSwitchOn: isTeamAvailable(deps.settings.isTeamOn()),
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

  /** Only admit owns these slots, including pending consent and worker teardown. */
  const running = (entryId?: string): number => {
    let count = 0
    for (const id of leases.values()) if (entryId === undefined || id === entryId) count += 1
    return count
  }

  /** Local midnight: daily caps count each request by the time it was made. */
  const dayStart = (atMs: number = deps.now()): number => new Date(atMs).setHours(0, 0, 0, 0)

  const claimsFor = (entry: StaffedEntry, cap: TeamCap, owner?: TeamTaskRecord) => {
    const since = cap.window === 'day' ? dayStart() : 0
    const reset = resets.get(entry.id) ?? 0
    // Claims stay on the entry that spent them: a retry that clears or
    // replaces task.entry must not move earlier attempts to another entry's
    // caps. Unstamped (pre-migration) claims fall back to the current entry.
    const owned =
      owner === undefined
        ? allTasks().filter(
            (task) =>
              task.entry?.id === entry.id ||
              task.claims.some((claim) => claim.entryId === entry.id),
          )
        : [owner]
    return owned
      .flatMap((task) =>
        task.claims.filter((claim) => (claim.entryId ?? task.entry?.id) === entry.id),
      )
      .filter(
        (claim) =>
          cap.window === 'task' ||
          ((claim.ordinal > reset || !claim.isSettled) && claim.atMs >= since),
      )
  }

  const capUsed = (entry: StaffedEntry, cap: TeamCap, owner?: TeamTaskRecord): number => {
    if (cap.measure === 'tasks') {
      const since = cap.window === 'day' ? dayStart() : 0
      const reset = resets.get(entry.id) ?? 0
      // Attempts, not records: each dispatch stamps one dispatch claim at its
      // own start, and the cap counts those stamps on the day they ran. Usage
      // slices are never attempts. A task with no dispatch stamp yet (queued
      // before this change, or never admitted) keeps the old record rule.
      const attempts = new Set<string>()
      const owners = owner === undefined ? allTasks() : [owner]
      for (const task of owners) {
        const owned = task.claims.filter((claim) => (claim.entryId ?? task.entry?.id) === entry.id)
        const stamps = owned.filter((claim) => claim.isDispatch === true)
        if (stamps.length > 0) {
          for (const stamp of stamps)
            if ((stamp.ordinal > reset || !stamp.isSettled) && stamp.atMs >= since)
              attempts.add(`${task.taskId}#${String(stamp.ordinal)}`)
          continue
        }
        if (owned.length === 0) {
          // Never admitted: one reservation on its current entry, counted
          // when it runs (no day gate: it has not run on any day yet).
          if (task.entry?.id === entry.id && task.ordinal > reset)
            attempts.add(`task:${task.taskId}`)
          continue
        }
        // Pre-marker usage slices: group by attempt and gate each attempt by
        // its own earliest stamp, never the original task's start.
        const slices = new Map<string, { atMs: number; ordinal: number; isSettled: boolean }>()
        for (const claim of owned) {
          const key =
            claim.attempt === undefined
              ? `task:${task.taskId}`
              : `task:${task.taskId}#${String(claim.attempt)}`
          const seen = slices.get(key)
          if (
            seen === undefined ||
            claim.atMs < seen.atMs ||
            (claim.atMs === seen.atMs && claim.ordinal < seen.ordinal)
          )
            slices.set(key, {
              atMs: claim.atMs,
              ordinal: claim.ordinal,
              isSettled: claim.isSettled,
            })
          else if (!claim.isSettled)
            slices.set(key, { atMs: seen.atMs, ordinal: seen.ordinal, isSettled: false })
        }
        for (const [key, slice] of slices)
          if ((slice.ordinal > reset || !slice.isSettled) && slice.atMs >= since) attempts.add(key)
      }
      return attempts.size
    }
    return owner !== undefined || cap.window !== 'task'
      ? claimsFor(entry, cap, owner).reduce((sum, claim) => sum + measureOf(claim.usage, cap), 0)
      : Math.max(
          0,
          ...allTasks()
            .filter((task) => task.entry?.id === entry.id && isActive(task.phase))
            .map((task) => capUsed(entry, cap, task)),
        )
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
    (SETTLED_PHASES.has(task.phase) && task.workspace !== undefined)

  /**
  Today's settled engine costs and their ceiling, exact to the nano-USD:
  settled claims count as spent, open ones keep their maximum liability.
  Absent until a claim names a cost, so a costless team shows no tally.
  */
  const todayTally = (
    all: readonly TeamTaskRecord[],
  ): { readonly spentUsdToday: UsdAmount; readonly budgetUsdToday: UsdAmount } | undefined => {
    const today = usageLocalDay(deps.now())
    const spent: UsdAmount[] = []
    const budget: UsdAmount[] = []
    for (const task of all) {
      for (const claim of task.claims) {
        if (usageLocalDay(claim.atMs) !== today) continue
        const cost = claim.usage.costUsd
        if (cost === undefined) continue
        budget.push(cost)
        if (claim.isSettled) spent.push(cost)
      }
    }
    return budget.length === 0
      ? undefined
      : { spentUsdToday: sumUsd(...spent), budgetUsdToday: sumUsd(...budget) }
  }

  const noteMergeQueueEvent = (
    kind: TeamMergeQueueEvent['kind'],
    taskId: string,
    reason?: string,
  ): void => {
    mergeEventLog.push({
      kind,
      taskId,
      at: deps.now(),
      ...(reason !== undefined && { reason }),
    })
  }
  /** The queue in landing order: dependencies, then priority, then conflicts,
  then blast radius, then queue arrival, then id (merge/mergeQueue). */
  const orderedMergeQueue = (): readonly MergeCandidate[] => {
    const boardById = new Map((scheduler?.snapshot().tasks ?? []).map((task) => [task.id, task]))
    const queued: {
      candidate: Omit<MergeCandidate, 'conflictsWith'> & { conflictsWith: string[] }
      files: Set<string>
    }[] = []
    for (const entry of mergeQueueEntries) {
      const task = tasks.get(entry.taskId)
      if (task?.outcome === undefined) continue
      const changedFiles = task.outcome.changedFiles ?? []
      const boardTask = boardById.get(entry.taskId)
      queued.push({
        candidate: {
          id: entry.taskId,
          dependsOn: (boardTask?.depends_on ?? [])
            .filter((edge) => edge.on !== 'done')
            .map((edge) => edge.task),
          priority: boardTask?.priority ?? 'normal',
          conflictsWith: [],
          // Best available blast radius: file count and protected paths.
          changedLines: changedFiles.length,
          files: changedFiles.map((name) => ({
            shared: false,
            protected: isProtectedPath(name.toLowerCase()),
          })),
          finishedAt: entry.enqueuedAt,
          onConflict: entry.onConflict,
        } satisfies MergeCandidate,
        files: new Set(changedFiles),
      })
    }
    for (const [index, left] of queued.entries()) {
      const later = queued.slice(index + 1)
      for (const right of later) {
        const hasSharedFiles = [...left.files].some((file) => right.files.has(file))
        if (!hasSharedFiles) continue
        left.candidate.conflictsWith.push(right.candidate.id)
        right.candidate.conflictsWith.push(left.candidate.id)
      }
    }
    const merged = new Set(
      allTasks()
        .filter((task) => task.phase === 'merged')
        .map((task) => task.taskId),
    )
    return orderMergeQueue(
      queued.map((entry) => entry.candidate),
      merged,
    ).ordered
  }
  const queuePosition = (taskId: string): number =>
    orderedMergeQueue().findIndex((candidate) => candidate.id === taskId) + 1
  /** Enqueue a reviewed task for landing; answers its 1-based position. */
  const enqueueMerge = (
    task: TeamTaskRecord,
    sessionId: string,
    approvalMode: string,
    onConflict: 'rework' | 'markers',
    isReviewOnly: boolean,
    signal: AbortSignal,
  ): number => {
    const existing = mergeQueueEntries.find((entry) => entry.taskId === task.taskId)
    if (existing === undefined) {
      mergeQueueEntries.push({
        taskId: task.taskId,
        enqueuedAt: deps.now(),
        sessionId,
        approvalMode,
        onConflict,
        reviewOnly: isReviewOnly,
        signal,
      })
      noteMergeQueueEvent('enqueued', task.taskId)
    } else {
      existing.sessionId = sessionId
      existing.approvalMode = approvalMode
      existing.onConflict = onConflict
      existing.signal = signal
    }
    changed()
    pumpMergeQueue()
    return queuePosition(task.taskId)
  }
  const dequeueMerge = (
    taskId: string,
    kind: TeamMergeQueueEvent['kind'],
    reason?: string,
  ): void => {
    const index = mergeQueueEntries.findIndex((entry) => entry.taskId === taskId)
    if (index === -1) return
    mergeQueueEntries.splice(index, 1)
    noteMergeQueueEvent(kind, taskId, reason)
    changed()
  }
  const mergeTurn = (taskId: string) => {
    const existing = mergeTurns.get(taskId)
    if (existing !== undefined) return existing
    // The TypeScript lib stays ES2023, which has no Promise.withResolvers.
    let cardResolve!: () => void
    let endResolve!: (result: TeamToolResult | undefined) => void
    const turn = {
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
      card: new Promise<void>((resolve) => {
        cardResolve = resolve
      }),
      cardResolve: () => {
        cardResolve()
      },
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
      end: new Promise<TeamToolResult | undefined>((resolve) => {
        endResolve = resolve
      }),
      endResolve: (result: TeamToolResult | undefined) => {
        endResolve(result)
      },
    }
    mergeTurns.set(taskId, turn)
    return turn
  }
  const settleMergeTurn = (taskId: string, result: TeamToolResult | undefined): void => {
    mergeTurns.get(taskId)?.endResolve(result)
    mergeTurns.delete(taskId)
  }
  const pumpMergeQueue = (): void => {
    if (
      mergeActive !== undefined ||
      isClosed() ||
      deps.state.get(TEAM_MERGE_PAUSE_STATE_KEY) === true
    )
      return
    while (mergeActive === undefined) {
      const head = orderedMergeQueue()[0]
      if (head === undefined) return
      const entry = mergeQueueEntries.find((candidate) => candidate.taskId === head.id)
      const task = tasks.get(head.id)
      if (entry === undefined || task === undefined) {
        dequeueMerge(head.id, 'withdrawn')
        continue
      }
      mergeActive = head.id
      void runQueuedMerge(task, entry.sessionId, entry.approvalMode, entry.reviewOnly, entry.signal)
    }
  }
  const runQueuedMerge = async (
    task: TeamTaskRecord,
    sessionId: string,
    approvalMode: string,
    isReviewOnly: boolean,
    signal: AbortSignal,
  ): Promise<void> => {
    let result: TeamToolResult | undefined
    try {
      result = await beginMerge(
        task,
        {
          sessionId,
          approvalMode,
          signal: AbortSignal.any([mergeQueueController.signal, task.controller.signal, signal]),
        },
        isReviewOnly,
      )
    } catch (error: unknown) {
      deps.log.warn(failureForLog(error))
      result = undefined
    } finally {
      let kind: TeamMergeQueueEvent['kind'] = 'returned'
      let reason: string | undefined = mergeRefusals.get(task.taskId)?.kind
      if (isReviewOnly) {
        kind = 'withdrawn'
        reason = undefined
      } else if (task.phase === 'merged') {
        kind = 'landed'
      }
      dequeueMerge(task.taskId, kind, reason)
      mergeActive = undefined
      settleMergeTurn(task.taskId, result)
      changed()
      pumpMergeQueue()
    }
  }
  /** A reviewed task whose landing wait can be re-listed after a reload. */
  const canRequeue = (task: TeamTaskRecord): boolean =>
    task.phase === 'done' &&
    task.outcome !== undefined &&
    (task.mergePhase === 'idle' || task.mergePhase === 'failed') &&
    hasCopy(task) &&
    mergeQueueEntries.every((entry) => entry.taskId !== task.taskId)
  /** Re-list review waits after a reload; only Full resumes landing on its own. */
  const rebuildMergeQueue = (): void => {
    for (const task of tasks.values()) {
      if (!canRequeue(task)) continue
      mergeQueueEntries.push({
        taskId: task.taskId,
        enqueuedAt: deps.now(),
        sessionId: task.sessionId,
        approvalMode: modeOf(task) ?? '',
        onConflict: 'rework',
        reviewOnly: false,
        signal: task.controller.signal,
      })
      noteMergeQueueEvent('enqueued', task.taskId)
    }
    changed()
    if (deps.settings.scheduler?.().integrationFlow === 'full') pumpMergeQueue()
  }

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
    // The conversation's real slot: a stored override is not Default, and the
    // stored snapshot carries it across the new-conversation boundary.
    const override = snapshot.orchestrator?.agent
    return {
      orchestrator: {
        model: orchestratorModel(),
        backend: deps.orchestrator.backend(),
        slot: override !== undefined && override.kind !== 'external' ? 'override' : 'default',
      },
      ...todayTally(all),
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
            estimated: all.some(
              (task) =>
                task.entry?.id === entry.id &&
                (task.usage.estimated ||
                  task.claims.some((claim) => !claim.isSettled || claim.usage.estimated)),
            ),
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

  /** Snapshot and serialize every save. The caller must await its durable boundary. */
  const persist = async (): Promise<void> => {
    const records = allTasks().map((task) => ({
      taskId: task.taskId,
      role: task.role,
      brief: task.brief,
      files: [...task.files],
      reason: task.reason,
      sessionId: task.sessionId,
      startMs: task.startMs,
      endMs: task.endMs,
      entry: task.entry,
      isDefault: task.entry?.isDefault,
      phase: task.phase,
      usage: task.usage,
      claims: task.claims.map((claim) => ({ ...claim })),
      ordinal: task.ordinal,
      isRaised: task.isRaised,
      workspace: task.workspace,
      outcome: task.outcome,
      failure: task.failure,
      continueFrom: task.continueFrom?.taskId,
      schedulerAttempt: task.schedulerAttempt,
      handoffBrief: task.handoffBrief,
      owner: task.owner,
      consented: [],
      writerModels: [...task.writerModels],
      reviewedHead: task.reviewedHead,
      review: task.review,
      reviewSummary: task.reviewSummary,
      reviewVerdict: task.reviewVerdict,
      reviewFindings: task.reviewFindings,
    }))
    const value = { tasks: records, resets: Object.fromEntries(resets) }
    const previous = saveQueue
    const write = async (): Promise<void> => {
      await previous
      if (saveFailure !== undefined) throw saveFailure
      await deps.state.update(TEAM_TASKS_STATE_KEY, value)
    }
    const pending = write()
    const observe = async (): Promise<void> => {
      try {
        await pending
      } catch (error: unknown) {
        saveFailure = new Error(describeError(error))
        deps.log.warn(`The team's task record could not be written: ${saveFailure.message}`)
      }
    }
    saveQueue = observe()
    await pending
  }

  const changed = (): void => {
    for (const wake of waiters) wake()
    if (isDisposed) return
    const current = tree()
    for (const listener of listeners) listener(current)
  }

  const restore = (): void => {
    const parsed = storedTasksSchema.safeParse(deps.state.get(TEAM_TASKS_STATE_KEY))
    if (!parsed.success) return
    const records = Array.isArray(parsed.data) ? parsed.data : parsed.data.tasks
    if (!Array.isArray(parsed.data))
      for (const [id, boundary] of Object.entries(parsed.data.resets)) resets.set(id, boundary)
    for (const stored of records) {
      const wasActive = ['queued', 'starting', 'running'].includes(stored.phase)
      const taskOrdinal = stored.ordinal ?? ++ordinal
      const claims = stored.claims ?? [
        {
          ordinal: taskOrdinal,
          atMs: stored.startMs,
          usage: stored.usage,
          isSettled: true,
          reported: stored.usage,
        },
      ]
      ordinal = Math.max(
        ordinal,
        taskOrdinal,
        ...claims.map((claim) => claim.ordinal),
        ...resets.values(),
      )
      if (wasActive) restoredInterrupted.add(stored.taskId)
      tasks.set(stored.taskId, {
        ...stored,
        handoffBrief: stored.handoffBrief,
        owner: stored.owner,
        // A restored run is never mid-stall: detection starts over.
        stallReassign: false,
        schedulerAttempt: stored.schedulerAttempt,
        controller: new AbortController(),
        // Consent is never restored: Resume renews it at the current price.
        consented: new Set(),
        isBusy: false,
        mergePhase: 'idle',
        claims,
        ordinal: taskOrdinal,
        isRaised: stored.isRaised === true,
        writerModels:
          stored.writerModels ?? (stored.entry === undefined ? [] : [stored.entry.agent.model]),
        entry:
          stored.entry === undefined
            ? undefined
            : { ...stored.entry, isDefault: stored.isDefault === true },
        phase: wasActive ? 'interrupted' : stored.phase,
        continueFrom: undefined,
      })
    }
    for (const stored of records) {
      const task = tasks.get(stored.taskId)
      const previous =
        stored.continueFrom === undefined ? undefined : tasks.get(stored.continueFrom)
      if (task === undefined || previous === undefined) {
        continue
      }

      task.continueFrom = previous
      task.workspace ??=
        previous.workspace ??
        (previous.outcome?.folder === undefined
          ? undefined
          : {
              folder: previous.outcome.folder,
              baseCommit: previous.outcome.baseCommit ?? '',
              branch: previous.outcome.branch,
              agentsRef: previous.outcome.agentsRef,
            })
    }
  }
  restore()

  /** The service's hold on a running task: every request is admitted here first. */
  const admitRequest = (task: TeamTaskRecord, hasClaim = false): void => {
    if (isDisposed || task.controller.signal.aborted || task.phase !== 'running')
      throw new Error(TEAM_MODEL_TEXT.hostStopped)
    if (!deps.settings.isTrusted()) throw new Error(TEAM_MODEL_TEXT.hostUntrusted)
    if (saveFailure !== undefined) throw saveFailure
    const entry = task.entry
    if (entry === undefined) throw new Error(TEAM_MODEL_TEXT.hostStopped)
    if (entry.agent.pays === 'key' && !deps.settings.isTeamWorkersOn())
      throw new Error(TEAM_MODEL_TEXT.hostPaidOff)
    for (const cap of entry.caps) {
      if (cap.measure === 'tasks') continue
      if (hasClaim) {
        const pending = task.claims.at(-1)
        if (
          pending !== undefined &&
          pending.reported === undefined &&
          cap.window === 'day' &&
          dayStart(pending.atMs) !== dayStart()
        )
          throw new Error(TEAM_MODEL_TEXT.hostStopped)
        continue
      }
      if (task.isRaised) continue
      const used = capUsed(entry, cap, cap.window === 'task' ? task : undefined)
      if (used >= cap.amount) {
        task.capped = `${String(cap.amount)} ${cap.measure}/${cap.window}`
        throw new Error(fill(TEAM_MODEL_TEXT.hostCapReached, { cap: task.capped }))
      }
    }
  }

  const settleReview = (task: TeamTaskRecord): void => {
    if (task.phase !== 'done') return
    const reviewed = task.reviewOf
    if (reviewed === undefined) return
    const report = task.outcome?.report
    const head = reviewed.outcome?.head
    if (head === undefined || report?.status !== 'done') return
    const reviewer = task.entry?.agent.model
    reviewed.reviewedHead = head
    reviewed.review =
      reviewer !== undefined &&
      reviewed.writerModels.some((model) => isSameTeamModel(reviewer, model))
        ? 'same-model'
        : 'reviewed'
    reviewed.reviewVerdict = report.status
    reviewed.reviewSummary = report.summary
    reviewed.reviewFindings = report.findings
  }

  /** The sole synchronous owner of worker admission, before any await. */
  const admit = (task: TeamTaskRecord, entry: StaffedEntry): { release: () => void } => {
    if (isClosed() || task.controller.signal.aborted) throw new Error(TEAM_MODEL_TEXT.hostStopped)
    if (saveFailure !== undefined) throw saveFailure
    if (!deps.settings.isTrusted()) throw new Error(TEAM_MODEL_TEXT.hostUntrusted)
    // One owner per task: a record naming a live foreign window never admits
    // here; a free or released record is claimed by this window.
    if (
      task.owner !== undefined &&
      task.owner.windowInstanceId !== myWindowId &&
      task.owner.released !== true
    )
      throw new Error(TEAM_MODEL_TEXT.hostStopped)
    task.owner = { windowInstanceId: myWindowId }
    task.stallReassign = false
    if (running() >= deps.settings.maxWorkers())
      throw new Error(
        fill(TEAM_MODEL_TEXT.hostMaxWorkers, { max: String(deps.settings.maxWorkers()) }),
      )
    if (
      running(entry.id) >= entry.concurrent ||
      (task.isRaised ? !isUsable(entry) : !hasHeadroom(entry))
    )
      throw new Error(fill(TEAM_MODEL_TEXT.hostExhausted, { role: task.role.role }))
    const source = task.continueFrom
    if (
      source !== undefined &&
      (source.phase !== 'done' ||
        source.isBusy ||
        source.mergePhase !== 'idle' ||
        copyOwners.has(source.taskId))
    )
      throw new Error(TEAM_MODEL_TEXT.hostContinueNotReady)
    leases.set(task.taskId, entry.id)
    task.entry = entry
    // Every dispatch owns one zero-liability dispatch claim stamped at its
    // own start: the tasks cap counts attempts on the day they run, and a
    // Reset caps boundary counts attempts that start after it, never the
    // original task's start. Token and spend sums are untouched (zero usage).
    task.claims.push({
      ordinal: ++ordinal,
      attempt: task.schedulerAttempt,
      entryId: entry.id,
      atMs: deps.now(),
      usage: ZERO_USAGE,
      isSettled: true,
      reported: ZERO_USAGE,
      isDispatch: true,
    })
    task.phase = 'starting'
    if (source !== undefined) {
      copyOwners.add(source.taskId)
      source.phase = 'continued'
      task.workspace =
        source.workspace ??
        (source.outcome?.folder === undefined
          ? undefined
          : {
              folder: source.outcome.folder,
              baseCommit: source.outcome.baseCommit ?? '',
              branch: source.outcome.branch,
              agentsRef: source.outcome.agentsRef,
            })
    }
    let isReleased = false
    const lease = {
      release: (): void => {
        if (isReleased) return
        isReleased = true
        leases.delete(task.taskId)
        if (source !== undefined) copyOwners.delete(source.taskId)
      },
    }
    task.lease = lease
    return lease
  }

  const recordAccounting = async (task: TeamTaskRecord): Promise<void> => {
    if (task.schedulerAttempt === undefined) return
    const attempts = new Map<number, TeamUsage>()
    for (const claim of task.claims) {
      const number = claim.attempt ?? 1
      const liability = attempts.get(number) ?? ZERO_USAGE
      attempts.set(number, {
        input: liability.input + claim.usage.input,
        cachedInput: liability.cachedInput + claim.usage.cachedInput,
        output: liability.output + claim.usage.output,
        reasoning: liability.reasoning + claim.usage.reasoning,
        modelCalls: liability.modelCalls + claim.usage.modelCalls,
        estimated: liability.estimated || !claim.isSettled || claim.usage.estimated,
        costUsd: Usd.from(liability.costUsd ?? 0)
          .add(Usd.from(claim.usage.costUsd ?? 0))
          .toAmount(),
      })
    }
    if (attempts.size === 0) attempts.set(task.schedulerAttempt, task.usage)
    for (const [number, usage] of attempts) await scheduler?.usage(task.taskId, number, usage)
  }

  const reserveRequest = async (task: TeamTaskRecord, maximum: TeamUsage): Promise<number> => {
    admitRequest(task)
    const entry = task.entry
    if (entry === undefined) throw new Error(TEAM_MODEL_TEXT.hostStopped)
    const checked = teamUsageSchema.parse(maximum)
    for (const cap of entry.caps) {
      if (cap.measure === 'tasks' || task.isRaised) continue
      const used = capUsed(entry, cap, cap.window === 'task' ? task : undefined)
      const isExceeded =
        cap.measure === 'spendUsd'
          ? checked.costUsd === undefined ||
            compareUsdAmounts(
              sumUsd(
                ...claimsFor(entry, cap, cap.window === 'task' ? task : undefined)
                  .map((claim) => claim.usage.costUsd)
                  .filter((cost): cost is UsdAmount => cost !== undefined),
                checked.costUsd,
              ),
              canonicalUsd(cap.amount),
            ) > 0
          : used + measureOf(checked, cap) > cap.amount
      if (isExceeded) {
        task.capped = `${String(cap.amount)} ${cap.measure}/${cap.window}`
        throw new Error(fill(TEAM_MODEL_TEXT.hostCapReached, { cap: task.capped }))
      }
    }
    // Synchronous claim insertion makes concurrent requests see this liability.
    const requestOrdinal = ++ordinal
    task.claims.push({
      ordinal: requestOrdinal,
      attempt: task.schedulerAttempt,
      entryId: entry.id,
      atMs: deps.now(),
      usage: checked,
      isSettled: false,
    })
    try {
      await persist()
      await recordAccounting(task)
      admitRequest(task, true)
    } catch (error: unknown) {
      // Dispatch has not been authorized: even revocation during the save costs nothing.
      task.claims = task.claims.filter((claim) => claim.ordinal !== requestOrdinal)
      await persist()
      changed()
      throw error
    }
    changed()
    return requestOrdinal
  }

  const settleRequest = async (
    task: TeamTaskRecord,
    requestOrdinal: number,
    usage: TeamUsage,
    isFinal = false,
  ): Promise<void> => {
    const claim = task.claims.find((candidate) => candidate.ordinal === requestOrdinal)
    if (claim === undefined) throw new Error(TEAM_MODEL_TEXT.hostInvalidArguments)
    const reported = teamUsageSchema.parse(usage)
    claim.reported = reported
    // An incomplete report keeps the whole maximum as uncertain liability; only
    // a complete one (or a maximum that never named a cost) settles the claim.
    if (
      !reported.estimated &&
      (reported.costUsd !== undefined || claim.usage.costUsd === undefined)
    ) {
      claim.usage = reported
      claim.isSettled = true
    }
    if (isFinal) claim.isSettled = true
    let total: TeamUsage = ZERO_USAGE
    for (const item of task.claims) {
      const known = item.reported
      if (known === undefined) continue
      total = {
        input: total.input + known.input,
        cachedInput: total.cachedInput + known.cachedInput,
        output: total.output + known.output,
        reasoning: total.reasoning + known.reasoning,
        modelCalls: total.modelCalls + known.modelCalls,
        estimated: total.estimated || known.estimated,
        ...((total.costUsd !== undefined || known.costUsd !== undefined) && {
          costUsd: sumUsd(
            ...(total.costUsd === undefined ? [] : [total.costUsd]),
            ...(known.costUsd === undefined ? [] : [known.costUsd]),
          ),
        }),
      }
    }
    task.usage = total
    await persist()
    await recordAccounting(task)
    changed()
  }

  const noteUsage = async (task: TeamTaskRecord, usage: TeamUsage): Promise<void> => {
    const reported = teamUsageSchema.parse(usage)
    const delta: TeamUsage = {
      input: Math.max(0, reported.input - task.usage.input),
      cachedInput: Math.max(0, reported.cachedInput - task.usage.cachedInput),
      output: Math.max(0, reported.output - task.usage.output),
      reasoning: Math.max(0, reported.reasoning - task.usage.reasoning),
      modelCalls: Math.max(0, reported.modelCalls - task.usage.modelCalls),
      estimated: reported.estimated,
      ...(reported.costUsd !== undefined && {
        costUsd: maxUsdZero(
          Usd.from(reported.costUsd).subtract(Usd.from(task.usage.costUsd ?? canonicalUsd(0))),
        ),
      }),
    }
    if (
      delta.modelCalls === 0 &&
      delta.input === 0 &&
      delta.output === 0 &&
      (delta.costUsd === undefined || compareUsdAmounts(delta.costUsd, canonicalUsd(0)) === 0)
    )
      return
    const claim = task.claims.at(-1)
    if (claim !== undefined && !claim.isSettled) {
      await settleRequest(task, claim.ordinal, delta)
      return
    }
    task.claims.push({
      ordinal: ++ordinal,
      attempt: task.schedulerAttempt,
      entryId: task.entry?.id,
      atMs: deps.now(),
      usage: delta,
      reported: delta,
      isSettled: !delta.estimated,
    })
    task.usage = reported
    await persist()
    await recordAccounting(task)
    changed()
  }

  const agentProfile = (entry: StaffedEntry): TeamAgentProfile => ({
    key: `${entry.agent.kind}:${entry.agent.agentId}`,
    kind: entry.agent.kind,
    billing: entry.agent.pays,
    modelId: entry.agent.model,
    label: entry.agent.model,
  })
  const taskHookFields = (task: TeamTaskRecord) => {
    const entry = task.entry
    if (entry === undefined) throw new Error(TEAM_MODEL_TEXT.hostStopped)
    return {
      subagentId: task.taskId,
      childSessionId: task.childSessionId,
      roleId: task.role.role,
      entryId: entry.id,
      agentProfileId: agentProfile(entry).key,
      provider: entry.agent.provider,
      taskId: task.taskId,
      parentSessionId: task.sessionId,
      workspaceMode: roleMode(task.role),
      branch: task.workspace?.branch ?? task.outcome?.branch,
      workingCopyPath:
        task.workspace?.folder === undefined
          ? undefined
          : deps.hooks?.relativePath(task.workspace.folder),
      pipelineId: task.pipelineId,
      depth: 1,
      model: entry.agent.model,
      modelProvider: entry.agent.provider ?? entry.agent.agentId,
    }
  }
  const switchEntry = async (task: TeamTaskRecord, entry: StaffedEntry): Promise<void> => {
    const key = `${task.sessionId}:${task.role.role}`
    const previous = selectedEntries.get(key)
    if (previous !== undefined && previous.id !== entry.id) {
      const cap = previous.caps.find((item) => capUsed(previous, item) >= item.amount)
      let lastRefusal: TeamEntryExhaustion | undefined
      if (cap !== undefined)
        lastRefusal = { entryId: previous.id, reason: 'cap', cap, used: capUsed(previous, cap) }
      else if (!isUsable(previous)) lastRefusal = { entryId: previous.id, reason: 'unavailable' }
      else if (running(previous.id) >= previous.concurrent)
        lastRefusal = { entryId: previous.id, reason: 'concurrent' }
      const change = recordTeamSwitch(
        {
          roleId: task.role.role,
          entries: [],
          policy: task.role.exhausted ?? TEAM_EXHAUSTED_DEFAULT,
          continueOnNext: false,
        },
        previous.id,
        {
          kind: 'selected',
          entry: { ...entry, agent: agentProfile(entry) },
          agent: agentProfile(entry),
        },
        lastRefusal,
        task.taskId,
      )
      if (change !== undefined) {
        deps.cards.show(task.sessionId, {
          itemId: `team-switch-${task.taskId}`,
          kind: 'teamSwitch',
          status: 'completed',
          teamSwitch: {
            roleId: change.roleId,
            fromEntry: change.fromEntryId,
            toEntry: change.toEntryId,
            reason: switchReasonText(change),
          },
        })
        const dispatch = await deps.hooks?.fire(
          task.sessionId,
          'TeamAgentSwitch',
          teamAgentSwitchFields(
            switchHookPayload(change, agentProfile(previous), agentProfile(entry), task.sessionId),
          ),
          task.role.role,
          task.controller.signal,
        )
        if (dispatch?.refusedReason !== undefined) {
          exhaustedHookRoles.add(key)
          throw new Error(dispatch.refusedReason)
        }
      }
    }
    selectedEntries.set(key, entry)
  }

  const finish = async (
    task: TeamTaskRecord,
    phase: TaskPhase,
    failure?: string,
  ): Promise<void> => {
    // Stop owns cancellation; a late handoff still owns its retained copy.
    if (task.controller.signal.aborted) task.phase = hasCopy(task) ? 'interrupted' : 'stopped'
    else task.phase = phase
    task.endMs = deps.now()
    if (failure !== undefined) task.failure = failure
    const previous = task.continueFrom
    if (previous?.phase === 'continued' && task.outcome?.folder === undefined) {
      previous.phase = 'done'
      task.workspace = undefined
    }
    if (!task.hasStoppedHook && task.entry !== undefined) {
      task.hasStoppedHook = true
      await deps.hooks?.fire(
        task.sessionId,
        'SubagentStop',
        teamSubagentStopFields(taskHookFields(task)),
        task.role.role,
        undefined,
      )
    }
    settleReview(task)
    await persist()
    changed()
  }

  type LaunchInput = Parameters<TeamSchedulingDeps['launch']>[2]
  /** A final-admission refusal: the worker was never invoked, so the window
  refunds the admission instead of marking it uncertain. */
  class FinalAdmissionRefusal extends Error {
    readonly code = 'teamFinalAdmissionRefused'
  }
  const finalRefusal = (message: string): Error => new FinalAdmissionRefusal(message)
  /**
  The only admission that launches a worker. It runs before any await and
  again after the last one (host persistence): a pause, a lost governor
  slot, or flipped trust during any await means no launch. Entry headroom
  counts minus this reservation's own slot and lease.
  */
  const finalAdmit = (task: TeamTaskRecord, hasStarted: boolean): void => {
    if (isClosed() || task.controller.signal.aborted || task.stallReassign)
      throw finalRefusal(TEAM_MODEL_TEXT.hostStopped)
    if (!deps.settings.isTrusted()) throw finalRefusal(TEAM_MODEL_TEXT.hostUntrusted)
    if (saveFailure !== undefined) throw saveFailure
    const entry = task.entry
    if (entry === undefined) throw new Error(TEAM_MODEL_TEXT.hostStopped)
    if (rawScheduler?.snapshot().paused === true)
      throw finalRefusal(UI_TEXT.teamTrafficNotices.queuePaused)
    if (running() > deps.settings.maxWorkers())
      throw finalRefusal(
        fill(TEAM_MODEL_TEXT.hostMaxWorkers, { max: String(deps.settings.maxWorkers()) }),
      )
    if (running(entry.id) > entry.concurrent)
      throw finalRefusal(fill(TEAM_MODEL_TEXT.hostExhausted, { role: task.role.role }))
    if (deps.capacity !== undefined && !isResourceSlotAvailable(deps.capacity, 'worker', true))
      throw finalRefusal(fill(TEAM_MODEL_TEXT.hostExhausted, { role: task.role.role }))
    // Request admission only once the task runs: reservations admit at launch.
    // A cap refusal here still precedes the worker, so it refunds as well.
    if (hasStarted) {
      try {
        admitRequest(task)
      } catch (error: unknown) {
        throw new FinalAdmissionRefusal(error instanceof Error ? error.message : String(error), {
          cause: error,
        })
      }
    }
  }
  const launch = async (task: TeamTaskRecord, input?: LaunchInput): Promise<void> => {
    finalAdmit(task, false)
    const entry = task.entry
    if (entry === undefined || task.lease === undefined)
      throw new Error(TEAM_MODEL_TEXT.hostStopped)
    task.phase = 'running'
    task.writerModels = [
      ...new Set([...(task.continueFrom?.writerModels ?? []), entry.agent.model]),
    ]
    await persist()
    // The world may have moved during persistence: re-admit before launch.
    // A refusal requeues the unstarted task instead of stranding it running.
    try {
      finalAdmit(task, true)
    } catch (error: unknown) {
      task.phase = 'queued'
      await persist()
      changed()
      throw error
    }
    // execute owns the lease until worker teardown and the final durable handoff.
    const execute = async (): Promise<void> => {
      try {
        await switchEntry(task, entry)
        const start = await deps.hooks?.fire(
          task.sessionId,
          'SubagentStart',
          teamSubagentStartFields(taskHookFields(task)),
          task.role.role,
          task.controller.signal,
        )
        if (start?.refusedReason !== undefined) throw new Error(start.refusedReason)
        const taskSpec: TeamTaskSpec = {
          taskId: task.taskId,
          role: task.role,
          entry,
          // A stall handoff rides once, ahead of the original brief.
          brief:
            task.handoffBrief === undefined ? task.brief : `${task.handoffBrief}\n${task.brief}`,
          parentReports: input?.reports.map((report) => ({
            taskId: report.taskId,
            text: report.text,
          })),
          files: task.files,
          parentSessionId: task.sessionId,
          continueFrom: task.retryFrom ?? task.continueFrom?.outcome,
          reviewOf: task.reviewOf?.outcome,
          meter: {
            noteSession: (sessionId) => {
              task.childSessionId = sessionId
              task.handoffBrief = undefined
              // A started worker is alive: feed the stall detector.
              rawScheduler?.noteActivity({
                taskId: task.taskId,
                attempt: task.schedulerAttempt ?? 0,
              })
            },
            admitRequest: (hasReservation) => {
              admitRequest(task, hasReservation === true)
            },
            reserveRequest: (maximum) => reserveRequest(task, maximum),
            settleRequest: (requestOrdinal, usage, isFinal) =>
              settleRequest(task, requestOrdinal, usage, isFinal),
            noteUsage: (usage) => noteUsage(task, usage),
            noteWorkspace: async (workspace) => {
              task.workspace = workspace
              await persist()
              if (workspace !== undefined) admitRequest(task, true)
            },
          },
        }
        let outcome = await deps.workers.run(taskSpec, task.controller.signal)
        let continuations = 0
        while (
          deps.hooks !== undefined &&
          outcome.isCeilingReached === false &&
          outcome.folder !== undefined &&
          task.capped === undefined &&
          !task.controller.signal.aborted &&
          continuations < stopContinuationLimitFor(deps.settings.maxStopContinuations?.() ?? 0)
        ) {
          const siblings = allTasks().filter(
            (other) =>
              other !== task &&
              other.delegateGroup !== undefined &&
              other.delegateGroup === task.delegateGroup &&
              other.sessionId === task.sessionId &&
              other.phase === 'running',
          ).length
          if (siblings === 0) break
          try {
            admitRequest(task)
          } catch {
            // Admission refused: stop draining behind the refused task; a
            // later open or reload retries the queue.
            break
          }
          const idle = await deps.hooks.fire(
            task.sessionId,
            'TeammateIdle',
            teammateIdleFields({
              name: task.taskId,
              siblingsRunning: siblings,
              team: {
                teammateName: task.taskId,
                roleId: task.role.role,
                entryId: entry.id,
                agentProfileId: agentProfile(entry).key,
                taskId: task.taskId,
                parentSessionId: task.sessionId,
              },
            }),
            task.taskId,
            task.controller.signal,
          )
          if (!idle.keepWorking) break
          admitRequest(task)
          continuations += 1
          outcome = await deps.workers.run(
            { ...taskSpec, continueFrom: outcome },
            task.controller.signal,
          )
        }
        task.outcome =
          task.capped === undefined
            ? outcome
            : { ...outcome, report: { ...outcome.report, status: 'capped' } }
        if (outcome.folder === undefined) task.workspace = undefined
        await noteUsage(task, outcome.usage)
        await finish(
          task,
          outcome.report.status === 'failed' && outcome.folder === undefined ? 'failed' : 'done',
        )
      } catch (error: unknown) {
        // The failure is recorded on the task; the log carries only the
        // redacted kind (raw text can name paths).
        deps.log.warn(failureForLog(error))
        await finish(task, 'failed', task.capped ?? describeError(error))
      } finally {
        const retirement = deps.workers.retirement?.(task.taskId)
        const isFailed =
          !task.controller.signal.aborted &&
          (task.phase === 'failed' ||
            task.outcome?.report.status === 'failed' ||
            task.capped !== undefined)
        const policy = deps.settings.scheduler?.()
        if (retirement !== undefined || task.schedulerAttempt === undefined) {
          task.lease?.release()
          if (retirement !== undefined && task.schedulerAttempt !== undefined) {
            let state: 'done' | 'review' | 'failed' | 'cancelled' | 'blocked' = 'cancelled'
            if (isFailed) state = policy?.onStall === 'stop' ? 'failed' : 'blocked'
            else if (task.phase === 'done') state = hasCopy(task) ? 'review' : 'done'
            await scheduler?.finish(task.taskId, state, retirement)
            // A detector-flagged run retires into the retry pin even when its
            // teardown was an abort rather than a failure; a run that reached
            // done is never retried.
            const shouldReassign = isFailed || (task.stallReassign && task.phase !== 'done')
            if (shouldReassign && policy?.onStall !== 'stop') {
              const decision =
                policy?.onStall === 'reassign'
                  ? 'reassign'
                  : ((await deps.onStall?.(task.taskId)) ?? 'stop')
              if (
                decision === 'reassign' &&
                !isClosed() &&
                deps.settings.isTrusted() &&
                !isTaskStopped(task)
              ) {
                const keyEntries = pool(task.role).filter(
                  (entry) => entry.agent.pays === 'key' && hasHeadroom(entry),
                )
                const context = {
                  sessionId: task.sessionId,
                  approvalMode: modeOf(task) ?? '',
                  signal: task.controller.signal,
                }
                const isAllowed =
                  keyEntries.length === 0 ||
                  (await deps.paid.allowKeyTasks(
                    keyEntries.map((entry) => confirmationFor(task.role.role, entry)),
                    undefined,
                    context,
                  ))
                if (isAllowed && deps.settings.isTrusted() && !isTaskStopped(task)) {
                  // The popup just quoted every key entry with headroom: its
                  // grant joins the task, otherwise a key-billed retry could
                  // never dispatch. The retry pins to a different entry when
                  // one can run it, so a failed model is not selected again.
                  const failedId = task.entry?.id
                  task.consented = new Set([
                    ...task.consented,
                    ...keyEntries.map((entry) => paidScope(entry.agent)),
                  ])
                  const next = pool(task.role).find(
                    (candidate) =>
                      candidate.id !== failedId &&
                      hasHeadroom(candidate) &&
                      (candidate.agent.pays !== 'key' ||
                        keyEntries.some((key) => key.id === candidate.id)),
                  )
                  if (next !== undefined) task.selectedEntry = next.id
                  task.retryFrom = task.outcome
                  task.phase = 'queued'
                  task.entry = undefined
                  task.lease = undefined
                  delete task.capped
                  await persist()
                  if (!(await scheduler?.retry(task.taskId))) {
                    task.phase = 'failed'
                    await persist()
                  }
                }
              }
            }
          }
        }
        const integrate = task.reviewOf ?? task
        if (
          !isFailed &&
          retirement !== undefined &&
          integrate.phase === 'done' &&
          policy?.integrationFlow !== undefined &&
          policy.integrationFlow !== 'manual' &&
          deps.state.get(TEAM_MERGE_PAUSE_STATE_KEY) !== true &&
          hasCopy(integrate)
        ) {
          enqueueMerge(
            integrate,
            integrate.sessionId,
            modeOf(integrate) ?? '',
            'rework',
            policy.integrationFlow === 'reviewAutomatically',
            integrate.controller.signal,
          )
        }
        changed()
      }
    }
    const executing = (async () => {
      try {
        await execute()
        await pump()
      } catch (error: unknown) {
        task.failure = describeError(error)
        deps.log.warn(`Team task ${task.taskId}: ${task.failure}`)
        changed()
      } finally {
        executions.delete(task.taskId)
      }
    })()
    executions.set(task.taskId, executing)
  }

  async function pump(): Promise<void> {
    if (saveFailure !== undefined || isClosed()) return
    if (scheduler !== undefined) {
      await scheduler.wake()
      return
    }
    for (const task of allTasks()) {
      if (task.phase !== 'queued') continue
      const isConsented = (candidate: StaffedEntry): boolean =>
        candidate.agent.pays !== 'key' || task.consented.has(paidScope(candidate.agent))
      const entry = pool(task.role).find(
        (candidate) => isConsented(candidate) && hasHeadroom(candidate),
      )
      if (entry === undefined) continue
      let isLaunched = false
      try {
        admit(task, entry)
        await launch(task)
        isLaunched = true
      } catch (error: unknown) {
        deps.log.warn(failureForLog(error))
        if (task.lease !== undefined) {
          task.phase = 'failed'
          task.failure = describeError(error)
          await persist()
        }
      } finally {
        if (!isLaunched) task.lease?.release()
      }
    }
    changed()
  }

  const record = (
    role: TeamRoleConfig,
    item: Pick<DelegateItem, 'brief' | 'files' | 'reason'>,
    sessionId: string,
    phase: TaskPhase,
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
      entry: undefined,
      phase,
      usage: ZERO_USAGE,
      claims: [],
      ordinal: ++ordinal,
      owner: undefined,
      stallReassign: false,
      isRaised: false,
      writerModels: [],
      mergePhase: 'idle',
      consented: new Set(),
      isBusy: false,
    }
    tasks.set(task.taskId, task)
    return task
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
      if (
        role === undefined ||
        (builtinRole(item.role) === undefined &&
          (role.purpose?.trim() === undefined ||
            role.purpose.trim() === '' ||
            role.workspace === undefined ||
            role.tools === undefined ||
            role.report === undefined))
      ) {
        return { item, refused: fill(TEAM_MODEL_TEXT.hostRoleNotOffered, { role: item.role }) }
      }
      if (roleMode(role) === 'in-place') {
        return { item, refused: TEAM_MODEL_TEXT.hostInPlaceNotOffered }
      }
      if (exhaustedHookRoles.has(`${context.sessionId}:${role.role}`))
        return { item, refused: fill(TEAM_MODEL_TEXT.hostExhausted, { role: role.role }) }
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
      dequeueMerge(task.taskId, 'withdrawn')
      settleMergeTurn(task.taskId, undefined)
      if (task.schedulerAttempt !== undefined) await scheduler?.landed(task.taskId, 'discarded')
      task.endMs ??= deps.now()
      await persist()
    })
  }

  const stop = async (task: TeamTaskRecord): Promise<void> => {
    dequeueMerge(task.taskId, 'withdrawn')
    settleMergeTurn(task.taskId, undefined)
    if (isActive(task.phase) || task.phase === 'queued') {
      task.controller.abort()
      const wasQueued = task.phase === 'queued'
      await finish(task, 'stopped')
      if (wasQueued && scheduler !== undefined)
        await scheduler.finish(task.taskId, 'cancelled', { kind: 'userDecision' })
    } else if (SETTLED_PHASES.has(task.phase)) {
      task.controller.abort()
      task.awaiting?.('cancelled')
      if (task.mergeCompletion !== undefined && task.mergePhase === 'awaiting-decision')
        await task.mergeCompletion
      if (hasCopy(task)) await discard(task)
      else {
        task.phase = 'discarded'
        await persist()
        changed()
      }
    }
  }

  /** The conversation's approval mode now, or the call's when no surface reports it. */
  const modeOf = (task: TeamTaskRecord, fallback?: string): string | undefined => {
    const live =
      deps.orchestrator.approvalMode === undefined
        ? fallback
        : deps.orchestrator.approvalMode(task.sessionId)
    if (live === undefined) return undefined
    return live === 'denyUnmatched' || fallback === 'denyUnmatched' ? 'denyUnmatched' : live
  }

  /** One gate for every merge, from the model or the tree: refused in Plan and untrusted. */
  const mergeRefusal = (task: TeamTaskRecord, mode: string | undefined): string | undefined => {
    if (!deps.settings.isTrusted()) return TEAM_MODEL_TEXT.hostUntrusted
    if (mode === undefined) return TEAM_MODEL_TEXT.hostMergeNoConversation
    if (mode === 'denyUnmatched') return TEAM_MODEL_TEXT.hostMergePlanMode
    if (task.isBusy || ['reviewing', 'awaiting-decision', 'merging'].includes(task.mergePhase))
      return TEAM_MODEL_TEXT.hostTaskBusy
    return task.phase !== 'done' ||
      task.outcome?.branch === undefined ||
      task.awaiting !== undefined
      ? TEAM_MODEL_TEXT.hostMergeNotReady
      : undefined
  }

  const checkMergeOwner = (task: TeamTaskRecord, context: TeamToolContext): void => {
    context.signal.throwIfAborted()
    if (isClosed() || task.controller.signal.aborted)
      throw new Error(TEAM_MODEL_TEXT.hostMergeCancelled)
    if (!deps.settings.isTrusted()) throw new Error(TEAM_MODEL_TEXT.hostUntrusted)
    const mode = modeOf(task, context.approvalMode)
    if (mode === undefined) throw new Error(TEAM_MODEL_TEXT.hostMergeNoConversation)
    if (mode === 'denyUnmatched') throw new Error(TEAM_MODEL_TEXT.hostMergePlanMode)
  }

  /** The merge flow's strings, filled here so the lazy bundle never reads model text. */
  const reviewText = {
    brief: (taskId: string, role: string, brief: string): string =>
      fill(TEAM_MODEL_TEXT.hostReviewBrief, { task: taskId, role, brief }),
    reason: TEAM_MODEL_TEXT.hostReviewReason,
    running: (taskId: string): string => fill(TEAM_MODEL_TEXT.hostReviewRunning, { task: taskId }),
    started: (taskId: string): string => fill(TEAM_MODEL_TEXT.hostReviewStarted, { task: taskId }),
    paidDeclined: TEAM_MODEL_TEXT.hostPaidDeclined,
    mergeNotReady: TEAM_MODEL_TEXT.hostMergeNotReady,
    mergeCancelled: TEAM_MODEL_TEXT.hostMergeCancelled,
  }

  /** Own review admission and exactly one card waiter through final settlement. */
  const beginMerge = (
    task: TeamTaskRecord,
    context: TeamToolContext,
    shouldOnlyReview = false,
  ): Promise<TeamToolResult> => {
    const refused = mergeRefusal(task, modeOf(task, context.approvalMode))
    if (refused !== undefined) return Promise.resolve(refusal(refused))
    task.mergePhase = 'reviewing'
    context = { ...context, signal: AbortSignal.any([context.signal, task.controller.signal]) }
    // The flow loads lazily; the guard and phase claim above already ran here.
    const completion = (async (): Promise<TeamToolResult> => {
      let runMergeFlow: typeof teamMergeFlow.runMergeFlow
      try {
        ;({ runMergeFlow } = await import('./teamMergeFlow'))
      } catch (error: unknown) {
        // A missing lazy bundle is an install fault: refuse without hanging the card.
        deps.log.warn(failureForLog(error))
        task.mergePhase = 'failed'
        task.failure = describeError(error)
        task.mergeReady?.()
        return refusal(task.failure)
      }
      return await runMergeFlow(task, context, {
        record,
        shouldOnlyReview,
        landed: async (id, state) => {
          await scheduler?.landed(id, state)
        },
        scheduleReview:
          scheduler === undefined
            ? undefined
            : async (review, reviewer, reviewContext) => {
                checkMergeOwner(review.reviewOf ?? review, reviewContext)
                if (
                  reviewer.agent.pays === 'key' &&
                  !(await deps.paid.allowKeyTasks(
                    [confirmationFor(REVIEW_ROLE, reviewer)],
                    undefined,
                    reviewContext,
                  ))
                )
                  return false
                checkMergeOwner(review.reviewOf ?? review, reviewContext)
                review.phase = 'queued'
                review.selectedEntry = reviewer.id
                review.consented = new Set([paidScope(reviewer.agent)])
                await persist()
                await scheduler.submit([
                  {
                    id: review.taskId,
                    sessionId: review.sessionId,
                    roleId: review.role.role,
                    fields: { priority: 'normal', size: 'M', overlap: 'serialize' },
                  },
                ])
                return true
              },
        admit,
        launch,
        persist,
        changed,
        discard,
        exclusive,
        checkOwner: checkMergeOwner,
        confirmReview: (entry) =>
          confirmationFor(REVIEW_ROLE, entry, deps.workers.rates?.(entry.agent)),
        agentScope: (agent) => paidScope(agent),
        forget: (taskId: string): void => {
          tasks.delete(taskId)
        },
        reviewStaff: () => {
          const role = roles().find((candidate) => candidate.role === REVIEW_ROLE)
          return role === undefined ? undefined : { role, entries: pool(role) }
        },
        hasReviewRoom: (entry) => running() < deps.settings.maxWorkers() && hasHeadroom(entry),
        findRunningReview: (of) =>
          allTasks().find(
            (candidate) =>
              candidate.reviewOf === of &&
              (isActive(candidate.phase) || candidate.phase === 'queued'),
          ),
        answer,
        refusal,
        noteMergeRefusal: (taskId, value) => {
          if (value === undefined) mergeRefusals.delete(taskId)
          else mergeRefusals.set(taskId, value)
          changed()
        },
        noteCardOpen: (taskId) => {
          mergeTurns.get(taskId)?.cardResolve()
        },
        describeError,
        paid: deps.paid,
        cards: deps.cards,
        merges: deps.merges,
        text: reviewText,
      })
    })()
    task.mergeCompletion = completion
    return task.mergeCompletion
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
      if (scheduler !== undefined) {
        const parsedScheduled = delegateArgs.parse(args)
        const scheduledGroup = `${context.sessionId}:delegate:${String(++delegateOrdinal)}`
        const scheduledPipeline = parsedScheduled.pipeline ?? scheduledGroup
        return await runScheduledDelegate(settledSteps, context, {
          scheduler,
          deps,
          allTasks,
          pool,
          isUsable,
          confirmationFor,
          isClosed,
          record: (role, item, sessionId, phase) => {
            const task = record(role, item, sessionId, phase)
            task.delegateGroup = scheduledGroup
            task.pipelineId = scheduledPipeline
            return task
          },
          paidScope,
          persist,
          taskView,
          answer,
          refusal,
          describeError,
          forget: (id) => {
            tasks.delete(id)
          },
        })
      }
      const placedCount = settledSteps.filter((step) => 'entry' in step).length
      if (running() + placedCount > deps.settings.maxWorkers()) {
        return refusal(
          fill(TEAM_MODEL_TEXT.hostMaxWorkers, { max: String(deps.settings.maxWorkers()) }),
        )
      }
      // NOLIMITS4: the queue itself is unbounded; every task waits for headroom.
      const parsedGroup = delegateArgs.parse(args)
      const delegateGroup = `${context.sessionId}:delegate:${String(++delegateOrdinal)}`
      const pipelineId = parsedGroup.pipeline ?? delegateGroup
      const reserved = new Map<PlanStep, TeamTaskRecord>()
      let hasStarted = false
      try {
        // Every launch path uses admit; the source copy is owned across consent.
        const steps = settledSteps.map((step): PlanStep => {
          if (!('entry' in step)) return step
          const entry =
            step.isRaised === true
              ? step.entry
              : pool(step.role).find(
                  (candidate) =>
                    (step.item.entry === undefined || candidate.id === step.item.entry) &&
                    hasHeadroom(candidate),
                )
          if (entry === undefined)
            return {
              item: step.item,
              refused: fill(TEAM_MODEL_TEXT.hostExhausted, { role: step.item.role }),
            }
          const task = record(step.role, step.item, context.sessionId, 'starting')
          task.delegateGroup = delegateGroup
          task.pipelineId = pipelineId
          task.continueFrom = step.continueFrom
          task.isRaised = step.isRaised === true
          try {
            admit(task, entry)
            reserved.set(step, task)
            return step
          } catch (error: unknown) {
            deps.log.warn(failureForLog(error))
            tasks.delete(task.taskId)
            return { item: step.item, refused: describeError(error) }
          }
        })
        await persist()
        const named = new Map<PlanStep, readonly StaffedEntry[]>()
        for (const step of steps) {
          const task = reserved.get(step)
          if (task?.entry?.agent.pays === 'key') named.set(step, [task.entry])
          if ('queue' in step)
            named.set(
              step,
              pool(step.role).filter((entry) => entry.agent.pays === 'key' && isUsable(entry)),
            )
        }
        const confirmations = [...named].flatMap(([step, entries]) =>
          entries.map((entry) =>
            confirmationFor(step.item.role, entry, deps.workers.rates?.(entry.agent)),
          ),
        )
        context.signal.throwIfAborted()
        if (
          confirmations.length > 0 &&
          !(await deps.paid.allowKeyTasks(confirmations, undefined, context))
        )
          return refusal(TEAM_MODEL_TEXT.hostPaidDeclined)
        if (isClosed() || context.signal.aborted) return refusal(TEAM_MODEL_TEXT.hostStopped)
        const started = []
        for (const step of steps) {
          if ('refused' in step) {
            started.push({ role: step.item.role, refused: step.refused })
            continue
          }
          const task = reserved.get(step)
          if (task?.entry !== undefined) {
            task.consented = new Set([paidScope(task.entry.agent)])
            await launch(task)
            reserved.delete(step)
            started.push(taskView(task))
          } else if ('queue' in step) {
            const queued = record(step.role, step.item, context.sessionId, 'queued')
            queued.delegateGroup = delegateGroup
            queued.pipelineId = pipelineId
            queued.consented = new Set(
              (named.get(step) ?? []).map((entry) => paidScope(entry.agent)),
            )
            await persist()
            started.push(taskView(queued))
          }
        }
        hasStarted = true
        await pump()
        changed()
        return answer(
          { tasks: started },
          fill(UI_TEXT.teamTasksStarted, {
            count: String(started.filter((step) => 'task_id' in step).length),
          }),
        )
      } catch (error: unknown) {
        return refusal(describeError(error))
      } finally {
        for (const task of reserved.values()) {
          task.lease?.release()
          if (task.continueFrom !== undefined) task.continueFrom.phase = 'done'
          tasks.delete(task.taskId)
        }
        if (!hasStarted) {
          try {
            await persist()
          } catch (error: unknown) {
            deps.log.warn(failureForLog(error))
          }
          changed()
        }
      }
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
          deps.log.warn(failureForLog(error))
          results.push({ task_id: id, refused: describeError(error) })
        }
      }
      return answer({ tasks: results }, '')
    },
    merge: (args, context) => {
      const parsed = mergeArgs.safeParse(args)
      if (!parsed.success) return Promise.resolve(refusal(TEAM_MODEL_TEXT.hostInvalidArguments))
      const task = ownTask(parsed.data.task_id, context)
      if (task === undefined) return Promise.resolve(refusal(TEAM_MODEL_TEXT.hostUnknownTask))
      const mode = modeOf(task, context.approvalMode)
      const refused = mergeRefusal(task, mode)
      if (refused !== undefined) return Promise.resolve(refusal(refused))
      const position = enqueueMerge(
        task,
        context.sessionId,
        mode ?? '',
        parsed.data.on_conflict ?? 'rework',
        false,
        context.signal,
      )
      return Promise.resolve(answer({ task_id: task.taskId, position }, ''))
    },
    reschedule: async (args, context) => {
      const parsed = teamRescheduleSchema.safeParse(args)
      if (!parsed.success) return refusal(TEAM_MODEL_TEXT.hostInvalidArguments)
      context.signal.throwIfAborted()
      if (scheduler === undefined) return refusal(UI_TEXT.teamTaskUnknown)
      try {
        await scheduler.reschedule(parsed.data)
      } catch (error: unknown) {
        return refusal(describeError(error))
      }
      return answer({ rescheduled: parsed.data.task_ids }, '')
    },
  }

  const known = (taskId: string): TeamTaskRecord => {
    const task = tasks.get(taskId)
    if (task === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
    return task
  }

  /**
  The stall detector's handoff: a run that stopped emitting while pending
  is aborted so its teardown retires it with proof, and the teardown
  reaches the retry pin (with the previous outcome as its checkpoint).
  Stale reports (the attempt already moved on) are ignored.
  */
  const onStallDetected = (ref: { taskId: string; attempt: number }): Promise<void> => {
    const task = tasks.get(ref.taskId)
    if (task?.schedulerAttempt !== ref.attempt) return Promise.resolve()
    if (task.phase !== 'running' && task.phase !== 'starting') return Promise.resolve()
    task.stallReassign = true
    task.controller.abort()
    // The retry needs a live signal: the aborted one stays with the torn-down run.
    task.controller = new AbortController()
    return Promise.resolve()
  }
  const rawScheduler: TeamSchedulingPort | undefined = deps.createScheduler?.({
    capacity: deps.capacity,
    sharedFiles: () => deps.settings.scheduler?.().sharedFiles ?? [],
    workspaceId: deps.workspaceId ?? 'workspace',
    windowInstanceId: myWindowId,
    ...(deps.ownerBirth !== undefined && { ownerBirth: deps.ownerBirth }),
    ...(deps.probeOwner !== undefined && { probeOwner: deps.probeOwner }),
    onStallDetected,
    state: deps.state,
    now: deps.now,
    limits: () => ({
      workers: deps.settings.maxWorkers(),
      // Process-backed workers share the person's worker ceiling; a separate
      // zero here would hard-code a limit no provider or setting chose.
      processWorkers: deps.settings.maxWorkers(),
      role: () => deps.settings.maxWorkers(),
      entry: (id) =>
        roles()
          .flatMap((role) => pool(role))
          .find((entry) => entry.id === id)?.concurrent ?? 0,
      agent: () => deps.settings.maxWorkers(),
    }),
    entries: () =>
      roles().flatMap((role) =>
        pool(role).map((entry, index) => ({
          id: entry.id,
          roleId: role.role,
          agentProfileId: entry.agent.agentId,
          modelId: entry.agent.model,
          kind: entry.agent.kind,
          poolFit: 1 / (index + 1),
          remainingDayTokens: Number.MAX_SAFE_INTEGER,
          eligible: (task) => task.roleId === role.role,
        })),
      ),
    mode: (id) => roleMode(known(id).role),
    report: (id) => known(id).outcome?.report.summary ?? '',
    canStart: (task, entry) => {
      const record = known(task.id)
      const candidate = pool(record.role).find((item) => item.id === entry.id)
      return (
        record.phase === 'queued' &&
        (record.selectedEntry === undefined || record.selectedEntry === entry.id) &&
        candidate !== undefined &&
        hasHeadroom(candidate) &&
        (candidate.agent.pays !== 'key' || record.consented.has(paidScope(candidate.agent)))
      )
    },
    admit: (task, entry) => {
      const record = known(task.id)
      const candidate = pool(record.role).find(
        (item) => item.id === entry.id && item.agent.model === entry.modelId,
      )
      // Consent binds the dispatch, not just the pick: a restored task with
      // no renewed consent cannot start an attempt on a key-billed entry.
      if (
        candidate === undefined ||
        (candidate.agent.pays === 'key' && !record.consented.has(paidScope(candidate.agent)))
      )
        return false
      try {
        admit(record, candidate)
        record.schedulerAttempt = task.currentAttempt
        return true
      } catch (error: unknown) {
        deps.log.warn(failureForLog(error))
        return false
      }
    },
    refund: (id) => {
      const task = known(id)
      task.lease?.release()
      task.lease = undefined
      task.phase = 'queued'
      task.entry = undefined
    },
    authorize: (task, entry) =>
      Promise.resolve(
        !isClosed() &&
          deps.settings.isTrusted() &&
          !known(task.id).controller.signal.aborted &&
          pool(known(task.id).role).some(
            (candidate) =>
              candidate.id === entry.id &&
              hasHeadroom(candidate) &&
              (candidate.agent.pays !== 'key' ||
                known(task.id).consented.has(paidScope(candidate.agent))),
          ),
      ),
    launch: async (task, _entry, input) => {
      await launch(known(task.id), input)
    },
    retirement: {
      evidence: (ref) => {
        const task = known(ref.taskId)
        const boardAttempt = rawScheduler
          ?.snapshot()
          .tasks.find((item) => item.id === ref.taskId)
          ?.attempts.find((attempt) => attempt.number === ref.attempt)
        const proof = deps.workers.retirement?.(ref.taskId)
        const isProved = proof?.kind === 'proved'
        const method = isProved ? proof.method : 'unproved'
        return {
          windowInstanceId: myWindowId,
          ref,
          kind: boardAttempt?.kind ?? task.entry?.agent.kind ?? 'engine',
          loopStopped: !executions.has(ref.taskId),
          turnTerminal: task.outcome !== undefined,
          itemsTerminal: task.outcome !== undefined,
          promptAnswered: task.outcome !== undefined,
          isReadOnlyMuse:
            (boardAttempt?.kind ?? task.entry?.agent.kind) === 'museCode' &&
            roleMode(task.role) === 'read-only',
          hostExited: isProved,
          processes: [
            {
              childExited: !executions.has(ref.taskId),
              descendantsEnded: isProved,
              method,
            },
          ],
          containerMethod: method,
        }
      },
      cancel: (ref) => {
        known(ref.taskId).controller.abort()
        return Promise.resolve()
      },
      changed: (_ref, signal) =>
        new Promise((resolve) => {
          if (signal.aborted) {
            resolve()
            return
          }
          const wake = (): void => {
            waiters.delete(wake)
            resolve()
          }
          waiters.add(wake)
          signal.addEventListener(
            'abort',
            () => {
              waiters.delete(wake)
              resolve()
            },
            { once: true },
          )
        }),
      escalate: async (ref) => {
        const task = known(ref.taskId)
        task.controller.abort()
        await executions.get(ref.taskId)
      },
      quarantine: async (ref) => {
        // The copy is never a continue source again; the board keeps the
        // attempt counted until a decision or proof releases it.
        copyOwners.add(ref.taskId)
        await persist()
      },
      canQuarantine: (ref) => hasCopy(known(ref.taskId)),
      restartWorkers: async () => {
        for (const task of allTasks())
          if (isActive(task.phase) || task.phase === 'starting') task.controller.abort()
        await Promise.allSettled(executions.values())
      },
      checkpoint: (ref) => {
        const task = known(ref.taskId)
        return Promise.resolve({
          commit: task.outcome?.head ?? task.workspace?.baseCommit ?? '',
          files: task.outcome?.changedFiles ?? task.files,
          diffStat: task.outcome?.report.summary ?? '',
        })
      },
      settleUsage: async (ref) => {
        await recordAccounting(known(ref.taskId))
      },
      isKeyEntry: (entryId) =>
        roles().some((role) =>
          pool(role).some((entry) => entry.id === entryId && entry.agent.pays === 'key'),
        ),
      consentEntry: async (ref, entry) => {
        const task = known(ref.taskId)
        const candidate = pool(task.role).find((item) => item.id === entry.id)
        if (candidate === undefined) return false
        if (candidate.agent.pays !== 'key') return true
        return await deps.paid.allowKeyTasks(
          [confirmationFor(task.role.role, candidate)],
          undefined,
          {
            sessionId: task.sessionId,
            approvalMode: modeOf(task) ?? '',
            signal: task.controller.signal,
          },
        )
      },
      stallBrief: (ref) => {
        const task = known(ref.taskId)
        return {
          brief: task.brief,
          lastMessage: task.outcome?.report.summary ?? task.failure ?? '',
          toolCalls: [],
        }
      },
      applyReassignment: async (ref, entry, handoff) => {
        const task = known(ref.taskId)
        const candidate = pool(task.role).find((item) => item.id === entry.id)
        if (candidate === undefined) return false
        task.selectedEntry = entry.id
        if (candidate.agent.pays === 'key')
          task.consented = new Set([...task.consented, paidScope(candidate.agent)])
        task.retryFrom = task.outcome
        task.handoffBrief = `${handoff.instruction}\n${handoff.data.open}${handoff.data.lastMessage}${handoff.data.close}`
        task.phase = 'queued'
        task.entry = undefined
        task.lease = undefined
        delete task.capped
        await persist()
        return true
      },
      applyReplacement: async (ref, _replacementAttempt, checkpoint) => {
        const task = known(ref.taskId)
        if (task.outcome === undefined) return false
        // A fresh copy from the checkpoint commit; the old copy stays quarantined.
        task.retryFrom = {
          ...task.outcome,
          folder: undefined,
          branch: undefined,
          agentsRef: undefined,
          baseCommit: checkpoint.commit,
          head: checkpoint.commit,
        }
        task.workspace = undefined
        task.phase = 'queued'
        task.entry = undefined
        task.lease = undefined
        delete task.capped
        await persist()
        return true
      },
    },
    changed,
    failure: (error) => {
      deps.log.warn(describeError(error))
    },
  })

  /**
  Resume reconciles this run's restored interruptions, renews paid consent
  with the current price and budget, and only then unpauses the board:
  nothing restored dispatches on a previous run's consent. Tasks whose
  restored attempt provably never ran reopen; anything that may have run
  keeps its interrupted liability.
  */
  const reconcileRestored = async (): Promise<void> => {
    if (rawScheduler === undefined) return
    for (const id of restoredInterrupted) {
      const task = tasks.get(id)
      if (task?.phase !== 'interrupted') continue
      const boardTask = rawScheduler.snapshot().tasks.find((candidate) => candidate.id === id)
      if (boardTask === undefined || !(await rawScheduler.reopenInterrupted(id))) continue
      task.phase = 'queued'
      task.entry = undefined
      task.lease = undefined
      await persist()
      changed()
    }
  }

  /** Renew key-billed consent for queued tasks that may bill, before dispatch. */
  const renewConsent = async (): Promise<void> => {
    for (const task of allTasks()) {
      if (isClosed() || !deps.settings.isTrusted() || task.phase !== 'queued') continue
      const candidates = pool(task.role).filter(
        (entry) =>
          entry.agent.pays === 'key' &&
          isUsable(entry) &&
          (task.selectedEntry === undefined || entry.id === task.selectedEntry) &&
          !task.consented.has(paidScope(entry.agent)),
      )
      if (candidates.length === 0) continue
      const context = {
        sessionId: task.sessionId,
        approvalMode: modeOf(task) ?? '',
        signal: new AbortController().signal,
      }
      try {
        if (
          await deps.paid.allowKeyTasks(
            candidates.map((entry) => confirmationFor(task.role.role, entry)),
            undefined,
            context,
          )
        )
          task.consented = new Set([
            ...task.consented,
            ...candidates.map((entry) => paidScope(entry.agent)),
          ])
      } catch (error: unknown) {
        deps.log.warn(failureForLog(error))
        // A failed renewal leaves the task queued without consent: the
        // admission gates below refuse it until Resume asks again.
      }
    }
    await persist()
    changed()
  }

  const scheduler: TeamSchedulingPort | undefined =
    rawScheduler === undefined
      ? undefined
      : {
          ...rawScheduler,
          resume: async () => {
            if (!isClosed() && deps.settings.isTrusted()) {
              // Take the board when its owner is this window, released, or
              // proven gone. Only the holding window reconciles interruptions
              // and renews consent: a foreign window never reopens or
              // requeues a live owner's attempts.
              if (await rawScheduler.takeoverBoard()) {
                let isRemapped = false
                for (const task of allTasks())
                  if (task.owner?.windowInstanceId !== myWindowId) {
                    task.owner = { windowInstanceId: myWindowId }
                    isRemapped = true
                  }
                if (isRemapped) await persist()
                await reconcileRestored()
                await renewConsent()
              }
              if (isClosed()) return
            }
            await rawScheduler.resume()
          },
          releaseOwnership: async () => {
            for (const task of allTasks())
              if (task.owner?.windowInstanceId === myWindowId)
                task.owner = { windowInstanceId: myWindowId, released: true }
            try {
              await persist()
            } catch (error: unknown) {
              deps.log.warn(failureForLog(error))
              // Best effort on the way out; the board release below still lands.
            }
            await rawScheduler.releaseOwnership()
          },
        }

  const service: TeamHostService = {
    scheduler,
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
    landingPaused: () => deps.state.get(TEAM_MERGE_PAUSE_STATE_KEY) === true,
    mergeRefusal: (taskId) => mergeRefusals.get(taskId),
    mergeQueue: () =>
      orderedMergeQueue().map((candidate, index) => ({
        taskId: candidate.id,
        position: index + 1,
      })),
    mergeEvents: () => [...mergeEventLog],
    setLandingPaused: async (isPaused) => {
      if (isClosed() || !deps.settings.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
      await deps.state.update(TEAM_MERGE_PAUSE_STATE_KEY, isPaused)
      changed()
      if (!isPaused && deps.settings.scheduler?.().integrationFlow !== 'manual') {
        for (const task of allTasks()) {
          if (task.phase !== 'done' || task.mergePhase !== 'idle' || !hasCopy(task)) continue
          enqueueMerge(
            task,
            task.sessionId,
            modeOf(task) ?? '',
            'rework',
            deps.settings.scheduler?.().integrationFlow === 'reviewAutomatically',
            task.controller.signal,
          )
        }
      }
    },
    cleanupAgentBranches: async (taskId) => {
      if (isClosed() || !deps.settings.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
      const candidates = allTasks().filter(
        (task) =>
          (taskId === undefined || task.taskId === taskId) &&
          (task.phase === 'merged' || task.phase === 'discarded'),
      )
      for (const task of candidates) {
        if (isClosed() || !deps.settings.isTrusted())
          throw new Error(UI_TEXT.teamRunners.trustNotice)
        await deps.merges.discard({ taskId: task.taskId, role: task.role, outcome: task.outcome })
      }
      return candidates.length
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
      if (decision === 'merge' && deps.state.get(TEAM_MERGE_PAUSE_STATE_KEY) === true)
        throw new Error(UI_TEXT.teamTaskBusy)
      const task = known(taskId)
      if (task.awaiting !== undefined) {
        const completion = task.mergeCompletion
        task.awaiting(decision)
        const result = await completion
        if (result?.output.startsWith('Error:')) throw new Error(result.visibleOutput)
        return
      }
      if (decision === 'discard') {
        if (!SETTLED_PHASES.has(task.phase)) throw new Error(UI_TEXT.teamTaskUnknown)
        if (!['idle', 'failed'].includes(task.mergePhase)) throw new Error(UI_TEXT.teamTaskBusy)
        await discard(task)
        return
      }
      const mode = modeOf(task)
      const refused = mergeRefusal(task, mode)
      if (refused !== undefined) throw new Error(userMergeRefusal(refused))
      enqueueMerge(task, task.sessionId, mode ?? '', 'rework', false, task.controller.signal)
      const turn = mergeTurn(task.taskId)
      pumpMergeQueue()
      await Promise.race([turn.card, turn.end])
      if (task.mergePhase === 'awaiting-decision') return
      const result = await turn.end
      if (result?.output.startsWith('Error:')) throw new Error(result.visibleOutput)
    },

    taskDiff: async (taskId) => {
      const outcome = known(taskId).outcome
      if (outcome?.head === undefined) throw new Error(UI_TEXT.teamTaskNoDiff)
      return await deps.merges.diff(outcome)
    },
    resetEntry: async (entryId) => {
      if (saveFailure !== undefined) throw saveFailure
      resets.set(entryId, ordinal)
      await persist()
      await pump()
      changed()
    },
    probeEntries: async () => {
      // The declared setup probes run only where the team could run: never
      // with the switch off, on Solo, for the orchestrator's own model, for an
      // agent this editor cannot run, or for a key entry while `teamWorkers` is off.
      if (
        isClosed() ||
        !isTeamAvailable(deps.settings.isTeamOn()) ||
        readTeamWorkspaceHint(deps.state).soloTemplate
      )
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
        } catch (error: unknown) {
          deps.log.warn(failureForLog(error))
          // A failed current probe is unavailable; a stale failure has no owner.
        }
        if (isClosed()) return
        if (probeGenerations.get(entry.id) === generation)
          probes.set(entry.id, { identity, isReady })
      }
      await pump()
      changed()
    },
    reload: () => {
      for (const [id, generation] of probeGenerations) probeGenerations.set(id, generation + 1)
      snapshot = readStoredTeam(deps.state)
      rebuildMergeQueue()
      changed()
    },
    dispose: async (options) => {
      isDisposed = true
      mergeQueueController.abort()
      for (const turn of mergeTurns.values()) turn.endResolve(undefined)
      mergeTurns.clear()
      // Hand the board over cleanly: the next window claims without proof.
      try {
        await scheduler?.releaseOwnership()
      } catch (error: unknown) {
        deps.log.warn(failureForLog(error))
        // Best effort on the way out.
      }
      scheduler?.dispose()
      listeners.clear()
      for (const resolve of waiting.values()) resolve('cancelled')
      for (const task of tasks.values()) {
        task.awaiting?.('cancelled')
        if (isActive(task.phase) || task.phase === 'queued') task.controller.abort()
      }
      for (const wake of waiters) wake()
      if (options?.waitForWorkers === true)
        await Promise.allSettled([
          ...executions.values(),
          ...allTasks().flatMap((task) =>
            task.mergeCompletion === undefined ? [] : [task.mergeCompletion],
          ),
        ])
      await saveQueue
    },
  }
  rebuildMergeQueue()
  return service
}

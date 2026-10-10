// The team host service's implementation (M96 lane X, C-M96-3). It owns one
// workspace team's live tasks in one window: the decision a conversation reads
// when it starts, the roster, the five tools' runner, the "waiting for you"
// and merge cards, and the Agent map's tree. Every effect goes through the
// ports in teamHostService.ts, so the VS Code host, the ACP agent and the
// other editors' panels drive the same code.
//
// Loads with dist/team.js, and only for a workspace that stores a team.

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
  teamSnapshotSchema,
  type TeamAgentRef,
  type TeamPoolEntry,
  type TeamRoleConfig,
  type TeamSnapshot,
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
  TeamHostService,
  TeamHostServiceDeps,
  TeamMergeDecision,
  TeamStatePort,
  TeamWaitingChoice,
  TeamWorkerOutcome,
} from './teamHostService'

type StaffedEntry = TeamPoolEntry & {
  readonly agent: TeamAgentRef
  /** Default: the orchestrator slot's own model and backend (acceptance 34). */
  readonly isDefault: boolean
}

type DelegateItem = DelegateArgs['tasks'][number]

/** Where a task is: waiting for headroom, running, finished (open to merge), or closed. */
type TaskPhase =
  'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'merged' | 'discarded' | 'continued'

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
  continueFrom?: TeamWorkerOutcome | undefined
  queueTimer?: ReturnType<typeof setTimeout> | undefined
  endMs?: number
  outcome?: TeamWorkerOutcome
  failure?: string
  /** A `merge` call waiting for the user's answer on the merge card or the tree. */
  awaiting?: ((decision: TeamMergeDecision | 'cancelled') => void) | undefined
}

/** One planned delegation: refused with its reason, waiting for the user, or placed. */
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
    }
  | { readonly item: DelegateItem; readonly role: TeamRoleConfig; readonly queue: true }

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

/** The worker node's status words, as `teamWorkerStatusLabel` knows them. */
function workerStatus(task: TeamTaskRecord): string {
  switch (task.phase) {
    case 'done': {
      return task.awaiting === undefined ? 'done' : 'waitingForApproval'
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

function toolGroups(role: TeamRoleConfig): readonly string[] {
  const builtin = builtinRole(role.role)
  return role.tools ?? (builtin === undefined ? [] : TEAM_ROLE_TOOLSETS[builtin.id])
}

const describePlan = (planned: readonly PlanStep[]) =>
  planned.map((step) => {
    if ('refused' in step) return { role: step.item.role, refused: step.refused }
    if ('entry' in step)
      return { role: step.item.role, entry: step.entry.id, model: step.entry.agent.model }
    return { role: step.item.role, state: 'ask' in step ? 'ask' : 'queued' }
  })

const keyConfirmations = (steps: readonly PlanStep[]): TeamWorkerConfirmation[] =>
  steps.flatMap((step) =>
    'entry' in step && step.entry.agent.pays === 'key'
      ? [
          {
            ...(step.entry.agent.provider !== undefined && {
              provider: step.entry.agent.provider,
            }),
            role: step.item.role,
            modelId: step.entry.agent.model,
            taskCeilingTokens:
              step.entry.caps.find((cap) => cap.measure === 'tokens' && cap.window === 'task')
                ?.amount ?? 0,
          },
        ]
      : [],
  )

export function createTeamHostService(deps: TeamHostServiceDeps): TeamHostService {
  let snapshot = readStoredTeam(deps.state)
  let isDisposed = false
  const probes = new Map<string, boolean>()
  const tasks = new Map<string, TeamTaskRecord>()
  const allTasks = (): TeamTaskRecord[] => Array.from(tasks.values(), (task) => task)
  /** Tasks counted against each entry's `tasks` caps since its last reset. */
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

  const decisionSource = (orchestratorModelId?: string): TeamDecisionSource | undefined => {
    if (snapshot === undefined) return undefined
    if (orchestratorModelId !== undefined) lastModel = orchestratorModelId
    return {
      teamSwitchOn: deps.settings.isTeamOn(),
      soloTemplate: readTeamWorkspaceHint(deps.state).soloTemplate,
      orchestratorModelId: orchestratorModel(),
      customEntries: customEntries().map((entry) => ({
        entryId: entry.id,
        modelId: entry.agent.model,
        kind: entry.agent.kind === 'museCode' ? 'musecode' : entry.agent.kind,
        billsKey: entry.agent.pays === 'key',
        isAvailable: deps.workers.canRun(entry.agent),
      })),
      isSameModel: isSameTeamModel,
      isEntryReady: (entryId) => probes.get(entryId) === true,
      teamWorkersOn: deps.settings.isTeamWorkersOn(),
    }
  }

  const isTeamRunning = (): boolean => {
    const source = decisionSource()
    return source !== undefined && decideTeamConversationMode(source).mode === 'team'
  }

  const running = (entryId?: string): number =>
    allTasks().filter(
      (task) => task.phase === 'running' && (entryId === undefined || task.entry?.id === entryId),
    ).length

  const tasksSinceReset = (entry: StaffedEntry, window: 'task' | 'day' | 'lifetime'): number => {
    const since = Math.max(
      resets.get(entry.id) ?? 0,
      window === 'day' ? new Date(deps.now()).setHours(0, 0, 0, 0) : 0,
    )
    return allTasks().filter((task) => task.entry?.id === entry.id && task.startMs >= since).length
  }

  /** The entry can run at all: its worker exists, it is loaded, and it is not limited. */
  const isUsable = (entry: StaffedEntry): boolean =>
    deps.workers.canRun(entry.agent) &&
    deps.workers.isLimited?.(entry.agent) !== true &&
    (entry.agent.pays !== 'key' || deps.settings.isTeamWorkersOn()) &&
    (entry.isDefault ||
      (probes.get(entry.id) === true && !isSameTeamModel(entry.agent.model, orchestratorModel())))

  /** D75's selection: the first usable entry with a free slot and room under its caps. */
  const hasHeadroom = (entry: StaffedEntry, taken = 0): boolean =>
    isUsable(entry) &&
    running(entry.id) + taken < entry.concurrent &&
    entry.caps.every(
      (cap) =>
        cap.measure !== 'tasks' ||
        cap.window === 'task' ||
        tasksSinceReset(entry, cap.window) + taken < cap.amount,
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
    inputTokens: task.outcome?.usage.input ?? 0,
    outputTokens: task.outcome?.usage.output ?? 0,
    ...(task.outcome?.usage.costUsd !== undefined && { costUsd: task.outcome.usage.costUsd }),
    estimated: task.outcome?.usage.estimated ?? false,
  })

  const tree = (): TeamTreeData | undefined => {
    if (snapshot === undefined || (!isTeamRunning() && tasks.size === 0)) return undefined
    const all = allTasks()
    const ofRole = (role: TeamRoleConfig, phase: TaskPhase): TeamWorker[] =>
      all
        .filter((task) => task.role.role === role.role && task.phase === phase)
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
            used: cap.measure === 'tasks' ? tasksSinceReset(entry, cap.window) : 0,
            amount: cap.amount,
          })),
          running: running(entry.id),
          concurrentMax: entry.concurrent,
          state: entryState(entry),
          warnings: [],
          workers: all
            .filter((task) => task.entry?.id === entry.id && task.phase === 'running')
            .map((task) => workerNode(task)),
        })),
        queued: ofRole(role, 'queued'),
        unmerged: ofRole(role, 'done'),
        interrupted: [],
      })),
    }
  }

  const changed = (): void => {
    for (const wake of waiters) wake()
    if (isDisposed) return
    const current = tree()
    for (const listener of listeners) listener(current)
  }

  const launch = (task: TeamTaskRecord, entry: StaffedEntry): void => {
    if (task.queueTimer !== undefined) clearTimeout(task.queueTimer)
    task.entry = entry
    task.phase = 'running'
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
          continueFrom: task.continueFrom,
        },
        task.controller.signal,
      )
      .then((outcome) => {
        task.outcome = outcome
        finish(task, outcome.report.status === 'failed' ? 'failed' : 'done')
      })
      .catch((error: unknown) => {
        finish(task, 'failed', describeError(error))
      })
  }

  /** Queued tasks start in order as soon as their role has headroom again. */
  const pump = (): void => {
    for (const task of allTasks()) {
      if (task.phase !== 'queued') continue
      const entry = pool(task.role).find((candidate) => hasHeadroom(candidate))
      if (entry !== undefined) launch(task, entry)
    }
  }

  function finish(task: TeamTaskRecord, phase: TaskPhase, failure?: string): void {
    if (task.phase !== 'running' && task.phase !== 'queued') return
    if (task.queueTimer !== undefined) clearTimeout(task.queueTimer)
    task.phase = phase
    task.endMs = deps.now()
    if (failure !== undefined) task.failure = failure
    if (!isDisposed) pump()
    changed()
  }

  const record = (
    role: TeamRoleConfig,
    item: DelegateItem,
    context: TeamToolContext,
    continueFrom?: TeamTaskRecord,
  ): TeamTaskRecord => {
    const task: TeamTaskRecord = {
      taskId: deps.newId(),
      role,
      brief: item.brief,
      files: item.files ?? [],
      reason: item.reason.code,
      sessionId: context.sessionId,
      startMs: deps.now(),
      controller: new AbortController(),
      entry: undefined,
      phase: 'queued',
      continueFrom: continueFrom?.outcome,
    }
    tasks.set(task.taskId, task)
    if (continueFrom !== undefined) {
      continueFrom.phase = 'continued'
      continueFrom.endMs ??= deps.now()
    }
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
      const chosen = candidates.find((entry) => hasHeadroom(entry, taken.get(entry.id) ?? 0))
      if (chosen !== undefined) {
        taken.set(chosen.id, (taken.get(chosen.id) ?? 0) + 1)
        return { item, role, entry: chosen, continueFrom: previous }
      }
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

  /** Resolves each waiting step with the user's answer, before any spend is asked. */
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
      const entry = step.usable[0]
      if (choice === 'queue') settled.push({ item: step.item, role: step.role, queue: true })
      else if (choice === 'raise' && entry !== undefined)
        // The user lets this one task past its entry's limits.
        settled.push({ item: step.item, role: step.role, entry })
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
    ...(task.failure !== undefined && { failure: task.failure }),
    ...(task.outcome !== undefined && {
      report: task.outcome.report,
      usage: task.outcome.usage,
      ...(task.outcome.branch !== undefined && { branch: task.outcome.branch }),
      ...(task.outcome.changedFiles !== undefined && {
        changed_files: task.outcome.changedFiles,
      }),
    }),
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

  const discard = async (task: TeamTaskRecord): Promise<void> => {
    await deps.merges.discard({ taskId: task.taskId, role: task.role, outcome: task.outcome })
    task.phase = 'discarded'
    task.endMs ??= deps.now()
    changed()
  }

  const stop = async (task: TeamTaskRecord): Promise<void> => {
    if (task.phase === 'running' || task.phase === 'queued') {
      task.controller.abort()
      finish(task, 'stopped')
    } else if (task.phase === 'done') {
      task.awaiting?.('cancelled')
      await discard(task)
    }
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
        review: 'not-reviewed' as const,
      },
    }
  }

  const mergeNow = async (
    task: TeamTaskRecord,
    outcome: TeamWorkerOutcome,
    signal: AbortSignal,
  ) => {
    const merged = await deps.merges.merge(
      { taskId: task.taskId, role: task.role, outcome },
      signal,
    )
    if (merged.status === 'merged') task.phase = 'merged'
    changed()
    return merged
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
      const planned = await settle(initial, context)
      const starting = planned.filter((step) => 'entry' in step).length
      if (running() + starting > deps.settings.maxWorkers()) {
        return refusal(
          fill(TEAM_MODEL_TEXT.hostMaxWorkers, { max: String(deps.settings.maxWorkers()) }),
        )
      }
      const queued = allTasks().filter((task) => task.phase === 'queued').length
      if (queued + planned.filter((step) => 'queue' in step).length > TEAM_QUEUE_MAX) {
        return refusal(fill(TEAM_MODEL_TEXT.hostQueueFull, { max: String(TEAM_QUEUE_MAX) }))
      }
      const keyTasks = keyConfirmations(planned)
      if (keyTasks.length > 0 && !(await deps.paid.allowKeyTasks(keyTasks, undefined, context))) {
        return refusal(TEAM_MODEL_TEXT.hostPaidDeclined)
      }
      context.signal.throwIfAborted()
      const started = planned.map((step) => {
        if ('refused' in step) return { role: step.item.role, refused: step.refused }
        if ('entry' in step) {
          const task = record(step.role, step.item, context, step.continueFrom)
          launch(task, step.entry)
          return taskView(task)
        }
        const task = record(step.role, step.item, context)
        enqueue(task)
        return taskView(task)
      })
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
        chosen().some((task) => task?.phase === 'running' || task?.phase === 'queued')
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
        await stop(task)
        results.push({ task_id: id, state: workerStatus(task) })
      }
      return answer({ tasks: results }, '')
    },
    merge: async (args, context) => {
      const parsed = mergeArgs.safeParse(args)
      if (!parsed.success) return refusal(TEAM_MODEL_TEXT.hostInvalidArguments)
      if (context.approvalMode === 'denyUnmatched')
        return refusal(TEAM_MODEL_TEXT.hostMergePlanMode)
      if (!deps.settings.isTrusted()) return refusal(TEAM_MODEL_TEXT.hostUntrusted)
      const task = ownTask(parsed.data.task_id, context)
      if (task === undefined) return refusal(TEAM_MODEL_TEXT.hostUnknownTask)
      const outcome = task.outcome
      if (task.phase !== 'done' || outcome?.branch === undefined || task.awaiting !== undefined) {
        return refusal(TEAM_MODEL_TEXT.hostMergeNotReady)
      }
      // No reviewer runs here, so the merge is "not reviewed" and asks in
      // every mode that allows one (acceptance 19), on the merge card.
      const card = mergeCard(task, outcome)
      deps.cards.show(context.sessionId, { ...card, status: 'inProgress' })
      const decision = await new Promise<TeamMergeDecision | 'cancelled'>((resolve) => {
        task.awaiting = resolve
        context.signal.addEventListener('abort', () => {
          resolve('cancelled')
        })
        changed()
      })
      task.awaiting = undefined
      deps.cards.show(context.sessionId, { ...card, status: 'completed', teamDecision: decision })
      changed()
      if (decision === 'cancelled') return refusal(TEAM_MODEL_TEXT.hostMergeCancelled)
      if (decision === 'discard') {
        await discard(task)
        return answer({ task_id: task.taskId, state: 'discarded' }, UI_TEXT.teamWorkerDiscarded)
      }
      try {
        const merged = await mergeNow(task, outcome, context.signal)
        return answer(
          { task_id: task.taskId, ...merged },
          merged.status === 'merged' ? UI_TEXT.teamWorkerMerged : UI_TEXT.teamMergeRework,
        )
      } catch (error: unknown) {
        return refusal(describeError(error))
      }
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
          unmergedTasks: allTasks().filter((task) => task.phase === 'done').length,
          budgetLeft: '',
        },
      }
    },
    teamRunner: runner,
    isTeamInPlaceActive: () =>
      allTasks().some((task) => task.phase === 'running' && roleMode(task.role) === 'in-place'),
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
      const open = allTasks().filter((task) => task.phase === 'running' || task.phase === 'queued')
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
      if (task.phase !== 'done') throw new Error(UI_TEXT.teamTaskUnknown)
      if (decision === 'discard') {
        await discard(task)
        return
      }
      const outcome = task.outcome
      if (outcome?.branch === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
      // The user's own Merge on the tree is the approval itself.
      await mergeNow(task, outcome, new AbortController().signal)
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
      for (const entry of customEntries()) {
        if (!deps.workers.canRun(entry.agent)) continue
        try {
          probes.set(entry.id, await deps.workers.probe(entry.agent))
        } catch {
          probes.set(entry.id, false)
        }
      }
      pump()
      changed()
    },
    reload: () => {
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
        if (task.phase === 'running' || task.phase === 'queued') task.controller.abort()
      }
      for (const wake of waiters) wake()
      await Promise.resolve()
    },
  }
}

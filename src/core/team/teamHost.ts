// The team host service's implementation (M96 lane X, C-M96-3). It owns one
// workspace team's live tasks in one window: the decision a conversation reads
// when it starts, the roster, the five tools' runner, and the Agent map's tree.
// Every effect goes through the ports in teamHostService.ts, so the VS Code
// host, the ACP agent and the other editors' panels drive the same code.
//
// Loads with dist/team.js, and only for a workspace that stores a team.

import { TEAM_MODEL_TEXT, TEAM_ROLE_WHEN_TO_USE_MAX_CHARS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { redactSecrets } from '../redact'
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
import { cancelArgs, collectArgs, delegateArgs, mergeArgs } from './teamTools'
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
  TeamWorkerOutcome,
} from './teamHostService'

type StaffedEntry = TeamPoolEntry & {
  readonly agent: TeamAgentRef
  /** Default: the orchestrator slot's own model and backend (acceptance 34). */
  readonly isDefault: boolean
}

/** Where a task is: running, finished (open to merge), or closed. */
type TaskPhase = 'running' | 'done' | 'failed' | 'stopped' | 'merged' | 'discarded'

interface TeamTaskRecord {
  readonly taskId: string
  readonly role: TeamRoleConfig
  readonly entry: StaffedEntry
  readonly brief: string
  readonly reason: string
  readonly sessionId: string
  readonly startMs: number
  readonly controller: AbortController
  phase: TaskPhase
  endMs?: number
  outcome?: TeamWorkerOutcome
  failure?: string
  /** A `merge` call waiting for the user's answer on the tree's card. */
  awaiting?: ((decision: TeamMergeDecision | 'cancelled') => void) | undefined
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

function isOpen(phase: TaskPhase): boolean {
  return phase === 'running' || phase === 'done'
}

/** The worker node's status words, as `teamWorkerStatusLabel` knows them. */
function workerStatus(task: TeamTaskRecord): string {
  switch (task.phase) {
    case 'running': {
      return task.awaiting === undefined ? 'running' : 'waitingForApproval'
    }
    case 'stopped': {
      return 'cancelled'
    }
    default: {
      return task.phase
    }
  }
}

export function createTeamHostService(deps: TeamHostServiceDeps): TeamHostService {
  let snapshot = readStoredTeam(deps.state)
  let isDisposed = false
  const probes = new Map<string, boolean>()
  const tasks = new Map<string, TeamTaskRecord>()
  const allTasks = (): TeamTaskRecord[] => Array.from(tasks.values(), (task) => task)
  /** Tasks counted against each entry's `tasks` caps since its last reset. */
  const resets = new Map<string, number>()
  const listeners = new Set<(tree: TeamTreeData | undefined) => void>()
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
      (task) => task.phase === 'running' && (entryId === undefined || task.entry.id === entryId),
    ).length

  const tasksSinceReset = (entry: StaffedEntry, window: 'task' | 'day' | 'lifetime'): number => {
    const since = Math.max(
      resets.get(entry.id) ?? 0,
      window === 'day' ? new Date(deps.now()).setHours(0, 0, 0, 0) : 0,
    )
    return allTasks().filter((task) => task.entry.id === entry.id && task.startMs >= since).length
  }

  /** The first entry with headroom (D75 selection); a named entry only if it has room. */
  const isUsable = (entry: StaffedEntry): boolean =>
    deps.workers.canRun(entry.agent) &&
    (entry.isDefault ||
      (probes.get(entry.id) === true && !isSameTeamModel(entry.agent.model, orchestratorModel())))

  const hasHeadroom = (entry: StaffedEntry): boolean =>
    isUsable(entry) &&
    (entry.agent.pays !== 'key' || deps.settings.isTeamWorkersOn()) &&
    running(entry.id) < entry.concurrent &&
    entry.caps.every(
      (cap) =>
        cap.measure !== 'tasks' ||
        cap.window === 'task' ||
        tasksSinceReset(entry, cap.window) < cap.amount,
    )

  const entryState = (entry: StaffedEntry): string => {
    if (hasHeadroom(entry)) return 'ready'
    return isUsable(entry) ? 'capped' : 'unavailable'
  }

  const stableRoles = (): readonly TeamStableRole[] =>
    roles().map((role) => {
      const builtin = builtinRole(role.role)
      return {
        roleId: role.role,
        workspaceMode: role.workspace ?? builtin?.workspace ?? 'read-only',
        toolGroups: role.tools ?? [],
        exhaustedPolicy: role.exhausted ?? 'self',
        whenToUse: (builtin?.whenToUse ?? '').slice(0, TEAM_ROLE_WHEN_TO_USE_MAX_CHARS),
        pool: pool(role).map((entry) => ({
          entryId: entry.id,
          agentLabel: entry.agent.agentId,
          modelId: entry.agent.model,
          kind: entry.agent.kind === 'museCode' ? 'musecode' : entry.agent.kind,
          caps: entry.caps.map((cap) => `${String(cap.amount)} ${cap.measure}/${cap.window}`),
        })),
      }
    })

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
    return {
      orchestrator: {
        model: orchestratorModel(),
        backend: deps.orchestrator.backend(),
        slot: 'default',
      },
      roles: roles().map((role) => ({
        id: role.role,
        name: builtinRole(role.role)?.name ?? role.role,
        mode: role.workspace ?? builtinRole(role.role)?.workspace ?? 'read-only',
        toolGroups: role.tools ?? [],
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
            .filter((task) => task.entry.id === entry.id && task.phase === 'running')
            .map((task) => workerNode(task)),
        })),
        queued: [],
        unmerged: all
          .filter((task) => task.role.role === role.role && task.phase === 'done')
          .map((task) => workerNode(task)),
        interrupted: [],
      })),
    }
  }

  const changed = (): void => {
    if (isDisposed) return
    const current = tree()
    for (const listener of listeners) listener(current)
  }

  const finish = (task: TeamTaskRecord, phase: TaskPhase, failure?: string): void => {
    if (!isOpen(task.phase)) return
    task.phase = phase
    task.endMs = deps.now()
    if (failure !== undefined) task.failure = redactSecrets(failure)
    changed()
  }

  const start = (
    role: TeamRoleConfig,
    entry: StaffedEntry,
    item: { readonly brief: string; readonly files?: readonly string[] | undefined },
    reason: string,
    context: TeamToolContext,
  ): TeamTaskRecord => {
    const task: TeamTaskRecord = {
      taskId: deps.newId(),
      role,
      entry,
      brief: item.brief,
      reason,
      sessionId: context.sessionId,
      startMs: deps.now(),
      controller: new AbortController(),
      phase: 'running',
    }
    tasks.set(task.taskId, task)
    deps.log.info(`Team task ${task.taskId} started: role ${role.role}, entry ${entry.id}`)
    void deps.workers
      .run(
        {
          taskId: task.taskId,
          role,
          entry,
          brief: item.brief,
          files: item.files ?? [],
          parentSessionId: context.sessionId,
        },
        task.controller.signal,
      )
      .then((outcome) => {
        task.outcome = outcome
        finish(task, outcome.report.status === 'failed' ? 'failed' : 'done')
      })
      .catch((error: unknown) => {
        finish(task, 'failed', error instanceof Error ? error.message : String(error))
      })
    return task
  }

  const plan = (args: unknown, context: TeamToolContext) => {
    if (context.orchestratorModelId !== undefined) lastModel = context.orchestratorModelId
    const parsed = delegateArgs.safeParse(args)
    if (!parsed.success) return
    const taken = new Map<string, number>()
    return parsed.data.tasks.map((item) => {
      const role = roles().find((candidate) => candidate.role === item.role)
      if (role === undefined || builtinRole(item.role) === undefined) {
        return { item, refused: fill(TEAM_MODEL_TEXT.hostRoleNotOffered, { role: item.role }) }
      }
      if (item.continue !== undefined) {
        return { item, refused: TEAM_MODEL_TEXT.hostContinueNotOffered }
      }
      const candidates = pool(role).filter(
        (entry) => item.entry === undefined || entry.id === item.entry,
      )
      const chosen = candidates.find(
        (entry) =>
          hasHeadroom(entry) && running(entry.id) + (taken.get(entry.id) ?? 0) < entry.concurrent,
      )
      if (chosen === undefined) {
        return {
          item,
          refused: fill(
            candidates.length === 0
              ? TEAM_MODEL_TEXT.hostNotStaffed
              : TEAM_MODEL_TEXT.hostExhausted,
            { role: item.role },
          ),
        }
      }
      taken.set(chosen.id, (taken.get(chosen.id) ?? 0) + 1)
      return { item, role, entry: chosen }
    })
  }

  const describePlan = (planned: NonNullable<ReturnType<typeof plan>>) =>
    planned.map((step) =>
      'refused' in step
        ? { role: step.item.role, refused: step.refused }
        : { role: step.item.role, entry: step.entry.id, model: step.entry.agent.model },
    )

  const taskView = (task: TeamTaskRecord) => ({
    task_id: task.taskId,
    role: task.role.role,
    entry: task.entry.id,
    model: task.entry.agent.model,
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

  const ownTask = (taskId: string, context: TeamToolContext): TeamTaskRecord | undefined => {
    const task = tasks.get(taskId)
    return task?.sessionId === context.sessionId ? task : undefined
  }

  const discard = async (task: TeamTaskRecord): Promise<void> => {
    await deps.merges.discard({ taskId: task.taskId, role: task.role, outcome: task.outcome })
    task.phase = 'discarded'
    task.endMs ??= deps.now()
    changed()
  }

  const stop = async (task: TeamTaskRecord): Promise<void> => {
    if (task.phase === 'running') {
      task.controller.abort()
      finish(task, 'stopped')
    } else if (task.phase === 'done') {
      task.awaiting?.('cancelled')
      await discard(task)
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
      const planned = plan(args, context)
      if (planned === undefined) return refusal(TEAM_MODEL_TEXT.hostInvalidArguments)
      const starting = planned.filter((step) => 'entry' in step).length
      if (running() + starting > deps.settings.maxWorkers()) {
        return refusal(
          fill(TEAM_MODEL_TEXT.hostMaxWorkers, { max: String(deps.settings.maxWorkers()) }),
        )
      }
      const keyTasks: TeamWorkerConfirmation[] = planned.flatMap((step) =>
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
      if (keyTasks.length > 0 && !(await deps.paid.allowKeyTasks(keyTasks, undefined, context))) {
        return refusal(TEAM_MODEL_TEXT.hostPaidDeclined)
      }
      context.signal.throwIfAborted()
      const started = planned.map((step) =>
        'refused' in step
          ? { role: step.item.role, refused: step.refused }
          : taskView(start(step.role, step.entry, step.item, step.item.reason.code, context)),
      )
      changed()
      const count = started.filter((step) => 'task_id' in step).length
      return answer({ tasks: started }, fill(UI_TEXT.teamTasksStarted, { count: String(count) }))
    },
    collect: (args, context) => {
      const parsed = collectArgs.safeParse(args)
      if (!parsed.success) return Promise.resolve(refusal(TEAM_MODEL_TEXT.hostInvalidArguments))
      const ids = parsed.data.task_ids
      const chosen =
        ids === undefined
          ? allTasks().filter((task) => task.sessionId === context.sessionId)
          : ids.map((id) => ownTask(id, context))
      return Promise.resolve(
        answer(
          {
            tasks: chosen.map((task, index) =>
              task === undefined
                ? { task_id: ids?.[index], refused: TEAM_MODEL_TEXT.hostUnknownTask }
                : taskView(task),
            ),
          },
          '',
        ),
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
      if (context.approvalMode === 'plan') return refusal(TEAM_MODEL_TEXT.hostMergePlanMode)
      if (!deps.settings.isTrusted()) return refusal(TEAM_MODEL_TEXT.hostUntrusted)
      const task = ownTask(parsed.data.task_id, context)
      if (task === undefined) return refusal(TEAM_MODEL_TEXT.hostUnknownTask)
      const outcome = task.outcome
      if (task.phase !== 'done' || outcome?.branch === undefined || task.awaiting !== undefined) {
        return refusal(TEAM_MODEL_TEXT.hostMergeNotReady)
      }
      // No reviewer runs here, so the merge is "not reviewed" and asks in
      // every mode that allows one (acceptance 19), on the tree's card.
      const decision = await new Promise<TeamMergeDecision | 'cancelled'>((resolve) => {
        task.awaiting = resolve
        context.signal.addEventListener('abort', () => {
          resolve('cancelled')
        })
        changed()
      })
      task.awaiting = undefined
      changed()
      if (decision === 'cancelled') return refusal(TEAM_MODEL_TEXT.hostMergeCancelled)
      if (decision === 'discard') {
        await discard(task)
        return answer({ task_id: task.taskId, state: 'discarded' }, UI_TEXT.teamWorkerDiscarded)
      }
      const merged = await deps.merges.merge(
        { taskId: task.taskId, role: task.role, outcome },
        context.signal,
      )
      if (merged.status === 'merged') {
        task.phase = 'merged'
        changed()
      }
      return answer(
        { task_id: task.taskId, ...merged },
        merged.status === 'merged' ? UI_TEXT.teamWorkerMerged : UI_TEXT.teamMergeRework,
      )
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
        state: hasHeadroom(entry) ? 'ready' : 'capped or unavailable',
      }))
      return {
        stable: stableRoles(),
        live: {
          entries: live,
          queueDepth: 0,
          unmergedTasks: allTasks().filter((task) => task.phase === 'done').length,
          budgetLeft: '',
        },
      }
    },
    teamRunner: runner,
    isTeamInPlaceActive: () =>
      allTasks().some((task) => task.phase === 'running' && task.role.workspace === 'in-place'),
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
      const open = allTasks().filter((task) => task.phase === 'running')
      for (const task of open) await stop(task)
      return open.length
    },
    // The `ask` policy's cards come with the scheduler (M96c); nothing waits here.
    answerWaiting: () => Promise.reject(new Error(UI_TEXT.teamWaitingUnknown)),
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
      const merged = await deps.merges.merge(
        { taskId, role: task.role, outcome },
        new AbortController().signal,
      )
      if (merged.status === 'merged') task.phase = 'merged'
      changed()
    },
    resetEntry: async (entryId) => {
      resets.set(entryId, deps.now())
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
      changed()
    },
    reload: () => {
      snapshot = readStoredTeam(deps.state)
      changed()
    },
    dispose: async () => {
      isDisposed = true
      listeners.clear()
      for (const task of tasks.values()) {
        task.awaiting?.('cancelled')
        if (task.phase === 'running') task.controller.abort()
      }
      await Promise.resolve()
    },
  }
}

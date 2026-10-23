// The team host service's recording rig (M96): every port records its
// calls; nothing touches a model, git or the disk. Shared by the service
// suite and the playbook host suite so the rigs cannot drift apart.
import type {
  TeamCardItem,
  TeamHostServiceDeps,
  TeamMergeOutcome,
  TeamTaskSpec,
  TeamWorkerOutcome,
} from '../../../src/core/team/teamHostService'
import { TEAM_WORKSPACE_KEYS } from '../../../src/shared/teamConversation'
import { SETTING_DEFAULTS } from '../../../src/shared/constants'

export const ORCHESTRATOR_MODEL = 'muse-spark-1.3'

export interface Controls {
  isTrusted: boolean
  isTeamWorkersOn: boolean
  /** The conversation's wire mode a tree Merge reads; undefined is no open surface. */
  mode: string | undefined
  isPaidAllowed: boolean
  isPaidHeld: boolean
  isMergeHeld: boolean
  /** The setup probe's answer per model. */
  isLoaded: (model: string) => boolean
}

export interface Harness {
  readonly deps: TeamHostServiceDeps
  readonly values: Map<string, unknown>
  readonly controls: Controls
  readonly started: TeamTaskSpec[]
  readonly signals: AbortSignal[]
  readonly finish: (index: number, outcome?: Partial<TeamWorkerOutcome>) => void
  readonly fail: (index: number, error: Error) => void
  readonly merged: string[]
  readonly mergeOptions: { readonly allowProtected: boolean }[]
  readonly discarded: string[]
  readonly paidAsks: number[]
  readonly probes: string[]
  readonly cards: { readonly sessionId: string; readonly item: TeamCardItem }[]
  readonly releasePaid: (isAllowed: boolean) => void
  readonly releaseMerge: () => void
}

export function harness(
  stored: unknown,
  options: {
    readonly trusted?: boolean
    readonly paid?: boolean
    readonly canRun?: boolean
    readonly probe?: boolean
    readonly defaultAgent?: boolean
    readonly values?: Map<string, unknown>
    readonly maxWorkers?: number
    /** The person's Stop-continuation bound; the production default (0) is no bound. */
    readonly hookContinuations?: number
  } = {},
): Harness {
  const values = options.values ?? new Map<string, unknown>()
  values.set(TEAM_WORKSPACE_KEYS.team, stored)
  const controls: Controls = {
    isTrusted: options.trusted ?? true,
    isTeamWorkersOn: true,
    mode: 'promptUnmatched',
    isPaidAllowed: options.paid ?? true,
    isPaidHeld: false,
    isMergeHeld: false,
    isLoaded: () => options.probe ?? true,
  }
  const started: TeamTaskSpec[] = []
  const signals: AbortSignal[] = []
  const resolvers: ((outcome: TeamWorkerOutcome) => void)[] = []
  const rejecters: ((error: Error) => void)[] = []
  const merged: string[] = []
  const mergeOptions: { readonly allowProtected: boolean }[] = []
  const discarded: string[] = []
  const paidAsks: number[] = []
  const probes: string[] = []
  const cards: { readonly sessionId: string; readonly item: TeamCardItem }[] = []
  const heldPaid: ((isAllowed: boolean) => void)[] = []
  const heldMerges: (() => void)[] = []
  let id = 0
  const deps: TeamHostServiceDeps = {
    state: {
      get: (key) => values.get(key),
      update: async (key, value) => {
        values.set(key, value)
        await Promise.resolve()
      },
    },
    settings: {
      isTeamOn: () => true,
      isTeamWorkersOn: () => controls.isTeamWorkersOn,
      maxWorkers: () => options.maxWorkers ?? 4,
      isTrusted: () => controls.isTrusted,
      maxStopContinuations: () =>
        options.hookContinuations ?? SETTING_DEFAULTS.hooksMaxStopContinuations,
    },
    orchestrator: {
      modelId: () => ORCHESTRATOR_MODEL,
      backend: () => 'modelApi',
      defaultAgent: (model) =>
        options.defaultAgent === true
          ? { kind: 'engine', agentId: 'default', model, pays: 'key' }
          : undefined,
      approvalMode: () => controls.mode,
    },
    workers: {
      canRun: () => options.canRun ?? true,
      probe: (agent) => {
        probes.push(agent.model)
        return Promise.resolve(controls.isLoaded(agent.model))
      },
      run: (spec, signal) => {
        started.push(spec)
        signals.push(signal)
        return new Promise((resolve, reject) => {
          resolvers.push(resolve)
          rejecters.push(reject)
        })
      },
    },
    merges: {
      merge: async (task, _signal, mergeOption): Promise<TeamMergeOutcome> => {
        merged.push(task.taskId)
        mergeOptions.push(mergeOption)
        if (controls.isMergeHeld)
          await new Promise<void>((resolve) => {
            heldMerges.push(resolve)
          })
        return { status: 'merged', written: ['a.ts'], conflicts: [] }
      },
      discard: (task) => {
        discarded.push(task.taskId)
        return Promise.resolve()
      },
      diff: (outcome) => Promise.resolve(`diff ${outcome.head ?? ''}`),
    },
    cards: {
      show: (sessionId, item) => {
        cards.push({ sessionId, item })
      },
    },
    paid: {
      allowKeyTasks: (tasks) => {
        paidAsks.push(tasks.length)
        if (!controls.isPaidHeld) return Promise.resolve(controls.isPaidAllowed)
        return new Promise<boolean>((resolve) => {
          heldPaid.push(resolve)
        })
      },
    },
    newId: () => {
      id += 1
      return `task-${String(id)}`
    },
    now: () => 1_000_000,
    log: { info: () => undefined, warn: () => undefined },
  }
  return {
    deps,
    values,
    controls,
    started,
    signals,
    merged,
    mergeOptions,
    discarded,
    paidAsks,
    probes,
    cards,
    releasePaid: (isAllowed) => {
      for (const resolve of heldPaid.splice(0)) resolve(isAllowed)
    },
    releaseMerge: () => {
      for (const resolve of heldMerges.splice(0)) resolve()
    },
    fail: (index, error) => {
      rejecters[index]?.(error)
    },
    finish: (index, outcome = {}) => {
      resolvers[index]?.({
        report: { status: 'done', summary: 'did it' },
        usage: {
          input: 10,
          cachedInput: 0,
          output: 5,
          reasoning: 0,
          modelCalls: 1,
          estimated: false,
        },
        branch: 'agents/engineering/x',
        baseCommit: 'a'.repeat(40),
        head: 'b'.repeat(40),
        changedFiles: ['a.ts'],
        folder: '/copies/x',
        agentsRef: 'refs/heads/agents/engineering/x',
        ...outcome,
      })
    },
  }
}

import {
  TEAM_BOARD_MAX,
  TEAM_MAX_REASSIGNMENTS,
  TEAM_SCHED_HISTORY_MAX,
  UI_TEXT,
} from '../../../shared/constants'
import {
  teamBoardSchema,
  teamBoardTaskSchema,
  teamRescheduleSchema,
  teamSchedulerEventSchema,
  teamSchedulerFieldsSchema,
  type TeamAttempt,
  type TeamBoard,
  type TeamBoardTask,
  type TeamSchedulerEvent,
  type TeamSchedulerFields,
  type TeamTaskState,
} from '../../../shared/team'
import { fill } from '../../../shared/l10n/text'

export interface BoardSubmission {
  id: string
  parentSessionId: string
  roleId: string
  workspaceMode: 'read-only' | 'own-branch' | 'in-place'
  fields: TeamSchedulerFields
}
export interface BoardContext {
  workspaceFor(taskId: string): string | undefined
  workspaceMode(taskId: string): BoardSubmission['workspaceMode']
  report(taskId: string): string
  countAttempt(task: TeamBoardTask, attempt: TeamAttempt): boolean
  /** The team ledger keeps terminal rows beside the board; journal both before dispatch. */
  archive(tasks: readonly TeamBoardTask[]): void
  archivedTask(taskId: string): unknown
}

const terminal = new Set<TeamTaskState>([
  'merged',
  'done',
  'discarded',
  'failed',
  'cancelled',
  'redesign',
])
const unsuccessful = new Set<TeamTaskState>(['discarded', 'failed', 'cancelled', 'redesign'])
const transitions: Record<TeamTaskState, readonly TeamTaskState[]> = {
  queued: ['ready', 'blocked', 'cancelled'],
  ready: ['queued', 'running', 'blocked', 'cancelled'],
  running: ['review', 'done', 'blocked', 'failed', 'cancelled'],
  blocked: ['queued', 'ready', 'cancelled', 'failed'],
  review: ['ready', 'merge', 'blocked', 'failed', 'discarded', 'redesign'],
  merge: ['review', 'ready', 'merged', 'blocked', 'discarded'],
  merged: [],
  done: [],
  discarded: [],
  failed: [],
  cancelled: [],
  redesign: [],
}

/** Structured refusal: the tools/UI render the code and the named edge. */
export class BoardRefusal extends Error {
  constructor(
    readonly code: string,
    readonly edge: readonly string[] = [],
  ) {
    super(code)
  }
}

/** Window-owned pure board; the caller journals snapshots before dispatch. */
export class TaskBoard {
  private board: TeamBoard

  constructor(
    workspaceId: string,
    windowInstanceId: string,
    private readonly context: BoardContext,
  ) {
    this.board = teamBoardSchema.parse({ workspaceId, windowInstanceId, paused: false, tasks: [] })
  }

  private archivedTask(id: string): TeamBoardTask | undefined {
    const input = this.context.archivedTask(id)
    if (input === undefined) return undefined
    const task = teamBoardTaskSchema.parse(input)
    const last = task.attempts.at(-1)
    if (
      task.id !== id ||
      task.workspaceId !== this.board.workspaceId ||
      !terminal.has(task.state) ||
      (last !== undefined && last.state !== 'retired')
    )
      throw new BoardRefusal('state', [id])
    return task
  }

  private findTask(id: string): TeamBoardTask | undefined {
    return this.board.tasks.find((item) => item.id === id) ?? this.archivedTask(id)
  }

  private requireTask(id: string): TeamBoardTask {
    const task = this.findTask(id)
    if (!task) throw new BoardRefusal('unknownTask', [id])
    return task
  }

  private retainOpen(tasks: readonly TeamBoardTask[]): TeamBoardTask[] {
    const completed = tasks.filter((task) => terminal.has(task.state))
    if (completed.length > 0) this.context.archive(structuredClone(completed))
    return tasks.filter((task) => !terminal.has(task.state))
  }

  private validateEdges(tasks: readonly TeamBoardTask[]): void {
    const byId = new Map(tasks.map((task) => [task.id, task]))
    const visited = new Set<string>()
    const visiting: string[] = []
    const active = new Set<string>()
    const visit = (root: string): void => {
      const pending = [{ id: root, isLeaving: false }]
      for (let step = pending.pop(); step !== undefined; step = pending.pop()) {
        if (step.isLeaving) {
          visiting.pop()
          active.delete(step.id)
          visited.add(step.id)
          continue
        }
        if (active.has(step.id)) throw new BoardRefusal('cycle', [...visiting, step.id])
        if (visited.has(step.id)) continue
        visiting.push(step.id)
        active.add(step.id)
        const edges = (byId.get(step.id) ?? this.requireTask(step.id)).depends_on ?? []
        for (const edge of edges) {
          if (byId.has(edge.task) || this.archivedTask(edge.task)) continue
          const workspace = this.context.workspaceFor(edge.task)
          throw new BoardRefusal(
            workspace && workspace !== this.board.workspaceId ? 'crossWorkspace' : 'unknownTask',
            [step.id, edge.task],
          )
        }
        pending.push({ id: step.id, isLeaving: true })
        for (const edge of edges.toReversed()) pending.push({ id: edge.task, isLeaving: false })
      }
    }
    for (const task of tasks) visit(task.id)
  }

  snapshot(): TeamBoard {
    return structuredClone(this.board)
  }
  task(id: string): TeamBoardTask {
    return structuredClone(this.requireTask(id))
  }
  get paused(): boolean {
    return this.board.paused
  }
  pause(): void {
    this.board.paused = true
  }
  resume(): void {
    this.board.paused = false
  }

  restore(input: unknown): void {
    const restored = teamBoardSchema.parse(input)
    if (restored.workspaceId !== this.board.workspaceId) throw new BoardRefusal('workspace')
    this.validateEdges(restored.tasks)
    restored.windowInstanceId = this.board.windowInstanceId
    restored.paused = true
    for (const task of restored.tasks) {
      let isInterrupted = false
      for (const attempt of task.attempts) {
        if (attempt.state === 'retired') {
          continue
        }

        attempt.state = 'interrupted'
        isInterrupted = true
      }
      if (!isInterrupted) {
        continue
      }

      task.state = 'blocked'
      task.blockedReason = UI_TEXT.teamTrafficNotices.uncertainAttempt
    }
    restored.tasks = this.retainOpen(restored.tasks)
    this.board = restored
  }

  submit(inputs: readonly BoardSubmission[], at: number): readonly TeamBoardTask[] {
    const aliases = new Map<string, string>()
    const modes = new Map(inputs.map((input) => [input.id, input.workspaceMode]))
    const existing = new Set(this.board.tasks.map((task) => task.id))
    for (const input of inputs) {
      if (existing.has(input.id) || this.archivedTask(input.id) || aliases.has(input.id))
        throw new BoardRefusal('duplicate', [input.id])
      aliases.set(input.id, input.id)
    }
    for (const input of inputs) {
      const key = input.fields.key
      if (key === undefined) {
        continue
      }

      if (
        (aliases.has(key) && aliases.get(key) !== input.id) ||
        existing.has(key) ||
        this.archivedTask(key)
      ) {
        throw new BoardRefusal('duplicateKey', [input.id, key])
      }
      aliases.set(key, input.id)
    }
    const additions = inputs.map((input) => {
      const fields = teamSchedulerFieldsSchema.parse(input.fields)
      return teamBoardTaskSchema.parse({
        ...fields,
        id: input.id,
        workspaceId: this.board.workspaceId,
        parentSessionId: input.parentSessionId,
        roleId: input.roleId,
        depends_on: fields.depends_on?.map((dependency) => {
          const task = aliases.get(dependency.task) ?? dependency.task
          const mode =
            modes.get(task) ??
            (existing.has(task) || this.archivedTask(task)
              ? this.context.workspaceMode(task)
              : undefined)
          return { task, on: dependency.on ?? (mode === 'read-only' ? 'done' : 'merged') }
        }),
        state: 'queued',
        held: false,
        createdAt: at,
        currentAttempt: 0,
        attempts: [],
        reassignments: 0,
        reviewRounds: 0,
      })
    })
    const next = [...this.board.tasks, ...additions]
    if (next.filter((task) => !terminal.has(task.state)).length > TEAM_BOARD_MAX)
      throw new BoardRefusal('boardFull')
    this.validateEdges(next)
    this.board.tasks = this.retainOpen(next)
    this.refresh(at)
    return additions.map((task) => structuredClone(task))
  }

  reschedule(input: unknown, at: number): void {
    const change = teamRescheduleSchema.parse(input)
    const next = this.snapshot()
    for (const id of change.task_ids) {
      const task = next.tasks.find((candidate) => candidate.id === id)
      if (!task) throw new BoardRefusal('unknownTask', [id])
      if (task.state !== 'queued' && task.state !== 'ready') throw new BoardRefusal('state', [id])
      if (change.priority !== undefined) task.priority = change.priority
      if (change.hold !== undefined) task.held = change.hold
      if (change.depends_on === undefined) {
        continue
      }

      task.depends_on = change.depends_on.map((dependency) => ({
        task: dependency.task,
        on:
          dependency.on ??
          ((next.tasks.some((candidate) => candidate.id === dependency.task) ||
            this.archivedTask(dependency.task)) &&
          this.context.workspaceMode(dependency.task) === 'read-only'
            ? 'done'
            : 'merged'),
      }))
      task.state = 'queued'
      delete task.readyAt
    }
    this.validateEdges(next.tasks)
    this.board = next
    this.refresh(at)
  }

  refresh(at: number): void {
    for (const task of this.board.tasks) {
      if (task.state !== 'queued' && task.state !== 'ready') continue
      const dependencies = (task.depends_on ?? []).map((edge) => ({
        edge,
        task: this.requireTask(edge.task),
      }))
      const failure = dependencies.find((dependency) => unsuccessful.has(dependency.task.state))
      if (failure) {
        task.state = 'blocked'
        task.blockedReason = fill(UI_TEXT.teamTrafficNotices.dependencyBlocked, {
          task: failure.task.id,
        })
      } else if (
        dependencies.every(({ edge, task: dependency }) =>
          edge.on === 'merged'
            ? dependency.state === 'merged'
            : dependency.state === 'done' || dependency.state === 'merged',
        )
      ) {
        task.state = 'ready'
        task.readyAt ??= at
      } else {
        task.state = 'queued'
        delete task.readyAt
      }
    }
  }

  dependencyInput(id: string): {
    integrationTasks: string[]
    reports: { taskId: string; kind: 'data'; text: string }[]
  } {
    const task = this.requireTask(id)
    if (task.state !== 'ready') throw new BoardRefusal('dependencies', [id])
    return {
      integrationTasks: (task.depends_on ?? [])
        .filter((edge) => edge.on === 'merged')
        .map((edge) => edge.task),
      reports: (task.depends_on ?? [])
        .filter((edge) => edge.on === 'done')
        .map((edge) => ({
          taskId: edge.task,
          kind: 'data',
          text: this.context.report(edge.task),
        })),
    }
  }

  begin(id: string, attempt: TeamAttempt, isReplacementQuarantined = false): boolean {
    const task = this.requireTask(id)
    if (this.paused || task.held || task.state !== 'ready') return false
    const prior = task.attempts.at(-1)
    if (
      prior &&
      prior.state !== 'retired' &&
      !(isReplacementQuarantined && prior.state === 'uncertain')
    )
      return false
    if (
      attempt.number !== task.currentAttempt + 1 ||
      task.attempts.length >= TEAM_SCHED_HISTORY_MAX
    )
      return false
    // Count every attempt before it can run; the pool owns caps/budget admission.
    const candidate = teamBoardTaskSchema.parse({
      ...task,
      currentAttempt: attempt.number,
      attempts: [...task.attempts, attempt],
    })
    if (!this.context.countAttempt(candidate, attempt)) return false
    task.attempts.push(structuredClone(attempt))
    task.currentAttempt = attempt.number
    task.state = 'running'
    delete task.blockedReason
    return true
  }

  finishAttempt(
    id: string,
    number: number,
    outcome: Pick<TeamAttempt, 'state' | 'endedAt' | 'retirement'>,
  ): boolean {
    const task = this.requireTask(id)
    if (terminal.has(task.state) && outcome.state !== 'retired') return false
    const attempt = task.attempts.find((candidate) => candidate.number === number)
    if (!attempt || (number !== task.currentAttempt && outcome.state !== 'retired')) return false
    const updated = { ...attempt, ...outcome }
    const checked = teamBoardTaskSchema.parse({
      ...task,
      attempts: task.attempts.map((item) => (item === attempt ? updated : item)),
    })
    if (this.board.tasks.some((item) => item.id === id)) task.attempts = checked.attempts
    else this.context.archive([checked])
    return true
  }

  /** Trusted recovery, never a worker event, opens the next attempt. */
  prepareNext(
    id: string,
    number: number,
    at: number,
    reason: 'stall' | 'review' | 'conflict',
    hasQuarantine = false,
  ): boolean {
    const task = this.requireTask(id)
    const previous = task.attempts.at(-1)
    if (!previous || number !== task.currentAttempt || terminal.has(task.state)) return false
    if (previous.state !== 'retired' && !(hasQuarantine && previous.state === 'uncertain'))
      return false
    if (reason === 'stall') {
      if (task.reassignments >= TEAM_MAX_REASSIGNMENTS) return false
      task.reassignments++
    }
    task.state = 'ready'
    task.readyAt = at
    delete task.blockedReason
    this.refresh(at)
    return true
  }

  transition(
    id: string,
    number: number,
    state: TeamTaskState,
    at: number,
    reason?: string,
  ): boolean {
    const task = this.requireTask(id)
    if (number !== task.currentAttempt || !transitions[task.state].includes(state)) return false
    if (state === 'blocked' && !reason) throw new BoardRefusal('blockedReason', [id])
    if (state !== 'blocked' && task.attempts.at(-1) && task.attempts.at(-1)?.state !== 'retired')
      return false
    task.state = state
    if (reason) task.blockedReason = reason
    else delete task.blockedReason
    if (state === 'ready') task.readyAt = at
    this.refresh(at)
    return true
  }

  applyEvent(input: unknown, charge: (event: TeamSchedulerEvent) => void): boolean {
    const event = teamSchedulerEventSchema.parse(input)
    if (event.workspaceId !== this.board.workspaceId) return false
    const task = this.findTask(event.taskId)
    const attempt = task?.attempts.find((item) => item.number === event.attempt)
    if (!task || !attempt) return false
    if (event.kind === 'usage') {
      charge(event)
      return true
    }
    return event.attempt === task.currentAttempt && ['running', 'retiring'].includes(attempt.state)
  }
}

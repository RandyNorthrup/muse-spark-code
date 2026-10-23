import { TEAM_BOARD_MAX, TEAM_SCHED_HISTORY_MAX, UI_TEXT } from '../../../shared/constants'
import {
  teamAttemptUsageSchema,
  teamBoardSchema,
  teamBoardTaskSchema,
  teamRescheduleSchema,
  teamSchedulerEventSchema,
  teamSchedulerFieldsSchema,
  type TeamAttempt,
  type TeamBoard,
  type TeamBoardOwner,
  type TeamBoardTask,
  type TeamSchedulerEvent,
  type TeamSchedulerFields,
  type TeamBoardTaskState,
} from '../../../shared/team'
import { fill } from '../../../shared/l10n/text'
import { Usd } from '../../../shared/usd'
import { teamHandoffRecordSchema, type TeamChainEntry } from '../../../shared/teamHandoff'

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
  /**
  Refunds exactly the admission `countAttempt` counted for this attempt. The
  scheduler calls it once, only for an attempt that closes before its worker
  is invoked: one it closes itself (see `cancelUnstarted`), one `restore`
  interrupted while its launch journal was pending (see `cancelInterrupted`),
  or one its owner already closed (see `refundUnspawned`).
  */
  refundAttempt(task: TeamBoardTask, attempt: TeamAttempt): void
  /** The team ledger keeps terminal rows beside the board; journal both before dispatch. */
  archive(tasks: readonly TeamBoardTask[]): void
  archivedTask(taskId: string): unknown
}

const terminal = new Set<TeamBoardTaskState>([
  'merged',
  'done',
  'discarded',
  'failed',
  'cancelled',
  'redesign',
])
const unsuccessful = new Set<TeamBoardTaskState>(['discarded', 'failed', 'cancelled', 'redesign'])
const transitions: Record<TeamBoardTaskState, readonly TeamBoardTaskState[]> = {
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
  /** This window's identity: restore never overwrites the stored one with it. */
  private readonly mine: string

  constructor(
    workspaceId: string,
    windowInstanceId: string,
    private readonly context: BoardContext,
  ) {
    this.mine = windowInstanceId
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

  /**
  Refund a counted admission, drop its attempt and park the task ready with
  no liability notice. The caller owns the guard: the attempt never spawned.
  */
  private reopenUnspawned(task: TeamBoardTask, attempt: TeamAttempt): void {
    this.context.refundAttempt(structuredClone(task), structuredClone(attempt))
    task.attempts.pop()
    task.currentAttempt--
    task.state = 'ready'
    delete task.blockedReason
    delete task.loan
    delete task.recallAskedAtMs
    if (task.handoff !== undefined) {
      task.handoff.chain = task.handoff.chain.filter(
        (link) =>
          link.kind !== 'borrow' ||
          link.candidateId !== attempt.entryId ||
          link.atMs !== attempt.startedAt,
      )
    }
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
    // Restore never overwrites the stored identity: the board keeps its
    // stored window and ownership claim, so a second window cannot seize the
    // board by reading it. Only a proven-gone owner is taken over, explicitly.
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
      if (task.state !== 'queued' && task.state !== 'ready') {
        // A hold is a control signal, never a re-plan: an owner hold may
        // land on live work (lead ruling 2026-10-11), where the launch gate
        // refuses the launch before the worker starts. Anything else still
        // needs a queued or ready task, and terminal tasks refuse everything.
        const isHoldOnly =
          change.hold !== undefined &&
          change.priority === undefined &&
          change.depends_on === undefined
        if (!isHoldOnly || terminal.has(task.state)) throw new BoardRefusal('state', [id])
        if (change.hold !== undefined) task.held = change.hold
        continue
      }
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

  /** Close an admission whose worker was never invoked and refund it; preserve queue age. */
  cancelUnstarted(id: string, number: number): void {
    const task = this.requireTask(id)
    const attempt = task.attempts.at(-1)
    if (task.state !== 'running' || number !== task.currentAttempt || attempt?.state !== 'running')
      throw new BoardRefusal('state', [id])
    // Only the scheduler, before invoking start, can close this admission. The
    // refund comes first: if it fails, the counted attempt stays on the board.
    // No process retirement is claimed.
    this.reopenUnspawned(task, attempt)
  }

  /**
  Close an admission `restore` interrupted while its launch journal was
  pending and refund it; preserve queue age. Only the scheduler's launch
  gate calls it, for its own attempt number, when it can still prove the
  worker was never invoked: the launch never left the journal await. The
  "slots remain counted" notice goes with the admission, so the board no
  longer says the slot is held. An attempt `restore` interrupts after a
  crash or reload is not this path: reopening cannot know whether its
  worker ran, so D75's uncertain liability stands there.
  */
  cancelInterrupted(id: string, number: number): void {
    const task = this.requireTask(id)
    const attempt = task.attempts.at(-1)
    if (
      task.state !== 'blocked' ||
      number !== task.currentAttempt ||
      attempt?.state !== 'interrupted'
    )
      throw new BoardRefusal('state', [id])
    // Same ownership as `cancelUnstarted`: before the worker is invoked, and
    // the refund comes first for the same reason.
    this.reopenUnspawned(task, attempt)
  }

  /**
  Refund the admission for an attempt its owner closed before the worker was
  invoked; the board is unchanged. The scheduler calls it once per attempt,
  only from its launch gate, which runs before the worker can start: an
  attempt that already spawned must stay counted with its liability. A
  second call refunds again, so the caller tracks what it refunded.
  */
  refundUnspawned(id: string, number: number): void {
    const task = this.requireTask(id)
    const attempt = task.attempts.find((candidate) => candidate.number === number)
    if (attempt?.state !== 'retired') throw new BoardRefusal('state', [id])
    this.context.refundAttempt(structuredClone(task), structuredClone(attempt))
  }

  /**
  Move to… (M120 lane P): requeue a waiting task under another role. The
  loan stays with its authorized candidate and role, so it goes; the new
  role's demand window starts at the move. A running or terminal task
  refuses; stop and capture it first.
  */
  moveToRole(id: string, roleId: string, at: number): boolean {
    const task = this.requireTask(id)
    if (terminal.has(task.state) || task.state === 'running') return false
    task.roleId = roleId
    task.state = 'ready'
    task.readyAt = at
    task.reassignments++
    delete task.loan
    delete task.unmetSinceMs
    delete task.blockedReason
    this.refresh(at)
    return true
  }

  /** Journalled with the board, including demand resets when a main candidate frees. */
  demand(id: string, nowMs: number, isMainFree: boolean): void {
    const task = this.requireTask(id)
    task.unmetSinceMs = isMainFree ? nowMs : (task.unmetSinceMs ?? nowMs)
  }

  borrowEnded(candidateId: string, endedAtMs: number): void {
    const cooldowns = (this.board.borrowCooldowns ?? []).filter(
      (row) => row.candidateId !== candidateId,
    )
    this.board.borrowCooldowns = [...cooldowns, { candidateId, endedAtMs }].slice(
      -TEAM_SCHED_HISTORY_MAX,
    )
  }

  loan(id: string, loan: TeamBoardTask['loan']): void {
    const task = this.requireTask(id)
    if (loan === undefined) delete task.loan
    else task.loan = teamBoardTaskSchema.parse({ ...task, loan }).loan
    if (this.board.tasks.every((item) => item.id !== id)) this.context.archive([task])
  }

  recallAsked(id: string, atMs: number | undefined): void {
    const task = this.requireTask(id)
    if (atMs === undefined) delete task.recallAskedAtMs
    else task.recallAskedAtMs ??= atMs
  }

  appendChain(id: string, link: TeamChainEntry): void {
    const task = this.requireTask(id)
    task.handoff = teamHandoffRecordSchema.parse({
      taskId: task.id,
      roleId: task.roleId,
      chain: [...(task.handoff?.chain ?? []), link],
    })
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

  /** The request meter owns this exact attempt, including a late settlement. */
  usage(id: string, number: number, input: TeamAttempt['usage']): boolean {
    const task = this.requireTask(id)
    const attempt = task.attempts.find((item) => item.number === number)
    if (attempt === undefined) return false
    attempt.usage = teamAttemptUsageSchema.parse(input)
    if (this.board.tasks.every((item) => item.id !== id))
      this.context.archive([structuredClone(task)])
    return true
  }

  /**
  Reload recovery for an attempt that provably never ran: restored as
  interrupted, with zero usage, no retirement and no end time, it emitted
  nothing, so dropping it loses no accounting and double-runs nothing.
  Anything that may have run keeps its interrupted liability for an
  explicit recovery instead.
  */
  reopenInterrupted(id: string, at: number): boolean {
    if (this.board.tasks.every((task) => task.id !== id)) return false
    const task = this.requireTask(id)
    const previous = task.attempts.at(-1)
    const isMissing = previous === undefined
    if (
      isMissing ||
      previous.state !== 'interrupted' ||
      previous.retirement !== undefined ||
      previous.endedAt !== undefined ||
      terminal.has(task.state)
    )
      return false
    const usage = previous.usage
    if (
      usage.inputTokens !== 0 ||
      usage.cachedInputTokens !== 0 ||
      usage.outputTokens !== 0 ||
      usage.reasoningTokens !== 0 ||
      usage.modelCalls !== 0 ||
      Usd.from(usage.costUsd).compare(Usd.from(0)) !== 0
    )
      return false
    task.attempts.pop()
    task.currentAttempt--
    task.state = 'ready'
    task.readyAt = at
    delete task.blockedReason
    this.refresh(at)
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
      // Reassignments are counted, never capped: the next attempt opens
      // until the work converges or the person stops it (D121).
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
    state: TeamBoardTaskState,
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

  /**
  Whether this window currently holds the board (sync, in-memory only). A
  free or released board, or one already naming this window, is claimed
  with this window's birth and process lease; a live foreign owner refuses.
  */
  holdsOwnership(birth: { windowStartedAt: number; pid?: number; processStart?: string }): boolean {
    const owner = this.board.owner
    if (owner !== undefined && !owner.released && owner.windowInstanceId !== this.mine) return false
    this.board.owner = { windowInstanceId: this.mine, released: false, ...birth }
    return true
  }

  /** Release the claim cleanly (dispose): the next window claims without proof. */
  releaseOwnership(): void {
    if (this.board.owner?.windowInstanceId === this.mine)
      this.board.owner = { ...this.board.owner, released: true }
  }

  /** Unconditional in-memory claim after the stored board proved claimable. */
  takeOwnership(birth: { windowStartedAt: number; pid?: number; processStart?: string }): void {
    this.board.owner = { windowInstanceId: this.mine, released: false, ...birth }
  }

  /** The stored ownership claim, if any window holds the board. */
  owner(): TeamBoardOwner | undefined {
    return this.board.owner === undefined ? undefined : { ...this.board.owner }
  }
}

// --- M96c scheduler region (lane S). M96 lane A owns pool/accounting selection. ---
import { TEAM_SCHED_TICK_MS, UI_TEXT } from '../../shared/constants'
import { type TeamAttempt, type TeamBoard, type TeamBoardTask } from '../../shared/team'
import { type TaskBoard } from './scheduler/board'
import { TaskPicker, type PickContext, type SchedulerEntry } from './scheduler/pick'
import { type SchedulerSlots, type SlotRequest } from './scheduler/slots'

export interface SchedulerDependencies {
  now(): number
  context(): PickContext
  /** Resources/lease/throttle/load guard: transient waits never ask the user. */
  headroom(task: TeamBoardTask): 'lane' | 'exhausted' | 'ready'
  exhausted(task: TeamBoardTask): void
  /** Reservations are synchronous; leases remain held until retirement. */
  lease(task: TeamBoardTask, ref: SlotRequest): { release(): void } | undefined
  authorize(task: TeamBoardTask, entry: SchedulerEntry): Promise<boolean>
  journal(board: TeamBoard): Promise<void>
  /** Resolve on launch admission, not on the worker's eventual completion. */
  start(
    task: TeamBoardTask,
    entry: SchedulerEntry,
    input: ReturnType<TaskBoard['dependencyInput']>,
  ): Promise<'started' | 'notStarted' | 'uncertain'>
  uncertain(ref: SlotRequest): Promise<void>
  schedule(callback: () => void, ms: number): () => void
  failure(error: unknown): void
  halveAgentCap(agentProfileId: string): void
}

/** Event-driven window scheduler, with a sweep; no work at construction/import. */
export class TeamScheduler {
  private readonly picker = new TaskPicker()
  private readonly leases = new Map<string, { release(): void }>()
  private sweep: (() => void) | undefined
  private draining: Promise<void> | undefined
  private hasWake = false
  private isStopped = false

  constructor(
    private readonly board: TaskBoard,
    private readonly slots: SchedulerSlots,
    private readonly deps: SchedulerDependencies,
  ) {}

  private request(task: TeamBoardTask, entry: SchedulerEntry): SlotRequest {
    return {
      taskId: task.id,
      attempt: task.currentAttempt + 1,
      workspaceId: task.workspaceId,
      roleId: task.roleId,
      entryId: entry.id,
      agentProfileId: entry.agentProfileId,
      kind: entry.kind,
    }
  }

  private key(ref: Pick<SlotRequest, 'taskId' | 'attempt'>): string {
    return JSON.stringify([ref.taskId, ref.attempt])
  }

  private canDispatch(): boolean {
    return !this.isStopped && !this.board.paused
  }

  private canLaunch(ref: SlotRequest): boolean {
    const task = this.board.task(ref.taskId)
    return (
      this.canDispatch() &&
      task.state === 'running' &&
      task.currentAttempt === ref.attempt &&
      task.attempts.at(-1)?.state === 'running'
    )
  }

  private isActive(ref: SlotRequest): boolean {
    const task = this.board.task(ref.taskId)
    const state = task.attempts.at(-1)?.state
    return task.currentAttempt === ref.attempt && (state === 'running' || state === 'retiring')
  }

  private async drain(): Promise<void> {
    const considered = new Set<string>()
    while (this.hasWake && this.canDispatch()) {
      this.hasWake = false
      this.board.refresh(this.deps.now())
      const tasks = this.board.snapshot().tasks
      const supplied = this.deps.context()
      const context: PickContext = {
        ...supplied,
        now: this.deps.now(),
        canStart: (task, entry) =>
          !considered.has(task.id) &&
          supplied.canStart(task, entry) &&
          (this.slots.isReserved(this.request(task, entry)) ||
            this.slots.refusal(this.request(task, entry)) === undefined),
      }
      const pick = this.picker.pick(tasks, context)
      if (!pick) {
        for (const task of tasks)
          if (task.state === 'ready' && !task.held && this.deps.headroom(task) === 'exhausted')
            this.deps.exhausted(task)
        break
      }
      considered.add(pick.task.id)
      const ref = this.request(pick.task, pick.entry)
      if (!this.slots.isReserved(ref) && !this.slots.reserve(ref).ok) {
        this.hasWake = true
        continue
      }
      const lease = this.deps.lease(pick.task, ref)
      if (!lease) {
        this.slots.release(ref, 'notStarted')
        this.hasWake = true
        continue
      }
      let hasAttempt = false
      let canRelease = true
      try {
        if (!(await this.deps.authorize(pick.task, pick.entry))) continue
        const current = this.board.task(pick.task.id)
        if (
          !this.canDispatch() ||
          current.state !== 'ready' ||
          current.currentAttempt !== pick.task.currentAttempt
        )
          continue
        const input = this.board.dependencyInput(current.id)
        const attempt: TeamAttempt = {
          number: ref.attempt,
          entryId: ref.entryId,
          agentProfileId: ref.agentProfileId,
          modelId: pick.entry.modelId,
          kind: ref.kind,
          state: 'running',
          startedAt: this.deps.now(),
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            modelCalls: 0,
            costUsd: 0,
            accuracy: 'reported',
          },
        }
        if (!this.board.begin(current.id, attempt)) continue
        hasAttempt = true
        await this.deps.journal(this.board.snapshot())
        // Pause or Stop while journalling must still prevent a launch.
        if (!this.canLaunch(ref)) {
          if (this.board.task(current.id).attempts.at(-1)?.state === 'running') {
            canRelease = false
            this.slots.mark(ref, 'uncertain')
            this.leases.set(this.key(ref), lease)
            this.board.finishAttempt(current.id, ref.attempt, { state: 'uncertain' })
            this.board.transition(
              current.id,
              ref.attempt,
              'blocked',
              this.deps.now(),
              UI_TEXT.teamTrafficNotices.queuePaused,
            )
            await this.deps.uncertain(ref)
          }
          await this.deps.journal(this.board.snapshot())
          continue
        }
        this.slots.mark(ref, 'running')
        canRelease = false
        this.leases.set(this.key(ref), lease)
        const outcome = await this.deps.start(this.board.task(current.id), pick.entry, input)
        this.picker.started(pick.entry, this.deps.now())
        if (outcome !== 'started' && this.isActive(ref)) {
          this.slots.mark(ref, 'uncertain')
          this.board.finishAttempt(current.id, ref.attempt, { state: 'uncertain' })
          this.board.transition(
            current.id,
            ref.attempt,
            'blocked',
            this.deps.now(),
            UI_TEXT.teamTrafficNotices.uncertainAttempt,
          )
          // Even a not-created launch is journalled; caller explicitly resolves it.
          await this.deps.uncertain(ref)
          await this.deps.journal(this.board.snapshot())
        }
      } catch (error) {
        if (hasAttempt && this.isActive(ref)) {
          canRelease = false
          this.leases.set(this.key(ref), lease)
          this.slots.mark(ref, 'uncertain')
          this.board.finishAttempt(ref.taskId, ref.attempt, { state: 'uncertain' })
          this.board.transition(
            ref.taskId,
            ref.attempt,
            'blocked',
            this.deps.now(),
            UI_TEXT.teamTrafficNotices.uncertainAttempt,
          )
          await this.deps.uncertain(ref)
        }
        throw error
      } finally {
        if (canRelease) {
          this.slots.release(ref, 'notStarted')
          lease.release()
        }
        this.hasWake = true
      }
    }
  }

  startSweep(): void {
    if (this.sweep || this.isStopped) return
    const tick = (): void => {
      this.sweep = undefined
      void this.wake().catch((error: unknown) => {
        this.deps.failure(error)
      })
      if (!this.isStopped) this.sweep = this.deps.schedule(tick, TEAM_SCHED_TICK_MS)
    }
    this.sweep = this.deps.schedule(tick, TEAM_SCHED_TICK_MS)
  }

  /** Called for readiness, a free lane, lease release or recovered limit. */
  async wake(): Promise<void> {
    this.hasWake = true
    if (this.draining) {
      await this.draining
      return
    }
    this.draining = this.drain()
    try {
      await this.draining
    } finally {
      this.draining = undefined
    }
  }

  async retired(ref: Pick<SlotRequest, 'taskId' | 'attempt'>): Promise<void> {
    const attempt = this.board.task(ref.taskId).attempts.find((item) => item.number === ref.attempt)
    if (attempt?.state !== 'retired') throw new Error('team:notRetired')
    this.slots.release(ref, 'retired')
    this.leases.get(this.key(ref))?.release()
    this.leases.delete(this.key(ref))
    await this.deps.journal(this.board.snapshot())
    await this.wake()
  }

  providerOverloaded(agentProfileId: string): void {
    this.deps.halveAgentCap(agentProfileId)
  }

  stopSweep(): void {
    this.isStopped = true
    this.sweep?.()
    this.sweep = undefined
    // Active workers retain their slots and leases; stopping goes through retirement.
  }
}
// --- End M96c scheduler region. ---

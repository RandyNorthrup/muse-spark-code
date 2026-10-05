import { TEAM_DIFF_POLL_MS } from '../../shared/constants'
import { type SharedFiles } from './sharedFiles'
import { writeSetOverlap, type PlannedWriteSet } from './writeSets'

export interface PredictionTask {
  readonly taskId: string
  readonly attempt: number
  readonly files: readonly string[]
}
export interface PredictedConflict {
  readonly taskId: string
  readonly attempt: number
  readonly otherTaskId: string
  readonly paths: readonly string[]
}
export interface ConflictPredictionDeps {
  /** Running and waiting writing tasks, read from their immutable diff
   * snapshots. Q resolves ancestry and binary/added/deleted shapes. */
  readonly readTasks: () => Promise<readonly PredictionTask[]>
  readonly integrationFiles: (task: PredictionTask) => Promise<readonly string[]>
  /** Adapter to Q's landing mergeRoutine, without a formatter or a write.
   * Undefined `other` means the current integration state for this task. */
  readonly merge: (
    path: string,
    task: PredictionTask,
    other: PredictionTask | undefined,
  ) => Promise<{ kind: 'merged' | 'conflict' }>
  readonly onConflict: (conflict: PredictedConflict) => void
  readonly onError: (error: unknown) => void
}

export function plannedConflicts(
  tasks: readonly { taskId: string; set: PlannedWriteSet }[],
  shared: SharedFiles,
): PredictedConflict[] {
  const conflicts: PredictedConflict[] = []
  for (const [index, task] of tasks.entries()) {
    const others = tasks.slice(index + 1)
    for (const other of others) {
      const paths = writeSetOverlap(task.set, other.set, shared)
      if (paths.length > 0)
        conflicts.push({ taskId: task.taskId, attempt: 1, otherTaskId: other.taskId, paths })
    }
  }
  return conflicts
}

/** No timer starts at import/construction. Team activation starts polling;
 * known engine writes call poll immediately. Stop suppresses late results. */
export class ConflictPredictor {
  private timer: ReturnType<typeof setInterval> | undefined
  private pending: Promise<void> | undefined
  private again = false
  private generation = 0
  private seen = new Set<string>()

  constructor(private readonly deps: ConflictPredictionDeps) {}

  private async sweep(generation: number): Promise<void> {
    do {
      this.again = false
      const read = await this.deps.readTasks()
      const tasks = read.toSorted((left, right) => left.taskId.localeCompare(right.taskId))
      const conflicts: PredictedConflict[] = []
      for (const [index, task] of tasks.entries()) {
        const others = tasks.slice(index + 1)
        for (const other of others) {
          const files = task.files.filter((path) => other.files.includes(path))
          const paths: string[] = []
          for (const path of files) {
            const result = await this.deps.merge(path, task, other)
            if (result.kind === 'conflict') paths.push(path)
          }
          if (paths.length > 0)
            conflicts.push({
              taskId: task.taskId,
              attempt: task.attempt,
              otherTaskId: other.taskId,
              paths,
            })
        }
        const integration = await this.deps.integrationFiles(task)
        const paths: string[] = []
        for (const path of task.files) {
          if (!integration.includes(path)) continue
          const result = await this.deps.merge(path, task, undefined)
          if (result.kind === 'conflict') paths.push(path)
        }
        if (paths.length > 0)
          conflicts.push({
            taskId: task.taskId,
            attempt: task.attempt,
            otherTaskId: 'integration',
            paths,
          })
      }
      if (generation !== this.generation) return
      const next = new Set<string>()
      for (const conflict of conflicts) {
        for (const path of conflict.paths) {
          const identity = JSON.stringify([
            conflict.taskId,
            conflict.attempt,
            conflict.otherTaskId,
            path,
          ])
          next.add(identity)
          if (!this.seen.has(identity)) this.deps.onConflict({ ...conflict, paths: [path] })
        }
      }
      this.seen = next
    } while (this.shouldSweepAgain() && generation === this.generation)
  }

  private shouldSweepAgain(): boolean {
    return this.again
  }

  private async runSweep(generation: number): Promise<void> {
    try {
      await this.sweep(generation)
    } finally {
      this.pending = undefined
    }
  }

  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => {
      void this.poll().catch((error: unknown) => {
        this.deps.onError(error)
      })
    }, TEAM_DIFF_POLL_MS)
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.generation++
    this.seen.clear()
  }

  poll(): Promise<void> {
    if (this.pending !== undefined) {
      this.again = true
      return this.pending
    }
    this.pending = this.runSweep(this.generation)
    return this.pending
  }
}

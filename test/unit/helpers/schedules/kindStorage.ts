import {
  createScheduleLeaseLock,
  scheduleFsOperation,
} from '../../../../src/runtime/schedules/nodeScheduleFs'
import type {
  ScheduleFsPort,
  ScheduleLeaseGuard,
  ScheduleLockOptions,
} from '../../../../src/core/schedules/journal'

/** Fault-injectable disk with real serialized bytes, shared by production clients. */
export class MemoryScheduleFs implements ScheduleFsPort {
  private readonly leaseLock = createScheduleLeaseLock(this)
  readonly files = new Map<string, string>()
  readonly tails = new Map<string, Promise<undefined>>()
  readonly faults = new Map<string, number>()
  readonly directories = new Map<string, Set<string>>()
  constructor(shared?: MemoryScheduleFs) {
    // Independent port instances over one disk, just like createNodeScheduleFs.
    if (shared === undefined) return
    this.files = shared.files
    this.tails = shared.tails
    this.faults = shared.faults
    this.directories = shared.directories
  }
  private put(file: string, content: string): void {
    this.files.set(file, content)
    const parts = file.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      const folder = parts.slice(0, index).join('/')
      const entries = this.directories.get(folder) ?? new Set<string>()
      entries.add(parts[index]!)
      this.directories.set(folder, entries)
    }
  }
  fail(operation: string, file: string): void {
    const key = `${operation}:${file}`
    const remaining = this.faults.get(key) ?? 0
    if (remaining <= 0) return
    this.faults.set(key, remaining - 1)
    throw new Error('injected storage failure')
  }
  read(file: string): Promise<string | undefined> {
    return scheduleFsOperation('memory.read', () => {
      this.fail('read', file)
      return Promise.resolve(this.files.get(file))
    })
  }
  names(directory: string): Promise<readonly string[]> {
    return scheduleFsOperation('memory.names', () =>
      Promise.resolve([...(this.directories.get(directory) ?? [])]),
    )
  }
  async publish(file: string, content: string, guard?: () => Promise<void>): Promise<boolean> {
    await scheduleFsOperation('memory.publishGuard', async () => {
      await guard?.()
    })
    return await scheduleFsOperation('memory.publish', () => {
      this.fail('publish', file)
      if (this.files.has(file)) return Promise.resolve(false)
      this.put(file, content)
      return Promise.resolve(true)
    })
  }
  async replace(file: string, content: string, guard?: () => Promise<void>): Promise<void> {
    await scheduleFsOperation('memory.replaceGuard', async () => {
      await guard?.()
    })
    await scheduleFsOperation('memory.replace', () => {
      this.fail('replace', file)
      this.put(file, content)
      return Promise.resolve()
    })
  }
  remove(file: string): Promise<void> {
    return scheduleFsOperation('memory.remove', () => {
      this.fail('remove', file)
      this.files.delete(file)
      this.directories.delete(file)
      const slash = file.lastIndexOf('/')
      this.directories.get(file.slice(0, slash))?.delete(file.slice(slash + 1))
      return Promise.resolve()
    })
  }
  async lock<T>(
    key: string,
    work: (guard: ScheduleLeaseGuard) => Promise<T>,
    options?: ScheduleLockOptions,
  ): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve(undefined)
    const next = Promise.withResolvers<undefined>()
    this.tails.set(key, next.promise)
    // An abandoned slot never strands its chain: it resolves with its
    // predecessor, so repeated refreshes against a persistent holder leave
    // no live waiter behind. A finished last waiter removes its own tail.
    let isReleased = false
    const release = (isAborted: boolean) => {
      if (isReleased) return
      isReleased = true
      const finish = () => {
        next.resolve(undefined)
        if (this.tails.get(key) === next.promise) this.tails.delete(key)
      }
      if (isAborted) void previous.then(finish).catch(finish)
      else finish()
    }
    const signal = options?.signal
    const rawDeadline = options?.deadlineMs
    const deadlineMs =
      rawDeadline !== undefined && !Number.isNaN(rawDeadline) ? rawDeadline : undefined
    // The deadline binds first: a valid holder past the wait is busy, never
    // an abandon that later publishes; an explicit abort ends the wait. The
    // wakeup below only interrupts; this check names the word.
    const checkWaiting = (isDeadlineElapsed = false) => {
      if (isDeadlineElapsed || (deadlineMs !== undefined && Date.now() >= deadlineMs))
        throw new Error('scheduleLeaseBusy')
      signal?.throwIfAborted()
    }
    try {
      checkWaiting()
      if (signal !== undefined || deadlineMs !== undefined) {
        let timer: ReturnType<typeof setTimeout> | undefined
        let onAbort: (() => void) | undefined
        let isDeadlineElapsed = false
        try {
          const wakeups: Promise<unknown>[] = [previous]
          if (signal !== undefined) {
            wakeups.push(
              new Promise<never>((_resolve, reject) => {
                onAbort = () => {
                  reject(new Error('scheduleLockWaitInterrupted'))
                }
                if (signal.aborted) {
                  reject(new Error('scheduleLockWaitInterrupted'))
                } else signal.addEventListener('abort', onAbort, { once: true })
              }),
            )
          }
          if (deadlineMs !== undefined) {
            const remaining = deadlineMs - Date.now()
            wakeups.push(
              new Promise<never>((_resolve, reject) => {
                if (remaining <= 0) {
                  isDeadlineElapsed = true
                  reject(new Error('scheduleLockWaitInterrupted'))
                } else {
                  timer = setTimeout(() => {
                    // The timer firing is the deadline event itself: it runs
                    // on the monotonic clock, while a wall re-read below can
                    // still land before the deadline on the same turn.
                    isDeadlineElapsed = true
                    reject(new Error('scheduleLockWaitInterrupted'))
                  }, remaining)
                }
              }),
            )
          }
          try {
            await Promise.race(wakeups)
          } catch (error) {
            // A rejected race skips straight to the outer catch, so the
            // terminal word is named here on the rejection path: the wakeup
            // only interrupts, and the sentinel must never escape.
            checkWaiting(isDeadlineElapsed)
            throw error
          }
        } finally {
          if (timer !== undefined) clearTimeout(timer)
          if (onAbort !== undefined && signal !== undefined)
            signal.removeEventListener('abort', onAbort)
        }
      } else {
        await previous
      }
      checkWaiting()
      try {
        return await this.leaseLock(key, work, options)
      } finally {
        release(false)
      }
    } catch (error) {
      release(true)
      throw error
    }
  }
  bytes(prefix = ''): number {
    return [...this.files]
      .filter(([file]) => file.startsWith(prefix))
      .reduce((total, [, content]) => total + Buffer.byteLength(content), 0)
  }
}

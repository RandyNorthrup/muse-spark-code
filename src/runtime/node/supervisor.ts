import * as z from 'zod/mini'
import {
  NODE_MAX_PAGE_ITEMS,
  NODE_RESTART_DELAY_MS,
  NODE_RESTART_MAX_MS,
  NODE_STATE_MAX_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { nodeIdentifierSchema } from '../../shared/nodeAuth'
import { isMissingFile, type NodePrivateFiles } from './privateFiles'
import type { NodeRunPolicy } from './attendance'
import { type NodeAttendance } from './attendance'

const attemptsSchema = z
  .array(
    z.strictObject({
      id: nodeIdentifierSchema,
      state: z.enum(['running', 'completed', 'blocked']),
    }),
  )
  .check(z.maxLength(NODE_MAX_PAGE_ITEMS))
type Attempts = z.infer<typeof attemptsSchema>

/** A durable running attempt becomes blocked on boot, never automatically replayed. */
export class NodeAttempts {
  private attempts: Attempts = []
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly files: NodePrivateFiles,
    private readonly attendance: NodeAttendance,
  ) {}

  private transaction(change: (attempts: Attempts) => void): Promise<void> {
    const previous = this.queue
    const result = (async () => {
      await previous
      const next = structuredClone(this.attempts)
      change(next)
      attemptsSchema.parse(next)
      await this.files.write('attempts.v1.json', JSON.stringify(next))
      this.attempts = next
    })()
    this.queue = (async () => {
      try {
        await result
      } catch {
        /* Keep the journal usable after a refused admission. */
      }
    })()
    return result
  }

  async reconcile(): Promise<void> {
    try {
      const input: unknown = JSON.parse(
        await this.files.read('attempts.v1.json', NODE_STATE_MAX_BYTES),
      )
      this.attempts = attemptsSchema.parse(input)
      if (new Set(this.attempts.map((item) => item.id)).size !== this.attempts.length) {
        throw new Error(UI_TEXT.nodeErrors.invalidRequest)
      }
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error
    }
    await this.transaction((attempts) => {
      for (const attempt of attempts) if (attempt.state === 'running') attempt.state = 'blocked'
    })
  }

  blocked(): string[] {
    return this.attempts
      .filter((attempt) => attempt.state === 'blocked')
      .map((attempt) => attempt.id)
  }

  async run<T>(
    id: string,
    policy: NodeRunPolicy,
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    nodeIdentifierSchema.parse(id)
    signal.throwIfAborted()
    this.attendance.assertRunAllowed(policy)
    await this.transaction((attempts) => {
      if (attempts.some((attempt) => attempt.id === id))
        throw new Error(UI_TEXT.nodeErrors.conflict)
      attempts.push({ id, state: 'running' })
    })
    try {
      // Recheck after durable admission; a person can detach during the write.
      signal.throwIfAborted()
      this.attendance.assertRunAllowed(policy)
      const value = await work(signal)
      await this.transaction((attempts) => {
        for (const attempt of attempts) if (attempt.id === id) attempt.state = 'completed'
      })
      return value
    } catch (error: unknown) {
      await this.transaction((attempts) => {
        for (const attempt of attempts) if (attempt.id === id) attempt.state = 'blocked'
      })
      throw error
    }
  }
}

export interface NodeServiceInstance {
  run(signal: AbortSignal): Promise<void>
  stop(): Promise<void>
}

/** The deployment starts one service; every restart rebuilds it sealed and reconciles. */
export async function superviseNode(
  create: () => Promise<NodeServiceInstance>,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const isStopping = () => signal.aborted
  let delay = NODE_RESTART_DELAY_MS
  while (!isStopping()) {
    let service: NodeServiceInstance | undefined
    try {
      service = await create()
      await service.run(signal)
      return
    } catch (error: unknown) {
      if (isStopping()) return
      if (!(error instanceof Error)) throw error
    } finally {
      await service?.stop()
    }
    try {
      await sleep(delay, signal)
    } catch (error: unknown) {
      if (isStopping()) return
      throw error
    }
    delay = Math.min(delay * 2, NODE_RESTART_MAX_MS)
  }
}

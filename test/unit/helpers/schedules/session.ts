import type { ScheduleRunContext, ScheduleSessionPort } from '../../../../src/shared/scheduleV2'
import type { ScheduleDeliverySession } from '../../../../src/core/schedules/delivery'

export type FakeScheduleSessionCall =
  | { readonly kind: 'cancel' }
  | {
      readonly kind: 'send' | 'steer' | 'queue'
      readonly prompt: string
      readonly context: ScheduleRunContext
    }
  | { readonly kind: 'withdraw'; readonly messageId: string }

/** The delivery lane decides what to call; the fake records backend operations. */
export class FakeScheduleSession implements ScheduleSessionPort {
  readonly calls: FakeScheduleSessionCall[] = []
  readonly queued = new Map<string, { prompt: string; context: ScheduleRunContext }>()
  running = false
  open = true
  constructor(
    readonly backend: ScheduleSessionPort['backend'],
    readonly sessionId = 'session-1',
  ) {}
  isRunning(): boolean {
    return this.running
  }
  isOpen(): boolean {
    return this.open
  }
  steer(prompt: string, context: ScheduleRunContext): Promise<void> {
    if (!this.running) return Promise.reject(new Error('Cannot steer an idle session'))
    this.calls.push({ kind: 'steer', prompt, context: structuredClone(context) })
    return Promise.resolve()
  }
  cancel(): Promise<void> {
    this.calls.push({ kind: 'cancel' })
    this.running = false
    return Promise.resolve()
  }
  queue(prompt: string, context: ScheduleRunContext): Promise<string> {
    const id = `queued-${String(this.calls.length)}`
    this.queued.set(id, { prompt, context: structuredClone(context) })
    this.calls.push({ kind: 'queue', prompt, context: structuredClone(context) })
    return Promise.resolve(id)
  }
  withdraw(messageId: string): Promise<boolean> {
    this.calls.push({ kind: 'withdraw', messageId })
    return Promise.resolve(this.queued.delete(messageId))
  }
  send(prompt: string, context: ScheduleRunContext): Promise<void> {
    if (this.running) return Promise.reject(new Error('Cannot send a new turn while running'))
    this.running = true
    this.calls.push({ kind: 'send', prompt, context: structuredClone(context) })
    return Promise.resolve()
  }
}

/** A fake delivery session with abortable idle waits, shared by the delivery
 * and restart-recovery tests. */
export class IdleScheduleSession extends FakeScheduleSession implements ScheduleDeliverySession {
  private readonly idle = new Set<(isIdle: boolean) => void>()
  waitUntilIdle(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || !this.open) return Promise.resolve(false)
    if (!this.running) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (isIdle: boolean): void => {
        this.idle.delete(done)
        signal.removeEventListener('abort', aborted)
        resolve(isIdle)
      }
      const aborted = (): void => {
        done(false)
      }
      this.idle.add(done)
      signal.addEventListener('abort', aborted, { once: true })
    })
  }
  queueWhenIdle(
    prompt: string,
    context: ScheduleRunContext,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    return signal.aborted ? Promise.resolve(undefined) : this.queue(prompt, context)
  }
  idleNow(): void {
    this.running = false
    for (const done of this.idle) done(this.open)
  }
}

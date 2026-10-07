import type { ScheduleRunContext, ScheduleSessionPort } from '../../../../src/shared/scheduleV2'

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

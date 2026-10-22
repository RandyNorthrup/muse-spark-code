import type { NodeClock } from '../../../../src/shared/node'

/** Wall-clock changes never move the elapsed-time clock. */
export class FakeNodeClock implements NodeClock {
  private wallMs = Date.UTC(2026, 9, 5)
  private elapsedMs = 0
  now(): number {
    return this.wallMs
  }
  monotonicMs(): number {
    return this.elapsedMs
  }
  advance(ms: number): void {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('invalid elapsed time')
    this.wallMs += ms
    this.elapsedMs += ms
  }
  shiftWall(ms: number): void {
    if (!Number.isSafeInteger(ms)) throw new TypeError('invalid wall-clock shift')
    this.wallMs += ms
  }
}

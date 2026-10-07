import { scheduleZoneSchema } from '../../../../src/shared/scheduleV2'

/** Independent wall/monotonic clocks. Intl supplies real IANA gap/fold data. */
export class FakeScheduleClock {
  private wallMs: number
  private elapsedMs = 0
  private currentZone: string
  now = (): number => this.wallMs
  monotonicNow = (): number => this.elapsedMs
  zone = (): string => this.currentZone
  constructor(at: string | number, zone = 'UTC') {
    this.wallMs = typeof at === 'string' ? Date.parse(at) : at
    if (!Number.isFinite(this.wallMs)) throw new Error('Invalid fake clock instant')
    this.currentZone = scheduleZoneSchema.parse(zone)
  }
  advance(ms: number): void {
    if (ms < 0) throw new Error('Monotonic time cannot go backwards')
    this.wallMs += ms
    this.elapsedMs += ms
  }
  jumpWall(ms: number): void {
    this.wallMs += ms
  }
  sleep(ms: number): void {
    this.jumpWall(ms)
  }
  moveToZone(zone: string): void {
    this.currentZone = scheduleZoneSchema.parse(zone)
  }
  localAt(atMs = this.wallMs, zone = this.currentZone): Record<string, string> {
    return Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(atMs)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )
  }
}

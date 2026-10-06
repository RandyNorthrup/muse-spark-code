import * as z from 'zod/mini'
import {
  resourceTreeUsageSchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
  type ResourceTreeReader,
  type ResourceTreeUsage,
} from '../../../shared/resources'
import { processSampleSchema, type ProcessSample } from './posixTable'

export interface PosixTreeSnapshot {
  /** Already restricted to the requested group or cgroup by the OS adapter. */
  readonly rows: readonly ProcessSample[]
  /** A cgroup's lifetime CPU counter; null uses observed per-process CPU. */
  readonly cpuSeconds: number | null
}

/** The adapter reads current membership, never a cached action-time table. */
export interface PosixTreeSource {
  snapshot(ticket: ResourceTicket): Promise<PosixTreeSnapshot | null>
  /** Fresh proof for the authority anchor and each action after the accounting scan. */
  containsNow(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean>
}

/** Common group/start proof and accounting, with no editor or actuator dependency. */
export class PosixResourceTreeReader implements ResourceTreeReader {
  private readonly states = new Map<
    string,
    { signature: string; known: Map<number, string>; cpu: Map<string, number> }
  >()
  constructor(private readonly source: PosixTreeSource) {}

  private async read(
    ticket: ResourceTicket,
  ): Promise<{ rows: readonly ProcessSample[]; cpuSeconds: number; epoch: object } | null> {
    if (
      ticket.scope.type === 'job' ||
      (ticket.scope.type === 'group' && ticket.scope.pgid !== ticket.root.pid)
    )
      return null
    const signature = JSON.stringify(ticket)
    const prior = this.states.get(ticket.id)
    const state =
      prior?.signature === signature
        ? prior
        : { signature, known: new Map<number, string>(), cpu: new Map<string, number>() }
    // The state object is this ticket's epoch; forget invalidates every pending continuation.
    this.states.set(ticket.id, state)
    const snapshot = await this.source.snapshot(ticket)
    if (snapshot === null || this.states.get(ticket.id) !== state) return null
    const rows = z
      .array(processSampleSchema)
      .parse(snapshot.rows)
      .filter(
        (row) =>
          !row.exited &&
          row.pid !== process.pid &&
          (ticket.scope.type !== 'group' || row.pgid === ticket.scope.pgid),
      )
    // POSIX adapters return exact, decimal kernel start counters, not ps's second-resolution lstart.
    if (!/^\d+$/.test(ticket.root.startTime) || rows.some((row) => !/^\d+$/.test(row.startTime)))
      return null
    const root = rows.find((row) => row.pid === ticket.root.pid)
    const anchor = root ?? rows.find((row) => state.known.get(row.pid) === row.startTime)
    if (anchor === undefined || (root !== undefined && root.startTime !== ticket.root.startTime)) {
      this.states.delete(ticket.id)
      return null
    }
    // A scan can span group reuse; only a still-current authority may introduce witnesses.
    if (!(await this.source.containsNow(ticket, anchor))) return null
    if (this.states.get(ticket.id) !== state) return null
    const members = rows.filter((row) => BigInt(row.startTime) >= BigInt(ticket.root.startTime))
    state.known = new Map(members.map((row) => [row.pid, row.startTime]))
    for (const member of members) {
      const key = `${String(member.pid)}/${member.startTime}`
      state.cpu.set(key, Math.max(state.cpu.get(key) ?? 0, member.cpuSeconds))
    }
    let observedCpu = 0
    for (const value of state.cpu.values()) observedCpu += value
    const cpuSeconds = snapshot.cpuSeconds ?? observedCpu
    return { rows: members, cpuSeconds, epoch: state }
  }

  forget(ticket: ResourceTicket): void {
    this.states.delete(ticket.id)
  }

  async members(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[]> {
    const snapshot = await this.read(ticket)
    return snapshot?.rows.map(({ pid, startTime }) => ({ pid, startTime })) ?? []
  }

  async contains(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean> {
    const snapshot = await this.read(ticket)
    return snapshot?.rows.some(
      (row) => row.pid === identity.pid && row.startTime === identity.startTime,
    )
      ? (await this.source.containsNow(ticket, identity)) &&
          this.states.get(ticket.id) === snapshot.epoch
      : false
  }

  async usage(ticket: ResourceTicket): Promise<ResourceTreeUsage | null> {
    const snapshot = await this.read(ticket)
    return snapshot === null
      ? null
      : resourceTreeUsageSchema.parse({
          cpuSeconds: snapshot.cpuSeconds,
          residentBytes: snapshot.rows.reduce((sum, row) => sum + row.residentBytes, 0),
        })
  }
}

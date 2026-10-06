import * as z from 'zod/mini'
import {
  resourceTreeUsageSchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
  type ResourceTreeReader,
  type ResourceTreeUsage,
} from '../../../shared/resources'
import { processSampleSchema, type ProcessSample } from './posixTable'
import type { ResourceActionResult, ResourceSignal } from './actions'

export interface PosixTreeSnapshot {
  /** Group sources include the full ancestry table; cgroups restrict by kernel membership. */
  readonly rows: readonly ProcessSample[]
  /** A cgroup's lifetime CPU counter; null uses observed per-process CPU. */
  readonly cpuSeconds: number | null
  /** Numerical rows whose native birth read was refused, distinct from a gone process. */
  readonly unavailable?: readonly { pid: number; parent: number; pgid: number }[]
}

const unavailableProcessSchema = z.strictObject({
  pid: processSampleSchema.shape.pid,
  parent: processSampleSchema.shape.parent,
  pgid: processSampleSchema.shape.pgid,
})

/** Every action/enrollment proof is fresh, never the accounting-time table. */
export interface PosixTreeSource {
  snapshot(ticket: ResourceTicket): Promise<PosixTreeSnapshot | null>
  containsNow(
    ticket: ResourceTicket,
    identity: ResourceProcessIdentity,
    isEnrolled?: boolean,
    parent?: ResourceProcessIdentity,
  ): Promise<boolean>
  signalNow?(
    identity: ResourceProcessIdentity,
    signal: ResourceSignal,
    isRegistered: () => boolean,
  ): Promise<ResourceActionResult>
}

/** Exact observed ancestry survives reparenting and new sessions; unknown ancestry never does. */
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
    this.states.set(ticket.id, state)
    const snapshot = await this.source.snapshot(ticket)
    if (snapshot === null || this.states.get(ticket.id) !== state) return null
    const rows = z
      .array(processSampleSchema)
      .parse(snapshot.rows)
      .filter((row) => row.pid !== process.pid)
    const unavailable = z.array(unavailableProcessSchema).parse(snapshot.unavailable ?? [])
    if (
      unavailable.some(
        (row) =>
          row.pid === ticket.root.pid ||
          state.known.has(row.pid) ||
          (ticket.scope.type === 'group' && row.pgid === ticket.scope.pgid),
      ) ||
      !/^\d+$/.test(ticket.root.startTime) ||
      rows.some((row) => !/^\d+$/.test(row.startTime))
    )
      return null
    const root = rows.find((row) => row.pid === ticket.root.pid)
    const hasRootChanged = root !== undefined && root.startTime !== ticket.root.startTime
    if (
      hasRootChanged &&
      rows.every((row) => row.exited || state.known.get(row.pid) !== row.startTime)
    ) {
      this.states.delete(ticket.id)
      return null
    }
    const isKnown = (row: ResourceProcessIdentity) => state.known.get(row.pid) === row.startTime
    const isInScope = (row: ProcessSample) =>
      ticket.scope.type !== 'group' || row.pgid === ticket.scope.pgid
    const live = rows.filter((row) => !row.exited)
    const anchor =
      live.find(
        (row) =>
          row.pid === ticket.root.pid &&
          row.startTime === ticket.root.startTime &&
          (isKnown(row) || isInScope(row)),
      ) ?? live.find((row) => isKnown(row))
    if (anchor === undefined) {
      // No live member means completion only if there is no unproven replacement in the scope.
      if (state.known.size === 0 || live.some((row) => isInScope(row))) return null
    } else {
      if (
        !(await this.source.containsNow(ticket, anchor, isKnown(anchor))) ||
        this.states.get(ticket.id) !== state
      )
        return null
    }
    const isScopeAnchored =
      anchor !== undefined &&
      (ticket.scope.type !== 'group' ||
        (anchor.pgid === ticket.scope.pgid && (await this.source.containsNow(ticket, anchor))))
    if (this.states.get(ticket.id) !== state) return null
    const members =
      anchor === undefined
        ? []
        : live.filter(
            (row) =>
              BigInt(row.startTime) >= BigInt(ticket.root.startTime) &&
              (isKnown(row) ||
                (isScopeAnchored &&
                  isInScope(row) &&
                  (ticket.scope.type === 'cgroup' || !state.known.has(row.pid)))),
          )
    // A scope proof admits its current members. Detached newcomers need an observed,
    // freshly verified parent identity and a still-current parent edge at enrollment.
    const accepted = new Map(members.map((row) => [row.pid, row]))
    for (const row of members) state.known.set(row.pid, row.startTime)
    let hasGrown = true
    while (hasGrown) {
      hasGrown = false
      for (const row of live) {
        if (accepted.has(row.pid) || isKnown(row)) continue
        const parent = accepted.get(row.parent)
        if (
          parent === undefined ||
          BigInt(row.startTime) < BigInt(parent.startTime) ||
          !(await this.source.containsNow(ticket, row, true, parent))
        )
          continue
        if (this.states.get(ticket.id) !== state) return null
        accepted.set(row.pid, row)
        state.known.set(row.pid, row.startTime)
        hasGrown = true
      }
    }
    if (this.states.get(ticket.id) !== state || unavailable.some((row) => accepted.has(row.parent)))
      return null
    const enrolledRows: ProcessSample[] = []
    for (const member of accepted.values()) {
      enrolledRows.push(member)
      const key = `${String(member.pid)}/${member.startTime}`
      state.cpu.set(key, Math.max(state.cpu.get(key) ?? 0, member.cpuSeconds))
    }
    let observedCpu = 0
    for (const value of state.cpu.values()) observedCpu += value
    return {
      rows: enrolledRows,
      cpuSeconds: snapshot.cpuSeconds ?? observedCpu,
      epoch: state,
    }
  }

  private async enrollRoot(ticket: ResourceTicket): Promise<boolean> {
    if (
      ticket.scope.type === 'job' ||
      (ticket.scope.type === 'group' && ticket.scope.pgid !== ticket.root.pid) ||
      ticket.root.pid === process.pid ||
      !/^\d+$/.test(ticket.root.startTime)
    )
      return false
    const state = {
      signature: JSON.stringify(ticket),
      known: new Map<number, string>(),
      cpu: new Map<string, number>(),
    }
    this.states.set(ticket.id, state)
    let isEnrolled = false
    try {
      if (
        !(await this.source.containsNow(ticket, ticket.root)) ||
        this.states.get(ticket.id) !== state
      )
        return false
      state.known.set(ticket.root.pid, ticket.root.startTime)
      try {
        await this.read(ticket)
      } catch {
        // Unknown accounting adds no descendants; targeted native launch authority is independent.
      }
      isEnrolled =
        this.states.get(ticket.id) === state &&
        (await this.source.containsNow(ticket, ticket.root)) &&
        this.states.get(ticket.id) === state
      return isEnrolled
    } catch {
      return false
    } finally {
      if (!isEnrolled && this.states.get(ticket.id) === state) this.states.delete(ticket.id)
    }
  }

  forget(ticket: ResourceTicket): void {
    this.states.delete(ticket.id)
  }

  async members(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[]> {
    const snapshot = await this.read(ticket)
    return snapshot?.rows.map(({ pid, startTime }) => ({ pid, startTime })) ?? []
  }

  async actionMembers(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[] | null> {
    const snapshot = await this.read(ticket)
    const state = this.states.get(ticket.id)
    return snapshot === null || state !== snapshot.epoch
      ? null
      : [...state.known].map(([pid, startTime]) => ({ pid, startTime }))
  }

  async signal(
    ticket: ResourceTicket,
    identity: ResourceProcessIdentity,
    signal: ResourceSignal,
    isRegistered: () => boolean,
  ): Promise<ResourceActionResult> {
    let state = this.states.get(ticket.id)
    if (state?.known.get(identity.pid) !== identity.startTime) {
      await this.read(ticket)
      state = this.states.get(ticket.id)
    }
    return state?.signature !== JSON.stringify(ticket) ||
      state.known.get(identity.pid) !== identity.startTime ||
      this.source.signalNow === undefined ||
      !isRegistered()
      ? 'refused'
      : await this.source.signalNow(
          identity,
          signal,
          () => isRegistered() && this.states.get(ticket.id) === state,
        )
  }

  async contains(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean> {
    const state = this.states.get(ticket.id)
    if (
      identity.pid === ticket.root.pid &&
      identity.startTime === ticket.root.startTime &&
      (state?.signature !== JSON.stringify(ticket) || state.known.size === 0)
    )
      return await this.enrollRoot(ticket)
    const snapshot = await this.read(ticket)
    return snapshot?.rows.some(
      (row) => row.pid === identity.pid && row.startTime === identity.startTime,
    )
      ? (await this.source.containsNow(ticket, identity, true)) &&
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

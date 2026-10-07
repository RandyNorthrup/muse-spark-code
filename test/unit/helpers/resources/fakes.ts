import { vi } from 'vitest'
import {
  deviceResourceSchema,
  resourceSampleSchema,
  resourceTicketSchema,
  resourceTreeUsageSchema,
  type DeviceResource,
  type ResourceClock,
  type ResourceLinkedDevice,
  type ResourceProcessIdentity,
  type ResourceSample,
  type ResourceSampler,
  type ResourceTicket,
  type ResourceTreeReader,
  type ResourceTreeUsage,
} from '../../../../src/shared/resources'

export function fakeResourceLease(isStopped = false) {
  return {
    register: vi.fn(),
    complete: vi.fn(),
    background: vi.fn(),
    kill: vi.fn(() => Promise.resolve(isStopped)),
    isTreeGone: vi.fn(() => Promise.resolve(false)),
  }
}

/** A missing step throws; failed readings must be scripted as explicit nulls. */
export class ScriptedResourceSampler implements ResourceSampler {
  calls = 0
  constructor(private readonly steps: readonly ResourceSample[]) {}
  sample(): Promise<ResourceSample> {
    const step = this.steps[this.calls++]
    return step === undefined
      ? Promise.reject(new Error('Resource sampler script exhausted'))
      : Promise.resolve(resourceSampleSchema.parse(structuredClone(step)))
  }
}

export class FakeResourceClock implements ResourceClock {
  private time = 0
  private nextId = 0
  private readonly pending = new Map<number, { at: number; callback: () => void }>()
  now(): number {
    return this.time
  }
  setTimeout(callback: () => void, delayMs: number): () => void {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('Invalid clock delay')
    const id = this.nextId++
    this.pending.set(id, { at: this.time + delayMs, callback })
    return () => {
      this.pending.delete(id)
    }
  }
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Invalid clock advance')
    const target = this.time + ms
    for (;;) {
      let due: { id: number; at: number; callback: () => void } | undefined
      for (const [id, entry] of this.pending) {
        if (
          entry.at <= target &&
          (due === undefined || entry.at < due.at || (entry.at === due.at && id < due.id))
        )
          due = { id, ...entry }
      }
      if (due === undefined) break
      this.time = due.at
      this.pending.delete(due.id)
      due.callback()
    }
    this.time = target
  }
}

export class FakeResourceTree implements ResourceTreeReader {
  private readonly trees = new Map<string, ResourceTicket>()
  private readonly processes = new Map<
    number,
    { identity: ResourceProcessIdentity; treeId: string; usage: ResourceTreeUsage }
  >()
  private isCurrent(ticket: ResourceTicket): boolean {
    const registered = this.trees.get(ticket.id)
    const root = this.processes.get(ticket.root.pid)
    return (
      registered?.root.pid === ticket.root.pid &&
      registered.root.startTime === ticket.root.startTime &&
      root?.treeId === ticket.id &&
      root.identity.startTime === ticket.root.startTime
    )
  }
  register(ticket: ResourceTicket): void {
    if (this.trees.has(ticket.id)) throw new Error('Resource ticket already registered')
    this.trees.set(ticket.id, resourceTicketSchema.parse(structuredClone(ticket)))
  }
  put(treeId: string, identity: ResourceProcessIdentity, usage: ResourceTreeUsage): void {
    if (!this.trees.has(treeId)) throw new Error('Resource tree not registered')
    this.processes.set(identity.pid, {
      treeId,
      identity: structuredClone(identity),
      usage: resourceTreeUsageSchema.parse(usage),
    })
  }
  remove(pid: number): void {
    this.processes.delete(pid)
  }
  members(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[]> {
    const members: ResourceProcessIdentity[] = []
    if (this.isCurrent(ticket)) {
      for (const process of this.processes.values()) {
        if (process.treeId === ticket.id) members.push(structuredClone(process.identity))
      }
    }
    return Promise.resolve(members)
  }
  contains(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean> {
    const process = this.processes.get(identity.pid)
    return Promise.resolve(
      this.isCurrent(ticket) &&
        process?.treeId === ticket.id &&
        process.identity.startTime === identity.startTime,
    )
  }
  usage(ticket: ResourceTicket): Promise<ResourceTreeUsage | null> {
    if (!this.isCurrent(ticket)) return Promise.resolve(null)
    const sum = { cpuSeconds: 0, residentBytes: 0 }
    for (const process of this.processes.values()) {
      if (process.treeId !== ticket.id) continue
      sum.cpuSeconds += process.usage.cpuSeconds
      sum.residentBytes += process.usage.residentBytes
    }
    return Promise.resolve(sum)
  }
}

/** Resource admission only; M100 still supplies pairing, consent and retirement. */
export class FakeResourceLinkedDevice implements ResourceLinkedDevice {
  private readonly offers = new Map<string, Set<'worker' | 'check'>>()
  private status: DeviceResource = { level: 'normal', headroom: 'ample' }
  readonly admissions: { repository: string; kind: 'worker' | 'check'; isAllowed: boolean }[] = []
  setResource(status: DeviceResource): void {
    this.status = deviceResourceSchema.parse(status)
  }
  offer(repository: string, kinds: readonly ('worker' | 'check')[]): void {
    this.offers.set(repository, new Set(kinds))
  }
  revoke(repository: string): void {
    this.offers.delete(repository)
  }
  resource(): Promise<DeviceResource> {
    return Promise.resolve(structuredClone(this.status))
  }
  hasOffer(repository: string, kind: 'worker' | 'check'): boolean {
    return this.offers.get(repository)?.has(kind) === true
  }
  admit(repository: string, kind: 'worker' | 'check'): Promise<boolean> {
    const isAllowed = this.status.level === 'normal' && this.hasOffer(repository, kind)
    this.admissions.push({ repository, kind, isAllowed })
    return Promise.resolve(isAllowed)
  }
}

import * as z from 'zod/mini'
import {
  resourceProcessIdentitySchema,
  resourceTicketSchema,
  resourceTreeUsageSchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
  type ResourceTreeReader,
  type ResourceTreeUsage,
} from '../../../shared/resources'

/** Local launch authority. OS readers prove membership; tickets never confer it alone. */
export class ResourceTreeRegistry implements ResourceTreeReader {
  private readonly entries = new Map<string, { ticket: ResourceTicket; ready: boolean }>()

  constructor(
    private readonly reader: ResourceTreeReader & {
      forget?: (ticket: ResourceTicket) => void
      kill?: (ticket: ResourceTicket, member: ResourceProcessIdentity) => Promise<boolean>
    },
  ) {}

  private entry(ticket: ResourceTicket): { ticket: ResourceTicket; ready: boolean } | undefined {
    const parsed = resourceTicketSchema.safeParse(ticket)
    if (!parsed.success) return undefined
    const entry = this.entries.get(parsed.data.id)
    return entry !== undefined && JSON.stringify(entry.ticket) === JSON.stringify(parsed.data)
      ? entry
      : undefined
  }

  /** Call at launch, with the OS start identity and the scope the launcher created. */
  async register(input: ResourceTicket): Promise<ResourceTicket> {
    const ticket = resourceTicketSchema.parse(input)
    if (ticket.root.pid === process.pid) throw new Error('Cannot govern the harness process')
    for (const entry of this.entries.values()) {
      if (
        entry.ticket.id === ticket.id ||
        entry.ticket.root.pid === ticket.root.pid ||
        JSON.stringify(entry.ticket.scope) === JSON.stringify(ticket.scope)
      )
        throw new Error('Resource tree already registered')
    }
    const entry = { ticket, ready: false }
    this.entries.set(ticket.id, entry)
    try {
      if (!(await this.reader.contains(structuredClone(ticket), structuredClone(ticket.root))))
        throw new Error('Resource root membership not proven')
      if (this.entries.get(ticket.id) !== entry) throw new Error('Resource registration cancelled')
      entry.ready = true
      return structuredClone(ticket)
    } catch (error: unknown) {
      if (this.entries.get(ticket.id) === entry) {
        this.entries.delete(ticket.id)
        this.reader.forget?.(structuredClone(ticket))
      }
      throw error
    }
  }

  /** Retire on tree completion, rather than merely the root's exit. */
  unregister(ticket: ResourceTicket): void {
    if (this.entry(ticket) === undefined) return
    this.entries.delete(ticket.id)
    this.reader.forget?.(structuredClone(ticket))
  }

  tickets(): readonly ResourceTicket[] {
    const tickets: ResourceTicket[] = []
    for (const entry of this.entries.values()) {
      if (entry.ready) tickets.push(structuredClone(entry.ticket))
    }
    return tickets
  }

  /** Stop is an explicit owner action, outside governor admission and policy. */
  async kill(ticket: ResourceTicket): Promise<boolean> {
    const entry = this.entry(ticket)
    if (entry?.ready !== true || this.reader.kill === undefined) return false
    const members = await this.members(ticket)
    for (const member of members) {
      if (this.entry(ticket) !== entry) return false
      if (await this.contains(ticket, member)) {
        return await this.reader.kill(structuredClone(entry.ticket), member)
      }
    }
    return false
  }

  async contains(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean> {
    const entry = this.entry(ticket)
    const parsed = resourceProcessIdentitySchema.safeParse(identity)
    if (entry?.ready !== true || !parsed.success || parsed.data.pid === process.pid) return false
    try {
      const isMember = await this.reader.contains(structuredClone(entry.ticket), parsed.data)
      return isMember && this.entry(ticket) === entry
    } catch {
      return false
    }
  }

  async members(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[]> {
    const entry = this.entry(ticket)
    if (entry?.ready !== true) return []
    try {
      const members = z
        .array(resourceProcessIdentitySchema)
        .parse(await this.reader.members(structuredClone(entry.ticket)))
      return this.entry(ticket) === entry
        ? members.filter((member) => member.pid !== process.pid)
        : []
    } catch {
      return []
    }
  }

  async usage(ticket: ResourceTicket): Promise<ResourceTreeUsage | null> {
    const entry = this.entry(ticket)
    if (entry?.ready !== true) return null
    try {
      const usage = await this.reader.usage(structuredClone(entry.ticket))
      return usage !== null && this.entry(ticket) === entry
        ? resourceTreeUsageSchema.parse(usage)
        : null
    } catch {
      return null
    }
  }
}

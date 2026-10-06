import {
  resourceLevelSchema,
  resourceTicketSchema,
  type ResourceLevel,
  type ResourceProcessIdentity,
  type ResourceTicket,
  type ResourceTreeReader,
} from '../../../shared/resources'
import type {
  ResourceActionResult,
  ResourceActuatorPort,
  ResourceControl,
  ResourceTreeCompletionPort,
} from './controls'

interface SavedControl {
  readonly control: ResourceControl
  original: string | null
  dirty: boolean
  applied: string | null
}
interface TreeControls {
  readonly ticket: ResourceTicket
  readonly saved: Map<string, SavedControl>
}

/** G calls setLevel on transitions and tree scans; C calls retire BEFORE unregistering a live tree. */
export class ResourceActuators {
  private readonly trees = new Map<string, TreeControls>()
  private readonly pending = new Map<string, Promise<unknown>>()

  constructor(
    private readonly registry: ResourceTreeReader,
    private readonly port: ResourceActuatorPort,
  ) {}

  private async serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const prior = this.pending.get(id)
    const next = (async () => {
      try {
        await prior
      } catch {
        // A failed operation must not block a later recovery attempt.
      }
      return await action()
    })()
    this.pending.set(id, next)
    try {
      return await next
    } finally {
      if (this.pending.get(id) === next) this.pending.delete(id)
    }
  }

  private async proof(
    ticket: ResourceTicket,
    identity: ResourceProcessIdentity | null,
  ): Promise<ResourceProcessIdentity | null> {
    const members = identity === null ? await this.registry.members(ticket) : [identity]
    for (const member of members) {
      if (await this.registry.contains(ticket, member)) return member
    }
    return null
  }

  private async change(
    tree: TreeControls,
    saved: SavedControl,
    level: ResourceLevel,
  ): Promise<ResourceActionResult> {
    const control = saved.control
    const result = (status: ResourceActionResult['status']): ResourceActionResult => ({
      control: control.name,
      status,
    })
    const isRecovering =
      level === 'normal' || (control.minimumLevel === 'pause' && level !== 'pause')
    if (isRecovering && !saved.dirty) return result('unchanged')
    try {
      const before = await this.proof(tree.ticket, control.identity)
      if (before === null) return result('unknown')
      if (isRecovering && !control.reversible) {
        if (saved.applied === null) return result('unknown')
        return result(
          (await control.read(before)) === saved.applied ? 'lifetimeLowered' : 'unknown',
        )
      }
      if (!control.reversible && saved.original !== null) {
        const current = await control.read(before)
        if (
          current === null ||
          (saved.dirty && saved.applied === null && current !== saved.original)
        )
          return result('unknown')
      }
      if (saved.original === null) {
        saved.original = await control.read(before)
        if (saved.original === null) return result('unknown')
      }
      const value = isRecovering ? saved.original : control.lower(level, saved.original)
      if (!saved.dirty && value === saved.original) return result('unchanged')
      // Capture before dispatch, even when the write/readback later fails: recovery must retry.
      saved.dirty = true
      const identity = await this.proof(tree.ticket, control.identity)
      if (identity === null) return result('unknown')
      saved.applied = null
      const actual = await control.write(value, identity)
      if (actual !== value) return result('unknown')
      saved.applied = value
      if (isRecovering) saved.dirty = false
      if (isRecovering) return result('restored')
      return result(control.reversible ? 'applied' : 'lifetimeLowered')
    } catch {
      return result('unknown')
    }
  }

  private async update(
    ticket: ResourceTicket,
    level: ResourceLevel,
  ): Promise<ResourceActionResult[]> {
    const existing = this.trees.get(ticket.id)
    if (existing !== undefined && JSON.stringify(existing.ticket) !== JSON.stringify(ticket))
      return [{ control: null, status: 'unknown' }]
    const tree = existing ?? { ticket, saved: new Map<string, SavedControl>() }
    this.trees.set(ticket.id, tree)
    const results: ResourceActionResult[] = []
    const isEligible =
      ticket.kind === 'museServe'
        ? level === 'pause'
        : ticket.class === 'background' && level !== 'normal'
    if (isEligible) {
      try {
        if ((await this.proof(ticket, null)) === null) return [{ control: null, status: 'unknown' }]
        const controls = await this.port.controls(ticket)
        if (controls.length === 0) results.push({ control: null, status: 'unknown' })
        for (const control of controls) {
          if (tree.saved.has(control.key)) await control.close()
          else tree.saved.set(control.key, { control, original: null, dirty: false, applied: null })
        }
      } catch {
        results.push({ control: null, status: 'unknown' })
      }
    }
    for (const saved of tree.saved.values()) {
      results.push(await this.change(tree, saved, isEligible ? level : 'normal'))
    }
    return results
  }

  setLevel(
    input: ResourceTicket,
    inputLevel: ResourceLevel,
  ): Promise<readonly ResourceActionResult[]> {
    const ticket = resourceTicketSchema.parse(input)
    const level = resourceLevelSchema.parse(inputLevel)
    return this.serial(ticket.id, () => this.update(ticket, level))
  }

  /** Failed restoration retains the snapshot and handles for retry; it never reports retirement. */
  retire(input: ResourceTicket): Promise<{
    retired: boolean
    results: readonly ResourceActionResult[]
  }> {
    const ticket = resourceTicketSchema.parse(input)
    return this.serial(ticket.id, async () => {
      const results = await this.update(ticket, 'normal')
      const tree = this.trees.get(ticket.id)
      if (tree === undefined || results.some((result) => result.status === 'unknown'))
        return { retired: false, results }
      try {
        for (const saved of tree.saved.values()) await saved.control.close()
      } catch {
        return { retired: false, results: [...results, { control: null, status: 'unknown' }] }
      }
      this.trees.delete(ticket.id)
      return { retired: true, results }
    })
  }

  /** After Stop or natural completion, release saved handles only with C's complete-tree proof.
   * Closing handles changes no OS policy; a vanished/unknown registry reading is not this proof. */
  releaseCompleted(
    input: ResourceTicket,
    completion: ResourceTreeCompletionPort,
  ): Promise<boolean> {
    const ticket = resourceTicketSchema.parse(input)
    return this.serial(ticket.id, async () => {
      const tree = this.trees.get(ticket.id)
      if (tree === undefined) return true
      if (JSON.stringify(tree.ticket) !== JSON.stringify(ticket)) return false
      try {
        if (!(await completion.hasCompleted(ticket))) return false
        for (const saved of tree.saved.values()) await saved.control.close()
        this.trees.delete(ticket.id)
        return true
      } catch {
        return false
      }
    })
  }
}

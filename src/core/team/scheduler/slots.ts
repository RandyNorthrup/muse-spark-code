import { type TeamAttempt } from '../../../shared/team'

export interface SlotRequest {
  taskId: string
  attempt: number
  workspaceId: string
  roleId: string
  entryId: string
  agentProfileId: string
  kind: TeamAttempt['kind']
}
export interface SlotLimits {
  workers: number
  processWorkers: number
  role(roleId: string): number
  entry(entryId: string): number
  agent(agentId: string): number
}
export type SlotRefusal =
  'workers' | 'processWorkers' | 'role' | 'entry' | 'agent' | 'duplicate' | 'parent' | 'workspace'
type SlotResult = { ok: true } | { ok: false; reason: SlotRefusal; recovery: 'selfOrRaiseLimit' }

/** Reservations count before any asynchronous consent, journal or launch. */
export class SchedulerSlots {
  private readonly held = new Map<
    string,
    { request: SlotRequest; state: 'reserved' | 'running' | 'uncertain' }
  >()
  constructor(
    private readonly workspaceId: string,
    private readonly limits: () => SlotLimits,
  ) {}

  private key(request: Pick<SlotRequest, 'taskId' | 'attempt'>): string {
    return JSON.stringify([request.taskId, request.attempt])
  }

  refusal(request: SlotRequest): SlotRefusal | undefined {
    if (request.workspaceId !== this.workspaceId) return 'workspace'
    if (this.held.has(this.key(request))) return 'duplicate'
    const limits = this.limits()
    const requests = Array.from(this.held.values(), (item) => item.request)
    if (requests.length >= limits.workers) return 'workers'
    if (
      request.kind !== 'engine' &&
      requests.filter((item) => item.kind !== 'engine').length >= limits.processWorkers
    )
      return 'processWorkers'
    if (
      requests.filter((item) => item.roleId === request.roleId).length >=
      limits.role(request.roleId)
    )
      return 'role'
    if (
      requests.filter((item) => item.entryId === request.entryId).length >=
      limits.entry(request.entryId)
    )
      return 'entry'
    return requests.filter((item) => item.agentProfileId === request.agentProfileId).length >=
      limits.agent(request.agentProfileId)
      ? 'agent'
      : undefined
  }

  reserve(request: SlotRequest): SlotResult {
    const reason = this.refusal(request)
    if (reason) return { ok: false, reason, recovery: 'selfOrRaiseLimit' }
    this.held.set(this.key(request), { request: structuredClone(request), state: 'reserved' })
    return { ok: true }
  }

  reserveChildren(
    parent: Pick<SlotRequest, 'taskId' | 'attempt'>,
    children: readonly SlotRequest[],
  ): SlotResult {
    if (this.held.get(this.key(parent))?.state !== 'running')
      return { ok: false, reason: 'parent', recovery: 'selfOrRaiseLimit' }
    const reserved: SlotRequest[] = []
    for (const child of children) {
      const result = this.reserve(child)
      if (!result.ok) {
        for (const request of reserved) this.held.delete(this.key(request))
        return result
      }
      reserved.push(child)
    }
    return { ok: true }
  }

  mark(request: Pick<SlotRequest, 'taskId' | 'attempt'>, state: 'running' | 'uncertain'): void {
    const slot = this.held.get(this.key(request))
    if (!slot) throw new Error('team:slotNotReserved')
    slot.state = state
  }

  release(
    request: Pick<SlotRequest, 'taskId' | 'attempt'>,
    outcome: 'notStarted' | 'retired',
  ): boolean {
    const key = this.key(request)
    const slot = this.held.get(key)
    return (
      Boolean(slot) &&
      (outcome === 'retired' || slot?.state === 'reserved') &&
      this.held.delete(key)
    )
  }

  snapshot(): readonly { request: SlotRequest; state: 'reserved' | 'running' | 'uncertain' }[] {
    return structuredClone(Array.from(this.held, ([, item]) => item))
  }
}

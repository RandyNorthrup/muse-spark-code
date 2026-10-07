import { z } from 'zod/mini'
import {
  provisionedServerSchema,
  type ProvisionedServer,
  type EstimateProviderPort,
  type EstimateNodePort,
} from '../../../shared/estimate'
import {
  ESTIMATE_IDLE_TEARDOWN_MINUTES,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { EstimateSerialOwner } from './owner'
import { EstimateProvisionClock } from './clock'

type LeaseState = 'active' | 'notice' | 'wiping' | 'deleting' | 'deleted' | 'failed'
export interface EstimateServerLease {
  readonly providerId: string
  readonly server: ProvisionedServer
  readonly expiresAt: string
  readonly lastActiveAt: string
  readonly busy: boolean
  readonly state: LeaseState
  readonly failure?: 'notice' | 'wipe' | 'delete' | 'status'
}
interface Lease {
  provider: EstimateProviderPort
  server: ProvisionedServer
  expiresAt: number
  lastActiveAt: number
  busy: boolean
  state: LeaseState
  failure?: EstimateServerLease['failure']
  version: number
  wiped: boolean
  deleteAttempted: boolean
}
export interface EstimateLifecycleBindings {
  readonly node: EstimateNodePort
  readonly now: () => number
  /** Resolves only after the notice with Keep was presented to the user.
   * M110f drives continuous sweeps, and enforces expiry independently.
   */
  readonly notice: (lease: EstimateServerLease) => Promise<'keep' | 'teardown'>
}
const IDLE_MS = ESTIMATE_IDLE_TEARDOWN_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND
const instantSchema = z.iso.datetime({ offset: true })

function fail(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}
function key(providerId: string, serverId: string): string {
  return JSON.stringify([providerId, serverId])
}

/** One owner for notices/wipe/delete. Synchronous activity invalidates an
 * outstanding notice, so a slow user answer cannot erase newly active work.
 */
export class EstimateServerLifecycle {
  private readonly leases = new Map<string, Lease>()
  private readonly owner = new EstimateSerialOwner()
  private readonly clock: EstimateProvisionClock

  constructor(private readonly bindings: EstimateLifecycleBindings) {
    this.clock = new EstimateProvisionClock(bindings.now, 'invalid-lifecycle-clock')
  }

  private async receipt(lease: Lease): Promise<ProvisionedServer> {
    const receipt = provisionedServerSchema.parse(await lease.provider.status(lease.server.id))
    if (
      receipt.id !== lease.server.id ||
      receipt.sizeId !== lease.server.sizeId ||
      receipt.imageId !== lease.server.imageId
    )
      fail('server-identity')
    return receipt
  }

  private snapshot(lease: Lease): EstimateServerLease {
    return {
      providerId: lease.provider.id,
      server: structuredClone(lease.server),
      expiresAt: new Date(lease.expiresAt).toISOString(),
      lastActiveAt: new Date(lease.lastActiveAt).toISOString(),
      busy: lease.busy,
      state: lease.state,
      ...(lease.failure !== undefined && { failure: lease.failure }),
    }
  }

  private async destroy(lease: Lease): Promise<void> {
    lease.version++
    let phase: NonNullable<EstimateServerLease['failure']> = 'wipe'
    delete lease.failure
    try {
      if (!lease.wiped) {
        lease.state = 'wiping'
        await this.bindings.node.teardownAndWipe(structuredClone(lease.server))
        lease.wiped = true
        lease.busy = false
      }
      phase = 'status'
      if (lease.deleteAttempted) {
        const receipt = await this.receipt(lease)
        if (receipt.state === 'deleted') {
          lease.server = receipt
          lease.state = 'deleted'
          return
        }
        if (receipt.state === 'deleting') {
          lease.state = 'deleting'
          return
        }
      }
      phase = 'delete'
      lease.state = 'deleting'
      lease.deleteAttempted = true
      await lease.provider.delete(lease.server.id)
      phase = 'status'
      const receipt = await this.receipt(lease)
      if (receipt.state !== 'deleted' && receipt.state !== 'deleting') fail('deletion-unconfirmed')
      lease.server = receipt
      lease.state = receipt.state
    } catch {
      lease.state = 'failed'
      lease.failure = phase
    }
  }

  private async notice(lease: Lease, version: number): Promise<void> {
    let answer: 'keep' | 'teardown' | 'failed'
    try {
      answer = z.enum(['keep', 'teardown']).parse(await this.bindings.notice(this.snapshot(lease)))
    } catch {
      answer = 'failed'
    }
    // A slow user answer owns no cleanup lock. Other sweeps may expire this
    // server meanwhile; activity may invalidate its notice generation.
    await this.owner.run(async () => {
      if (lease.version !== version) return
      lease.state = 'active'
      const now = this.clock.now()
      if (now >= lease.expiresAt) {
        await this.destroy(lease)
        return
      }
      if (answer === 'failed') {
        lease.failure = 'notice'
        return
      }
      delete lease.failure
      if (answer === 'keep') {
        lease.lastActiveAt = now
        return
      }
      await this.destroy(lease)
    })
  }

  track(provider: EstimateProviderPort, input: ProvisionedServer, expiresAt: string): void {
    const server = provisionedServerSchema.parse(input)
    instantSchema.parse(expiresAt)
    if (server.state !== 'creating' && server.state !== 'running') fail('invalid-created-server')
    const id = key(provider.id, server.id)
    if (this.leases.has(id)) fail('duplicate-server')
    this.leases.set(id, {
      provider,
      server,
      expiresAt: Date.parse(expiresAt),
      lastActiveAt: this.clock.now(),
      busy: true,
      state: 'active',
      version: 0,
      wiped: false,
      deleteAttempted: false,
    })
  }

  activity(providerId: string, serverId: string, isBusy: boolean): void {
    const lease = this.leases.get(key(providerId, serverId))
    if (!lease || (lease.state !== 'active' && lease.state !== 'notice')) fail('inactive-server')
    const isParsedBusy = z.boolean().parse(isBusy)
    lease.lastActiveAt = this.clock.now()
    lease.busy = isParsedBusy
    lease.version++
    lease.state = 'active'
  }

  snapshots(): readonly EstimateServerLease[] {
    return Array.from(this.leases.values(), (lease) => this.snapshot(lease))
  }

  /** Explicit cleanup after a failed install/pair. Failure stays visible and
   * the next sweep reconciles it; no unknown deletion is reported as success.
   */
  retire(providerId: string, serverId: string): Promise<void> {
    return this.owner.run(async () => {
      const lease = this.leases.get(key(providerId, serverId))
      if (!lease) fail('unknown-server')
      if (lease.state !== 'deleted') await this.destroy(lease)
    })
  }

  async sweep(): Promise<void> {
    const notices = await this.owner.run(async () => {
      const pending: Promise<void>[] = []
      for (const lease of this.leases.values()) {
        if (lease.state === 'deleted') continue
        const now = this.clock.now()
        if (now >= lease.expiresAt || lease.state === 'deleting' || lease.state === 'failed') {
          await this.destroy(lease)
          continue
        }
        if (lease.state === 'notice' || lease.busy || now - lease.lastActiveAt < IDLE_MS) continue
        const version = lease.version
        lease.state = 'notice'
        pending.push(this.notice(lease, version))
      }
      return pending
    })
    await Promise.all(notices)
  }
}

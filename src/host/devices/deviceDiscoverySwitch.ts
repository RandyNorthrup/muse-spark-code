// Lane D: every choice, session verdict and asynchronous completion enters
// one queue. Effects never mutate state: a late ON result cannot undo a
// blocked verdict, and store failures remain visible even without a caller.
import { DevicePairingError } from '../../core/devices/pairing'
import {
  deviceHostMessageSchema,
  parseDeviceWebviewRequest,
  type DeviceHostMessage,
} from '../../shared/devicesPanel'
import type { DeviceStore } from './deviceStore'
import { assertLocalDeviceHost, type DeviceExecutionHost } from './deviceSecrets'
import type { DeviceDiscovery, DeviceDiscoveryStatus } from './deviceDiscovery'

type Setup = NonNullable<DeviceHostMessage['setup']>
type Failure = 'storage' | 'blocked-or-unreachable'
export interface DeviceDiscoveryFacts {
  readonly address: string
  readonly port: number
  readonly listenerApplication: string
  readonly interfaceLabel: string
}
export interface DeviceDiscoverySwitchDeps {
  readonly host: DeviceExecutionHost
  readonly store: Pick<DeviceStore, 'read' | 'update'>
  readonly discovery: DeviceDiscovery
  readonly isPairedReceiverOffering: () => boolean
  readonly localFacts: () => Promise<DeviceDiscoveryFacts>
}
interface Operation {
  readonly kind: 'load' | 'choice'
  readonly enabled: boolean
  readonly done: (failure: Failure | undefined) => void
  phase: 'read' | 'facts' | 'persist' | 'start' | 'settle'
  facts?: DeviceDiscoveryFacts
  failure?: Failure
}
interface Write {
  readonly enabled: boolean
  readonly operation: Operation | undefined
}
type Event =
  | { readonly kind: 'request'; readonly operation: Operation }
  | { readonly kind: 'status'; readonly status: DeviceDiscoveryStatus }
  | { readonly kind: 'read'; readonly operation: Operation; readonly enabled: boolean | undefined }
  | {
      readonly kind: 'facts'
      readonly operation: Operation
      readonly facts: DeviceDiscoveryFacts | undefined
    }
  | { readonly kind: 'started'; readonly operation: Operation; readonly failed: boolean }
  | {
      readonly kind: 'persisted'
      readonly write: Write
      readonly enabled: boolean | undefined
      readonly failed: boolean
    }

interface SwitchStatus {
  readonly enabled: boolean
  readonly discovery: DeviceDiscoveryStatus
  /** Undefined means the store could not confirm its persisted value. */
  readonly persistedEnabled: boolean | undefined
  readonly failure: Failure | undefined
}

export class DeviceDiscoverySwitch {
  private loaded = false
  private state: SwitchStatus = {
    enabled: false,
    discovery: { state: 'off' },
    persistedEnabled: undefined,
    failure: undefined,
  }
  private readonly events: Event[] = []
  private readonly requests: Operation[] = []
  private readonly writes: Write[] = []
  private draining = false
  private active: Operation | undefined
  private writing: Write | undefined

  public constructor(private readonly deps: DeviceDiscoverySwitchDeps) {
    this.deps.discovery.onStatus((status) => {
      this.enqueue({ kind: 'status', status })
    })
  }

  private enqueue(event: Event): void {
    this.events.push(event)
    if (this.draining) return
    this.draining = true
    try {
      let next: Event | undefined
      while ((next = this.events.shift()) !== undefined) {
        this.apply(next)
        this.beginWrite()
        this.beginRequest()
      }
    } finally {
      this.draining = false
    }
  }

  private apply(event: Event): void {
    switch (event.kind) {
      case 'request': {
        this.requests.push(event.operation)
        break
      }
      case 'status': {
        this.noteStatus(event.status)
        break
      }
      case 'read': {
        if (this.active !== event.operation || event.operation.phase !== 'read') return
        this.loaded = event.enabled !== undefined
        this.state = {
          ...this.state,
          enabled: event.enabled ?? false,
          persistedEnabled: event.enabled,
          failure: event.enabled === undefined ? 'storage' : undefined,
        }
        this.finish(event.enabled === undefined ? 'storage' : undefined)
        break
      }
      case 'facts': {
        this.noteFacts(event.operation, event.facts)
        break
      }
      case 'started': {
        if (this.active !== event.operation || event.operation.phase !== 'start') return
        if (event.failed) {
          this.noteStatus({ state: 'blocked-or-unreachable', reason: 'blocked-or-unreachable' })
        } else this.finish(undefined)
        break
      }
      case 'persisted': {
        this.notePersisted(event)
        break
      }
    }
  }

  private noteStatus(status: DeviceDiscoveryStatus): void {
    this.state = { ...this.state, discovery: status }
    if (status.state !== 'blocked-or-unreachable') return
    const operation = this.active
    if (!this.state.enabled && (operation === undefined || operation.phase === 'settle')) return
    this.state = { ...this.state, enabled: false, failure: status.reason }
    // Choices already waiting when the verdict arrived cannot count as
    // renewed consent. Preserve queued OFF and load requests in order.
    const waiting = this.requests.splice(0)
    for (const request of waiting) {
      if (request.kind === 'choice' && request.enabled) request.done(status.reason)
      else this.requests.push(request)
    }
    if (operation !== undefined) {
      operation.phase = 'settle'
      operation.failure = status.reason
    }
    this.writes.push({ enabled: false, operation })
  }

  private beginRequest(): void {
    // A downgrade and its reread settle before the next choice. In-flight
    // effects report events while the queue keeps accepting live verdicts.
    if (this.active !== undefined || this.writing !== undefined || this.writes.length > 0) return
    const operation = this.requests.shift()
    if (operation === undefined) return
    this.active = operation
    if (operation.kind === 'load' || operation.enabled) {
      void this.prepare(operation)
    } else {
      this.state = { ...this.state, enabled: false, failure: undefined }
      this.deps.discovery.stop()
      operation.phase = 'settle'
      this.writes.push({ enabled: false, operation })
      this.beginWrite()
    }
  }

  private async prepare(operation: Operation): Promise<void> {
    try {
      if (operation.kind === 'load') {
        const stored = await this.deps.store.read()
        this.enqueue({ kind: 'read', operation, enabled: stored.discoveryEnabled ?? false })
      } else {
        const facts = await this.deps.localFacts()
        this.enqueue({ kind: 'facts', operation, facts })
      }
    } catch {
      this.enqueue(
        operation.kind === 'load'
          ? { kind: 'read', operation, enabled: undefined }
          : { kind: 'facts', operation, facts: undefined },
      )
    }
  }

  private noteFacts(operation: Operation, facts: DeviceDiscoveryFacts | undefined): void {
    if (this.active !== operation || operation.phase !== 'facts') return
    if (facts === undefined) {
      this.state = { ...this.state, failure: 'storage' }
      this.finish('storage')
      return
    }
    operation.facts = facts
    operation.phase = 'persist'
    this.state = { ...this.state, enabled: true, failure: undefined }
    this.writes.push({ enabled: true, operation })
  }

  private beginWrite(): void {
    if (this.writing !== undefined) return
    const write = this.writes.shift()
    if (write === undefined) return
    this.writing = write
    void this.persist(write)
  }

  private async persist(write: Write): Promise<void> {
    try {
      await this.deps.store.update((state) => {
        state.discoveryEnabled = write.enabled
        return state
      })
      this.enqueue({ kind: 'persisted', write, enabled: write.enabled, failed: false })
    } catch {
      // A failed rename can leave the old bit on disk. Re-read it; a store
      // that has failed closed may refuse that read, which means unknown.
      let enabled: boolean | undefined
      try {
        const stored = await this.deps.store.read()
        enabled = stored.discoveryEnabled ?? false
      } catch {
        enabled = undefined
      }
      this.enqueue({ kind: 'persisted', write, enabled, failed: true })
    }
  }

  private notePersisted(event: Extract<Event, { kind: 'persisted' }>): void {
    this.writing = undefined
    this.state = { ...this.state, persistedEnabled: event.enabled }
    const operation = event.write.operation
    if (event.failed) {
      this.state = { ...this.state, enabled: false, failure: 'storage' }
      if (this.state.discovery.state !== 'blocked-or-unreachable') this.deps.discovery.stop()
      if (this.active !== undefined) {
        this.active.phase = 'settle'
        this.active.failure = 'storage'
      }
    }
    if (operation === undefined || this.active !== operation) return
    // A blocked verdict queued a later OFF write. Its completion owns the
    // result, so the older ON write cannot start a replacement session.
    if (this.writes.some((write) => write.operation === operation)) return
    if (operation.phase === 'settle' || event.failed) {
      this.finish(operation.failure)
      return
    }
    if (operation.phase !== 'persist' || operation.facts === undefined) return
    operation.phase = 'start'
    const facts = operation.facts
    void this.deps.discovery
      .start(
        {
          isEnabled: () => this.isEnabled(),
          isPairedReceiverOffering: this.deps.isPairedReceiverOffering,
        },
        facts.address,
        facts.port,
      )
      .then(() => {
        this.enqueue({ kind: 'started', operation, failed: false })
      })
      .catch(() => {
        this.enqueue({ kind: 'started', operation, failed: true })
      })
  }

  private finish(failure: Failure | undefined): void {
    const operation = this.active
    this.active = undefined
    operation?.done(failure)
  }

  private request(kind: Operation['kind'], shouldEnable: boolean): Promise<Failure | undefined> {
    return new Promise((done) => {
      this.enqueue({
        kind: 'request',
        operation: {
          kind,
          enabled: shouldEnable,
          done,
          phase: kind === 'load' ? 'read' : 'facts',
        },
      })
    })
  }

  private async safeFacts(): Promise<Pick<Setup, 'listenerApplication' | 'interfaceLabel'>> {
    try {
      const facts = await this.deps.localFacts()
      return {
        listenerApplication: facts.listenerApplication,
        interfaceLabel: facts.interfaceLabel,
      }
    } catch {
      return {}
    }
  }

  public async load(): Promise<void> {
    assertLocalDeviceHost(this.deps.host)
    if ((await this.request('load', false)) !== undefined) throw new DevicePairingError('storage')
  }

  public isEnabled(): boolean {
    return this.loaded && this.state.enabled
  }

  /** The displayed choice, live verdict and confirmed persisted value. */
  public status(): SwitchStatus {
    return { ...this.state, enabled: this.isEnabled() }
  }

  public async handle(input: unknown): Promise<Setup> {
    const parsed = parseDeviceWebviewRequest(input)
    if (!parsed.ok) throw new DevicePairingError('invalid-frame')
    const request = parsed.message
    if (request.action.kind !== 'setDiscovery') throw new DevicePairingError('invalid-frame')
    try {
      assertLocalDeviceHost(this.deps.host)
    } catch (error) {
      return parseSetup({
        viewId: request.viewId,
        requestId: request.requestId,
        failure: error instanceof DevicePairingError ? error.reason : 'storage',
      })
    }
    const setup: Setup = { viewId: request.viewId, requestId: request.requestId }
    const failure = await this.request('choice', request.action.enabled)
    if (failure === 'blocked-or-unreachable')
      return parseSetup({ ...setup, failure, ...(await this.safeFacts()) })
    return parseSetup(failure === undefined ? setup : { ...setup, failure })
  }
}

function parseSetup(candidate: unknown): Setup {
  const setup = deviceHostMessageSchema.shape.setup.safeParse(candidate)
  if (!setup.success || setup.data === undefined) throw new DevicePairingError('invalid-frame')
  return setup.data
}

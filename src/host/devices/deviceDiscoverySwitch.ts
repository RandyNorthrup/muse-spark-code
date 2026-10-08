// Lane D: the discovery switch and its Blocked-or-unreachable setup region.
// Discovery is off by default and starts only on an explicit local
// `setDiscovery` choice while a paired receiver is offering. Neighboring
// lanes chain this handler before their own: any other action kind throws
// `invalid-frame` so their regions stay theirs.
import { DevicePairingError } from '../../core/devices/pairing'
import {
  parseDeviceWebviewRequest,
  deviceHostMessageSchema,
  type DeviceHostMessage,
} from '../../shared/modelsPanel'
import { assertLocalDeviceHost, type DeviceExecutionHost } from './deviceSecrets'
import type { DeviceDiscovery } from './deviceDiscovery'
import type { DeviceStore } from './deviceStore'

type Setup = NonNullable<DeviceHostMessage['setup']>

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

export class DeviceDiscoverySwitch {
  private enabled = false
  private loaded = false
  // One state-changing turn at a time: each handle waits for the previous
  // turn, so a later OFF always runs after an earlier ON's facts resolve
  // and wins. A turn's failure reaches only its own caller.
  private tail: Promise<void> = Promise.resolve()
  public constructor(private readonly deps: DeviceDiscoverySwitchDeps) {
    // The switch never infers success from a return value: it subscribes to
    // discovery's owned status and shows exactly what it says. A failure
    // that lands after startup (a later send error, a socket error, a closed
    // port) flips the switch off and persists it through the same tail, so
    // a later turn still runs after the downgrade.
    this.deps.discovery.onStatus((status) => {
      if (status.state === 'blocked-or-unreachable') this.noteBlocked()
    })
  }

  /**
   * Records a live blocked verdict: memory flips at once, the persisted bit
   * follows through the serialized tail. Not awaited — the event has no
   * caller — but ordered behind every turn the tail already holds.
   */
  private noteBlocked(): void {
    if (!this.enabled) return
    this.enabled = false
    const previous = this.tail
    const turn = (async (): Promise<void> => {
      await previous
      await this.deps.store.update((state) => {
        state.discoveryEnabled = false
        return state
      })
    })()
    this.tail = (async (): Promise<void> => {
      try {
        await turn
      } catch {
        /* A downgrade write failure stays local; memory already says off. */
      }
    })()
  }

  private async serialized(work: () => Promise<void>): Promise<void> {
    const previous = this.tail
    const turn = (async (): Promise<void> => {
      await previous
      await work()
    })()
    this.tail = (async (): Promise<void> => {
      try {
        await turn
      } catch {
        /* A turn's failure reaches only its own caller. */
      }
    })()
    await turn
  }

  /** Records the blocked verdict locally and in the store; the caller throws. */
  private async rollbackBlocked(): Promise<void> {
    this.enabled = false
    await this.deps.store.update((state) => {
      state.discoveryEnabled = false
      return state
    })
  }

  private async apply(shouldEnable: boolean): Promise<void> {
    let facts: DeviceDiscoveryFacts | undefined
    if (shouldEnable) {
      try {
        facts = await this.deps.localFacts()
      } catch {
        throw new DevicePairingError('storage')
      }
    }
    await this.deps.store.update((state) => {
      state.discoveryEnabled = shouldEnable
      return state
    })
    this.enabled = shouldEnable
    if (!shouldEnable || facts === undefined) {
      this.deps.discovery.stop()
      return
    }
    // A rejected start is only one failure shape. The verdict is the owned
    // discovery status, read after start resolves: a bind that succeeded
    // with a later send failure still reads blocked-or-unreachable.
    try {
      await this.deps.discovery.start(
        {
          isEnabled: () => this.isEnabled(),
          isPairedReceiverOffering: this.deps.isPairedReceiverOffering,
        },
        facts.address,
        facts.port,
      )
    } catch {
      await this.rollbackBlocked()
      throw new DevicePairingError(this.blockedReason())
    }
    const verdict = this.deps.discovery.status()
    if (verdict.state !== 'blocked-or-unreachable') return
    await this.rollbackBlocked()
    throw new DevicePairingError(verdict.reason)
  }

  /**
   * The failure word the switch shows, read from the owned status — never a
   * socket or peer string. Falls back to the fixed word when the status
   * carries no verdict (a port that threw raw without publishing one).
   */
  private blockedReason(): 'blocked-or-unreachable' {
    const verdict = this.deps.discovery.status()
    return verdict.state === 'blocked-or-unreachable' ? verdict.reason : 'blocked-or-unreachable'
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

  /** Restores the persisted choice; before this, the switch reads off. */
  public async load(): Promise<void> {
    assertLocalDeviceHost(this.deps.host)
    const stored = await this.deps.store.read()
    this.enabled = stored.discoveryEnabled ?? false
    this.loaded = true
  }

  /** Discovery policy source: explicit choice and nothing else. */
  public isEnabled(): boolean {
    return this.loaded && this.enabled
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
    const shouldEnable = request.action.enabled
    try {
      await this.serialized(() => this.apply(shouldEnable))
    } catch (error) {
      if (error instanceof DevicePairingError && error.reason === 'blocked-or-unreachable') {
        const facts = await this.safeFacts()
        return parseSetup({ ...setup, failure: 'blocked-or-unreachable', ...facts })
      }
      return parseSetup({
        ...setup,
        failure: error instanceof DevicePairingError ? error.reason : 'storage',
      })
    }
    return parseSetup(setup)
  }
}

function parseSetup(candidate: unknown): Setup {
  const setup = deviceHostMessageSchema.shape.setup.safeParse(candidate)
  if (!setup.success || setup.data === undefined) throw new DevicePairingError('invalid-frame')
  return setup.data
}

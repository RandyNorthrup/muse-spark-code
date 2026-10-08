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
  public constructor(private readonly deps: DeviceDiscoverySwitchDeps) {}

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
      this.enabled = false
      this.deps.discovery.stop()
      await this.deps.store.update((state) => {
        state.discoveryEnabled = false
        return state
      })
      throw new DevicePairingError('blocked-or-unreachable')
    }
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
    try {
      await this.apply(request.action.enabled)
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

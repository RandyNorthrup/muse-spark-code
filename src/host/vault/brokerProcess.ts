import { UI_TEXT } from '../../shared/constants'
import type { VaultBrokerDiscovery, VaultBrokerLocation } from '../../core/vault/broker/discovery'
import { VaultBrokerClient } from '../../core/vault/broker/client'
import type {
  VaultPeerVerifier,
  VaultPipeDialPort,
  VaultProcessIdentity,
} from '../../core/vault/broker/peer'

export interface VaultBrokerProcessPort {
  identity(pid: number): Promise<VaultProcessIdentity>
  /** W launches the installed dist/vaultBroker.js with a narrow credential-free environment. */
  launch(): Promise<{
    ready: Promise<void>
    /** Present only while the launcher owns a starting process; session handoffs expose no stop. */
    stop?: () => Promise<void>
  }>
}
/** Only called at the first vault need; construction starts no process and reads no vault. */
export class VaultBrokerProcess {
  private starting: Promise<VaultBrokerLocation> | null = null
  constructor(
    private readonly discovery: VaultBrokerDiscovery,
    private readonly process: VaultBrokerProcessPort,
  ) {}
  private async start(): Promise<VaultBrokerLocation> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.discovery.discover((pid) => this.process.identity(pid))
      if (existing) return existing
      const child = await this.process.launch()
      let location: VaultBrokerLocation | null
      try {
        await child.ready
        location = await this.discovery.discover((pid) => this.process.identity(pid))
      } catch (error: unknown) {
        await child.stop?.()
        throw error
      }
      if (location) return location
      // Retire each failed owned startup exactly once; failed cleanup stops the retry.
      await child.stop?.()
      // A broker can finish orderly shutdown after readiness; retry its successor once.
    }
    throw new Error(UI_TEXT.vault.brokerBlocked)
  }
  /** Retry only a vanished/replaced broker, before sending any operation or secret. */
  async connect(
    hostId: string,
    hostSession: string,
    peers: VaultPeerVerifier,
    dial?: VaultPipeDialPort,
  ): Promise<VaultBrokerClient> {
    const location = await this.get()
    try {
      return await VaultBrokerClient.open(location, hostId, hostSession, peers, dial)
    } catch (error: unknown) {
      const current = await this.discovery.discover((pid) => this.process.identity(pid))
      if (current?.lock.brokerId === location.lock.brokerId) throw error
      return await VaultBrokerClient.open(await this.get(), hostId, hostSession, peers, dial)
    }
  }

  async get(): Promise<VaultBrokerLocation> {
    this.starting ??= this.start()
    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }
}

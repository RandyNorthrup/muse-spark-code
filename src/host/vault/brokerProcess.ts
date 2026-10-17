import { UI_TEXT } from '../../shared/constants'
import {
  type VaultBrokerDiscovery,
  type VaultBrokerLocation,
} from '../../core/vault/broker/discovery'
import { type VaultProcessIdentity } from '../../core/vault/broker/peer'

export interface VaultBrokerProcessPort {
  identity(pid: number): Promise<VaultProcessIdentity>
  /** W launches the installed dist/vaultBroker.js with a narrow credential-free environment. */
  launch(): Promise<{ ready: Promise<void>; stop(): Promise<void> }>
}
/** Only called at the first vault need; construction starts no process and reads no vault. */
export class VaultBrokerProcess {
  private starting: Promise<VaultBrokerLocation> | null = null
  constructor(
    private readonly discovery: VaultBrokerDiscovery,
    private readonly process: VaultBrokerProcessPort,
  ) {}
  private async start(): Promise<VaultBrokerLocation> {
    const existing = await this.discovery.discover((pid) => this.process.identity(pid))
    if (existing) return existing
    const child = await this.process.launch()
    try {
      await child.ready
      const location = await this.discovery.discover((pid) => this.process.identity(pid))
      if (!location) throw new Error(UI_TEXT.vault.brokerBlocked)
      return location
    } catch (error: unknown) {
      await child.stop()
      throw error
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

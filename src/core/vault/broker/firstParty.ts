import { UI_TEXT } from '../../../shared/constants'
import {
  type VaultAuthenticatedPeer,
  type vaultPrivateReadSchema,
} from '../../../shared/vaultProtocol'
import { type VaultBroker } from './broker'
import { type VaultBrokerClient } from './client'

export type VaultFirstPartyFallback = () => Promise<{
  broker: VaultBroker
  peer: VaultAuthenticatedPeer
}>
/** Shared by every host: per-request access, and the same engine when child launch is blocked. */
export class VaultFirstPartyReader {
  constructor(
    private readonly connect: () => Promise<VaultBrokerClient>,
    private readonly fallback: VaultFirstPartyFallback | null = null,
  ) {}
  async read(request: ReturnType<typeof vaultPrivateReadSchema.parse>): Promise<Buffer> {
    let client: VaultBrokerClient
    try {
      client = await this.connect()
    } catch {
      if (!this.fallback) throw new Error(UI_TEXT.vault.brokerBlocked)
      const fallback = await this.fallback()
      const status = await fallback.broker.status()
      if (status.state !== 'firstPartyOnly') throw new Error(UI_TEXT.vault.brokerBlocked)
      return await fallback.broker.firstPartyRead(fallback.peer, request)
    }
    let bytes: Buffer | undefined
    let hasTransferred = false
    try {
      try {
        bytes = await client.firstPartyRead(request)
      } finally {
        client.close()
      }
      hasTransferred = true
      return bytes
    } finally {
      if (!hasTransferred) bytes?.fill(0)
    }
  }
}

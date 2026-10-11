import { type SecretStore } from '../auth/credentialStore'
import { type VaultFirstPartyReader } from '../../core/vault/broker/firstParty'
import { type vaultPrivateReadSchema } from '../../shared/vaultProtocol'

/** C/M binds first-party ids/origins and copy/verify/retain writes; values enter through existing UI/stdin. */
export interface VaultCredentialBindingPort {
  resolve(key: string): Promise<ReturnType<typeof vaultPrivateReadSchema.parse> | null>
  store(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
}
/** Structurally implements CredentialStore/AuthCommandDeps' existing SecretStore dependency. */
export class BrokerSecretStore implements SecretStore {
  constructor(
    private readonly reader: Pick<VaultFirstPartyReader, 'read'>,
    private readonly bindings: VaultCredentialBindingPort,
  ) {}
  async get(key: string): Promise<string | undefined> {
    const binding = await this.bindings.resolve(key)
    if (binding === null) return undefined
    const bytes = await this.reader.read(binding)
    try {
      return bytes.toString('utf8')
    } finally {
      bytes.fill(0)
    }
  }
  async store(key: string, value: string): Promise<void> {
    const bytes = Buffer.alloc(Buffer.byteLength(value))
    bytes.write(value)
    try {
      await this.bindings.store(key, bytes)
    } finally {
      bytes.fill(0)
    }
  }
  async delete(key: string): Promise<void> {
    await this.bindings.delete(key)
  }
}

export { VaultFirstPartyReader as HostVaultBrokerClient } from '../../core/vault/broker/firstParty'

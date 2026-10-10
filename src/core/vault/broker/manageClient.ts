// C-M109-1 (a): the host side of protocol v2, shared by the VS Code panel,
// the CLI and the ACP agent. Each call opens its own authenticated connection
// (the platform's connect: discovery, launch and peer check from lanes b and
// c) and closes it; values travel only in private frames.

import { UI_TEXT, VAULT_PROTOCOL_VERSION } from '../../../shared/constants'
import type {
  VaultApprovalAnswer,
  VaultAuditRecord,
  VaultGrant,
  VaultItem,
  VaultItemMetadata,
} from '../../../shared/vault'
import type {
  VaultBrokerEvent,
  VaultBrokerSnapshot,
  VaultStatus,
} from '../../../shared/vaultProtocol'
import { encodeVaultMaterial } from '../crypto'
import type { VaultBrokerClient } from './client'
import type { VaultChannelResponse } from './frames'
import type { VaultManagementRefusal } from './ports'

/** What a host needs of one authenticated connection. */
export type VaultBrokerConnection = Pick<VaultBrokerClient, 'send' | 'close' | 'watch' | 'closed'>
export type VaultConnect = () => Promise<VaultBrokerConnection>

/** The message a person reads for each fixed refusal; never broker exception text. */
export function vaultRefusalMessage(reason: VaultManagementRefusal): string {
  switch (reason) {
    case 'locked': {
      return UI_TEXT.vault.locked
    }
    case 'uncreated': {
      return UI_TEXT.vault.setupNeeded
    }
    case 'exists': {
      return UI_TEXT.vault.setupExists
    }
    case 'busy': {
      return UI_TEXT.vault.busy
    }
    case 'rollback': {
      return UI_TEXT.vault.rollback
    }
    case 'invalid':
    case 'io': {
      return UI_TEXT.vault.operationFailed
    }
  }
}

function expectOk(response: VaultChannelResponse['response']): void {
  if (response.kind === 'ok') return
  if (response.kind === 'refused') throw new Error(vaultRefusalMessage(response.reason))
  throw new Error(UI_TEXT.vault.noAccess)
}

export class VaultManageSession {
  constructor(private readonly connect: VaultConnect) {}

  private async call<T>(work: (client: VaultBrokerConnection) => Promise<T>): Promise<T> {
    const client = await this.connect()
    try {
      return await work(client)
    } finally {
      client.close()
    }
  }
  private async simple(
    request: Parameters<VaultBrokerConnection['send']>[0],
  ): Promise<VaultChannelResponse['response']> {
    return await this.call(async (client) => await client.send(request))
  }

  async status(): Promise<VaultStatus> {
    const response = await this.simple({ kind: 'status' })
    if (response.kind !== 'status') throw new Error(UI_TEXT.vault.noAccess)
    return response.status
  }
  async snapshot(): Promise<VaultBrokerSnapshot> {
    const response = await this.simple({ kind: 'snapshot' })
    if (response.kind === 'refused') throw new Error(vaultRefusalMessage(response.reason))
    if (response.kind !== 'snapshot') throw new Error(UI_TEXT.vault.noAccess)
    return response.snapshot
  }
  async audit(): Promise<readonly VaultAuditRecord[]> {
    const response = await this.simple({
      kind: 'audit',
      item: null,
      requesterId: null,
      afterGeneration: 0,
    })
    if (response.kind !== 'audit') throw new Error(UI_TEXT.vault.noAccess)
    return response.records
  }
  async unlock(slotId: string | null): Promise<void> {
    expectOk(await this.simple({ kind: 'unlock', slotId }))
  }
  async lock(): Promise<void> {
    expectOk(await this.simple({ kind: 'lock' }))
  }
  /** add when the id is new, edit otherwise; the encoded material is erased after sending. */
  async write(item: VaultItem, isEdit: boolean): Promise<void> {
    const encoded = encodeVaultMaterial(item.material)
    try {
      expectOk(
        await this.simple({
          v: VAULT_PROTOCOL_VERSION,
          kind: isEdit ? 'edit' : 'add',
          metadata: item.metadata,
          encoding: 'base64',
          material: encoded.toString('base64'),
        }),
      )
    } finally {
      encoded.fill(0)
    }
  }
  async editMetadata(metadata: VaultItemMetadata): Promise<void> {
    expectOk(await this.simple({ kind: 'editMetadata', metadata }))
  }
  async remove(itemId: string): Promise<void> {
    expectOk(await this.simple({ kind: 'remove', itemId }))
  }
  async grant(grant: VaultGrant): Promise<void> {
    expectOk(await this.simple({ kind: 'grant', grant }))
  }
  async revoke(grantId: string): Promise<void> {
    expectOk(await this.simple({ kind: 'revoke', grantId }))
  }
  async answer(answer: VaultApprovalAnswer): Promise<VaultChannelResponse['response']> {
    return await this.simple({ kind: 'answer', answer })
  }
  async importFile(path: string): Promise<void> {
    expectOk(await this.simple({ kind: 'import', path }))
  }
  async publicKey(itemId: string): Promise<string> {
    const response = await this.simple({ kind: 'publicKey', itemId })
    if (response.kind === 'refused') throw new Error(vaultRefusalMessage(response.reason))
    if (response.kind !== 'publicKey') throw new Error(UI_TEXT.vault.noAccess)
    return response.publicKey
  }
  /** The one-time code as owned bytes; the caller shows it once and erases it. */
  async setup(): Promise<{ setupId: string; code: Buffer }> {
    const response = await this.simple({ kind: 'setup', protection: 'auto' })
    if (response.kind === 'refused') throw new Error(vaultRefusalMessage(response.reason))
    if (response.kind !== 'recoveryCode') throw new Error(UI_TEXT.vault.noAccess)
    return { setupId: response.setupId, code: Buffer.from(response.code, 'ascii') }
  }
  async confirmSetup(setupId: string): Promise<void> {
    expectOk(await this.simple({ kind: 'confirmSetup', setupId }))
  }
  async cancelSetup(setupId: string): Promise<void> {
    expectOk(await this.simple({ kind: 'cancelSetup', setupId }))
  }
  async recover(code: Uint8Array): Promise<void> {
    expectOk(
      await this.simple({
        v: VAULT_PROTOCOL_VERSION,
        kind: 'recover',
        code: Buffer.from(code).toString('ascii'),
      }),
    )
  }
  /**
   * Pushed events until `signal` aborts; the stream reconnects after a broker
   * restart, and each reconnect first reports `changed` so views reload.
   */
  async watch(onEvent: (event: VaultBrokerEvent) => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let client: VaultBrokerConnection
      try {
        client = await this.connect()
      } catch {
        return
      }
      const stop = () => {
        client.close()
      }
      signal.addEventListener('abort', stop, { once: true })
      try {
        await client.watch(onEvent)
        onEvent({ kind: 'changed', v: VAULT_PROTOCOL_VERSION })
        await client.closed()
      } catch {
        return
      } finally {
        signal.removeEventListener('abort', stop)
        client.close()
      }
    }
  }
}

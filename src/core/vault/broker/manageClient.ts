// C-M109-1 (a): the host side of protocol v2, shared by the VS Code panel,
// the CLI and the ACP agent. Each call opens its own authenticated connection
// (the platform's connect: discovery, launch and peer check from lanes b and
// c) and closes it; values travel only in private frames.

import { UI_TEXT, VAULT_PROTOCOL_VERSION, VAULT_WATCH_RETRY_MS } from '../../../shared/constants'
import type {
  VaultApprovalAnswer,
  VaultAuditRecord,
  VaultGrant,
  VaultItem,
  VaultItemMetadata,
} from '../../../shared/vault'
import type { VaultBrokerEvent, VaultBrokerSnapshot } from '../../../shared/vaultProtocol'
import type { VaultBrokerClient } from './client'
import type { VaultChannelResponse } from './frames'
import type { VaultImportReport, VaultManagementRefusal } from './ports'

/** What a host needs of one authenticated connection. */
export type VaultBrokerConnection = Pick<VaultBrokerClient, 'send' | 'close' | 'watch' | 'closed'>
export type VaultConnect = () => Promise<VaultBrokerConnection>

/** The message a person reads for each fixed refusal; never broker exception text. */
export function vaultRefusalMessage(reason: VaultManagementRefusal): string {
  switch (reason) {
    case 'locked':
    case 'busy':
    case 'rollback':
    case 'storeUnavailable': {
      return UI_TEXT.vault[reason]
    }
    case 'uncreated': {
      return UI_TEXT.vault.setupNeeded
    }
    case 'exists': {
      return UI_TEXT.vault.setupExists
    }
    case 'conflict': {
      return UI_TEXT.vault.itemConflict
    }
    case 'deleteConflict': {
      return UI_TEXT.vault.deleteConflict
    }
    case 'sourceGone': {
      return UI_TEXT.vault.sourceGone
    }
    case 'sourceUnreadable': {
      return UI_TEXT.vault.sourceUnreadable
    }
    case 'sourceUnavailable': {
      return UI_TEXT.vault.sourceUnavailable
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
  /**
   * `encode` is injected so the vault's opening bundle never carries the
   * write-only crypto: the panel passes the lazily loaded actions bundle's
   * encoder, the CLI its direct one (RVAPP-CM1091D5 BYTES).
   */
  constructor(
    private readonly connect: VaultConnect,
    private readonly encodeMaterial?: (material: VaultItem['material']) => Buffer,
  ) {}

  /**
   * `authorize` runs after the connection is acquired, immediately before the
   * request that commits is sent: a caller retired while the connection was
   * pending sends nothing (RVCM1091A F5).
   */
  private async call<T>(
    work: (client: VaultBrokerConnection) => Promise<T>,
    authorize?: () => void,
    signal?: AbortSignal,
  ): Promise<T> {
    const client = await this.connect()
    const stop = () => {
      client.close()
    }
    signal?.addEventListener('abort', stop, { once: true })
    try {
      if (signal?.aborted) throw new Error(UI_TEXT.vault.useChanged)
      authorize?.()
      let result: T
      try {
        result = await work(client)
      } catch (error: unknown) {
        // The person's own barrier (Lock, revocation, disposal) closed this
        // connection mid-call: the abort recorded on the signal owns the
        // outcome, not the channel error the close produced. Report the veto
        // the host settles silent on the retired generation — never a
        // failure toast beside the person's own Lock (RVAPP-CM1091D5 P2-1).
        if (signal?.aborted) throw new Error(UI_TEXT.vault.useChanged, { cause: error })
        throw error
      }
      if (signal?.aborted) throw new Error(UI_TEXT.vault.useChanged)
      return result
    } finally {
      signal?.removeEventListener('abort', stop)
      client.close()
    }
  }
  private simple(
    request: Parameters<VaultBrokerConnection['send']>[0],
    authorize?: () => void,
    signal?: AbortSignal,
  ): Promise<VaultChannelResponse['response']> {
    return this.call((client) => client.send(request), authorize, signal)
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
  async unlock(slotId: string | null, authorize?: () => void): Promise<void> {
    expectOk(await this.simple({ kind: 'unlock', slotId }, authorize))
  }
  async lock(): Promise<void> {
    expectOk(await this.simple({ kind: 'lock' }))
  }
  /** add when the id is new, edit otherwise; the encoded material is erased after sending. */
  async write(item: VaultItem, isEdit: boolean, authorize?: () => void): Promise<void> {
    // Unwired only in a test that never writes: both production sessions
    // inject their encoder at construction.
    if (this.encodeMaterial === undefined) throw new Error(UI_TEXT.vault.operationFailed)
    const encoded = this.encodeMaterial(item.material)
    try {
      expectOk(
        await this.simple(
          {
            v: VAULT_PROTOCOL_VERSION,
            kind: isEdit ? 'edit' : 'add',
            metadata: item.metadata,
            encoding: 'base64',
            material: encoded.toString('base64'),
          },
          authorize,
        ),
      )
    } finally {
      encoded.fill(0)
    }
  }
  async editMetadata(metadata: VaultItemMetadata, authorize?: () => void): Promise<void> {
    expectOk(await this.simple({ kind: 'editMetadata', metadata }, authorize))
  }
  async remove(itemId: string, authorize?: () => void): Promise<void> {
    expectOk(await this.simple({ kind: 'remove', itemId }, authorize))
  }
  async grant(grant: VaultGrant, authorize?: () => void): Promise<void> {
    expectOk(await this.simple({ kind: 'grant', grant }, authorize))
  }
  async revoke(grantId: string): Promise<void> {
    expectOk(await this.simple({ kind: 'revoke', grantId }))
  }
  async answer(
    answer: VaultApprovalAnswer,
    authorize?: () => void,
  ): Promise<VaultChannelResponse['response']> {
    return await this.simple({ kind: 'answer', answer }, authorize)
  }
  /** The per-item report (metadata only) and the receipt for Keep/Delete. */
  async importFile(
    path: string,
    authorize?: () => void,
    signal?: AbortSignal,
  ): Promise<VaultImportReport> {
    const response = await this.simple({ kind: 'import', path }, authorize, signal)
    if (response.kind === 'refused') throw new Error(vaultRefusalMessage(response.reason))
    if (response.kind !== 'imported') throw new Error(UI_TEXT.vault.noAccess)
    return { receipt: response.receipt, items: response.items }
  }
  async keepImport(receipt: string): Promise<void> {
    expectOk(await this.simple({ kind: 'importKeep', receipt }))
  }
  async deleteImport(receipt: string, authorize?: () => void, signal?: AbortSignal): Promise<void> {
    expectOk(await this.simple({ kind: 'importDelete', receipt }, authorize, signal))
  }
  async resetBegin(): Promise<{ resetId: string; word: string }> {
    const response = await this.simple({ kind: 'resetBegin' })
    if (response.kind === 'refused') throw new Error(vaultRefusalMessage(response.reason))
    if (response.kind !== 'resetChallenge') throw new Error(UI_TEXT.vault.noAccess)
    return { resetId: response.resetId, word: response.word }
  }
  async resetConfirm(resetId: string, word: string, authorize?: () => void): Promise<void> {
    expectOk(await this.simple({ kind: 'resetConfirm', resetId, word }, authorize))
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
  async confirmSetup(setupId: string, authorize?: () => void): Promise<void> {
    expectOk(await this.simple({ kind: 'confirmSetup', setupId }, authorize))
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
   * Pushed events until `signal` aborts. A stream the broker closes is
   * reopened after `VAULT_WATCH_RETRY_MS`, and each (re)open first reports
   * `changed` so views reload. A connection or watch that fails rejects, so
   * every caller reports it; only cancellation ends quietly (RVCM1091A F7).
   */
  async watch(onEvent: (event: VaultBrokerEvent) => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let client: VaultBrokerConnection
      try {
        client = await this.connect()
      } catch (error: unknown) {
        if (isCancelled(signal)) return
        throw error
      }
      // Cancelled while the connection was being acquired: close the late
      // resource instead of watching forever (RVCM1091A F8).
      if (isCancelled(signal)) {
        client.close()
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
      } catch (error: unknown) {
        if (isCancelled(signal)) return
        throw error
      } finally {
        signal.removeEventListener('abort', stop)
        client.close()
      }
      await vaultAbortableDelay(VAULT_WATCH_RETRY_MS, signal)
    }
  }
}

/** Read through a call: an abort can land during any await (no stale narrowing). */
export function isCancelled(signal: AbortSignal): boolean {
  return signal.aborted
}
/** Resolves after `ms`, or at once when `signal` aborts. */
export async function vaultAbortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

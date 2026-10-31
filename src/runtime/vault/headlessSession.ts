// The headless registration and its session (D243): kept with the exec
// host port in dist/vaultExecHost.js so the vault runtime bundle keeps
// only the exec types. Loaded by the runtime binding on the first
// headless `--vault` open and by the exec entry for the host port.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  vaultItemMetadataSchema,
  vaultRequesterSchema,
  vaultTaintSchema,
  vaultUseSchema,
  type VaultRequester,
  type VaultTaint,
  type VaultUse,
} from '../../shared/vault'
import {
  vaultAuthorizationResultSchema,
  vaultStatusSchema,
  type VaultApprovalResult,
} from '../../shared/vaultProtocol'
import { vaultUseDigest } from '../../core/vault/useDigest'
import { randomBytes } from 'node:crypto'
import { VAULT_LIMITS } from '../../shared/constants'
import { isCancelled, type VaultConnect } from '../../core/vault/broker/manageClient'

const newId = (): string => randomBytes(VAULT_LIMITS.idBytes).toString('hex')
import {
  type ExecVaultContext,
  type ExecVaultSession,
  type HeadlessBrokerPort,
  type HeadlessVaultBroker,
} from './execVault'

/** The authenticated headless registration, bound to engine uses through the runtime vault loader. */
export class HeadlessVaultSession implements ExecVaultSession {
  private closed = false
  private readonly requester: VaultRequester
  constructor(
    requester: VaultRequester,
    private readonly broker: HeadlessBrokerPort,
    private readonly context: ExecVaultContext,
    private readonly endRequester: () => Promise<void>,
  ) {
    this.requester = vaultRequesterSchema.parse(structuredClone(requester))
    if (
      this.requester.source !== 'headless' ||
      !this.requester.unattended ||
      this.requester.role.kind !== 'headless' ||
      this.requester.conversationId !== context.sessionId ||
      this.requester.workspaceId === null
    )
      throw new Error(UI_TEXT.vault.noAccess)
  }
  private isCurrent(): boolean {
    return !this.closed && !this.context.signal.aborted
  }
  private deny(
    handle: string,
    use: VaultUse,
    reason: Extract<VaultApprovalResult, { kind: 'denied' }>['reason'],
  ): VaultApprovalResult {
    let detail = UI_TEXT.vault.noAccess
    switch (reason) {
      case 'presence': {
        detail = UI_TEXT.vault.presenceTierWarning
        break
      }
      case 'locked': {
        detail = UI_TEXT.vault.locked
        break
      }
      case 'expired': {
        detail = UI_TEXT.vault.approvalExpired
        break
      }
      case 'digest': {
        detail = UI_TEXT.vault.useChanged
        break
      }
      case 'ceiling': {
        detail = UI_TEXT.vault.ceilingNone
        break
      }
      default: {
        break
      }
    }
    this.context.onDenied(
      reason === 'unattended'
        ? fill(UI_TEXT.vault.noUnattended, { item: handle, use: JSON.stringify(use) })
        : `${handle}: ${detail} (${reason})`,
    )
    return { kind: 'denied', reason }
  }
  async request(
    handle: string,
    rawUse: VaultUse,
    rawTaint: VaultTaint,
  ): Promise<VaultApprovalResult> {
    try {
      const use = vaultUseSchema.parse(structuredClone(rawUse))
      const taint = vaultTaintSchema.parse(structuredClone(rawTaint))
      const item = vaultItemMetadataSchema.shape.handle.parse(handle)
      if (!this.isCurrent()) return this.deny(item, use, 'peer')
      if (taint.tainted) return this.deny(item, use, 'tainted')
      const digest = vaultUseDigest(use)
      const result = vaultAuthorizationResultSchema.parse(
        await this.broker.request(this.requester, handle, use, taint),
      )
      if (!this.isCurrent()) return this.deny(item, use, 'peer')
      if (result.kind === 'denied') return this.deny(item, use, result.reason)
      if (result.kind !== 'ticket' || result.authority.kind !== 'grant')
        return this.deny(item, use, 'policy')
      if (result.ticket.requesterId !== this.requester.id || result.ticket.digest !== digest)
        return this.deny(item, use, 'digest')
      return result.ticket.expiresAt !== null && this.broker.clock.now() >= result.ticket.expiresAt
        ? this.deny(item, use, 'expired')
        : result
    } catch {
      this.context.onDenied(UI_TEXT.vault.noAccess)
      return { kind: 'denied', reason: 'unattended' }
    }
  }
  /** D243: the exec host port's view of this registration. */
  execBroker(): HeadlessVaultBroker {
    return {
      authorize: async (handle, use, taint, signal) => {
        signal.throwIfAborted()
        // D243 lane T: the host's provenance rides with each proposal
        // over this incarnation-bound connection; the broker evaluates
        // the reported taint, and a report can only add taint.
        if (this.broker.reportProvenance) {
          const parsed = vaultTaintSchema.parse(structuredClone(taint))
          const wasReported = await this.broker.reportProvenance(parsed)
          if (!wasReported || !this.isCurrent()) return this.deny(handle, use, 'peer')
        }
        return await this.request(handle, use, taint)
      },
      list: async () => {
        if (!this.isCurrent()) throw new Error(UI_TEXT.vault.noAccess)
        return await this.broker.list(this.requester)
      },
      delegate: async (ticketId, feeder, envelopeDigest) => {
        if (!this.isCurrent() || !this.broker.delegate) throw new Error(UI_TEXT.vault.noAccess)
        const wasDelegated = await this.broker.delegate(ticketId, feeder, envelopeDigest)
        if (!wasDelegated || !this.isCurrent()) throw new Error(UI_TEXT.vault.noAccess)
      },
    }
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.endRequester()
  }
}

/** Headless `--vault`: one requester connection, registered as unattended and headless. */
export async function openHeadlessVault(
  connect: VaultConnect,
  context: ExecVaultContext,
  hostId: string,
  processId: number,
): Promise<ExecVaultSession> {
  const client = await connect()
  // Cancellation during any later await closes this connection at once (RVCM1091A2 P3).
  const abort = () => {
    client.close()
  }
  context.signal.addEventListener('abort', abort, { once: true })
  try {
    // Cancelled while connecting: the late connection is closed, never registered (F8).
    if (context.signal.aborted) throw new Error(UI_TEXT.vault.noAccess)
    const requester: VaultRequester = vaultRequesterSchema.parse({
      id: newId(),
      hostId,
      conversationId: context.sessionId,
      taskId: null,
      role: { kind: 'headless' },
      workspaceId: context.cwd,
      deviceId: null,
      peerProcessId: processId,
      sessionId: null,
      unattended: true,
      source: 'headless',
    })
    const registered = await client.send({ kind: 'registerRequester', requester })
    // Re-checked after the await: a run cancelled meanwhile gets no session.
    if (isCancelled(context.signal) || registered.kind !== 'ok')
      throw new Error(UI_TEXT.vault.noAccess)
    const port: HeadlessBrokerPort = {
      clock: { now: Date.now },
      status: async () => {
        const response = await client.send({ kind: 'status' })
        if (response.kind !== 'status') throw new Error(UI_TEXT.vault.noAccess)
        return vaultStatusSchema.parse(response.status)
      },
      list: async () => {
        const response = await client.send({ kind: 'list' })
        if (response.kind !== 'items') throw new Error(UI_TEXT.vault.noAccess)
        return response.items
      },
      request: async (_requester, handle: string, use: VaultUse, taint: VaultTaint) =>
        vaultAuthorizationResultSchema.parse(
          await client.send({ kind: 'requestUse', proposal: { handle, use, taint } }),
        ),
      reportProvenance: async (taint: VaultTaint) => {
        const reply = await client.send({ kind: 'reportProvenance', taint })
        return reply.kind === 'ok'
      },
      delegate: async (
        ticketId: string,
        feeder: { processId: number; startedAt: number },
        envelopeDigest: string,
      ) => {
        const reply = await client.send({ kind: 'delegate', ticketId, feeder, envelopeDigest })
        return reply.kind === 'ok'
      },
      // Headless never answers a card: there is no person to ask (D89.10).
      answer: () => Promise.resolve({ kind: 'denied', reason: 'unattended' }),
      lock: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
    }
    return new HeadlessVaultSession(requester, port, context, () => {
      client.close()
      return Promise.resolve()
    })
  } catch (error: unknown) {
    client.close()
    throw error
  } finally {
    context.signal.removeEventListener('abort', abort)
  }
}

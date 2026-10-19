// dist/vaultRuntime.js (lead decision 5, 2026-10-10): the CLI, the ACP agent
// and headless runs load this on first vault need. No `vscode` import. The
// platform's connection (discovery, broker launch and peer check) comes from
// vaultClientPlatform (POSIX bound; Windows follows in lane C-M109-1c).
// The write-only crypto loads with the first session, never with the agent.

import { createRequire } from 'node:module'
import path from 'node:path'
import type * as BrokerBindingsModule from './brokerBindings'
import type { VaultBrokerBindings, VaultBrokerContext } from './vaultBrokerEntry'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import { setUiText, uiLocale } from '../../shared/l10n/text'
import {
  vaultRequesterSchema,
  type VaultRequester,
  type VaultTaint,
  type VaultUse,
} from '../../shared/vault'
import {
  vaultAuthorizationResultSchema,
  vaultBrokerEventSchema,
  vaultStatusSchema,
  type VaultBrokerEvent,
  type VaultBrokerPort,
} from '../../shared/vaultProtocol'
import { encodeVaultMaterial } from '../../core/vault/crypto'
import {
  isCancelled,
  VaultManageSession,
  type VaultConnect,
} from '../../core/vault/broker/manageClient'
import { VaultBrokerProcess } from '../../host/vault/brokerProcess'
import { vaultClientPlatform } from './clientPlatform'
import { HeadlessVaultSession, type ExecVaultContext, type ExecVaultSession } from './execVault'
import type { WindowsBrokerPlatform } from './windowsHost'
import type { VaultCommandPort } from './vaultCommand'
import type { RuntimeVaultBinding, RuntimeVaultContext } from './vaultRuntime'
import type { AcpVault } from '../../acp/vault'
import type { VaultApprovalRequest } from '../../shared/vault'

const newId = (): string => randomBytes(VAULT_LIMITS.idBytes).toString('hex')

/** A Readable's pull hook with nothing to pull: events are pushed by the watch. */
const pushOnly = (): void => {
  /* Events arrive through push(); end arrives with push(null). */
}
/** Pushed broker events as an async iterable for `vault watch`. */
async function* watchEvents(
  session: VaultManageSession,
  signal: AbortSignal,
): AsyncGenerator<VaultBrokerEvent> {
  const stream = new Readable({ objectMode: true, read: pushOnly })
  void (async () => {
    try {
      await session.watch((event) => {
        stream.push(event)
      }, signal)
      stream.push(null)
    } catch (error: unknown) {
      // A broken watch fails `vault watch` instead of ending it as success (F7).
      stream.destroy(error instanceof Error ? error : new Error(UI_TEXT.vault.noAccess))
    }
  })()
  for await (const event of stream) yield vaultBrokerEventSchema.parse(event)
}

/** The CLI's manage port over v2; each call is its own authenticated connection. */
export function vaultCommandPort(session: VaultManageSession): VaultCommandPort {
  const metadataOf = async (itemId: string) => {
    const snapshot = await session.snapshot()
    const item = snapshot.items.find((entry) => entry.id === itemId)
    if (item === undefined) throw new Error(UI_TEXT.vault.noAccess)
    return item
  }
  return {
    // The management view knows "uncreated" and "setupPending"; the broker alone does not.
    status: async () => {
      const snapshot = await session.snapshot()
      return snapshot.status
    },
    list: async () => {
      const snapshot = await session.snapshot()
      return snapshot.items
    },
    lock: async () => {
      await session.lock()
    },
    audit: async () => await session.audit(),
    unlock: async (slotId) => {
      await session.unlock(slotId)
    },
    add: async (item) => {
      await session.write(item, false)
    },
    remove: async (itemId) => {
      await session.remove(itemId)
    },
    grant: async (grant) => {
      await session.grant(grant)
    },
    revoke: async (grantId) => {
      await session.revoke(grantId)
    },
    importFile: async (path) => await session.importFile(path),
    keepImport: async (receipt) => {
      await session.keepImport(receipt)
    },
    deleteImport: async (receipt) => {
      await session.deleteImport(receipt)
    },
    pendingReceipts: async () => {
      const snapshot = await session.snapshot()
      return snapshot.pendingReceipts.map((entry) => ({
        receipt: entry.receipt,
        path: entry.path,
        items: [...entry.items],
      }))
    },
    resetBegin: async () => await session.resetBegin(),
    resetConfirm: async (resetId, word) => {
      await session.resetConfirm(resetId, word)
    },
    publicKey: metadataOf,
    watch: (signal) => watchEvents(session, signal),
    answer: async (answer) => await session.answer(answer),
    setup: async () => await session.setup(),
    confirmSetup: async (setupId) => {
      await session.confirmSetup(setupId)
    },
    cancelSetup: async (setupId) => {
      await session.cancelSetup(setupId)
    },
    recover: async (code) => {
      await session.recover(code)
    },
    close: () => Promise.resolve(),
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
    const port: VaultBrokerPort = {
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

/**
 * Approvals from any requester reach the ACP editor while one is attached:
 * each broker approval becomes a `session/request_permission` round trip,
 * and the editor's answer is submitted back to the management session.
 * Without an attached asker (terminal, headless) approvals are left for
 * `vault watch`; answering deny here would steal them.
 */
function routeBrokerApprovals(
  session: VaultManageSession,
  acp: AcpVault,
  signal: AbortSignal,
): void {
  const pending: VaultApprovalRequest[] = []
  let isPumping = false
  const pump = async (): Promise<void> => {
    if (isPumping) return
    isPumping = true
    try {
      while (pending.length > 0) {
        const request = pending.shift()
        if (request === undefined || isCancelled(signal)) break
        // A requester outside any editor session has no session to ask in.
        const sessionId = request.requester.conversationId
        if (sessionId === null || !acp.attached) continue
        try {
          const answer = await acp.ask(sessionId, request)
          if (isCancelled(signal)) break
          await session.answer(answer)
        } catch {
          // Fail closed at the broker: the request expires unanswered, and
          // a lost editor never blocks the watch.
        }
      }
    } finally {
      isPumping = false
    }
  }
  const onApproval = (request: VaultApprovalRequest): void => {
    pending.push(request)
    void pump()
  }
  void session
    .watch((event) => {
      if (event.kind === 'approval') onApproval(event.request)
    }, signal)
    .catch(() => {
      // A broken watch ends approval routing; commands open their own
      // connections and keep working.
    })
}

export async function createRuntimeVault(
  context: RuntimeVaultContext,
): Promise<RuntimeVaultBinding> {
  setUiText(context.uiText, context.locale)
  const hostId = newId()
  const hostSession = newId()
  const platform = await vaultClientPlatform({
    dataDir: context.dataDir,
    distDir: context.distDir,
    hostId,
    hostSession,
  })
  const broker = new VaultBrokerProcess(platform.discovery, platform.process)
  const connect: VaultConnect = async () =>
    await broker.connect(hostId, hostSession, platform.peers, platform.dial)
  const session = new VaultManageSession(connect, encodeVaultMaterial)
  // Process lifetime: the runtime binding owns no close, so routing runs
  // until the broker or the process goes away. One-shot CLI commands never
  // attach an asker, so they start no watch and exit once done.
  context.acp.onAttach(() => {
    routeBrokerApprovals(session, context.acp, new AbortController().signal)
  })
  return {
    commands: () => Promise.resolve(vaultCommandPort(session)),
    exec: {
      open: async (execContext) =>
        await openHeadlessVault(connect, execContext, hostId, context.processId),
    },
  }
}

/** Child-only binding code stays in its installed lazy sibling, preserving this bundle's cap. */
export async function createVaultBrokerBindings(
  context: VaultBrokerContext,
  platform?: WindowsBrokerPlatform,
): Promise<VaultBrokerBindings> {
  // Same-build installed sibling contract; check the factory before calling (PLAN §8).
  const module = createRequire(__filename)(
    path.join(__dirname, 'vaultBrokerBindings.js'),
  ) as typeof BrokerBindingsModule
  if (typeof module.createVaultBrokerBindings !== 'function')
    throw new Error(UI_TEXT.vault.brokerBlocked)
  module.setUiText(UI_TEXT, uiLocale())
  return await module.createVaultBrokerBindings(context, {}, platform)
}

// dist/vaultRuntime.js (lead decision 5, 2026-10-10): the CLI, the ACP agent
// and headless runs load this on first vault need. No `vscode` import. The
// platform's connection (discovery, broker launch and peer check) comes from
// vaultClientPlatform (POSIX bound; Windows follows in lane C-M109-1c).
// The write-only crypto loads with the first session, never with the agent.

import { createRequire } from 'node:module'
import path from 'node:path'
import type * as BrokerBindingsModule from './brokerBindings'
import type * as RuntimeMigrationModule from './vaultRuntimeMigrationEntry'
import type { VaultBrokerBindings, VaultBrokerContext } from './vaultBrokerEntry'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  UI_TEXT,
  VAULT_LIMITS,
  VAULT_EXEC_HOST_BUNDLE_FILE,
  VAULT_RUNTIME_MIGRATION_BUNDLE_FILE,
} from '../../shared/constants'
import type { Logger } from '../../host/logger'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { CredentialMigrationController } from '../../host/vault/migrateCredentials'
import { setUiText, uiLocale } from '../../shared/l10n/text'
import { vaultBrokerEventSchema, type VaultBrokerEvent } from '../../shared/vaultProtocol'
import { encodeVaultMaterial } from '../../core/vault/crypto'
import {
  isCancelled,
  VaultManageSession,
  type VaultConnect,
} from '../../core/vault/broker/manageClient'
import { VaultBrokerProcess } from '../../host/vault/brokerProcess'
import { vaultClientPlatform } from './clientPlatform'
import type * as VaultExecHostModule from './vaultExecHostEntry'
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

/**
The CLI's manage port over v2; each call is its own authenticated
connection. `onUnlocked` is awaited after a command leaves the vault
unlocked (an unlock, a confirmed setup, a recovery): the key-store
migration's unlock edge in a one-shot process, where no broker watch
runs and the process would otherwise exit before the copy finished.
*/
export function vaultCommandPort(
  session: VaultManageSession,
  onUnlocked?: () => Promise<void>,
): VaultCommandPort {
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
      await onUnlocked?.()
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
      await onUnlocked?.()
    },
    cancelSetup: async (setupId) => {
      await session.cancelSetup(setupId)
    },
    recover: async (code) => {
      await session.recover(code)
      await onUnlocked?.()
    },
    close: () => Promise.resolve(),
  }
}

/**
Approvals from any requester reach the ACP editor while one is attached:
each broker approval becomes a `session/request_permission` round trip,
and the editor's answer is submitted back to the management session.
Without an attached asker (terminal, headless) approvals are left for
`vault watch`; answering deny here would steal them.
*/
function routeBrokerApprovals(
  session: VaultManageSession,
  acp: AcpVault,
  signal: AbortSignal,
  onUnlockEdge: () => void,
  log: Logger,
): void {
  const pending: VaultApprovalRequest[] = []
  let isPumping = false
  // The key-store migration's unlock edge in a serving process: broker
  // events carry no "unlocked" kind, so a change re-reads the status
  // and only a transition into unlocked fires (the panel host's rule).
  let lastUnlocked: boolean | undefined
  const checkLockEdge = async (): Promise<void> => {
    let isUnlocked: boolean
    try {
      const snapshot = await session.snapshot()
      isUnlocked = snapshot.status.state === 'unlocked'
    } catch (error: unknown) {
      // The edge is left for the next event; the failure is reported
      // with fixed words, never the broker's text.
      log.warn(`Credential migration lock check failed: ${failureForLog(error)}`)
      return
    }
    if (isUnlocked === lastUnlocked) return
    lastUnlocked = isUnlocked
    if (isUnlocked) onUnlockEdge()
  }
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
      else if (event.kind === 'changed' || event.kind === 'locked') void checkLockEdge()
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
  const connectBroker = async () =>
    await broker.connect(hostId, hostSession, platform.peers, platform.dial)
  const connect: VaultConnect = connectBroker
  const session = new VaultManageSession(connect, encodeVaultMaterial)
  // The key-store migration (RLF-M109) loads its own chunk on the first
  // unlock edge only, like the window's; a chunk that cannot load is
  // retried at the next unlock, and the keys keep working in the OS
  // store meanwhile. The controller's own run never throws.
  let migrationController: CredentialMigrationController | undefined
  const ensureMigrated = async (): Promise<void> => {
    const source = context.migration
    if (source === undefined) return
    try {
      migrationController ??= (() => {
        // Same-build installed sibling contract; check the factory before calling (PLAN §8).
        const module = createRequire(__filename)(
          path.join(__dirname, VAULT_RUNTIME_MIGRATION_BUNDLE_FILE),
        ) as Partial<typeof RuntimeMigrationModule>
        if (
          typeof module.bindRuntimeCredentialMigration !== 'function' ||
          typeof module.setUiText !== 'function'
        )
          throw new TypeError(UI_TEXT.vault.brokerBlocked)
        module.setUiText(UI_TEXT, uiLocale())
        return module.bindRuntimeCredentialMigration({
          session,
          connect: connectBroker,
          openEntry: source.openEntry,
          rawSecrets: source.rawSecrets,
          shell: source.shell,
          dataDir: context.dataDir,
          providersFile: source.providersFile,
          minorRelease: source.minorRelease,
          now: Date.now,
          log: context.log,
          label: UI_TEXT.vault.secret,
        })
      })()
    } catch (error: unknown) {
      context.log.warn(`Credential migration unavailable: ${failureForLog(error)}`)
      return
    }
    await migrationController.ensureMigrated()
  }
  // Process lifetime: the runtime binding owns no close, so routing runs
  // until the broker or the process goes away. One-shot CLI commands never
  // attach an asker, so they start no watch and exit once done.
  context.acp.onAttach(() => {
    routeBrokerApprovals(
      session,
      context.acp,
      new AbortController().signal,
      () => {
        void ensureMigrated()
      },
      context.log,
    )
  })
  // D216: the headless exec stack is its own lazy chunk
  // (dist/vaultExecHost.js); the same-build sibling contract is
  // validated before use (PLAN §8).
  let execHostModule: typeof VaultExecHostModule | undefined
  const loadVaultExecHost = (): typeof VaultExecHostModule => {
    if (execHostModule === undefined) {
      const loaded = createRequire(__filename)(
        path.join(__dirname, VAULT_EXEC_HOST_BUNDLE_FILE),
      ) as typeof VaultExecHostModule
      if (typeof loaded.openHeadlessVault !== 'function' || typeof loaded.setUiText !== 'function')
        throw new TypeError(UI_TEXT.vault.brokerBlocked)
      loaded.setUiText(UI_TEXT, uiLocale())
      execHostModule = loaded
    }
    return execHostModule
  }
  return {
    commands: () => Promise.resolve(vaultCommandPort(session, ensureMigrated)),
    exec: {
      dataDir: context.dataDir,
      open: async (execContext) =>
        await loadVaultExecHost().openHeadlessVault(
          connect,
          execContext,
          hostId,
          context.processId,
        ),
    },
    ensureMigrated,
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
    throw new TypeError(UI_TEXT.vault.brokerBlocked)
  module.setUiText(UI_TEXT, uiLocale())
  return await module.createVaultBrokerBindings(context, {}, platform)
}

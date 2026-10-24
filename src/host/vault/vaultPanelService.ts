// C-M109-1 (a): the VS Code panel's broker-backed service (VaultPanelService)
// over protocol v2. It lives in dist/vault.js; activation never loads it.
// authorize() runs after every await, including the connection's, immediately
// before the broker request that commits, as VaultPanelHost requires (F5).

import type { VaultPanelState } from '../../shared/vaultPanel'
import type { VaultBrokerEvent } from '../../shared/vaultProtocol'
import { UI_TEXT, VAULT_WATCH_RETRY_MAX_MS, VAULT_WATCH_RETRY_MS } from '../../shared/constants'
import {
  isCancelled,
  vaultAbortableDelay,
  type VaultManageSession,
} from '../../core/vault/broker/manageClient'
import type { AmbientFile } from '../../core/vault/migrate/ambient'
import type { VaultPanelService, VaultRetiredUndoPort } from './vaultPanelHost'

export interface VaultPanelServiceDeps {
  /** Files the user may pick for Import (M's ambient discovery); never read here. */
  readonly ambientFiles: () => Promise<readonly AmbientFile[]>
  /**
  D217: the key-store migration's retired-slot surface, once the binding
  binds it on the first unlock edge. Absent in tests and lock-only hosts,
  where no retired entry lists and every undo is refused as stale.
  */
  readonly migration?: () => VaultRetiredUndoPort | undefined
}

export function vaultPanelService(
  session: VaultManageSession,
  deps: VaultPanelServiceDeps,
): VaultPanelService {
  return {
    snapshot: async (): Promise<VaultPanelState> => {
      const snapshot = await session.snapshot()
      const isUnlocked = snapshot.status.state === 'unlocked'
      const audit = isUnlocked ? await session.audit() : []
      // Import discovery is optional: an unreadable ambient location must
      // not hide an otherwise healthy vault behind a failed snapshot.
      let ambientFiles: readonly AmbientFile[] = []
      if (isUnlocked) {
        try {
          ambientFiles = await deps.ambientFiles()
        } catch {
          // Import discovery is optional: an unreadable ambient location
          // degrades to no suggestions, never to a failed snapshot.
          ambientFiles = []
        }
      }
      // D217: retired slots list only while unlocked; a lock landing
      // between the status read and this list refuses like the audit's
      // own race, and the broker's locked event settles the true view.
      const migration = isUnlocked ? deps.migration?.() : undefined
      const retired = migration === undefined ? [] : [...(await migration.listRetired())]
      return {
        status: snapshot.status,
        items: snapshot.items,
        grants: snapshot.grants,
        audit: [...audit],
        pending: snapshot.pending,
        retired,
        pendingReceipts: snapshot.pendingReceipts.map((entry) => ({
          receipt: entry.receipt,
          path: entry.path,
          items: [...entry.items],
        })),
        ambientFiles: [...ambientFiles],
      }
    },
    undoRetired: async (key) => {
      const migration = deps.migration?.()
      if (migration === undefined) throw new Error(UI_TEXT.vault.useChanged)
      await migration.undoRetired(key)
    },
    subscribe: (changed: (event: VaultBrokerEvent) => void, failed: () => void) => {
      const controller = new AbortController()
      const signal = controller.signal
      void (async () => {
        let delay = VAULT_WATCH_RETRY_MS
        let isReported = false
        while (!signal.aborted) {
          try {
            await session.watch((event) => {
              // A (re)opened stream resets the failure report and the backoff.
              isReported = false
              delay = VAULT_WATCH_RETRY_MS
              changed(event)
            }, signal)
          } catch {
            // Reported once per outage, then retried with a bounded backoff (F7).
            if (!isReported && !isCancelled(signal)) failed()
            isReported = true
            await vaultAbortableDelay(delay, signal)
            delay = Math.min(delay * 2, VAULT_WATCH_RETRY_MAX_MS)
          }
        }
      })()
      return () => {
        controller.abort()
      }
    },
    unlock: (authorize) => session.unlock(null, authorize),
    lock: session.lock.bind(session),
    write: async (item, authorize) => {
      const snapshot = await session.snapshot()
      const isEdit = snapshot.items.some((entry) => entry.id === item.metadata.id)
      await session.write(item, isEdit, authorize)
    },
    updateMetadata: session.editMetadata.bind(session),
    remove: session.remove.bind(session),
    grant: session.grant.bind(session),
    revoke: session.revoke.bind(session),
    answer: async (answer, authorize) => {
      await session.answer(answer, authorize)
    },
    importFile: session.importFile.bind(session),
    keepImport: session.keepImport.bind(session),
    deleteImport: session.deleteImport.bind(session),
    resetBegin: session.resetBegin.bind(session),
    resetConfirm: session.resetConfirm.bind(session),
    setup: session.setup.bind(session),
    confirmSetup: session.confirmSetup.bind(session),
    cancelSetup: session.cancelSetup.bind(session),
  }
}

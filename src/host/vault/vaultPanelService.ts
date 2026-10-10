// C-M109-1 (a): the VS Code panel's broker-backed service (VaultPanelService)
// over protocol v2. It lives in dist/vault.js; activation never loads it.
// authorize() runs after every await, including the connection's, immediately
// before the broker request that commits, as VaultPanelHost requires (F5).

import type { VaultPanelState } from '../../shared/vaultPanel'
import type { VaultBrokerEvent } from '../../shared/vaultProtocol'
import { VAULT_WATCH_RETRY_MAX_MS, VAULT_WATCH_RETRY_MS } from '../../shared/constants'
import {
  isCancelled,
  vaultAbortableDelay,
  type VaultManageSession,
} from '../../core/vault/broker/manageClient'
import type { AmbientFile } from '../../core/vault/migrate/ambient'
import type { VaultPanelService } from './vaultPanelHost'

export interface VaultPanelServiceDeps {
  /** Files the user may pick for Import (M's ambient discovery); never read here. */
  readonly ambientFiles: () => Promise<readonly AmbientFile[]>
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
      const ambientFiles = isUnlocked ? await deps.ambientFiles() : []
      return {
        status: snapshot.status,
        items: snapshot.items,
        grants: snapshot.grants,
        audit: [...audit],
        pending: snapshot.pending,
        ambientFiles: [...ambientFiles],
      }
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
    unlock: async (authorize) => {
      await session.unlock(null, authorize)
    },
    lock: async () => {
      await session.lock()
    },
    write: async (item, authorize) => {
      const snapshot = await session.snapshot()
      const isEdit = snapshot.items.some((entry) => entry.id === item.metadata.id)
      await session.write(item, isEdit, authorize)
    },
    updateMetadata: async (metadata, authorize) => {
      await session.editMetadata(metadata, authorize)
    },
    remove: async (itemId, authorize) => {
      await session.remove(itemId, authorize)
    },
    grant: async (grant, authorize) => {
      await session.grant(grant, authorize)
    },
    revoke: async (grantId) => {
      await session.revoke(grantId)
    },
    answer: async (answer, authorize) => {
      await session.answer(answer, authorize)
    },
    importFile: async (path, authorize) => await session.importFile(path, authorize),
    keepImport: async (receipt) => {
      await session.keepImport(receipt)
    },
    deleteImport: async (receipt, authorize) => {
      await session.deleteImport(receipt, authorize)
    },
    resetBegin: async () => await session.resetBegin(),
    resetConfirm: async (resetId, word, authorize) => {
      await session.resetConfirm(resetId, word, authorize)
    },
    setup: async () => await session.setup(),
    confirmSetup: async (setupId, authorize) => {
      await session.confirmSetup(setupId, authorize)
    },
    cancelSetup: async (setupId) => {
      await session.cancelSetup(setupId)
    },
  }
}

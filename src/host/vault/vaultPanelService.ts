// C-M109-1 (a): the VS Code panel's broker-backed service (VaultPanelService)
// over protocol v2. It lives in dist/vault.js; activation never loads it.
// authorize() runs after every await, immediately before the broker call
// that commits, as VaultPanelHost requires.

import type { VaultPanelState } from '../../shared/vaultPanel'
import type { VaultBrokerEvent } from '../../shared/vaultProtocol'
import type { VaultManageSession } from '../../core/vault/broker/manageClient'
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
    subscribe: (changed: (event: VaultBrokerEvent) => void) => {
      const controller = new AbortController()
      void session.watch(changed, controller.signal)
      return () => {
        controller.abort()
      }
    },
    unlock: async (authorize) => {
      authorize()
      await session.unlock(null)
    },
    lock: async () => {
      await session.lock()
    },
    write: async (item, authorize) => {
      const snapshot = await session.snapshot()
      const isEdit = snapshot.items.some((entry) => entry.id === item.metadata.id)
      authorize()
      await session.write(item, isEdit)
    },
    updateMetadata: async (metadata, authorize) => {
      authorize()
      await session.editMetadata(metadata)
    },
    remove: async (itemId, authorize) => {
      authorize()
      await session.remove(itemId)
    },
    grant: async (grant, authorize) => {
      authorize()
      await session.grant(grant)
    },
    revoke: async (grantId) => {
      await session.revoke(grantId)
    },
    answer: async (answer) => {
      await session.answer(answer)
    },
    importFile: async (path, authorize) => {
      authorize()
      await session.importFile(path)
    },
    setup: async () => await session.setup(),
    confirmSetup: async (setupId) => {
      await session.confirmSetup(setupId)
    },
    cancelSetup: async (setupId) => {
      await session.cancelSetup(setupId)
    },
  }
}

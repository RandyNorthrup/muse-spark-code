// The credential lease's bundle (M95 D74, PLAN.md D6): esbuild builds this
// file into dist/credentialLease.js, which activation and the CLIs require
// on the first guarded credential write, Connect recovery or usage-page
// identity read, so the lease, its journal and the stored credential's
// identity stay out of the bundles VS Code and the CLIs load at start.
// Synchronous path callers keep their static import of
// `core/credentialPaths`; everything here may block. Secrets cross the
// chunk only as the structural `CredentialStorePort`, so no host value
// import enters the chunk beside the re-exported identity reader.
import { homedir } from 'node:os'
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { credentialLockDir, providerConfigFilePath } from './credentialPaths'
import type { SecretStore } from '../host/auth/credentialStore'

import {
  CredentialLockBusyError,
  OPENROUTER_JOURNAL_KEY_LABEL,
  OPENROUTER_JOURNAL_KEYS_URL,
  openRouterJournalKeys,
  recoverCredentialJournal,
  withCredentialLock,
} from './credentialLease'

export {
  CredentialLockBusyError,
  OPENROUTER_JOURNAL_KEY_LABEL,
  OPENROUTER_JOURNAL_KEYS_URL,
  formatCredentialJournal,
  openRouterJournalKeys,
  recoverCredentialJournal,
  withCredentialLock,
} from './credentialLease'
export { storedCredentialId } from '../host/providers/credentialRecords'

/** The machine's credential lease directory (the terminal derives the same one). */
export function credentialLeaseDir(): string {
  return credentialLockDir(
    providerConfigFilePath({
      platform: process.platform,
      homeDir: homedir(),
      xdgConfigHome: process.env['XDG_CONFIG_HOME'],
    }),
  )
}

/** The log a Connect recovery needs (a warning when recovery itself fails). */
export interface LeaseRecoveryLog {
  warn(message: string): void
}

/**
Surface a crashed terminal Connect without opening a Models tab
(RVCM952D R5). Runs inside the one credential lease, so it never deletes
a live attempt's journal: a held lease skips silently. A committed
journal reports the key in use (never a removal notice); a discarded one
reports the created key with its label and removal page. Loads with this
bundle, never at activation, and never the OAuth flow: the notice is
composed here from the journal binding's label and removal page.
*/
export async function recoverOpenRouterConnect(
  secrets: SecretStore,
  showWarning: (message: string) => void,
  showInformation: (message: string) => void,
  log: LeaseRecoveryLog,
  lock?: {
    readonly withCredentialLock: <T>(operation: () => Promise<T>) => Promise<T>
  },
): Promise<void> {
  const { account, staging } = openRouterJournalKeys()
  const store = {
    get: (key: string): Promise<string | undefined> => Promise.resolve(secrets.get(key)),
    delete: (key: string): Promise<void> => Promise.resolve(secrets.delete(key)),
  }
  const acquire =
    lock?.withCredentialLock ??
    (async <T>(operation: () => Promise<T>): Promise<T> => {
      return await withCredentialLock(credentialLeaseDir(), operation)
    })
  let recovery
  try {
    recovery = await acquire(() => recoverCredentialJournal(store, account, staging))
  } catch (error: unknown) {
    // A live attempt owns its journal; anything else is logged, never shown.
    if (!(error instanceof CredentialLockBusyError)) log.warn('OpenRouter Connect recovery failed')
    return
  }
  switch (recovery.decision.kind) {
    case 'discarded':
    case 'legacy': {
      if (recovery.journalKept) {
        log.warn('OpenRouter Connect recovery failed')
        break
      }
      showWarning(
        fill(UI_TEXT.providerCreatedKeyDiscarded, {
          label: OPENROUTER_JOURNAL_KEY_LABEL,
          url: OPENROUTER_JOURNAL_KEYS_URL,
        }),
      )
      break
    }
    case 'committed': {
      showInformation(UI_TEXT.providerConnectRecoveredStored)
      break
    }
    case 'none':
    case 'stale': {
      break
    }
  }
}

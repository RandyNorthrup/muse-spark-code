// The Models & Agents bundles as the activation bundle sees them (M95
// lane K, PLAN.md D6): dist/modelsPanel.js, built from modelsPanelEntry.ts
// and required on the first Models & Agents action; and the lane-P/T seam
// from dist/providers.js, which the panel's factory is composed with. The
// subscriptions half lives in dist/modelsSubscriptions.js beside them (its
// own loader, modelsSubscriptionsBundle.ts). Only
// types come from the entries here: a value imported from there would carry
// the panel back into dist/extension.js, which the bundle-split gate
// refuses.

import { homedir } from 'node:os'
import {
  CredentialLockBusyError,
  credentialLockDir,
  OPENROUTER_JOURNAL_KEY_LABEL,
  OPENROUTER_JOURNAL_KEYS_URL,
  openRouterJournalKeys,
  providerConfigFilePath,
  recoverCredentialJournal,
  withCredentialLock,
} from '../../core/credentialLease'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as ModelsPanelEntry from './modelsPanelEntry'
import { CredentialStore, type SecretStore } from '../auth/credentialStore'
import type { ProviderEntry } from '../providers/providerPorts'

/** Activation and the panel share this store, including credential-free locals. */
export function providerCredentials(
  secrets: SecretStore,
  log: Logger,
  readProviders: () => Promise<readonly ProviderEntry[]>,
): CredentialStore {
  return new CredentialStore(
    secrets,
    (message) => {
      log.warn(message)
    },
    undefined,
    async () => {
      try {
        return await readProviders()
      } catch {
        log.warn('Configured providers could not be read')
        return []
      }
    },
  )
}

/**
 * Surface a crashed terminal Connect at activation, without opening a
 * Models tab (RVCM952D R5). Runs inside the one credential lease, so it
 * never deletes a live attempt's journal: a held lease skips silently. A
 * committed journal reports the key in use (never a removal notice); a
 * discarded one reports the created key with its label and removal page.
 */
export async function recoverOpenRouterConnect(
  secrets: SecretStore,
  showWarning: (message: string) => void,
  showInformation: (message: string) => void,
  log: Logger,
  lock?: {
    readonly withCredentialLock: <T>(operation: () => Promise<T>) => Promise<T>
  },
): Promise<void> {
  // The activation bundle carries the lease statically (it has room) but
  // never the OAuth flow: the notice is composed here from the journal
  // binding's label and removal page.
  const { account, staging } = openRouterJournalKeys()
  const store = {
    get: (key: string): Promise<string | undefined> => Promise.resolve(secrets.get(key)),
    delete: (key: string): Promise<void> => Promise.resolve(secrets.delete(key)),
  }
  const acquire =
    lock?.withCredentialLock ??
    (async <T>(operation: () => Promise<T>): Promise<T> => {
      const lockDir = credentialLockDir(
        providerConfigFilePath({
          platform: process.platform,
          homeDir: homedir(),
          xdgConfigHome: process.env['XDG_CONFIG_HOME'],
        }),
      )
      return await withCredentialLock(lockDir, operation)
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

/** Recover persisted deletion on activation, without opening a Models tab. */
export async function recoverProviderRemovals(
  pending: unknown,
  features: () => ModelsPanelEntry.ModelsPanelFeatures,
  log: Logger,
): Promise<void> {
  if (!Array.isArray(pending) || pending.length === 0) {
    return
  }
  try {
    await features().completePendingRemovals()
  } catch {
    log.warn('Provider removal cleanup failed')
  }
}

/** The panel bundle's one export. */
export interface ModelsPanelBundle {
  readonly createModelsPanelFeatures: typeof ModelsPanelEntry.createModelsPanelFeatures
  readonly setComposerModelConfirmed?: typeof ModelsPanelEntry.setComposerModelConfirmed
  readonly publishProviderSetup?: typeof ModelsPanelEntry.publishProviderSetup
}

/** Whether a required module is the panel bundle: its factory is a function. */
export function isModelsPanelBundle(value: unknown): value is ModelsPanelBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createModelsPanelFeatures' in value &&
    typeof value.createModelsPanelFeatures === 'function'
  )
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a required module carries the lane-P/T seam the panel's factory
 * takes: required members are objects; absent OpenRouter services stay absent.
 * Signatures are taken on
 * trust (PLAN.md §8): entry, loader and package come from one source tree,
 * one `npm run build` and one package.
 */
export function isModelsPanelSeam(value: unknown): value is ModelsPanelEntry.ModelsPanelSeam {
  if (!isObjectRecord(value)) {
    return false
  }
  for (const name of ['store', 'catalog', 'policy', 'tester', 'fetcher', 'pkce', 'suggest']) {
    const member = value[name]
    if (typeof member !== 'object' || member === null) {
      return false
    }
  }
  for (const name of ['exchanger', 'usage']) {
    const member = value[name]
    if (member !== undefined && (typeof member !== 'object' || member === null)) return false
  }
  return true
}

export interface ModelsPanelLoaderDeps {
  /** dist/modelsPanel.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

export interface ProvidersSeamLoaderDeps {
  /** dist/providers.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The panel bundle, required on the first Models & Agents action and kept. */
export function modelsPanelLoader(deps: ModelsPanelLoaderDeps): () => ModelsPanelBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isModelsPanelBundle,
    label: 'models panel bundle',
    unavailable: () => UI_TEXT.modelsPanelUnavailable,
  })
}

/** The lane-P/T seam, required with the panel bundle and kept. */
export function providersSeamLoader(
  deps: ProvidersSeamLoaderDeps,
): () => ModelsPanelEntry.ModelsPanelSeam {
  return lazyBundleLoader({
    ...deps,
    isBundle: isModelsPanelSeam,
    label: 'providers seam bundle',
    unavailable: () => UI_TEXT.modelsPanelUnavailable,
  })
}

// The Models & Agents bundles as the activation bundle sees them (M95
// lane K, PLAN.md D6): dist/modelsPanel.js, built from modelsPanelEntry.ts
// and required on the first Models & Agents action; and the lane-P/T seam
// from dist/providers.js, which the panel's factory is composed with. Only
// types come from the entries here: a value imported from there would carry
// the panel back into dist/extension.js, which the bundle-split gate
// refuses.

import { UI_TEXT } from '../../shared/constants'
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
  readonly createSubscriptionFeatures: typeof ModelsPanelEntry.createSubscriptionFeatures
  readonly createModelsPanelFeatures: typeof ModelsPanelEntry.createModelsPanelFeatures
  readonly setComposerModelConfirmed?: typeof ModelsPanelEntry.setComposerModelConfirmed
  readonly publishProviderSetup?: typeof ModelsPanelEntry.publishProviderSetup
}

/** Whether a required module is the panel bundle: its factory is a function. */
export function isModelsPanelBundle(value: unknown): value is ModelsPanelBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createSubscriptionFeatures' in value &&
    typeof value.createSubscriptionFeatures === 'function' &&
    'createModelsPanelFeatures' in value &&
    typeof value.createModelsPanelFeatures === 'function'
  )
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a required module carries the lane-P/T seam the panel's factory
 * takes: every seam member present and an object. Signatures are taken on
 * trust (PLAN.md §8): entry, loader and package come from one source tree,
 * one `npm run build` and one package.
 */
export function isModelsPanelSeam(value: unknown): value is ModelsPanelEntry.ModelsPanelSeam {
  if (!isObjectRecord(value)) {
    return false
  }
  for (const name of [
    'store',
    'catalog',
    'policy',
    'tester',
    'fetcher',
    'exchanger',
    'usage',
    'pkce',
    'suggest',
  ]) {
    const member = value[name]
    if (typeof member !== 'object' || member === null) {
      return false
    }
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

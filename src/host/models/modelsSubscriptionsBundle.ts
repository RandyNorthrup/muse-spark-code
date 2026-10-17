// The subscriptions bundle as activation sees it (PLAN.md D6):
// dist/modelsSubscriptions.js, built from modelsSubscriptionsEntry.ts and
// required on the first subscription action. Only types come from the entry
// here: a value imported from there would carry the sign-in flows back into
// dist/extension.js, which the bundle-split gate refuses.

import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as ModelsSubscriptionsEntry from './modelsSubscriptionsEntry'

/** The subscriptions bundle's one export. */
export interface ModelsSubscriptionsBundle {
  readonly createSubscriptionFeatures: typeof ModelsSubscriptionsEntry.createSubscriptionFeatures
}

/** Whether a required module is the subscriptions bundle: its factory is a function. */
export function isModelsSubscriptionsBundle(value: unknown): value is ModelsSubscriptionsBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createSubscriptionFeatures' in value &&
    typeof value.createSubscriptionFeatures === 'function'
  )
}

export interface ModelsSubscriptionsLoaderDeps {
  /** dist/modelsSubscriptions.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The subscriptions bundle, required on the first subscription action and kept. */
export function modelsSubscriptionsLoader(
  deps: ModelsSubscriptionsLoaderDeps,
): () => ModelsSubscriptionsBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isModelsSubscriptionsBundle,
    label: 'models subscriptions bundle',
    unavailable: () => UI_TEXT.modelsPanelUnavailable,
  })
}

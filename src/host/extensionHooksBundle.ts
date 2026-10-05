// The dist/extensionHooks.js loader (M91, PLAN.md D6): the both-backend hook
// events (FileChanged, ConfigChange, Setup, Manual, DirectoryAdded) run from
// that bundle, outside the Model API bundle, with their own D6 budget row.

import { UI_TEXT } from '../shared/constants'
import { lazyBundleLoader } from './lazyBundle'
import type { Logger } from './logger'
import type { ExtensionHookRunner, ExtensionHookRunnerDeps } from './extensionHooksEntry'
import type { UiText } from '../shared/l10n/en'

export interface ExtensionHooksModule {
  createExtensionHookRunner: (
    deps: ExtensionHookRunnerDeps,
    uiText: UiText,
    locale: string,
  ) => ExtensionHookRunner
}

export interface ExtensionHooksBundle {
  /** Require dist/extensionHooks.js unless a test hands in the module. */
  readonly loadBundle: () => Promise<ExtensionHooksModule>
  readonly bundlePath: string
}

function isExtensionHooksModule(value: unknown): value is ExtensionHooksModule {
  // Shipped entry and loader share one build; validate the export as the other lazy bundles do.
  return (
    typeof value === 'object' &&
    value !== null &&
    'createExtensionHookRunner' in value &&
    typeof value.createExtensionHookRunner === 'function'
  )
}

/** The loader over the built bundle, or over a test double. */
export function extensionHooksBundle(
  bundlePath: string,
  log: Logger,
  loadBundle?: (file: string) => unknown,
): ExtensionHooksBundle {
  const load = lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isExtensionHooksModule,
    label: 'extension hooks',
    unavailable: () => UI_TEXT.extensionHooksUnavailable,
    ...(loadBundle !== undefined && { loadBundle }),
  })
  return {
    loadBundle: () => Promise.resolve(load()),
    bundlePath,
  }
}

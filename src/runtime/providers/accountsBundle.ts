import { lazyBundleLoader } from '../../host/lazyBundle'
import type { CoreLogger } from '../../core/logging'
import { UI_TEXT } from '../../shared/constants'
import type {
  createRuntimeAccountServicesForLocale,
  runTerminalDeveloperCommand,
  runAccountsCommand,
  runAccountAuthSet,
} from './accountsEntry'

export interface RuntimeAccountsBundle {
  readonly runAccountsCommand: typeof runAccountsCommand
  readonly runAccountAuthSet: typeof runAccountAuthSet
  readonly createRuntimeAccountServicesForLocale: typeof createRuntimeAccountServicesForLocale
  readonly runTerminalDeveloperCommand: typeof runTerminalDeveloperCommand
}

/** Same-build factory signatures are trusted after checking the exports (PLAN §8). */
export function isRuntimeAccountsBundle(value: unknown): value is RuntimeAccountsBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createRuntimeAccountServicesForLocale' in value &&
    typeof value.createRuntimeAccountServicesForLocale === 'function' &&
    'runTerminalDeveloperCommand' in value &&
    typeof value.runTerminalDeveloperCommand === 'function' &&
    'runAccountsCommand' in value &&
    typeof value.runAccountsCommand === 'function' &&
    'runAccountAuthSet' in value &&
    typeof value.runAccountAuthSet === 'function'
  )
}

export function runtimeAccountsLoader(deps: {
  readonly bundlePath: string
  readonly log: CoreLogger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): () => RuntimeAccountsBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isRuntimeAccountsBundle,
    label: 'Account services',
    unavailable: () => UI_TEXT.accounts.unavailable,
  })
}

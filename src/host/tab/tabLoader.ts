// Tab's lazy bundle as the activation shim sees it (M94, PLAN.md D6):
// dist/tab.js, built from tabEntry.ts and required on the first Tab
// request or menu (the provider, the completion engine and the ledger).
// Only types cross from the lazy side: a value imported from there would
// carry the provider back into dist/extension.js, which the bundle-split
// gate refuses. Pure: no `vscode` import.

import type { UiText } from '../../shared/l10n/en'
import { fill } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type {
  TabBundleTable,
  TabLanguagesCommandDeps,
  TabLoadedHandle,
  TabLoadedWiring,
  TabProviderDeps,
  TabProviderHandle,
  TabServices,
  TabServicesDeps,
  TabStatusDeps,
} from './tabBundle'
import type { TabSnooze } from './tabSnooze'

/** What tabEntry.ts exports: the services, the provider, the wiring, the status and the menu commands. */
export interface TabBundle {
  createTabServices(deps: TabServicesDeps): TabServices
  createTabProvider(deps: TabProviderDeps & TabBundleTable): TabProviderHandle
  createTabLoaded(wiring: TabLoadedWiring): TabLoadedHandle
  showTabMenu(deps: TabStatusDeps & TabBundleTable): Promise<void>
  snoozeTabCommand(snooze: TabSnooze, table: UiText, locale: string): Promise<void>
  tabLanguagesCommand(deps: TabLanguagesCommandDeps & TabBundleTable): Promise<void>
}

/** Whether a required module exports the Tab bundle's entries. */
export function isTabBundle(value: unknown): value is TabBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createTabServices' in value &&
    typeof value.createTabServices === 'function' &&
    'createTabProvider' in value &&
    typeof value.createTabProvider === 'function' &&
    'createTabLoaded' in value &&
    typeof value.createTabLoaded === 'function' &&
    'showTabMenu' in value &&
    typeof value.showTabMenu === 'function' &&
    'snoozeTabCommand' in value &&
    typeof value.snoozeTabCommand === 'function' &&
    'tabLanguagesCommand' in value &&
    typeof value.tabLanguagesCommand === 'function'
  )
}

export interface TabLoaderDeps {
  /** dist/tab.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required on the first Tab request and kept from then on. */
export function tabLoader(deps: TabLoaderDeps): () => TabBundle {
  const forward =
    (level: 'trace' | 'info' | 'warn') =>
    (message: string): void => {
      deps.log[level](message)
    }
  return lazyBundleLoader({
    ...deps,
    log: {
      trace: forward('trace'),
      info: forward('info'),
      warn: forward('warn'),
      // Paths never reach the log (Acceptance 20): fixed words, as the
      // import bundle's loader keeps them.
      error: (message) => {
        deps.log.error(
          message.includes('does not export')
            ? 'The Tab bundle does not export the Tab'
            : 'The Tab bundle could not be loaded',
        )
      },
    },
    isBundle: isTabBundle,
    label: 'Tab bundle',
    // No Tab-specific "unavailable" string is in lane 0's table: the sentence
    // is the table's own, and the {kind} slot it provides takes the fixed
    // technical class (AGENTS.md rule 5 allows the spliced technical detail).
    unavailable: () => fill(UI_TEXT.tabStatusError, { kind: 'load' }),
  })
}

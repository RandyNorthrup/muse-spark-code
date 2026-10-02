// The import as the activation bundle sees it (M83, PLAN.md D6):
// dist/agentImport.js, built from agentImportEntry.ts and required on the
// first import. Only types come from the import's side here: a value
// imported from there would carry the scan, the converters and `smol-toml`
// back into dist/extension.js, which the bundle-split gate refuses.
//
// There is no fallback without it: an import that cannot load is refused
// with the reason (`agentImportUnavailable`; the log has the cause), and the
// next one tries again.

import { UI_TEXT } from '../shared/constants'
import type { UiText } from '../shared/l10n/en'
import type { AgentImportHost } from './commands/agentImportCommands'
import { lazyBundleLoader } from './lazyBundle'
import type { Logger } from './logger'
import type { AgentImportHostDeps } from './agentImportHost'

/** The injected flow and the VS Code UI entry, shipped and loaded together. */
export interface AgentImportBundle {
  readonly importFromAgents: (host: AgentImportHost, table: UiText, locale: string) => Promise<void>
  readonly runAgentImport: (
    host: AgentImportHostDeps,
    table: UiText,
    locale: string,
  ) => Promise<void>
}

/** Whether a required module exports both import entries. */
export function isAgentImportBundle(value: unknown): value is AgentImportBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'importFromAgents' in value &&
    typeof value.importFromAgents === 'function' &&
    'runAgentImport' in value &&
    typeof value.runAgentImport === 'function'
  )
}

export interface AgentImportLoaderDeps {
  /** dist/agentImport.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required the first time it is asked for and kept from then on. */
export function agentImportLoader(deps: AgentImportLoaderDeps): () => AgentImportBundle {
  return lazyBundleLoader({
    ...deps,
    log: {
      trace: (message) => {
        deps.log.trace(message)
      },
      info: (message) => {
        deps.log.info(message)
      },
      warn: (message) => {
        deps.log.warn(message)
      },
      error: (message) => {
        deps.log.error(
          message.includes('does not export')
            ? 'The import bundle does not export the import'
            : 'The import bundle could not be loaded',
        )
      },
    },
    isBundle: isAgentImportBundle,
    label: 'import bundle',
    unavailable: () => UI_TEXT.agentImportUnavailable,
  })
}

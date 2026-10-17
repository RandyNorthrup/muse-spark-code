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
import { uiLocale } from '../shared/l10n/text'
import type { AgentImportHost } from './commands/agentImportCommands'
import { fixedMessageLog, lazyBundleLoader } from './lazyBundle'
import type { Logger } from './logger'
import type { AgentImportHostDeps } from './agentImportHost'

/** Activation's shim; the UI adapter and its config schema load only with the bundle. */
export async function runAgentImport(deps: AgentImportHostDeps): Promise<void> {
  await deps.bundle().runAgentImport(deps, UI_TEXT, uiLocale())
}

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
    log: fixedMessageLog({
      log: deps.log,
      loadFailed: 'The import bundle could not be loaded',
      wrongShape: 'The import bundle does not export the import',
    }),
    isBundle: isAgentImportBundle,
    label: 'import bundle',
    unavailable: () => UI_TEXT.agentImportUnavailable,
  })
}

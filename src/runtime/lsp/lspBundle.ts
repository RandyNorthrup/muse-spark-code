// M104 lane H: the only language-server code in dist/acp.js, the lazy loader
// of dist/lsp.js, required on `lsp` alone (PLAN.md D6).
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type * as Entry from './lspEntry'

interface LspBundle {
  readonly runLsp: typeof Entry.runLsp
}

/** Same-build signature, trusted after checking the exported function (PLAN §8). */
function isLspBundle(value: unknown): value is LspBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runLsp' in value &&
    typeof value.runLsp === 'function'
  )
}

export function lspLoader(bundlePath: string, log: Logger): () => LspBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isLspBundle,
    label: 'language server',
    unavailable: () => UI_TEXT.languageServer.unavailable,
  })
}

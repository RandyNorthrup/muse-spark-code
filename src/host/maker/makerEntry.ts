// dist/makerHost.js entry: the window's maker assembly (RLF-M103WIRE),
// required on the first maker UI or device tool. The engine loads behind it
// in dist/makerEngine.js, the preview panel in dist/makerPreviewHost.js.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { ideMakerTools, type IdeMakerToolsDeps } from '../ide/makerTools'

export {
  createMakerAssembly,
  type MakerAssembly,
  type MakerAssemblyDeps,
} from '../vscode/maker/makerAssembly'

/**
The `ide` tools, built synchronously: the MCP list cannot await the async
assembly, so the activation shim builds these behind a sync require with
lazy engine delegates.
*/
export function createMakerTools(deps: IdeMakerToolsDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return ideMakerTools(deps)
}

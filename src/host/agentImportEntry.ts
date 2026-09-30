// The import's shipped CommonJS bundle (M83, PLAN.md D6): the scan, the
// conversion, the masking, the plan, the file access and the flow, with
// `smol-toml` for Codex's configuration. esbuild builds this file into
// dist/agentImport.js, which `agentImportLoader` requires on the first
// import, so none of it is in the bundle VS Code loads at activation. It
// carries no `vscode` import: the VS Code side (pickers, the clipboard, the
// editor) comes in as `host`, and the localized table as `table`.

import { AGENT_IMPORT_PATHS } from '../shared/constants'
import type { UiText } from '../shared/l10n/en'
import { setUiText } from '../shared/l10n/text'
import {
  type AgentImportHost,
  createImportQueue,
  importFromAgents as runImport,
} from './commands/agentImportCommands'
import { fileImportIo, fileImportWriter, isPathPresent } from './importIo'

// One queue for the extension host: two imports accepted at once write one
// after the other, the whole flow (pickers, preview, writes, copies) each.
const importQueue = createImportQueue()

export async function importFromAgents(
  host: AgentImportHost,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  const { environment, ...rest } = host
  await runImport({
    ...rest,
    claudeConfigDir: environment[AGENT_IMPORT_PATHS.claudeCode.configDirVariable],
    codexHome: environment[AGENT_IMPORT_PATHS.codex.homeVariable],
    io: fileImportIo,
    writer: fileImportWriter,
    isPresent: isPathPresent,
    exclusive: importQueue,
  })
}

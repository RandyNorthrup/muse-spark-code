// The import's shipped CommonJS bundle (M83, PLAN.md D6): the scan, the
// conversion, the exposure checks, the plan, the file access and the flow, with
// `smol-toml` for Codex's configuration. esbuild builds this file into
// dist/agentImport.js, which `agentImportLoader` requires on the first
// import, so none of it is in the bundle VS Code loads at activation. It
// also carries the pickers and unsaved target editor adapter; `vscode` is the
// host's external module. Both entries receive the installed display table.

import { AGENT_IMPORT_PATHS } from '../shared/constants'
import type { UiText } from '../shared/l10n/en'
import { setUiText } from '../shared/l10n/text'
import {
  type AgentImportHost,
  createImportGate,
  importFromAgents as runImport,
} from './commands/agentImportCommands'
import { fileImportIo, fileImportWriter, isPathPresent } from './importIo'
import { type AgentImportHostDeps, runAgentImportUi } from './agentImportHost'

// One gate for the extension host: a second import asked for while one is
// open is told so, and starts nothing over the first one's questions.
const importGate = createImportGate()

export async function runAgentImport(
  host: AgentImportHostDeps,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  await runAgentImportUi(host)
}

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
    copilotHome: environment[AGENT_IMPORT_PATHS.copilot.homeVariable],
    io: fileImportIo,
    writer: fileImportWriter,
    isPresent: isPathPresent,
    gate: importGate,
  })
}

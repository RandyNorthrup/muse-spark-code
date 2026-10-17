// The Create AGENTS.md command (PLAN.md D15) as a bundle of its own (D6):
// esbuild builds this file into dist/rulesFile.js, which the activation
// bundle requires the first time that command runs, so the command, the rules
// template and their redaction stay out of dist/extension.js. The bundle keeps
// its own installed-language state, so the factory installs the caller's
// table before it creates the file.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { createRulesFile as createFile, type CreateRulesFileDeps } from './createRulesFile'

export function createRulesFile(
  deps: CreateRulesFileDeps,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  return createFile(deps)
}

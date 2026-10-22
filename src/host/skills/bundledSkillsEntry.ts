// The bundled skills installer's bundle (M89, PLAN.md D6, D68): esbuild builds
// this file into dist/bundledSkills.js, which `bundledSkillsLoader` requires
// on the first install, removal or offer, so the file work and the two
// commands that word its results stay out of the bundle VS Code loads at
// activation. The bundle keeps its own installed-language state, so each
// command installs the caller's table before it runs; the status read
// returns data only and the offer, in the activation bundle, words it.

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  type BundledSkillsCommandDeps,
  runBundledSkillsInstall as runInstall,
  runBundledSkillsRemove as runRemove,
} from './bundledSkillsCommands'

export { bundledSkillsStatus } from '../../core/skills/bundledSkillsInstall'

export { playbookReviewerCharter } from './playbookReviewerCharter'

export function runBundledSkillsInstall(
  deps: BundledSkillsCommandDeps,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  return runInstall(deps)
}

export function runBundledSkillsRemove(
  deps: BundledSkillsCommandDeps,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  return runRemove(deps)
}

// First-boot callers supply M81's lazy store and real consent surface.
export { createBaseAgentToolset } from '../../core/context/baseAgentToolset'

// The Model API backend's ACP-assist bundle (PLAN.md D6): the settled-cost
// tally the ACP answer carries, the translated workspace-refusal wording and
// the alias-glob fallback. esbuild builds this file into
// dist/modelApiAcp.js; the backend's own modules import these names, which
// the build externalises to a require of the sibling bundle. The bundle keeps
// its own installed-language state, so the backend entry installs the
// caller's table when the backend starts. Every name read across the boundary
// is exported here.
import type { UiText } from '../../../shared/l10n/en'
import { setUiText } from '../../../shared/l10n/text'

export {
  confinedGlob,
  costField,
  foldChildCost,
  newTally,
  pathRefusal,
  settleCost,
} from './acpAssist'
export type { CostTally } from './acpAssist'

/** Node bundles each own their language state; install the caller before use. */
export function installLanguage(table: UiText, locale: string): void {
  setUiText(table, locale)
}

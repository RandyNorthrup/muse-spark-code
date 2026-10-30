// The window-owned scheduler (M96c): board ownership, the launch gate and
// the retirement assembly. Its own bundle (dist/teamWindow.js), loaded only
// for a workspace that stores a team, so the scheduler-tools bundle does
// not carry the window binding (D6).
import { createWindowTeamScheduler } from './window'
import { setUiText } from '../../../shared/l10n/text'
import type { UiText } from '../../../shared/l10n/en'

// The runners bundle's Traffic projection rides this bundle's shared-file
// and write-set matching through the deferred cohort, so the members it
// imports are exported here: the split gate fails a member this list lacks.
export { SharedFiles } from '../sharedFiles'
export { expandWriteSet, writeSetOverlap } from '../writeSets'

export function createTeamWindowRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return { createWindowTeamScheduler }
}

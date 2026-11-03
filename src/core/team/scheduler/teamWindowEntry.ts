// The window-owned scheduler (M96c): board ownership, the launch gate and
// the retirement assembly. Its own bundle (dist/teamWindow.js), loaded only
// for a workspace that stores a team, so the scheduler-tools bundle does
// not carry the window binding (D6).
import { windowBoardOwner } from './boardOwner'
import { createWindowTeamScheduler } from './window'
import type { TeamSchedulingDeps } from '../teamScheduling'
import { setUiText } from '../../../shared/l10n/text'
import type { UiText } from '../../../shared/l10n/en'

// The Traffic bundle's projection rides this bundle's shared-file and
// write-set matching through the deferred cohort, so the members it
// imports are exported here: the split gate fails a member this list lacks.
export { SharedFiles } from '../sharedFiles'
export { expandWriteSet, writeSetOverlap } from '../writeSets'

/** Every scheduler this window makes holds the board under this process's lease. */
export async function createTeamWindowRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  const owner = await windowBoardOwner(() => Date.now())
  return {
    createWindowTeamScheduler: (deps: TeamSchedulingDeps) =>
      createWindowTeamScheduler({ ...deps, ...owner }),
  }
}

// The Muse Code and external-agent worker ports (RLF-TEAMWORKERS), in their
// own bundle (dist/teamProcess.js): loaded only when a team first runs a
// worker that is not an engine worker, so a team of engine workers never
// carries the native process lifetime, the Muse Code host or the ACP client
// (D6). The team host loads it through its worker port on the first
// Muse Code or external task.
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { installMuseCodeUiText } from '../backend/museCodeEntry'
import { createProcessTeamPorts } from './teamProcessWorkers'

export type { ProcessTeamPorts, TeamProcessWorkersDeps } from './teamProcessWorkers'

export function createTeamProcessRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  // The team's Muse Code host speaks through the backend bundle: its notices use this table.
  installMuseCodeUiText(table, locale)
  return { createProcessTeamPorts }
}

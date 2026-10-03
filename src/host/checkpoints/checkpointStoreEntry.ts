// The checkpoint implementation's shipped CommonJS bundle (M72, PLAN.md D6).
// The activation bundle keeps only its port and checked synchronous loader.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { CheckpointStore, type CheckpointStoreDeps } from './checkpointStore'
import {
  legacyCheckpointTurns as readLegacyTurns,
  type LegacyCheckpointDeps,
} from './legacyCheckpoints'

// The recorder of the turns' own writes (M86) loads with the store, not at activation.
export { createTurnRecording } from './writeRecorder'

export function createCheckpointStore(
  deps: CheckpointStoreDeps,
  table: UiText,
  locale: string,
): CheckpointStore {
  setUiText(table, locale)
  return new CheckpointStore(deps)
}

export async function legacyCheckpointTurns(
  deps: LegacyCheckpointDeps,
  sessionId: string,
  table: UiText,
  locale: string,
): Promise<readonly string[]> {
  setUiText(table, locale)
  return await readLegacyTurns(deps, sessionId)
}

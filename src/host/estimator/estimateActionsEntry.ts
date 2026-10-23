// The estimator run's composer parsing and first-wave start (PLAN.md D6):
// dist/estimateActions.js, required the first time an estimate parses a
// composer command or starts its first wave, so the engine bundle keeps its
// original cap. The bundle keeps its own installed-language state, so the
// factory installs the caller's table before anything reads it.
import { EstimateWaveStarter } from '../../core/estimator/provision/start'
import { parseEstimateComposer, type EstimateContext } from '../../runtime/estimator/command'
import type { EstimateInputs, EstimateRequest, EstimateStartPort } from '../../shared/estimate'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export function createEstimateActionsRun(board: EstimateStartPort, table: UiText, locale: string) {
  setUiText(table, locale)
  const starter = new EstimateWaveStarter(board)
  return {
    parseCommand: (text: string, context: EstimateContext): EstimateRequest =>
      parseEstimateComposer(text, context),
    startWave: (input: EstimateInputs): Promise<readonly string[]> => starter.start(input),
  }
}

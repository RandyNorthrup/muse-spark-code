// B/D/CS/G assembly (M98 phase 2): built as dist/judge.js, required only by
// an explicit judge surface. Source selection and per-attempt admission are
// supplied by the caller; importing this factory starts no backend or server.
import { applyCalibration } from '../../core/judge/calibration/apply'
import { fitCalibration } from '../../core/judge/calibration/fit'
import { reportCalibration } from '../../core/judge/calibration/report'
import {
  parseCalibrationDataset,
  parseCalibrationProfile,
} from '../../core/judge/calibration/schema'
import { contrastiveJudge } from '../../core/judge/contrastive'
import { sampleJudge } from '../../core/judge/sampling'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { startJudgeServer } from './serve'
import { runJudgeCommand } from './commands'
import { runJudgeMcp } from './mcp'

const features = {
  applyCalibration,
  fitCalibration,
  reportCalibration,
  parseCalibrationDataset,
  parseCalibrationProfile,
  contrastiveJudge,
  sampleJudge,
  startJudgeServer,
  runJudgeCommand,
  runJudgeMcp,
}

/** Install the caller's checked table before any boundary error is rendered. */
export function createJudgeFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
}) {
  setUiText(language.uiText, language.uiLocale)
  return features
}

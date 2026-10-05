// B/D/CS/G assembly (M98 phase 2): built as dist/judge.js, required only by
// an explicit judge surface. Source selection and per-attempt admission are
// supplied by the caller; importing this factory starts no backend or server.
import path from 'node:path'
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { stderrLogger } from '../stderrLog'
import type * as LintEntry from './judgeLintEntry'
import type * as HookEntry from './judgeHookEntry'
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
import { fill, setUiText, UI_TEXT, uiLocale } from '../../shared/l10n/text'
import { startJudgeServer } from './serve'
import { runJudgeCommand } from './commands'
import { runJudgeMcp } from './mcp'

// Same-build callable factory signatures are trusted after checking their
// exports, just like the parent loader (PLAN §8); no wire shape is inferred.
function hasFactory<T>(value: unknown, field: keyof T): value is T {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, field) &&
    typeof Reflect.get(value, field) === 'function'
  )
}

const childFactories: {
  current:
    | {
        readonly lint: () => typeof LintEntry
        readonly hook: () => typeof HookEntry
      }
    | undefined
} = { current: undefined }

function writeLog(line: string) {
  process.stderr.write(`${line}\n`)
}

function unavailable() {
  return fill(UI_TEXT.judgeNoAnswer, { reason: 'source-unavailable' })
}

function children() {
  if (childFactories.current === undefined) throw new Error('judge-factory-uninitialized')
  return childFactories.current
}

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
  loadLint() {
    const bundle = children().lint()
    return Promise.resolve(
      bundle.createJudgeLintFeatures({ uiText: UI_TEXT, uiLocale: uiLocale() }),
    )
  },
  loadHook() {
    const bundle = children().hook()
    return Promise.resolve(
      bundle.createJudgeHookFeatures({
        uiText: UI_TEXT,
        uiLocale: uiLocale(),
        runAsk: runJudgeCommand,
      }),
    )
  },
}

/** Install the caller's checked table before any boundary error is rendered. */
export function createJudgeFeatures(language: {
  readonly uiText: UiText
  readonly uiLocale: string
  readonly log?: Logger
}) {
  setUiText(language.uiText, language.uiLocale)
  // This standalone factory keeps its logger lazy; parent startup bytes stay unchanged.
  // A later host caller can supply its LogOutputChannel adapter directly.
  const log = language.log ?? stderrLogger(writeLog, 'warn')
  childFactories.current = {
    lint: lazyBundleLoader({
      bundlePath: path.join(__dirname, 'judgeLint.js'),
      log,
      isBundle: (value): value is typeof LintEntry =>
        hasFactory<typeof LintEntry>(value, 'createJudgeLintFeatures'),
      label: 'judge lint bundle',
      unavailable,
    }),
    hook: lazyBundleLoader({
      bundlePath: path.join(__dirname, 'judgeHook.js'),
      log,
      isBundle: (value): value is typeof HookEntry =>
        hasFactory<typeof HookEntry>(value, 'createJudgeHookFeatures'),
      label: 'judge hook bundle',
      unavailable,
    }),
  }
  return features
}

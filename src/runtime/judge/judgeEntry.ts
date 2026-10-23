// B/D/CS/G assembly (M98 phase 2): built as dist/judgeP2.js, required only by
// an explicit judge surface. Source selection and per-attempt admission are
// supplied by the caller; importing this factory starts no backend or server.
import { hasJudgeAdoptionEvidence } from '../../core/judge/adoption'
import { createPhase2Binding, type Phase2BindingRequest } from '../../core/judge/binding'
import { createJudgeRuntime, type JudgeRuntimeDeps } from '../../core/judge/runtime'
import { createJudgeCommandDeps } from './assembly'
import path from 'node:path'
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { stderrLogger } from '../stderrLog'
import type * as LintEntry from './judgeLintEntry'
import type * as HookEntry from './judgeHookEntry'
import type * as LocalEntry from './judgeLocalEntry'
import type * as UsesEntry from './judgeUsesEntry'
import type * as SourcesEntry from './judgeSourcesEntry'
type SourcesFeatures = ReturnType<typeof SourcesEntry.createJudgeSourcesFeatures>
import type * as ServeEntry from './judgeServeEntry'
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
        readonly sources: () => typeof SourcesEntry
        readonly lint: () => typeof LintEntry
        readonly hook: () => typeof HookEntry
        readonly local: () => typeof LocalEntry
        readonly uses: () => typeof UsesEntry
        readonly serve: () => typeof ServeEntry
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

function sourcesFeatures() {
  return children().sources().createJudgeSourcesFeatures({ uiText: UI_TEXT, uiLocale: uiLocale() })
}

const features = {
  loadSources() {
    return Promise.resolve(sourcesFeatures())
  },
  hasJudgeAdoptionEvidence,
  // The one binding policy, shared with the window: the CLI/ACP and MCP
  // surfaces build their binding through the same factory, with the real
  // adoption check applied here so calibration stays in this bundle.
  createPhase2Binding(request: Omit<Phase2BindingRequest, 'adoptionCheck'>) {
    return createPhase2Binding({ ...request, adoptionCheck: hasJudgeAdoptionEvidence })
  },
  // The one production side-factory port: the separate source a configured
  // id names, or exactly what it is missing, built inside the sources child.
  separateSource(...args: Parameters<SourcesFeatures['buildSeparateSource']>) {
    return sourcesFeatures().buildSeparateSource(...args)
  },
  // Whether a configured route's key is stored and usable, read before the
  // binding exists so a missing key refuses before any claim.
  hasSeparateSourceKey(...args: Parameters<SourcesFeatures['hasSeparateSourceKey']>) {
    return sourcesFeatures().hasSeparateSourceKey(...args)
  },
  // The provider and origin a configured id's route bills, or undefined when
  // the id names no route: C's own availability, apart from any Meta gate.
  separateSourceKey(separateId: string) {
    return sourcesFeatures().separateSourceKey(separateId)
  },
  // The configured route's source, model, tariff and consent identity, for
  // the status line and Account & usage (never the chat model's).
  separateRouteFacts(separateId: string) {
    return sourcesFeatures().separateRouteFacts(separateId)
  },
  createRuntime(deps: JudgeRuntimeDeps) {
    return Promise.resolve(
      createJudgeRuntime({
        ...deps,
        loadEmbedding: async () => {
          const sources = await features.loadSources()
          return sources.embedding
        },
      }),
    )
  },
  createCommandDeps(deps: Parameters<typeof createJudgeCommandDeps>[0]) {
    return Promise.resolve(
      createJudgeCommandDeps({
        ...deps,
        loadEmbedding: async () => {
          const sources = await features.loadSources()
          return sources.embedding
        },
      }),
    )
  },
  applyCalibration,
  fitCalibration,
  reportCalibration,
  parseCalibrationDataset,
  parseCalibrationProfile,
  contrastiveJudge,
  sampleJudge,
  runJudgeCommand,
  runJudgeMcp,
  loadLocal() {
    return Promise.resolve(
      children().local().createJudgeLocalFeatures({ uiText: UI_TEXT, uiLocale: uiLocale() }),
    )
  },
  loadUses() {
    return Promise.resolve(
      children().uses().createJudgeUsesFeatures({ uiText: UI_TEXT, uiLocale: uiLocale() }),
    )
  },
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
  loadServe() {
    const bundle = children().serve()
    return Promise.resolve(
      bundle.createJudgeServeFeatures({ uiText: UI_TEXT, uiLocale: uiLocale() }),
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
    sources: lazyBundleLoader({
      bundlePath: path.join(__dirname, 'judgeSources.js'),
      log,
      isBundle: (value): value is typeof SourcesEntry =>
        hasFactory<typeof SourcesEntry>(value, 'createJudgeSourcesFeatures'),
      label: 'judge sources bundle',
      unavailable,
    }),
    local: lazyBundleLoader({
      bundlePath: path.join(__dirname, 'judgeLocal.js'),
      log,
      isBundle: (value): value is typeof LocalEntry =>
        hasFactory<typeof LocalEntry>(value, 'createJudgeLocalFeatures'),
      label: 'judge local bundle',
      unavailable,
    }),
    uses: lazyBundleLoader({
      bundlePath: path.join(__dirname, 'judgeUses.js'),
      log,
      isBundle: (value): value is typeof UsesEntry =>
        hasFactory<typeof UsesEntry>(value, 'createJudgeUsesFeatures'),
      label: 'judge uses bundle',
      unavailable,
    }),
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
    serve: lazyBundleLoader({
      bundlePath: path.join(__dirname, 'judgeServe.js'),
      log,
      isBundle: (value): value is typeof ServeEntry =>
        hasFactory<typeof ServeEntry>(value, 'createJudgeServeFeatures'),
      label: 'judge serve bundle',
      unavailable,
    }),
  }
  return features
}

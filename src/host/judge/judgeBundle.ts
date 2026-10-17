import type { StartSessionOptions, AgentSession } from '../../core/agent/agentBackend'
import type { JudgeDailyLedger } from '../../core/judge/admission'
import type { JudgeEntryParts } from '../../core/judge/entries'
import type { JudgeAdvisory } from '../../core/judge/use'
import type { JudgeFenceSample } from '../../core/judge/use'
import type { ModelApiJudgeConnection } from '../../core/judge/same/modelApiSource'
import type { PaidFeatures } from '../paid/paidHost'
import type { JudgeStatus } from '../../shared/judge'
import type { AgentEvent } from '../../shared/agentEvents'
import { UI_TEXT, type JudgeEngine } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as JudgeEntry from './judgeEntry'

export interface JudgeWindowDeps {
  readonly engine: () => JudgeEngine
  readonly context: (action: JudgeEntryParts) =>
    | {
        readonly backend: 'museCode' | 'modelApi'
        readonly modelId: string
        readonly ownerId: string
        readonly contextLimit: number | undefined
        readonly confidential: boolean
      }
    | undefined
  readonly readSettingsText: () => string | undefined
  readonly startSession: (options: StartSessionOptions) => Promise<AgentSession>
  readonly modelApi: (action: JudgeEntryParts) => ModelApiJudgeConnection | undefined
  /** The real D78 adapter only; absence disables metered judging before consent. */
  readonly ledger?: JudgeDailyLedger | undefined
  readonly paid: PaidFeatures
  readonly emit: (action: JudgeEntryParts, event: AgentEvent) => void
  readonly status: (action: JudgeEntryParts, status: JudgeStatus) => void
  readonly notice: (text: string) => void
  readonly log: Logger
  /** M75 replay callers supply independent labels; ordinary approval answers never do. */
  readonly onFence?: ((sample: JudgeFenceSample) => void) | undefined
  readonly readyRate?: ((backend: string) => number | undefined) | undefined
}

export interface JudgeWindowPort extends JudgeAdvisory {
  isSideSession(sessionId: string): boolean
  dispose(): void
}

interface JudgeBundle {
  readonly createWindowJudge: typeof JudgeEntry.createWindowJudge
}

function isJudgeBundle(value: unknown): value is JudgeBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createWindowJudge' in value &&
    typeof value.createWindowJudge === 'function'
  )
}

/** Off never even requires the bundle, including when disposing an unused window. */
export function judgeWindowPort(
  deps: JudgeWindowDeps & {
    readonly bundlePath: string
    readonly loadBundle?: ((file: string) => unknown) | undefined
  },
): JudgeWindowPort {
  const load = lazyBundleLoader({
    ...deps,
    log: {
      ...deps.log,
      error: () => {
        deps.log.warn('Judge bundle unavailable; approval unchanged')
      },
    },
    isBundle: isJudgeBundle,
    label: 'Judge bundle',
    unavailable: () => UI_TEXT.judgeStatusUnavailable,
  })
  let judge: JudgeWindowPort | undefined
  return {
    start: (action, text) => {
      if (deps.engine() === 'off') return
      try {
        judge ??= load().createWindowJudge(deps, UI_TEXT, uiLocale())
        return judge.start(action, text)
      } catch {
        deps.log.warn('Judge unavailable; approval unchanged')
        return
      }
    },
    discardTurn: (session, turn) => judge?.discardTurn(session, turn),
    discardSession: (session) => judge?.discardSession(session),
    isSideSession: (session) => judge?.isSideSession(session) ?? false,
    dispose: () => judge?.dispose(),
  }
}

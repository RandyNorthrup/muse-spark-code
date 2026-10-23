import type {
  JudgePlanRuntime,
  JudgeRuntimeBinding,
  JudgeRuntimeDeps,
} from '../../core/judge/runtime'
import type { JudgePanelFacts, JudgePanelSnapshot } from '../../shared/judgePanel'
import { projectFastJudgePanel, projectJudgePanel } from '../../shared/judgePanel'
import { FastPanelFacts } from '../../core/judge/fast/panelFacts'
import type { JudgeFastTurn } from '../../shared/judgeFastTurn'
import type { StartSessionOptions, AgentSession } from '../../core/agent/agentBackend'
import type { JudgeDailyLedger } from '../../core/judge/admission'
import type { SeparateRouteFacts, SeparateSourcePorts } from '../../core/judge/sides'
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
  readonly phase2?:
    | {
        readonly binding: (action: JudgeEntryParts) => JudgeRuntimeBinding | undefined
        readonly createRuntime: (deps: JudgeRuntimeDeps) => Promise<JudgePlanRuntime>
        /** The configured separate route's facts while it can be built (C's own availability). */
        readonly readySeparateRoute?: (() => SeparateRouteFacts | undefined) | undefined
      }
    | undefined
  /**
  Production phase-2 inputs (M98 P2B). When `phase2` is absent but these
  are present, the window builds the production binding itself inside
  the lazy judge bundle; otherwise the window keeps phase-1 behaviour.
  All fields are plain data: activation passes no new code.
  */
  readonly separateId?: (() => string) | undefined
  readonly evidenceRoot?: string | undefined
  readonly judgeP2BundlePath?: string | undefined
  /**
  M95's stored credential value for a provider id (SecretStorage), read
  only when a configured SystemOne route needs its key. Never logged.
  */
  readonly readStoredCredential?: ((providerId: string) => Promise<string | undefined>) | undefined
  /** Tests' seams for the SystemOne route's pinned M95 transport; production passes none. */
  readonly separateTransport?: SeparateSourcePorts['transport']
  readonly dailyBudgetUsd?: () => number
  readonly engine: () => JudgeEngine
  readonly context: (action: JudgeEntryParts) =>
    | {
        readonly backend: 'museCode' | 'modelApi'
        readonly modelId: string
        readonly endpoint?: string | undefined
        readonly profileId?: string | undefined
        readonly providerId?: string | undefined
        readonly ownerId: string
        readonly contextLimit: number | undefined
        readonly confidential: boolean
      }
    | undefined
  readonly readSettingsText: () => string | undefined
  /**
  The local paths of this window's workspace settings files (each folder's
  `.vscode/settings.json`, the `.code-workspace` file). Read within bounds,
  only to name a separate judge set there, which paid settings never honour.
  */
  readonly workspaceSettingsFiles?: (() => readonly string[]) | undefined
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
  readPanelSnapshot(): JudgePanelSnapshot | undefined
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
  // D107 (M125 lane U): the window's fast-decision rolls. They live in
  // the port, not the lazy bundle: a fast-only window never loads the
  // caution judge, and its turns still count.
  const fast = new FastPanelFacts()
  const readPanelSnapshot = (): JudgePanelSnapshot | undefined => {
    const fastFacts = fast.facts()
    const base = judge?.readPanelSnapshot()
    if (base !== undefined) {
      return fastFacts === undefined ? base : { ...base, fast: projectFastJudgePanel(fastFacts) }
    }
    if (fastFacts === undefined) return undefined
    // The caution judge never ran here: the billing it never touched
    // stays none, and only the fast rows below say anything.
    const engine = deps.engine()
    const facts: JudgePanelFacts = {
      engine,
      effectiveSource: 'none',
      ...(engine === 'off' && { reason: 'explicit-off' as const }),
      locality: 'not-local',
      experimental: false,
      confidential: true,
      billing: 'none',
      paidSourceSelected: false,
      consent: 'not-required',
      fast: fastFacts,
    }
    return projectJudgePanel(facts)
  }
  const observeFastTurn = (event: JudgeFastTurn): void => {
    fast.observe(event)
  }
  return {
    readPanelSnapshot,
    observeFastTurn,
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

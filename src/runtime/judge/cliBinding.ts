// The CLI/ACP/MCP production phase-2 binding (M98 phase 2 redesign). Built
// from the same binding policy and the same side-factory port as the
// window, both inside `dist/judgeP2.js`; this module stays import-light so
// `src/runtime/main.ts` can hold it while judge schemas stay lazy for
// ordinary commands (the dispatch gate).
import type { Phase2EvidenceStore } from '../../core/judge/evidencePaths'
import type { JudgeRuntimeBinding } from '../../core/judge/runtime'
import {
  JUDGE_CALIBRATION_LIMITS,
  JUDGE_CRITERIA_VERSION,
  JUDGE_MIN_READY_RATE,
  JUDGE_PROMPT_VERSION,
  JUDGE_RISK_FAMILY,
  PROVIDER_SECRET_PREFIX,
} from '../../shared/constants'
import type { JudgeCliOptions } from './args'
import type * as JudgeEntry from './judgeEntry'

type JudgeFeatures = ReturnType<typeof JudgeEntry.createJudgeFeatures>

/**
 * The CLI's binding reader. A configured SystemOne route becomes the real
 * side over the OS store's M95 record and the platform fetch; any other id
 * names its gap. With no separate id the reader answers nothing, which is
 * the single-model refusal the CLI always gave.
 */
export function cliJudgeBinding(deps: {
  readonly features: JudgeFeatures
  readonly options: JudgeCliOptions
  readonly store: Phase2EvidenceStore
  /** The OS credential store's value for a name; never logged. */
  readonly readSecret: (name: string) => Promise<string | undefined>
  readonly fetch: typeof fetch
}): () => JudgeRuntimeBinding | undefined {
  const separateId = deps.options.separate?.trim() ?? ''
  const engine = deps.options.engine
  const built =
    separateId === ''
      ? undefined
      : deps.features.separateSource(
          separateId,
          {
            fetch: deps.fetch,
            // The CLI has no status line: a missing key refuses at dispatch
            // as `source-unavailable`, after its reservation is refunded.
            hasStoredKey: () => true,
            systemOne: {
              readStoredCredential: (providerId) =>
                deps.readSecret(`${PROVIDER_SECRET_PREFIX}${providerId}`),
              // `--budget-usd` already admitted the plan's whole ceiling, which
              // bounds this route's quote; the run cap keeps that reservation
              // as liability whatever the settlement (M80, D65).
              reserve: (usd) =>
                Promise.resolve({
                  reserved: true,
                  claim: {
                    reservedUsd: usd,
                    settle: () => Promise.resolve(),
                    refund: () => Promise.resolve(),
                  },
                }),
              // Headless admission is the explicit engine flag plus the hard
              // budget: dispatch is reached only after the run cap admits it.
              consent: () => 'granted',
              confidential: () => false,
              isExplicit: () => engine === 'separate' || engine === 'both',
            },
          },
          'noul',
        )
  const worstCaseUsd = built?.kind === 'built' ? built.worstCaseUsd : undefined
  return () =>
    deps.features.createPhase2Binding({
      engine,
      separateId,
      separateConfigured: true,
      ...(built?.kind === 'built' && { separate: built.source }),
      ...(built?.kind === 'gap' && { separateGap: built.gap }),
      store: deps.store,
      options: {
        family: JUDGE_RISK_FAMILY,
        promptVersion: JUDGE_PROMPT_VERSION,
        criteriaVersion: JUDGE_CRITERIA_VERSION,
        highStakes: true,
      },
      limits: JUDGE_CALIBRATION_LIMITS,
      // The CLI names no provider; adoption stays unverified for it.
      context: {
        providerId: '',
        modelId: deps.options.model ?? '',
        ownerId: '',
        confidential: false,
        sourceAvailable: deps.options.model !== undefined,
        paidConsent: 'not-required',
        readyRate: undefined,
        minReadyRate: JUDGE_MIN_READY_RATE,
      },
      billing: 'free',
      // A built route prices its own attempt, so the plan is paid and goes
      // through the run cap; the CLI's judge sides are otherwise free.
      ...(worstCaseUsd !== undefined && {
        attemptCostUsd: (_request, side) => (side === 'separate' ? worstCaseUsd : 0),
      }),
    })
}

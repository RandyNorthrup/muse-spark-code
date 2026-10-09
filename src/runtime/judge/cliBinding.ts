// The CLI/ACP/MCP production phase-2 binding (M98 phase 2 redesign). Built
// from the same binding policy and the same side-factory port as the
// window, both inside `dist/judgeP2.js`; this module stays import-light so
// `src/runtime/main.ts` can hold it while judge schemas stay lazy for
// ordinary commands (the dispatch gate).
import type { Phase2EvidenceStore } from '../../core/judge/evidencePaths'
import type { JudgeRuntimeBinding } from '../../core/judge/runtime'
import type { SeparateSourcePorts } from '../../core/judge/sides'
import {
  JUDGE_CALIBRATION_LIMITS,
  JUDGE_CRITERIA_VERSION,
  JUDGE_MIN_READY_RATE,
  JUDGE_PROMPT_VERSION,
  JUDGE_RISK_FAMILY,
  JUDGE_REQUEST_TIMEOUT_MS,
  PROVIDER_SECRET_PREFIX,
} from '../../shared/constants'
import type { JudgeCliOptions } from './args'
import type * as JudgeEntry from './judgeEntry'

type JudgeFeatures = ReturnType<typeof JudgeEntry.createJudgeFeatures>

/** The runtime's D78 daily ledger (`createRuntimeDailyBudget`), as the CLI judge uses it. */
export interface CliDailyLedger {
  reserve(
    costUsd: number,
    signal: AbortSignal,
  ): Promise<{
    readonly reservedUsd: number
    /** Final admission; the runtime claim reads the live cap itself, so the argument is unused. */
    check(capUsd: number): unknown
    settle(actualCostUsd: number): Promise<unknown>
  }>
}

/**
 * The CLI's binding reader. A configured SystemOne route becomes the real
 * side over the OS store's M95 record, the M95 providers' pinned transport
 * and the runtime's daily ledger; any other id names its gap. With no
 * separate id the reader answers nothing, which is the single-model refusal
 * the CLI always gave. The key is checked here, before anything is resolved
 * or reserved, so a missing key refuses with the window's `key` code.
 */
export async function cliJudgeBinding(deps: {
  readonly features: JudgeFeatures
  readonly options: JudgeCliOptions
  readonly store: Phase2EvidenceStore
  /** The OS credential store's value for a name; never logged. */
  readonly readSecret: (name: string) => Promise<string | undefined>
  /** The runtime's daily ledger, loaded on the first reservation. */
  readonly daily: () => Promise<CliDailyLedger>
  /** Tests' seams for the pinned transport; production passes none. */
  readonly transport?: SeparateSourcePorts['transport']
}): Promise<() => JudgeRuntimeBinding | undefined> {
  const separateId = deps.options.separate?.trim() ?? ''
  const engine = deps.options.engine
  const readStoredCredential = (providerId: string) =>
    deps.readSecret(`${PROVIDER_SECRET_PREFIX}${providerId}`)
  const hasKey =
    separateId !== '' &&
    (await deps.features.hasSeparateSourceKey(separateId, readStoredCredential))
  const built =
    separateId === ''
      ? undefined
      : deps.features.separateSource(
          separateId,
          {
            ...(deps.transport !== undefined && { transport: deps.transport }),
            hasStoredKey: () => hasKey,
            systemOne: {
              readStoredCredential,
              // The D78 daily ledger on top of `--budget-usd`: the run cap
              // admitted the plan's whole ceiling, and this claim settles the
              // reported cost into the daily journal every paid headless use
              // shares (PAID_DAILY_BUDGET).
              reserve: async (usd) => {
                const ledger = await deps.daily()
                let claim: Awaited<ReturnType<CliDailyLedger['reserve']>>
                try {
                  claim = await ledger.reserve(usd, AbortSignal.timeout(JUDGE_REQUEST_TIMEOUT_MS))
                } catch {
                  return { reserved: false, reason: 'over-budget' }
                }
                try {
                  claim.check(0)
                } catch {
                  await claim.settle(0)
                  return { reserved: false, reason: 'over-budget' }
                }
                return {
                  reserved: true,
                  claim: {
                    reservedUsd: claim.reservedUsd,
                    settle: async (actualUsd) => {
                      await claim.settle(actualUsd)
                    },
                    refund: async () => {
                      await claim.settle(0)
                    },
                  },
                }
              },
              // Headless admission is the explicit engine flag plus the hard
              // budget: dispatch is reached only after the run cap admits it.
              consent: () => 'granted',
              // One CLI process plans under one fixed trigger identity.
              generation: () => 0,
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

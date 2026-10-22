// One isolated paid planning turn over the engine's per-transport-attempt guard.
import {
  modelApiPaidTier,
  type TeamWorkerConfirmation,
  type SubagentUsage,
} from '../../shared/paid'
import type { ModelSummary } from '../agent/agentBackend'
import type { AgentHost } from '../agent/agentBackend'
import type { ResponseAttemptOutcome } from '../backends/modelapi/transport'
import type { ResponseAttemptGuard } from '../backends/modelapi/client'
import type { TeamEditorDocument, TeamPanelSlice } from '../../shared/teamPanel'
import { teamEditorDocumentSchema } from '../../shared/teamPanel'
import type { UsdAmount } from '../../shared/usd'
import { Usd, sumUsd } from '../../shared/usd'
import {
  UI_TEXT,
  TEAM_TRY_MAX_REQUESTS,
  TEAM_TRY_MAX_INPUT_TOKENS,
  TEAM_TRY_MAX_OUTPUT_TOKENS,
  TEAM_TRY_TIMEOUT_MS,
  TEAM_TRY_MODEL_TEXT,
  MODEL_API_PRICES_PER_MILLION,
} from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'

export interface TeamTryDeps {
  readonly isAllowed: () => boolean
  readonly modelId: string
  readonly workspaceRoot: string
  /** Hash-only identity of the account the quote bills; pinned across consent. */
  readonly keyDigest: () => Promise<string | undefined>
  readonly consent: () => Promise<boolean>
  readonly noteDispatched: () => void
  readonly noteUsage: (usage: SubagentUsage) => void
  readonly reserve: (maximum: UsdAmount) => Promise<{
    readonly check: () => void
    readonly settle: (actual: UsdAmount, isUncertain?: boolean) => Promise<unknown>
  }>
  readonly start: (guard: ResponseAttemptGuard) => Promise<AgentHost>
}
export async function tryTeam(
  deps: TeamTryDeps,
  document: TeamEditorDocument,
  sample: TeamPanelSlice['sample'],
  signal: AbortSignal,
): Promise<string> {
  const frozen = teamEditorDocumentSchema.parse(document)
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(TEAM_TRY_TIMEOUT_MS)])
  let openClaim: { readonly check: () => void } | undefined
  // The account the quote bills, pinned across consent (P2-A: the paying
  // provider credential for a bring-your-own model, not the generic Meta
  // account). The credential the latest transport attempt actually used,
  // carried from final admission: the quota stamper attributes observations
  // to it, never re-read after the response.
  const quote: { digest: string | undefined } = { digest: undefined }
  const check = (attemptDigest?: string) => {
    if (lifetime.aborted || !deps.isAllowed()) throw new Error(UI_TEXT.teamBudgetUnavailable)
    openClaim?.check()
    // Final transport admission compares the request's own digest against
    // the quote: a credential replaced after consent sends nothing further.
    if (attemptDigest !== undefined && quote.digest !== undefined && attemptDigest !== quote.digest)
      throw new Error(UI_TEXT.teamTryDenied)
  }
  check()
  // The quote names this account when it is shown: a stored-key replacement
  // while the consent is open voids the approval, and nothing is sent.
  quote.digest = await deps.keyDigest()
  if (quote.digest === undefined) throw new Error(UI_TEXT.teamTryDenied)
  if (!(await deps.consent())) throw new Error(UI_TEXT.teamTryDenied)
  if ((await deps.keyDigest()) !== quote.digest) throw new Error(UI_TEXT.teamTryDenied)
  check()
  let attempts = 0
  let charged = Usd.from(0).toAmount()
  let retained = Usd.from(0).toAmount()
  const guard: ResponseAttemptGuard = Object.assign(check, {
    onRequestStarted: deps.noteDispatched,
    reserveUsage: async (maximum: {
      readonly costUsd?: UsdAmount | undefined
      readonly inputTokens?: number | undefined
    }) => {
      check()
      // The quoted account travels with the request into final transport
      // admission: every attempt re-admits the paying identity in quote
      // space, and the transport's own digest is compared by the guard.
      // A credential replaced after consent sends nothing further.
      if ((await deps.keyDigest()) !== quote.digest) throw new Error(UI_TEXT.teamTryDenied)
      if (
        attempts >= TEAM_TRY_MAX_REQUESTS ||
        maximum.costUsd === undefined ||
        maximum.inputTokens === undefined ||
        maximum.inputTokens > TEAM_TRY_MAX_INPUT_TOKENS
      )
        throw new Error(UI_TEXT.teamBudgetUnavailable)
      const claim = await deps.reserve(maximum.costUsd)
      openClaim = claim
      attempts += 1
      let isSettled = false
      return async (outcome: ResponseAttemptOutcome) => {
        if (isSettled) return
        isSettled = true
        const isUncertain =
          outcome.kind === 'ambiguous' ||
          (outcome.kind === 'billed' && outcome.usage.costUsd === undefined)
        const billedCost =
          outcome.kind === 'billed' ? (outcome.usage.costUsd ?? maximum.costUsd) : undefined
        const cost =
          outcome.kind === 'released' ? Usd.from(0).toAmount() : (billedCost ?? maximum.costUsd)
        if (cost === undefined) throw new Error(UI_TEXT.teamBudgetUnavailable)
        await claim.settle(cost, isUncertain)
        if (outcome.kind === 'billed') deps.noteUsage(outcome.usage)
        if (isUncertain) retained = sumUsd(retained, cost)
        else charged = sumUsd(charged, cost)
        if (openClaim === claim) openClaim = undefined
      }
    },
  })
  // Revalidated before the preview host is created: the consent answered
  // for the quoted account never starts a billed host for another one.
  if ((await deps.keyDigest()) !== quote.digest) throw new Error(UI_TEXT.teamTryDenied)
  const host = await deps.start(guard)
  // The host initialised asynchronously: a credential replaced while it
  // started voids the approval before any session exists, so nothing is
  // reserved or sent under the earlier approval.
  if ((await deps.keyDigest()) !== quote.digest) {
    await host.close()
    throw new Error(UI_TEXT.teamTryDenied)
  }
  let text = ''
  let failure: string | undefined
  let unsubscribe: (() => void) | undefined
  try {
    check()
    const session = await host.startSession({
      workspaceRoot: deps.workspaceRoot,
      modelId: deps.modelId,
      approvalMode: 'denyUnmatched',
    })
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        void session.cancel().catch(reject)
        reject(new Error(UI_TEXT.teamBudgetUnavailable))
      }
      lifetime.addEventListener('abort', abort, { once: true })
      unsubscribe = session.onEvent((event) => {
        if (event.type === 'itemCompleted' && event.item.kind === 'agentMessage')
          text = event.item.text ?? text
        if (event.type !== 'turnCompleted') {
          return
        }

        lifetime.removeEventListener('abort', abort)
        if (event.terminal !== 'completed') failure = event.reason ?? event.terminal
        resolve()
      })
      void session
        .sendTurn([
          {
            type: 'text',
            text: `${TEAM_TRY_MODEL_TEXT.teamTryPlanningInstructions}\n${JSON.stringify({ document: frozen, sample })}`,
          },
        ])
        .catch((error: unknown) => {
          lifetime.removeEventListener('abort', abort)
          reject(error instanceof Error ? error : new Error(String(error)))
        })
      if (lifetime.aborted) abort()
    })
  } catch (error: unknown) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    unsubscribe?.()
    await host.close()
  }
  return [
    fill(UI_TEXT.teamTryTally, {
      attempts: plural(UI_TEXT.usagePaidBestOfNAttempts, attempts),
      charged: formatUsd(charged),
      retained: formatUsd(retained),
    }),
    failure,
    text,
  ]
    .filter((value) => value !== undefined && value !== '')
    .join('\n')
}

export function teamTryConfirmation(model: ModelSummary): TeamWorkerConfirmation {
  const provider =
    model.providerId ?? (model.modelId.includes('/') ? model.modelId.split('/', 1)[0] : 'meta')
  const tier = provider === 'meta' ? modelApiPaidTier(model.modelId) : undefined
  const meta = tier === undefined ? undefined : MODEL_API_PRICES_PER_MILLION[tier]
  const input = model.inputUsdPerMTokens ?? meta?.input
  const output = model.outputUsdPerMTokens ?? meta?.output
  if (input === undefined || output === undefined) throw new Error(UI_TEXT.teamBudgetUnavailable)
  return {
    role: UI_TEXT.teamOrchestrator,
    ...(provider !== undefined && { provider }),
    modelId: model.modelId,
    taskCeilingTokens:
      TEAM_TRY_MAX_REQUESTS * (TEAM_TRY_MAX_INPUT_TOKENS + TEAM_TRY_MAX_OUTPUT_TOKENS),
    rates: {
      input: Number(input),
      output: Number(output),
      ...(meta !== undefined && { cachedInput: Number(meta.cachedInput) }),
    },
  }
}

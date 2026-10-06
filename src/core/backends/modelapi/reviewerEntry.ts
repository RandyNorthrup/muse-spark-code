import type { ResponseObservation } from './client'
// Paid Auto review execution: loaded only after the paid-use popup allows it.
// Session-owned fences and journal observers are passed through unchanged.
import type { ModelApiHostDeps, DirectResponseBudget } from './ModelApiHost'
import {
  parseReviewerAnswer,
  reviewerInput,
  type ReviewAnswer,
  type ReviewBreaker,
  type ReviewRequest,
} from './autoReviewer'
import type { ConfirmedModelRequest, ResponseAttemptGuard } from './client'
import type { CreateResponseBody, StreamEvent, Usage } from './schemas'
import {
  estimateInput,
  requestParts,
  reserveRequest,
  type OwnedSessionBudgetScope,
  type SessionBudgetClaim,
  helperRequestSettlement,
} from './sessionBudget'
import {
  effortForPolicy,
  modelPricedUsage,
  outputLimitFor,
  type ResolvedModel,
} from './modelPolicy'
import type { AgentEvent, ItemSnapshot } from '../../../shared/agentEvents'
import {
  AUTO_REVIEW_ROW_TOOL,
  AUTO_REVIEWER_MAX_OUTPUT_TOKENS,
  AUTO_REVIEWER_MODEL_TEXT,
  AUTO_REVIEWER_TIMEOUT_MS,
  MODEL_API_EFFORT_OFF,
  MODEL_API_MAX_RETRIES,
  UI_TEXT,
} from '../../../shared/constants'
import { fill, setUiText } from '../../../shared/l10n/text'
import type { UiText } from '../../../shared/l10n/en'

// M91 hook model turns share the paid helper bundle and its existing lazy boundary.
export { runHookModelTurn } from './hookModelEntry'

type ReviewerResult =
  { readonly decision: 'allow' } | { readonly decision: 'ask'; readonly note: string }
interface ReviewerContext {
  readonly deps: Pick<
    ModelApiHostDeps,
    | 'client'
    | 'workspaceRoot'
    | 'platform'
    | 'newId'
    | 'log'
    | 'noteReviewerUsage'
    | 'now'
    | 'usageRecording'
  >
  readonly resolved: ResolvedModel
  readonly table: UiText
  readonly locale: string
  readonly breaker: ReviewBreaker
  readonly userRequest: ReviewRequest['userRequest']
  readonly recentCalls: ReviewRequest['recentCalls']
  readonly keyed: (
    request: Omit<CreateResponseBody, 'prompt_cache_key' | 'prompt_cache_retention'>,
  ) => CreateResponseBody
  readonly guard: (body: CreateResponseBody, budget: DirectResponseBudget) => ResponseAttemptGuard
  readonly isCountedUsage: (usage: Usage) => boolean
  readonly abortError: () => Error
  readonly isRefused: (error: unknown) => boolean
  readonly emit: (event: AgentEvent) => void
  readonly record: (item: ItemSnapshot, isStarted: boolean) => void
}
const IN_PROGRESS = 'inProgress'
const CANCELLED = 'cancelled'
const FAILED = 'failed'
const COMPLETED = 'completed'

/** What one stream event adds to an Auto review (M78): text, the usage, or how it failed. */
function reviewPart(event: StreamEvent): {
  readonly text: string
  readonly usage?: Usage | null | undefined
  readonly failure?: string
} {
  switch (event.type) {
    case 'response.output_text.delta': {
      return { text: event.delta }
    }
    case 'response.completed': {
      return { text: '', usage: event.response.usage }
    }
    case 'response.failed':
    case 'response.incomplete': {
      return { text: '', usage: event.response.usage, failure: event.type }
    }
    case 'error': {
      return { text: '', failure: `error ${event.code ?? 'unknown'}` }
    }
    default: {
      return { text: '' }
    }
  }
}

/** A consented review's transcript row, result and breaker update. */
export async function reviewPaidCall(
  context: ReviewerContext,
  tool: string,
  action: string,
  turnId: string,
  signal: AbortSignal,
  confirmed: ConfirmedModelRequest,
  budgetScope: OwnedSessionBudgetScope | undefined,
  isCurrent: () => boolean,
): Promise<ReviewerResult> {
  setUiText(context.table, context.locale)
  const started: ItemSnapshot = {
    itemId: context.deps.newId(),
    kind: 'toolCall',
    status: IN_PROGRESS,
    turnId,
    tool: AUTO_REVIEW_ROW_TOOL,
    args: JSON.stringify({ tool: tool, action }),
    paid: 'autoReviewer',
  }
  // The row is the transcript's, never the model's: it is not replayed.
  context.record(started, true)
  context.emit({ type: 'itemStarted', item: started })
  let answer: ReviewAnswer | 'failed' | 'unreadable'
  try {
    answer = await callReviewer(context, tool, action, signal, confirmed, budgetScope)
  } catch (error: unknown) {
    const completed: ItemSnapshot = { ...started, status: CANCELLED }
    context.emit({ type: 'itemCompleted', item: completed })
    context.record(completed, false)
    throw error
  }
  if (!isCurrent()) {
    answer = 'failed'
  }
  const isAllowedByReviewer =
    isCurrent() && typeof answer !== 'string' && answer.decision === 'allow'
  if (context.breaker.record(isAllowedByReviewer)) {
    context.deps.log.warn('The Auto reviewer stopped for the rest of the turn: its breaker tripped')
    context.emit({ type: 'backendNotice', level: 'warning', text: UI_TEXT.autoReviewerTripped })
  }
  let note: string
  if (answer === 'failed') {
    note = UI_TEXT.autoReviewerFailed
  } else if (answer === 'unreadable') {
    note = UI_TEXT.autoReviewerUnreadable
  } else {
    note = fill(answer.decision === 'allow' ? UI_TEXT.autoReviewAllowed : UI_TEXT.autoReviewAsked, {
      reason: answer.reason,
    })
  }
  const completed: ItemSnapshot = {
    ...started,
    status: answer === 'failed' ? FAILED : COMPLETED,
    visibleOutput: note,
    ...(answer === 'failed' && { failureReason: note }),
  }
  context.emit({ type: 'itemCompleted', item: completed })
  context.record(completed, false)
  return isAllowedByReviewer ? { decision: 'allow' } : { decision: 'ask', note }
}

/** One request, no retry, with the original session's live admission guard. */
async function callReviewer(
  context: ReviewerContext,
  tool: string,
  action: string,
  signal: AbortSignal,
  confirmed: ConfirmedModelRequest,
  budgetScope: OwnedSessionBudgetScope | undefined,
): Promise<ReviewAnswer | 'failed' | 'unreadable'> {
  const input = reviewerInput({
    userRequest: context.userRequest,
    recentCalls: context.recentCalls,
    tool,
    action,
    workspaceRoot: context.deps.workspaceRoot,
    platform: context.deps.platform,
  })
  let body = context.keyed({
    model: confirmed.modelId,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] }],
    instructions: AUTO_REVIEWER_MODEL_TEXT.autoReviewerInstructions,
    tools: [],
    tool_choice: 'auto',
    reasoning: {
      effort: effortForPolicy(context.resolved.policy, MODEL_API_EFFORT_OFF),
      summary: 'auto',
    },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: outputLimitFor(context.resolved.policy, AUTO_REVIEWER_MAX_OUTPUT_TOKENS),
  })
  const modelId = confirmed.modelId
  let text = ''
  let usage: Usage | null | undefined
  let claim: SessionBudgetClaim | undefined
  let directBudget: DirectResponseBudget | undefined
  let reservedUsd = 0
  let wasRefused = false
  const startedAt = context.deps.now()
  let observation: ResponseObservation = {}
  let outcome: 'completed' | 'incomplete' | 'failed' | 'cancelled' = 'failed'
  let served: string | undefined
  try {
    if (budgetScope !== undefined) {
      const total = await budgetScope.journal.read(budgetScope.sessionId, budgetScope.accountId)
      const capUsd = budgetScope.capUsd()
      const input = estimateInput(requestParts(body), undefined).inputTokens
      if (capUsd > 0) {
        const reservation = reserveRequest({
          capUsd,
          spentUsd: total.spentUsd,
          estimatedInputTokens: input,
          modelId,
          maxOutputTokens: body.max_output_tokens,
          ...(modelId.includes('/') && { price: context.resolved.price }),
        })
        body = {
          ...body,
          max_output_tokens: Math.min(body.max_output_tokens, reservation.maxOutputTokens),
        }
      }
      reservedUsd =
        context.resolved.price.reserve({
          inputTokens: input,
          outputTokens: body.max_output_tokens,
          cachedTokens: 0,
        }) ?? 0
      claim = await budgetScope.journal.reserve(
        budgetScope.sessionId,
        budgetScope.accountId,
        reservedUsd,
        { isUnbounded: capUsd === 0 },
      )
    }
    directBudget = { scope: budgetScope, claim, isSent: false }
    const required = context.guard(body, directBudget)
    const admission: ResponseAttemptGuard = Object.assign(
      (actualKeyDigest: string | undefined) => {
        required(actualKeyDigest)
      },
      {
        observe: (next: ResponseObservation) => {
          observation = {
            ...observation,
            ...next,
            rateLimited: observation.rateLimited === true || next.rateLimited === true,
          }
          if (
            next.headers !== undefined &&
            (Object.keys(next.headers).length > 0 || next.rateLimited === true)
          ) {
            context.deps.usageRecording?.limit(
              {
                backend: 'modelApi',
                provider: context.resolved.policy.identity.provider,
                source: 'headers',
                observedAt: context.deps.now(),
                windows: [],
                raw: next.headers,
              },
              next.rateLimited === true,
            )
          }
        },
        paidFeature: 'autoReviewer' as const,
        ...(required.paidEstimatedInputTokens !== undefined && {
          paidEstimatedInputTokens: required.paidEstimatedInputTokens,
        }),
        onRequestStarted: () => {
          required.onRequestStarted?.()
          confirmed.onRequestStarted()
        },
      },
    )
    const events = context.resolved.client.streamResponse(
      body,
      AbortSignal.any([signal, AbortSignal.timeout(AUTO_REVIEWER_TIMEOUT_MS)]),
      undefined,
      // Its one attempt: a failed review asks the user, it is never sent again.
      { retriesUsed: MODEL_API_MAX_RETRIES },
      admission,
      {
        ...confirmed,
        onRequestStarted: () => {
          // The combined admission observer above counts this paid use once.
        },
      },
    )
    for await (const event of events) {
      if ('response' in event) served = event.response.model
      const part = reviewPart(event)
      text += part.text
      if (part.usage !== undefined) {
        if (part.usage !== null && !context.isCountedUsage(part.usage)) {
          usage = undefined
          throw new Error('Invalid reviewer usage')
        }
        usage = part.usage
      }
      if (part.failure !== undefined) {
        if (part.failure === 'response.incomplete') outcome = 'incomplete'
        throw new Error(`the review ended with ${part.failure}`)
      }
    }
    outcome = 'completed'
  } catch (error: unknown) {
    if (signal.aborted) outcome = 'cancelled'
    wasRefused = context.isRefused(error)
    if (signal.aborted) {
      throw context.abortError()
    }
    context.deps.log.warn('The Auto reviewer call failed; the user decides')
    return 'failed'
  } finally {
    context.deps.usageRecording?.note(usage ?? undefined, {
      backend: 'modelApi',
      provider: context.resolved.policy.identity.provider,
      model: modelId,
      ...(served !== undefined && { served }),
      kind: 'reviewer',
      startedAt,
      pricing:
        context.resolved.policy.identity.provider === 'meta'
          ? undefined
          : context.resolved.policy.pricing,
      durationMs: Math.max(0, context.deps.now() - startedAt),
      ...observation,
      outcome: wasRefused ? 'refused' : outcome,
      providerCostUsd: usage?.provider_cost_usd,
      uncertain: directBudget?.isSent === true && !wasRefused && usage == null,
      retainedLiabilityUsd: reservedUsd,
    })
    if (usage !== null && usage !== undefined && context.isCountedUsage(usage)) {
      try {
        context.deps.noteReviewerUsage(modelId, {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
          ...(modelId.includes('/') && {
            ...modelPricedUsage(usage),
            cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
            costUsd: context.resolved.price.settle(modelPricedUsage(usage), {
              cost: usage.provider_cost_usd,
            }),
          }),
        })
      } catch {
        // CAPPAR replaces legacy tariff-only observers. The request count
        // remains explicitly unknown, and its journal claim still settles.
        context.deps.log.warn('Auto review usage observer failed; its paid tally remains unknown')
      }
    }
    if (claim !== undefined) {
      const settlement = helperRequestSettlement(
        modelId,
        usage,
        context.isCountedUsage,
        directBudget?.isSent === true,
        wasRefused,
        reservedUsd,
        context.resolved.price,
      )
      await claim.settle(settlement.costUsd, settlement.isUnknown)
    }
  }
  return parseReviewerAnswer(text) ?? 'unreadable'
}

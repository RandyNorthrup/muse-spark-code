import { Usd, isPositiveUsd } from '../../../shared/usd'
// A prompt/agent hook's own model call (M91, PLAN.md D70, lane H): loaded
// only after the paid-use popup allows it. One attempt, no retry, hooks off,
// billed to the Model API key on the hookModels tally line, apart from the
// conversation. `prompt` asks with no tools; `agent` loops over read-only
// tools (read, grep, list, code intelligence) at most HOOK_AGENT_MAX_STEPS
// requests. A failure fails the hook; the caller parses the answer.
// Session-owned fences and journal observers are passed through unchanged.
import type { ModelApiHostDeps, DirectResponseBudget } from './ModelApiHost'
import type { reviewPaidCall } from './reviewerEntry'
import type { ConfirmedModelRequest, ResponseAttemptGuard } from './client'
import { isFunctionCallItem } from './schemas'
import type { FunctionCallItem, InputItem, StreamEvent, ToolDefinition, Usage } from './schemas'
import {
  helperRequestSettlement,
  estimateInput,
  requestParts,
  reserveRequest,
  type OwnedSessionBudgetScope,
  type SessionBudgetClaim,
} from './sessionBudget'
import { estimateCostUsd } from '../../usage/insights'
import type { SubagentUsage } from '../../../shared/paid'
import type { ItemSnapshot } from '../../../shared/agentEvents'
import {
  HOOK_AGENT_MAX_STEPS,
  HOOK_MODEL_MAX_OUTPUT_TOKENS,
  HOOK_MODEL_ROW_TOOL,
  HOOK_MODEL_TIMEOUT_MS,
  MODEL_API_EFFORT_OFF,
  MODEL_API_MAX_RETRIES,
} from '../../../shared/constants'

const IN_PROGRESS = 'inProgress'
const CANCELLED = 'cancelled'
const FAILED = 'failed'
const COMPLETED = 'completed'

/** One hook turn's input, as the handler built it. */
export interface HookModelTurnInput {
  readonly kind: 'prompt' | 'agent'
  readonly system: string
  readonly user: string
}

/** One hook turn's answer text and billable use. */
export interface HookModelTurnResult {
  readonly text: string
  readonly usage: SubagentUsage
}

export interface HookModelContext extends Pick<
  Parameters<typeof reviewPaidCall>[0],
  'keyed' | 'guard' | 'isCountedUsage' | 'abortError' | 'isRefused' | 'emit' | 'record'
> {
  readonly deps: Pick<
    ModelApiHostDeps,
    'client' | 'workspaceRoot' | 'platform' | 'newId' | 'log' | 'hookModelDailyBudget'
  >
  /** The read-only defs for `agent`; empty for `prompt`. */
  readonly tools: readonly ToolDefinition[]
  /** Runs one read-only tool; refuses any other name. */
  readonly executeReadOnlyTool: (
    name: string,
    argsJson: string,
    signal: AbortSignal,
  ) => Promise<string>
}

/** What one stream event adds to a hook turn: text, calls, usage, or failure. */
function hookPart(event: StreamEvent): {
  readonly text: string
  readonly calls: readonly FunctionCallItem[]
  readonly usage?: Usage | null | undefined
  readonly failure?: string
} {
  switch (event.type) {
    case 'response.output_text.delta': {
      return { text: event.delta, calls: [] }
    }
    case 'response.output_item.done': {
      return { text: '', calls: isFunctionCallItem(event.item) ? [event.item] : [] }
    }
    case 'response.completed': {
      return { text: '', calls: [], usage: event.response.usage }
    }
    case 'response.failed':
    case 'response.incomplete': {
      return { text: '', calls: [], usage: event.response.usage, failure: event.type }
    }
    case 'error': {
      return { text: '', calls: [], failure: `error ${event.code ?? 'unknown'}` }
    }
    default: {
      return { text: '', calls: [] }
    }
  }
}

/**
 * One hook turn's transcript row: the paid run is loud, like a review's.
 * The row is the transcript's, never the model's: it is not replayed.
 */
export async function runHookModelTurn(
  context: HookModelContext,
  input: HookModelTurnInput,
  event: string,
  turnId: string,
  signal: AbortSignal,
  confirmed: ConfirmedModelRequest,
  budgetScope: OwnedSessionBudgetScope | undefined,
  isCurrent: () => boolean,
): Promise<HookModelTurnResult> {
  const started: ItemSnapshot = {
    itemId: context.deps.newId(),
    kind: 'toolCall',
    status: IN_PROGRESS,
    turnId,
    tool: HOOK_MODEL_ROW_TOOL,
    args: JSON.stringify({ kind: input.kind, event }),
    paid: 'hookModels',
  }
  context.record(started, true)
  context.emit({ type: 'itemStarted', item: started })
  let result: HookModelTurnResult
  try {
    result = await callHookModel(context, input, signal, confirmed, budgetScope)
  } catch (error: unknown) {
    const completed: ItemSnapshot = { ...started, status: signal.aborted ? CANCELLED : FAILED }
    context.emit({ type: 'itemCompleted', item: completed })
    context.record(completed, false)
    throw error
  }
  if (!isCurrent()) {
    throw context.abortError()
  }
  const completed: ItemSnapshot = { ...started, status: COMPLETED, visibleOutput: result.text }
  context.emit({ type: 'itemCompleted', item: completed })
  context.record(completed, false)
  return result
}

/** One attempt for `prompt`, a bounded read-only loop for `agent`. */
async function callHookModel(
  context: HookModelContext,
  input: HookModelTurnInput,
  signal: AbortSignal,
  confirmed: ConfirmedModelRequest,
  budgetScope: OwnedSessionBudgetScope | undefined,
): Promise<HookModelTurnResult> {
  const history: InputItem[] = [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: input.user }] },
  ]
  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  const usages: Usage[] = []
  const steps = input.kind === 'agent' ? HOOK_AGENT_MAX_STEPS : 1
  for (let step = 0; step < steps; step += 1) {
    text = ''
    const calls = await requestHookStep(
      context,
      input,
      history,
      confirmed,
      budgetScope,
      signal,
      (stepText, stepUsage) => {
        text += stepText
        if (stepUsage === null || stepUsage === undefined) {
          return
        }

        if (!context.isCountedUsage(stepUsage)) {
          throw new Error('Invalid hook model usage')
        }
        usages.push(stepUsage)
        inputTokens += stepUsage.input_tokens
        outputTokens += stepUsage.output_tokens
        cachedTokens += stepUsage.input_tokens_details?.cached_tokens ?? 0
      },
    )
    if (calls.length === 0) {
      break
    }
    if (input.kind !== 'agent' || step === steps - 1) {
      throw new Error('the hook model exceeded its tool allowance')
    }
    for (const call of calls) {
      signal.throwIfAborted()
      if (context.tools.every((tool) => !(tool.type === 'function' && tool.name === call.name))) {
        throw new Error('the hook model requested an unavailable tool')
      }
      const output = await context.executeReadOnlyTool(call.name, call.arguments, signal)
      history.push(call, { type: 'function_call_output', call_id: call.call_id, output })
    }
  }
  if (usages.length === 0) {
    throw new Error('the hook model call reported no usable usage')
  }
  const counted = { inputTokens, outputTokens, cachedTokens }
  return { text, usage: counted }
}

/** One request of the hook turn; returns the model's read-only calls, if any. */
async function requestHookStep(
  context: HookModelContext,
  input: HookModelTurnInput,
  history: InputItem[],
  confirmed: ConfirmedModelRequest,
  budgetScope: OwnedSessionBudgetScope | undefined,
  signal: AbortSignal,
  onPart: (text: string, usage: Usage | null | undefined) => void,
): Promise<readonly FunctionCallItem[]> {
  const modelId = confirmed.modelId
  let body = context.keyed({
    model: modelId,
    input: history,
    instructions: input.system,
    tools: input.kind === 'agent' ? [...context.tools] : [],
    tool_choice: 'auto',
    reasoning: { effort: MODEL_API_EFFORT_OFF, summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: HOOK_MODEL_MAX_OUTPUT_TOKENS,
  })
  let claim: SessionBudgetClaim | undefined
  let directBudget: DirectResponseBudget | undefined
  let reservedUsd = Usd.from(0).toAmount()
  let wasRefused = false
  let usage: Usage | null | undefined
  let dailyClaim:
    | Awaited<ReturnType<NonNullable<HookModelContext['deps']['hookModelDailyBudget']>['reserve']>>
    | undefined
  const calls: FunctionCallItem[] = []
  try {
    if (budgetScope !== undefined) {
      const total = await budgetScope.journal.read(budgetScope.sessionId, budgetScope.accountId)
      const capUsd = budgetScope.capUsd()
      const estimated = estimateInput(requestParts(body), undefined).inputTokens
      if (isPositiveUsd(capUsd)) {
        const reservation = reserveRequest({
          capUsd,
          spentUsd: total.spentUsd,
          estimatedInputTokens: estimated,
          modelId,
        })
        body = {
          ...body,
          max_output_tokens: Math.min(body.max_output_tokens, reservation.maxOutputTokens),
        }
      }
      reservedUsd = estimateCostUsd(
        { inputTokens: estimated, outputTokens: body.max_output_tokens, cachedTokens: 0 },
        modelId,
      )
      claim = await budgetScope.journal.reserve(
        budgetScope.sessionId,
        budgetScope.accountId,
        reservedUsd,
        { isUnbounded: !isPositiveUsd(capUsd) },
      )
    }
    const estimatedInputTokens = estimateInput(requestParts(body), undefined).inputTokens
    const reservationUsd = estimateCostUsd(
      { inputTokens: estimatedInputTokens, outputTokens: body.max_output_tokens, cachedTokens: 0 },
      modelId,
    )
    reservedUsd =
      Usd.from(reservedUsd).compare(Usd.from(reservationUsd)) > 0 ? reservedUsd : reservationUsd
    dailyClaim = await context.deps.hookModelDailyBudget?.reserve(
      modelId,
      estimatedInputTokens,
      body.max_output_tokens,
      signal,
    )
    directBudget = { scope: budgetScope, claim, isSent: false }
    const required = context.guard(body, directBudget)
    const admission: ResponseAttemptGuard = Object.assign(
      (actualKeyDigest: string | undefined) => {
        required(actualKeyDigest)
        dailyClaim?.check()
      },
      {
        onRequestStarted: () => {
          dailyClaim?.check()
          required.onRequestStarted?.()
          confirmed.onRequestStarted()
        },
      },
    )
    const events = context.deps.client.streamResponse(
      body,
      AbortSignal.any([signal, AbortSignal.timeout(HOOK_MODEL_TIMEOUT_MS)]),
      undefined,
      // Its one attempt: a failed hook run fails the hook, it is never sent again.
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
      const part = hookPart(event)
      onPart(part.text, part.usage)
      if (part.usage !== undefined) {
        usage = part.usage
        if (part.usage !== null && !context.isCountedUsage(part.usage)) {
          throw new Error('Invalid hook model usage')
        }
      }
      for (const call of part.calls) {
        calls.push(call)
      }
      if (part.failure !== undefined) {
        throw new Error(`the hook model call ended with ${part.failure}`)
      }
    }
  } catch (error: unknown) {
    wasRefused = context.isRefused(error)
    if (signal.aborted) {
      throw context.abortError()
    }
    context.deps.log.warn('The hook model call failed')
    throw error
  } finally {
    const settlement = helperRequestSettlement(
      modelId,
      usage,
      context.isCountedUsage,
      directBudget?.isSent === true,
      wasRefused,
      reservedUsd,
    )
    try {
      await claim?.settle(settlement.costUsd, settlement.isUnknown)
    } finally {
      await dailyClaim?.settle(settlement.costUsd, settlement.isUnknown)
    }
  }
  return calls
}

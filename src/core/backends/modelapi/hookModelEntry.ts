import { isUnsentSideCall } from '../../refusal'
import { Usd, isPositiveUsd } from '../../../shared/usd'
// A prompt/agent hook's own model call (M91, PLAN.md D70, lane H): loaded
// only after the paid-use popup allows it. No transport retry, hooks off,
// billed to the Model API key on the hookModels tally line, apart from the
// conversation. `prompt` asks with no tools; `agent` loops over read-only
// tools (read, grep, list, code intelligence) until the model stops calling
// them (D121: no step ceiling of ours). Invalid structured answers get one repair,
// then the existing text path. Every request is admitted and settled.
// Session-owned fences and journal observers are passed through unchanged.
import * as z from 'zod/mini'
import type { ModelApiHostDeps, DirectResponseBudget } from './ModelApiHost'
import type { reviewPaidCall } from './reviewerEntry'
import type { ConfirmedModelRequest, ResponseAttemptGuard } from './client'
import { streamRepairAttempt } from './repairAttempt'
import { isFunctionCallItem } from './schemas'
import type {
  CreateResponseBody,
  FunctionCallItem,
  InputItem,
  StreamEvent,
  ToolDefinition,
  Usage,
} from './schemas'
import { fitRequest, helperRequestCost, type OwnedSessionBudgetScope } from './sessionBudget'
import { estimateCostUsd } from '../../usage/insights'
import type { SubagentUsage } from '../../../shared/paid'
import type { ItemSnapshot } from '../../../shared/agentEvents'
import { HOOK_MODEL_ROW_TOOL, MODEL_API_EFFORT_OFF } from '../../../shared/constants'
import { hookDecisionSchema } from '../../../shared/sideCallSchemas'
import { setUiText } from '../../../shared/l10n/text'
import { minOutputTokensForPolicy, modelPolicyFor } from './modelPolicy'
import { sideCallBody, structuredSideCall, type SideCallAttempt } from './structuredOutput'
import { boundToolResultText, callOutputItem } from './toolResultBound'

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
  | 'keyed'
  | 'guard'
  | 'isCountedUsage'
  | 'abortError'
  | 'isRefused'
  | 'emit'
  | 'record'
  | 'table'
  | 'locale'
> {
  readonly deps: Pick<
    ModelApiHostDeps,
    | 'client'
    | 'workspaceRoot'
    | 'platform'
    | 'newId'
    | 'log'
    | 'hookModelDailyBudget'
    | 'sideCallFormats'
    | 'forceSideCallTool'
    | 'contextModel'
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
One hook turn's transcript row: the paid run is loud, like a review's.
The row is the transcript's, never the model's: it is not replayed.
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
  setUiText(context.table, context.locale)
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
    result = await callHookModel(context, input, event, signal, confirmed, budgetScope)
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

/** One request for `prompt`, a bounded read-only loop for each `agent` attempt. */
async function callHookModel(
  context: HookModelContext,
  input: HookModelTurnInput,
  event: string,
  signal: AbortSignal,
  confirmed: ConfirmedModelRequest,
  budgetScope: OwnedSessionBudgetScope | undefined,
): Promise<HookModelTurnResult> {
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  const usages: Usage[] = []
  const text = await structuredSideCall({
    formats: context.deps.sideCallFormats?.(confirmed.modelId),
    name: 'hook_decision',
    schema: z.pipe(
      hookDecisionSchema,
      z.transform((answer) =>
        JSON.stringify({
          ...(answer.decision === 'block' && { decision: 'block', reason: answer.reason }),
          ...(answer.additionalContext !== null && {
            hookSpecificOutput: {
              hookEventName: event,
              additionalContext: answer.additionalContext,
            },
          }),
        }),
      ),
    ),
    signal,
    fallback: (text) => text,
    notice: (text) => {
      context.emit({ type: 'backendNotice', level: 'warning', text })
    },
    request: async (attempt) => {
      const history: InputItem[] = [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: input.user }] },
      ]
      // D121: an agent handler loops over its read-only tools until the
      // model stops calling them — the removed 5-step ceiling was invented
      // and no provider documents one. Each step is admitted and settled
      // against the session and daily budgets, and Stop aborts the loop.
      let text = ''
      for (;;) {
        text = ''
        const calls = await requestHookStep(
          context,
          input,
          history,
          confirmed,
          budgetScope,
          signal,
          attempt,
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
        if (input.kind !== 'agent') {
          throw new Error('the hook model exceeded its tool allowance')
        }
        for (const call of calls) {
          signal.throwIfAborted()
          if (
            context.tools.every((tool) => !(tool.type === 'function' && tool.name === call.name))
          ) {
            throw new Error('the hook model requested an unavailable tool')
          }
          const output = await context.executeReadOnlyTool(call.name, call.arguments, signal)
          // TOOLCAP: a read-only tool's text enters the hook model's request
          // whole unless it needs more than its share of the hook model's own
          // window (D121: no trimming of ours). The hook model has no spill
          // writer, so text over that share fails loudly instead of riding
          // unbounded into a paid side call; the hook's read-only tools cap
          // their outputs upstream, so this is the dense-text edge.
          const hookWindow = context.deps.contextModel?.(confirmed.modelId)?.contextTokens
          const bounded = boundToolResultText(output, {
            maxBytes: Infinity,
            windowTokens:
              hookWindow !== undefined && Number.isSafeInteger(hookWindow) && hookWindow > 0
                ? hookWindow
                : undefined,
          })
          if (bounded.cut !== undefined) {
            throw new Error('the hook tool output exceeded the tool-result bound')
          }
          history.push(call, callOutputItem(call.call_id, bounded.text))
        }
      }
      return text
    },
  })
  if (usages.length === 0) {
    throw new Error('the hook model call reported no usable usage')
  }
  const counted = { inputTokens, outputTokens, cachedTokens }
  return { text, usage: counted }
}

/**
D121: the hook call sends no output cap of ours. The capability record's
published maximum rides along; a model the record names none for sends
none, and the provider's own default applies.
*/
export function hookModelOutputCap(modelId: string): number | undefined {
  return modelPolicyFor(modelId).output.maxTokens
}

/** One request of the hook turn; returns the model's read-only calls, if any. */
async function requestHookStep(
  context: HookModelContext,
  input: HookModelTurnInput,
  history: InputItem[],
  confirmed: ConfirmedModelRequest,
  budgetScope: OwnedSessionBudgetScope | undefined,
  signal: AbortSignal,
  attempt: SideCallAttempt,
  onPart: (text: string, usage: Usage | null | undefined) => void,
): Promise<readonly FunctionCallItem[]> {
  const modelId = confirmed.modelId
  const policy = modelPolicyFor(modelId)
  const outputCap = hookModelOutputCap(modelId)
  let body = context.keyed(
    sideCallBody(
      context.keyed({
        model: modelId,
        input: history,
        instructions: input.system,
        tools: input.kind === 'agent' ? [...context.tools] : [],
        tool_choice: 'auto',
        reasoning: { effort: MODEL_API_EFFORT_OFF, summary: 'auto' },
        stream: true,
        store: false,
        include: ['reasoning.encrypted_content'],
        // No cap of ours: the record's maximum, or no key at all. The
        // spread is absent exactly when the record is silent, so the key
        // is missing at runtime (PLAN.md §8).
        ...(outputCap !== undefined && { max_output_tokens: outputCap }),
      } as Omit<CreateResponseBody, 'prompt_cache_key' | 'prompt_cache_retention'>),
      attempt,
      context.deps.forceSideCallTool,
    ),
  )
  let directBudget: DirectResponseBudget | undefined
  let wasRefused = false
  let usage: Usage | null | undefined
  let dailyClaim:
    | Awaited<ReturnType<NonNullable<HookModelContext['deps']['hookModelDailyBudget']>['reserve']>>
    | undefined
  const calls: FunctionCallItem[] = []
  let hasCompleted = false
  let hasResponseFrame = false
  try {
    // Under the conversation's limit the request is fitted into what is left
    // (D208); its estimate is compared again before the send, never held.
    // The estimate below is the number actually sent: the record's maximum
    // fitted into the person's budget, or the fit alone when the record is
    // silent. With neither, the provider's own minimum floors the hold and
    // the daily tally settles the true cost after.
    const minimum = minOutputTokensForPolicy(policy)
    let sentMax = outputCap ?? minimum
    const capUsd = budgetScope?.capUsd() ?? Usd.from(0).toAmount()
    if (budgetScope !== undefined && isPositiveUsd(capUsd)) {
      const fit = fitRequest({
        capUsd,
        spentUsd: budgetScope.spentUsd(),
        estimatedInputTokens: Buffer.byteLength(JSON.stringify(body), 'utf8'),
        modelId,
        minOutputTokens: minimum,
      })
      sentMax =
        outputCap === undefined ? fit.maxOutputTokens : Math.min(outputCap, fit.maxOutputTokens)
      body = {
        ...body,
        max_output_tokens: sentMax,
      }
    }
    const estimatedInputTokens = Buffer.byteLength(JSON.stringify(body), 'utf8')
    dailyClaim = await context.deps.hookModelDailyBudget?.reserve(
      modelId,
      estimatedInputTokens,
      sentMax,
      signal,
    )
    directBudget = {
      scope: budgetScope,
      estimateUsd: estimateCostUsd(
        {
          inputTokens: estimatedInputTokens,
          outputTokens: sentMax,
          cachedTokens: 0,
        },
        modelId,
      ),
      isSent: false,
    }
    const required = context.guard(body, directBudget)
    const admission: ResponseAttemptGuard = Object.assign(
      (actualKeyDigest: string | undefined) => {
        required(actualKeyDigest)
        dailyClaim?.check()
      },
      {
        billingRoute: required.billingRoute,
        confirmBillingRoute: required.confirmBillingRoute,
        paidFeature: 'hookModels' as const,
        onRequestStarted: () => {
          dailyClaim?.check()
          required.onRequestStarted?.()
          confirmed.onRequestStarted()
        },
      },
    )
    // D121: no default deadline of ours — the hook's own model call runs
    // until it ends or the person stops it.
    const events = streamRepairAttempt(
      context.deps.client,
      body,
      signal,
      undefined,
      admission,
      confirmed,
    )
    for await (const event of events) {
      hasResponseFrame = true
      if (event.type === 'response.completed') hasCompleted = true
      const part = hookPart(event)
      onPart(part.text, part.usage)
      if (part.usage !== undefined) {
        usage = part.usage
        if (part.usage !== null && !context.isCountedUsage(part.usage)) {
          throw new Error('Invalid hook model usage')
        }
      }
      for (const call of part.calls) {
        if (attempt.mode === 'forced_tool' && call.name === attempt.name) {
          onPart(call.arguments, undefined)
        } else {
          calls.push(call)
        }
      }
      if (part.failure !== undefined) {
        throw new Error(`the hook model call ended with ${part.failure}`)
      }
    }
    if (!hasCompleted && attempt.mode !== 'text')
      throw new Error('the structured hook has no completed response')
  } catch (error: unknown) {
    wasRefused = isUnsentSideCall(
      error,
      hasResponseFrame,
      directBudget?.isSent === true,
      usage != null,
      (candidate) => context.isRefused(candidate),
    )
    if (signal.aborted) {
      throw context.abortError()
    }
    context.deps.log.warn('The hook model call failed')
    throw error
  } finally {
    // After the call, its reported cost (or cost unknown) joins the running totals (D208).
    const costUsd = helperRequestCost(
      modelId,
      usage,
      context.isCountedUsage,
      directBudget?.isSent === true,
      wasRefused,
    )
    budgetScope?.charge(costUsd)
    await dailyClaim?.settle(costUsd)
  }
  return calls
}

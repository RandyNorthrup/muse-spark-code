// Stable provider API adapter (M95c part 2), loaded by the first opt-in action
// or editor model call. The 1.99 typings stay pinned for older supported hosts.
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { Logger } from '../logger'
import type { ModelResolver, ResolvedModel } from '../../core/backends/modelapi/modelPolicy'
import type { CreateResponseBody, InputItem, Usage } from '../../core/backends/modelapi/schemas'
import type { UsageRecording } from '../../core/usage/recording'
import { Usd, type UsdAmount } from '../../shared/usd'
import {
  ANTHROPIC_MAX_IMAGE_BYTES,
  EDITOR_CHAT_VENDOR,
  META_IMAGE_MAX_BYTES,
  MODEL_API_EFFORT_OFF,
  MODEL_API_REQUEST_TIMEOUT_MS,
  TOKENS_PER_MILLION,
  EDITOR_CHAT_PROMPT_CACHE_RETENTION,
  UI_TEXT,
} from '../../shared/constants'
import { boundToolResultText } from '../../core/backends/modelapi/toolResultBound'
import { parseModelRef } from '../../shared/modelRef'
import { fill, formatNumber } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'

const selectedSchema = z.array(z.string().check(z.minLength(1)))
const confirmationsSchema = z.record(z.string(), z.string())
const modelOptionsSchema = z.strictObject({ reasoningEffort: z.optional(z.string()) })
const textSchema = z.object({ value: z.string() })
const callSchema = z.object({
  callId: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
})
const resultSchema = z.object({ callId: z.string(), content: z.array(textSchema) })
const imageSchema = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.instanceof(Uint8Array).check(z.refine((value) => value.byteLength > 0)),
})

/**
The provider's own documented image bound for editor-sent pictures, or
undefined where the provider states none: only documented bounds are
enforced locally (D121); other providers' own refusals reach the caller
in words.
*/
const IMAGE_MAX_BYTES_BY_PROVIDER: Readonly<Record<string, number>> = {
  anthropic: ANTHROPIC_MAX_IMAGE_BYTES,
  meta: META_IMAGE_MAX_BYTES,
}
const imageMaxBytesFor = (providerId: string): number | undefined =>
  IMAGE_MAX_BYTES_BY_PROVIDER[providerId]
const messageSchema = z.object({
  role: z.union([
    z.literal(vscode.LanguageModelChatMessageRole.User),
    z.literal(vscode.LanguageModelChatMessageRole.Assistant),
  ]),
  content: z.array(z.union([callSchema, resultSchema, textSchema, imageSchema])),
})
const messagesSchema = z.array(messageSchema)
const optionsSchema = z.object({
  tools: z.optional(
    z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.optional(z.record(z.string(), z.unknown())),
      }),
    ),
  ),
  toolMode: z.optional(
    z.union([
      z.literal(vscode.LanguageModelChatToolMode.Auto),
      z.literal(vscode.LanguageModelChatToolMode.Required),
    ]),
  ),
  modelOptions: z.optional(z.record(z.string(), z.unknown())),
})
const idSchema = z.object({ id: z.string() })

export interface EditorChatDeps {
  readonly log: Logger
  readonly models: ModelResolver
  readonly recording: UsageRecording
  readonly selected: () => unknown
  readonly allowed: () => boolean
  readonly now: () => number
  readonly saveSelected: (refs: readonly string[]) => Promise<void>
  readonly confirmations: () => unknown
  readonly saveConfirmation: (ref: string, evidence: string | undefined) => Promise<void>
}
export interface EditorChatInformation {
  readonly id: string
  readonly name: string
  readonly family: string
  readonly version: string
  readonly maxInputTokens: number
  readonly maxOutputTokens: number
  readonly capabilities: { readonly toolCalling: boolean; readonly imageInput: boolean }
}
export interface EditorChatProvider {
  provideLanguageModelChatInformation(
    options: unknown,
    token: vscode.CancellationToken,
  ): Promise<readonly EditorChatInformation[]>
  provideLanguageModelChatResponse(
    model: unknown,
    messages: unknown,
    options: unknown,
    progress: vscode.Progress<unknown>,
    token: vscode.CancellationToken,
  ): Promise<void>
  provideTokenCount(
    model: unknown,
    input: unknown,
    token: vscode.CancellationToken,
  ): Promise<number>
}

function isCancelled(token: vscode.CancellationToken): boolean {
  return token.isCancellationRequested
}

/**
The provider's own refusal, distinct from anything unexpected: callers
skip a refused model and rethrow anything else. The cause stays on the
thrown refusal for the record; only the fixed sentence reaches the person.
*/
class EditorChatRefusalError extends Error {
  constructor(cause?: unknown) {
    super(UI_TEXT.editorChatRefused, cause === undefined ? undefined : { cause })
  }
}
function fail(cause?: unknown): never {
  throw new EditorChatRefusalError(cause)
}
function limits(model: ResolvedModel): { input: number; output: number } {
  const input = model.contextTokens
  const output = model.policy.output.maxTokens
  return input === undefined ||
    output === undefined ||
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input <= 0 ||
    output <= 0
    ? fail()
    : { input, output }
}
function bodyFor(
  ref: string,
  messages: unknown,
  options: unknown,
  output: number,
  effort: string,
  inputWindow: number,
): CreateResponseBody {
  const parsed = messagesSchema.safeParse(messages)
  const opts = optionsSchema.safeParse(options)
  const providerId = parseModelRef(ref)?.providerId
  if (
    providerId === undefined ||
    !parsed.success ||
    !opts.success ||
    (opts.data.toolMode !== undefined &&
      opts.data.toolMode !== vscode.LanguageModelChatToolMode.Auto) ||
    !modelOptionsSchema.safeParse(opts.data.modelOptions ?? {}).success
  )
    return fail()
  const maxImageBytes = imageMaxBytesFor(providerId)
  const input: InputItem[] = []
  for (const message of parsed.data) {
    for (const part of message.content) {
      if ('data' in part) {
        if (message.role !== vscode.LanguageModelChatMessageRole.User) return fail()
        if (maxImageBytes !== undefined && part.data.byteLength > maxImageBytes) return fail()
        input.push({
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
              detail: 'auto',
            },
          ],
        })
      } else if ('input' in part) {
        if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) return fail()
        input.push({
          type: 'function_call',
          call_id: part.callId,
          name: part.name,
          arguments: JSON.stringify(part.input),
        })
      } else if ('content' in part) {
        if (message.role !== vscode.LanguageModelChatMessageRole.User) return fail()
        // TOOLCAP: the editor's tool text enters the request through the
        // one bound, sized by the model's own window. No spill writer
        // runs here, so text over its share fails loudly instead of
        // riding unbounded into a paid call.
        const bounded = boundToolResultText(part.content.map((text) => text.value).join('\n'), {
          maxBytes: Infinity,
          windowTokens: inputWindow,
        })
        if (bounded.cut !== undefined) return fail()
        input.push({
          type: 'function_call_output',
          call_id: part.callId,
          output: bounded.text,
        })
      } else
        input.push({
          type: 'message',
          role: message.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant',
          content: [
            {
              type:
                message.role === vscode.LanguageModelChatMessageRole.User
                  ? 'input_text'
                  : 'output_text',
              text: part.value,
            },
          ],
        })
    }
  }
  return {
    model: ref,
    input,
    instructions: '',
    tools: (opts.data.tools ?? []).map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      strict: false,
    })),
    tool_choice: 'auto',
    reasoning: { effort },
    stream: true,
    store: false,
    include: [],
    prompt_cache_key: '',
    prompt_cache_retention: EDITOR_CHAT_PROMPT_CACHE_RETENTION,
    max_output_tokens: output,
  }
}

const confirmationEvidence = (model: ResolvedModel) =>
  JSON.stringify({
    model: model.ref,
    origin: model.origin,
    pricing: model.policy.pricing,
  })

const pricePerMillion = (rate: number) =>
  formatUsd(Usd.from(rate).times(TOKENS_PER_MILLION).toAmount(), 2)

const modelRates = (model: ResolvedModel) => {
  const pricing = model.policy.pricing
  if (pricing.kind === 'local') return UI_TEXT.modelLocal
  if (pricing.kind !== 'priced') return fail()
  const card = pricing.card
  const tokenRates = (tier: typeof card.longContextTier) => {
    const input = tier?.input ?? card.input
    const output = tier?.output ?? card.output
    const cached = tier?.cachedInput ?? card.cachedInput ?? input
    const write = tier?.cacheWrite ?? card.cacheWrite ?? input
    const write1h = tier?.cacheWrite1h ?? card.cacheWrite1h ?? write
    return fill(UI_TEXT.editorChatRates, {
      input: pricePerMillion(input),
      output: pricePerMillion(output),
      cached: pricePerMillion(cached),
      write: pricePerMillion(write),
      write1h: pricePerMillion(write1h),
    })
  }
  const base = tokenRates(undefined)
  const fees = fill(UI_TEXT.editorChatFees, {
    request: formatUsd(card.request ?? 0, 2),
    image: formatUsd(card.image ?? 0, 2),
  })
  const tier = card.longContextTier
  return [
    base,
    fees,
    ...(tier === undefined
      ? []
      : [
          fill(UI_TEXT.editorChatTier, {
            tokens: formatNumber(tier.fromTokens),
            rates: tokenRates(tier),
          }),
        ]),
  ].join('\n')
}

const reasoningEffortFor = (model: ResolvedModel, options: unknown) => {
  const opts = optionsSchema.parse(options)
  const requested = modelOptionsSchema.parse(opts.modelOptions ?? {}).reasoningEffort
  const { supported, effortLevels, canDisable } = model.policy.reasoning
  // Reasoning off bills no reasoning level: a listed `none` level and a
  // recorded disable capability each run without reasoning, even when the
  // catalogue records only one of them.
  const canRunWithoutReasoning =
    canDisable.state === 'yes' ||
    (effortLevels.state === 'yes' && effortLevels.value.includes('none'))
  // Meta's thinking-off wire value is `minimal` (`none` is a 400); every
  // other provider runs without reasoning on `none`.
  const offEffort = model.policy.identity.provider === 'meta' ? MODEL_API_EFFORT_OFF : 'none'
  if (requested !== undefined) {
    // An explicit off request runs on the same terms as the default below:
    // it is honoured whenever the catalogue shows the model can run without
    // reasoning, even when `none` is not a listed level, and it is sent on
    // the provider's off wire value.
    if (requested === 'none') {
      if (supported.state === 'no') return 'none'
      return canRunWithoutReasoning ? offEffort : fail()
    }
    return supported.state !== 'no' &&
      effortLevels.state === 'yes' &&
      effortLevels.value.includes(requested)
      ? requested
      : fail()
  }
  if (supported.state === 'no') return 'none'
  if (effortLevels.state === 'yes') {
    if (canRunWithoutReasoning) return offEffort
    const level = effortLevels.value.find((value) => value !== 'none')
    if (level !== undefined) return level
  }
  return canDisable.state === 'yes' ? offEffort : fail()
}

export function createEditorChat(deps: EditorChatDeps) {
  const active = new Set<AbortController>()
  const confirming = new Map<string, Promise<void>>()
  const resolveModel = async (ref: string) =>
    await deps.models.resolve(ref.startsWith('meta/') ? ref.slice('meta/'.length) : ref)
  const selected = () => selectedSchema.parse(deps.selected())
  const isConfirmed = (ref: string, model: ResolvedModel) =>
    confirmationsSchema.safeParse(deps.confirmations()).data?.[ref] === confirmationEvidence(model)
  const confirm = async (ref: string, model: ResolvedModel, requiresSelected: boolean) => {
    if (isConfirmed(ref, model)) return
    const prior = confirming.get(ref)
    if (prior !== undefined) {
      await prior
      if (!isConfirmed(ref, model)) return fail()
      return
    }
    const pending = (async () => {
      const answer = await vscode.window.showWarningMessage(
        fill(UI_TEXT.editorChatConsent, {
          model: ref,
          rates: modelRates(model),
        }),
        { modal: true },
        UI_TEXT.editorChatEnable,
      )
      if (answer !== UI_TEXT.editorChatEnable) return fail()
      if (!deps.allowed() || !model.isCurrent()) return fail()
      if (requiresSelected && !selected().includes(ref)) return fail()
      await deps.saveConfirmation(ref, confirmationEvidence(model))
      // A removal that lands with the grant write must not leave a revoked
      // grant behind: recheck presence in the same step and withdraw instead.
      if (!requiresSelected || selected().includes(ref)) return
      await deps.saveConfirmation(ref, undefined)
      return fail()
    })()
    confirming.set(ref, pending)
    try {
      await pending
    } finally {
      confirming.delete(ref)
    }
  }
  const resolve = async (ref: string) => {
    if (!deps.allowed() || !selected().includes(ref)) return fail()
    const model = await resolveModel(ref)
    if (
      !model.isCurrent() ||
      (model.policy.pricing.kind !== 'priced' && model.policy.pricing.kind !== 'local')
    )
      return fail()
    limits(model)
    reasoningEffortFor(model, {})
    return model
  }
  const provider: EditorChatProvider = {
    async provideLanguageModelChatInformation(_options, token) {
      if (!deps.allowed() || isCancelled(token) || selected().length === 0) return []
      const rows: EditorChatInformation[] = []
      for (const ref of selected()) {
        try {
          const model = await resolve(ref)
          const bound = limits(model)
          rows.push({
            id: ref,
            name: ref,
            family: EDITOR_CHAT_VENDOR,
            version: '1',
            maxInputTokens: bound.input,
            maxOutputTokens: bound.output,
            capabilities: {
              toolCalling: model.policy.tools.calling.state === 'yes',
              imageInput: model.policy.input.images.state === 'yes',
            },
          })
        } catch (error) {
          // A removed/unpriced/stale entry is withdrawn, never offered optimistically.
          if (!(error instanceof EditorChatRefusalError)) throw error
        }
      }
      return isCancelled(token) ? [] : rows
    },
    async provideTokenCount(rawModel, input, token) {
      if (isCancelled(token)) return fail()
      await resolve(idSchema.parse(rawModel).id)
      const text = typeof input === 'string' ? input : JSON.stringify(messageSchema.parse(input))
      // Conservative offline bound; token counting must never purchase inference.
      return Buffer.byteLength(text, 'utf8')
    },
    async provideLanguageModelChatResponse(rawModel, messages, options, progress, token) {
      const ref = idSchema.parse(rawModel).id
      const model = await resolve(ref)
      const bound = limits(model)
      const body = bodyFor(
        model.ref,
        messages,
        options,
        bound.output,
        reasoningEffortFor(model, options),
        bound.input,
      )
      const images = body.input.reduce(
        (count, item) =>
          count +
          (item.type === 'message'
            ? item.content.filter((part) => part.type === 'input_image').length
            : 0),
        0,
      )
      if (images > 0 && model.policy.input.images.state !== 'yes') return fail()
      if (body.tools.length > 0 && model.policy.tools.calling.state !== 'yes') return fail()
      if (
        Buffer.byteLength(JSON.stringify(body), 'utf8') > bound.input ||
        token.isCancellationRequested
      )
        return fail()
      const worst = model.price.reserve({
        inputTokens: bound.input,
        outputTokens: bound.output,
        cacheWriteTokens: bound.input,
        images,
      })
      if (worst === undefined) return fail()
      await confirm(ref, model, true)
      if (!deps.allowed() || !selected().includes(ref) || !model.isCurrent()) return fail()
      if (!isConfirmed(ref, model)) return fail()
      const abort = new AbortController()
      active.add(abort)
      const subscription = token.onCancellationRequested(() => {
        abort.abort()
      })
      const timer = setTimeout(() => {
        abort.abort()
      }, MODEL_API_REQUEST_TIMEOUT_MS)
      const at = deps.now()
      const state = { isDispatched: false, isCompleted: false }
      let usage: Usage | undefined
      let outcome: 'completed' | 'incomplete' | 'failed' | 'cancelled' = 'failed'
      const guard = () => {
        abort.signal.throwIfAborted()
        if (!deps.allowed() || !selected().includes(ref) || !model.isCurrent()) return fail()
        if (!isConfirmed(ref, model)) return fail()
        if (state.isDispatched) return fail() // Automatic retries cannot spend twice.
      }
      guard.onRequestStarted = () => {
        guard()
        state.isDispatched = true
      }
      try {
        if (isCancelled(token)) abort.abort()
        guard()
        for await (const event of model.client.streamResponse(
          body,
          abort.signal,
          undefined,
          undefined,
          guard,
        )) {
          abort.signal.throwIfAborted()
          if (!deps.allowed() || !selected().includes(ref)) return fail()
          if (event.type === 'response.output_text.delta')
            progress.report(new vscode.LanguageModelTextPart(event.delta))
          else if (
            event.type === 'response.output_item.done' &&
            event.item.type === 'function_call' &&
            'call_id' in event.item
          ) {
            const value: unknown = JSON.parse(event.item.arguments)
            const input = z.record(z.string(), z.unknown()).parse(value)
            progress.report(
              new vscode.LanguageModelToolCallPart(event.item.call_id, event.item.name, input),
            )
          }
          if (event.type === 'response.completed' || event.type === 'response.incomplete') {
            usage = event.response.usage ?? undefined
            state.isCompleted = true
            outcome = event.type === 'response.incomplete' ? 'incomplete' : 'completed'
          } else if (event.type === 'response.failed' || event.type === 'error') return fail()
        }
        if (!state.isCompleted) return fail()
      } catch (error) {
        outcome = abort.signal.aborted ? 'cancelled' : 'failed'
        return fail(error)
      } finally {
        clearTimeout(timer)
        subscription.dispose()
        abort.abort()
        active.delete(abort)
        let actual: UsdAmount | undefined
        try {
          if (!state.isDispatched) actual = Usd.from(0).toAmount()
          else if (usage !== undefined && state.isCompleted)
            actual = model.price.settle(
              {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cachedTokens: usage.input_tokens_details?.cached_tokens,
                cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens,
                cacheWriteTokens1h: usage.input_tokens_details?.cache_write_tokens_1h,
                images,
              },
              usage.provider_cost_usd === undefined ? undefined : { cost: usage.provider_cost_usd },
            )
          // A settled cost past the worst case is not trusted: the tally
          // keeps the worst case as uncertain liability instead.
          if (actual === undefined || Usd.from(actual).compare(Usd.from(worst)) > 0) {
            actual = undefined
            if (state.isDispatched && state.isCompleted) outcome = 'failed'
          }
        } catch {
          // A failed pricing still gets a tally, with the worst case held
          // as uncertain liability.
          deps.log.warn('Editor chat pricing failed; the worst case is held as uncertain')
          actual = undefined
          outcome = 'failed'
        }
        if (state.isDispatched)
          deps.recording.note(usage, {
            provider: model.policy.identity.provider,
            startedAt: at,
            model: model.ref,
            backend: 'modelApi',
            kind: 'vscodeChat',
            durationMs: Math.max(0, deps.now() - at),
            outcome,
            pricing: model.policy.pricing,
            ...(images > 0 && { units: { images } }),
            providerCostUsd:
              usage?.provider_cost_usd === undefined
                ? undefined
                : Usd.from(usage.provider_cost_usd).toAmount(),
            uncertain: actual === undefined,
            retainedLiabilityUsd: actual === undefined ? worst : undefined,
          })
        if (outcome !== 'completed' && outcome !== 'incomplete') fail()
      }
    },
  }
  return {
    cancelAll: () => {
      for (const abort of active) abort.abort()
    },
    provider,
    async toggle(ref: string): Promise<void> {
      const refs = selected()
      if (refs.includes(ref)) {
        await deps.saveConfirmation(ref, undefined)
        await deps.saveSelected(refs.filter((value) => value !== ref))
        return
      }
      if (!deps.allowed()) return fail()
      await deps.saveConfirmation(ref, undefined)
      const model = await resolveModel(ref)
      const pricing = model.policy.pricing
      if (pricing.kind !== 'local' && pricing.kind !== 'priced') return fail()
      limits(model)
      reasoningEffortFor(model, {})
      try {
        await confirm(ref, model, false)
      } catch (error) {
        // A declined grant (or a raced removal) leaves the model unselected.
        if (!(error instanceof EditorChatRefusalError)) throw error
        return
      }
      if (!deps.allowed() || !model.isCurrent() || !isConfirmed(ref, model)) return fail()
      await deps.saveSelected([...new Set([...selected(), ref])])
    },
  }
}

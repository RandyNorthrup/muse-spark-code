// Stable provider API adapter (M95c part 2), loaded by the first opt-in action
// or editor model call. The 1.99 typings stay pinned for older supported hosts.
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { ModelResolver, ResolvedModel } from '../../core/backends/modelapi/modelPolicy'
import type { CreateResponseBody, InputItem, Usage } from '../../core/backends/modelapi/schemas'
import type { UsageRecording } from '../../core/usage/recording'
import type { TabLedger } from '../tab/tabLedger'
import { Usd, legacyUsdSchema, usdInputSchema, type UsdAmount } from '../../shared/usd'
import {
  EDITOR_CHAT_VENDOR,
  MAX_IMAGE_BYTES,
  MODEL_API_REQUEST_TIMEOUT_MS,
  TOKENS_PER_MILLION,
  EDITOR_CHAT_PROMPT_CACHE_RETENTION,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'

const selectedSchema = z.array(z.string().check(z.minLength(1)))
const textSchema = z.object({ value: z.string() })
const callSchema = z.object({
  callId: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
})
const resultSchema = z.object({ callId: z.string(), content: z.array(textSchema) })
const imageSchema = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z
    .instanceof(Uint8Array)
    .check(z.refine((value) => value.byteLength > 0 && value.byteLength <= MAX_IMAGE_BYTES)),
})
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
  readonly models: ModelResolver
  readonly ledger: TabLedger
  readonly recording: UsageRecording
  readonly selected: () => unknown
  readonly cap: () => unknown
  readonly allowed: () => boolean
  readonly now: () => number
  readonly saveSelected: (refs: readonly string[]) => Promise<void>
  readonly saveCap: (amount: UsdAmount) => Promise<void>
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

function fail(): never {
  throw new Error(UI_TEXT.editorChatRefused)
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
): CreateResponseBody {
  const parsed = messagesSchema.safeParse(messages)
  const opts = optionsSchema.safeParse(options)
  if (
    !parsed.success ||
    !opts.success ||
    (opts.data.toolMode !== undefined &&
      opts.data.toolMode !== vscode.LanguageModelChatToolMode.Auto) ||
    Object.keys(opts.data.modelOptions ?? {}).length > 0
  )
    return fail()
  const input: InputItem[] = []
  for (const message of parsed.data) {
    for (const part of message.content) {
      if ('data' in part) {
        if (message.role !== vscode.LanguageModelChatMessageRole.User) return fail()
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
        input.push({
          type: 'function_call_output',
          call_id: part.callId,
          output: part.content.map((text) => text.value).join('\n'),
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

export function createEditorChat(deps: EditorChatDeps) {
  const active = new Set<AbortController>()
  const resolveModel = async (ref: string) =>
    await deps.models.resolve(ref.startsWith('meta/') ? ref.slice('meta/'.length) : ref)
  const selected = () => selectedSchema.parse(deps.selected())
  const cap = () => {
    const value = legacyUsdSchema.safeParse(deps.cap())
    return !value.success || Usd.from(value.data).compare(Usd.from(0)) <= 0 ? fail() : value.data
  }
  const resolve = async (ref: string) => {
    if (!deps.allowed() || !selected().includes(ref)) return fail()
    cap()
    const model = await resolveModel(ref)
    if (
      !model.isCurrent() ||
      (model.policy.pricing.kind !== 'priced' && model.policy.pricing.kind !== 'local')
    )
      return fail()
    limits(model)
    return model
  }
  const provider: EditorChatProvider = {
    async provideLanguageModelChatInformation(_options, token) {
      if (!deps.allowed() || isCancelled(token) || selected().length === 0) return []
      cap()
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
        } catch {
          // A removed/unpriced/stale entry is withdrawn, never offered optimistically.
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
        model.policy.identity.provider === 'meta' ? 'minimal' : 'none',
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
      const admission = await deps.ledger.admit(worst, cap())
      if (!admission.admitted) return fail()
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
        if (Usd.from(admission.totalUsd).compare(Usd.from(cap())) > 0) return fail()
        if (state.isDispatched) return fail() // Automatic retries cannot spend a second reservation.
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
      } catch {
        outcome = abort.signal.aborted ? 'cancelled' : 'failed'
        return fail()
      } finally {
        clearTimeout(timer)
        subscription.dispose()
        abort.abort()
        active.delete(abort)
        let actual: UsdAmount | undefined
        try {
          if (!state.isDispatched) actual = Usd.from(0).toAmount()
          else if (usage !== undefined && state.isCompleted)
            actual = model.price.settle({
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cachedTokens: usage.input_tokens_details?.cached_tokens,
              cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens,
              cacheWriteTokens1h: usage.input_tokens_details?.cache_write_tokens_1h,
              images,
            })
          if (actual !== undefined && Usd.from(actual).compare(Usd.from(worst)) <= 0)
            await deps.ledger.settle(admission.reservation, actual)
          else actual = undefined
        } catch {
          // A failed settlement retains the durable reservation and still gets a tally.
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
        await deps.saveSelected(refs.filter((value) => value !== ref))
        return
      }
      if (!deps.allowed()) return fail()
      const originalCap = deps.cap()
      let budget = legacyUsdSchema.safeParse(originalCap).data
      if (budget === undefined || Usd.from(budget).compare(Usd.from(0)) <= 0) {
        const entered = await vscode.window.showInputBox({
          prompt: UI_TEXT.editorChatBudgetPrompt,
          validateInput: (value) => {
            const parsed = usdInputSchema.safeParse(value)
            return parsed.success && Usd.from(parsed.data).compare(Usd.from(0)) > 0
              ? undefined
              : UI_TEXT.editorChatBudgetPrompt
          },
        })
        if (entered === undefined) return
        budget = usdInputSchema.safeParse(entered).data
        if (budget === undefined || Usd.from(budget).compare(Usd.from(0)) <= 0) return fail()
      }
      const model = await resolveModel(ref)
      const pricing = model.policy.pricing
      if (pricing.kind !== 'local' && pricing.kind !== 'priced') return fail()
      limits(model)
      const rate =
        pricing.kind === 'local'
          ? UI_TEXT.modelLocal
          : fill(UI_TEXT.editorChatRates, {
              input: formatUsd(
                Usd.from(pricing.card.input).times(TOKENS_PER_MILLION).toAmount(),
                2,
              ),
              output: formatUsd(
                Usd.from(pricing.card.output).times(TOKENS_PER_MILLION).toAmount(),
                2,
              ),
            })
      const answer = await vscode.window.showWarningMessage(
        fill(UI_TEXT.editorChatConsent, { model: ref, rates: rate, cap: formatUsd(budget, 2) }),
        { modal: true },
        UI_TEXT.editorChatEnable,
      )
      if (answer !== UI_TEXT.editorChatEnable) return
      if (!deps.allowed() || !model.isCurrent() || deps.cap() !== originalCap) return fail()
      await deps.saveCap(budget)
      await deps.saveSelected([...new Set([...selected(), ref])])
    },
  }
}

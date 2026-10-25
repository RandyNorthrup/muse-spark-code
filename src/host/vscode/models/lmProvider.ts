// Stable provider API adapter (M95c part 2), loaded by the first opt-in action
// or editor model call. The 1.99 typings stay pinned for older supported hosts.
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { Logger } from '../../logger'
import type { ModelResolver, ResolvedModel } from '../../../core/backends/modelapi/modelPolicy'
import type { Usage } from '../../../core/backends/modelapi/schemas'
import { toEpochMs } from '../../../shared/epochMs'
import type { UsageRecording } from '../../../core/usage/recording'
import { Usd, type UsdAmount } from '../../../shared/usd'
import {
  EDITOR_CHAT_VENDOR,
  MODEL_API_REQUEST_TIMEOUT_MS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import {
  EditorChatRefusalError,
  editorChatBody,
  editorChatConfirmationEvidence,
  editorChatLimits,
  editorChatMessageSchema,
  editorChatRates,
  editorChatReasoningEffort,
  type EditorChatWireValues,
} from '../../../core/providers/editorChat'

const selectedSchema = z.array(z.string().check(z.minLength(1)))
const confirmationsSchema = z.record(z.string(), z.string())
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

/** The shared refusal (the class lives in core): only the fixed sentence reaches the person. */
function fail(cause?: unknown): never {
  throw new EditorChatRefusalError(cause)
}
export function createEditorChat(deps: EditorChatDeps) {
  const active = new Set<AbortController>()
  const confirming = new Map<string, Promise<void>>()
  // The editor's own values for the core conversion: the real enums.
  const wire: EditorChatWireValues = {
    userRole: vscode.LanguageModelChatMessageRole.User,
    assistantRole: vscode.LanguageModelChatMessageRole.Assistant,
    autoToolMode: vscode.LanguageModelChatToolMode.Auto,
    requiredToolMode: vscode.LanguageModelChatToolMode.Required,
  }
  const resolveModel = async (ref: string) =>
    await deps.models.resolve(ref.startsWith('meta/') ? ref.slice('meta/'.length) : ref)
  const selected = () => selectedSchema.parse(deps.selected())
  const isConfirmed = (ref: string, model: ResolvedModel) =>
    confirmationsSchema.safeParse(deps.confirmations()).data?.[ref] ===
    editorChatConfirmationEvidence(model)
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
          rates: editorChatRates(model),
        }),
        { modal: true },
        UI_TEXT.editorChatEnable,
      )
      if (answer !== UI_TEXT.editorChatEnable) return fail()
      if (!deps.allowed() || !model.isCurrent()) return fail()
      if (requiresSelected && !selected().includes(ref)) return fail()
      await deps.saveConfirmation(ref, editorChatConfirmationEvidence(model))
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
    editorChatLimits(model)
    editorChatReasoningEffort(model, {}, wire)
    return model
  }
  const provider: EditorChatProvider = {
    async provideLanguageModelChatInformation(_options, token) {
      if (!deps.allowed() || isCancelled(token) || selected().length === 0) return []
      const rows: EditorChatInformation[] = []
      for (const ref of selected()) {
        try {
          const model = await resolve(ref)
          const bound = editorChatLimits(model)
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
      const text =
        typeof input === 'string'
          ? input
          : JSON.stringify(editorChatMessageSchema(wire).parse(input))
      // Conservative offline bound; token counting must never purchase inference.
      return Buffer.byteLength(text, 'utf8')
    },
    async provideLanguageModelChatResponse(rawModel, messages, options, progress, token) {
      const ref = idSchema.parse(rawModel).id
      const model = await resolve(ref)
      const bound = editorChatLimits(model)
      const body = editorChatBody(
        model.ref,
        messages,
        options,
        bound.output,
        editorChatReasoningEffort(model, options, wire),
        bound.input,
        wire,
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
      const at = toEpochMs(deps.now())
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
      editorChatLimits(model)
      editorChatReasoningEffort(model, {}, wire)
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

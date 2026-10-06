function isPlanModel(model: string): boolean {
  return ['chatgpt', 'copilot'].includes(parseModelRef(model)?.providerId ?? '')
}
// M95b's subscription dispatch. Only the account catalogue chooses ChatGPT
// models; neither tokens nor service error text cross the host bridge.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { ProviderClient } from '../../backends/modelapi/client'
import {
  isFunctionCallItem,
  isMessageItem,
  isReasoningItem,
  messageText,
  type OutputItem,
  type StreamEvent,
  type Usage,
} from '../../backends/modelapi/schemas'
import {
  ChatgptPlanLimitError,
  createResponsesCodec,
  ResponsesOutputCapError,
} from '../../backends/modelapi/codecs/responses'
import {
  MODEL_API_REQUEST_TIMEOUT_MS,
  SUBSCRIPTION_STREAM_MAX_BYTES,
  UI_TEXT,
} from '../../../shared/constants'
import { parseModelRef } from '../modelRef'
import type { ProvidersFile } from '../providersFile'
import { type ChatGptSignIn, ChatGptSignInError, chatGptRecordSchema } from './chatgpt'
import { recordPlanUsage, type PlanUsageRow } from './planUsage'

// Owner captures acdc0f60 / 577bc807 (0 + 1 model attempts), 2026-10-05.
const catalogueSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string().check(z.minLength(1)),
      display_name: z.string(),
      visibility: z.enum(['list', 'hide']),
      supported_in_api: z.boolean(),
    }),
  ),
})
const MODELS_URL = 'https://api.openai.com/v1/models'
const RESPONSES_URL = 'https://api.openai.com/v1/responses'

export async function chatGptModels(
  signIn: ChatGptSignIn,
  fetcher: typeof fetch,
): Promise<string[]> {
  const token = await signIn.accessToken(MODELS_URL, MODEL_API_REQUEST_TIMEOUT_MS)
  const response = await fetcher(MODELS_URL, {
    redirect: 'error',
    signal: AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(UI_TEXT.acpChatGpt.failure)
  const value: unknown = await response.json()
  const parsed = catalogueSchema.safeParse(value)
  if (!parsed.success) throw new Error(UI_TEXT.acpChatGpt.failure)
  const models = parsed.data.models
    .filter((row) => row.visibility === 'list' && row.supported_in_api)
    .map((row) => row.slug)
  if (models.length === 0) throw new Error(UI_TEXT.acpChatGpt.failure)
  return [...new Set(models)]
}

export function chatGptAccountId(record: unknown): string | undefined {
  if (record === undefined) return undefined
  const parsed = chatGptRecordSchema.safeParse(record)
  if (!parsed.success) throw new Error(UI_TEXT.acpChatGpt.failure)
  return createHash('sha256').update(parsed.data.hostId).digest('hex')
}

/** Byte counts conservatively bound text tokens until a model tokenizer is available. */
function outputCounter(): (event: StreamEvent) => number {
  const counts = new Map<string, number>()
  const remember = (id: string, text: string) => {
    counts.set(id, Math.max(counts.get(id) ?? 0, Buffer.byteLength(text)))
  }
  return (event) => {
    if ('delta' in event) {
      counts.set(event.item_id, (counts.get(event.item_id) ?? 0) + Buffer.byteLength(event.delta))
    }
    const items: OutputItem[] = []
    if ('item' in event) items.push(event.item)
    else if ('response' in event) items.push(...event.response.output)
    for (const item of items) {
      let text = ''
      if (isFunctionCallItem(item)) text = item.arguments
      else if (isMessageItem(item)) text = messageText(item)
      else if (isReasoningItem(item)) text = (item.summary ?? []).map((part) => part.text).join('')
      remember(item.id ?? String(counts.size), text)
    }
    let total = 0
    for (const value of counts.values()) total += value
    return total
  }
}

export interface SubscriptionRegistryDeps {
  readonly fetch: typeof fetch
  readonly hasMetaKey?: () => Promise<boolean>
  readonly providers: () => Promise<ProvidersFile>
  readonly chatgpt: () => Promise<ChatGptSignIn>
  readonly accountId: () => Promise<string | undefined>
  readonly copilot?: () => ReadonlyMap<
    string,
    Pick<ProviderClient, 'streamResponse' | 'countInputTokens'> & {
      readonly model?: { readonly maxInputTokens: number }
    }
  >
  readonly loadUsage?: () => readonly PlanUsageRow[]
  readonly saveUsage?: (rows: readonly PlanUsageRow[]) => void
  readonly copilotUsage?: () => readonly PlanUsageRow[]
}

/** Routes the existing canonical tool loop; image extras still use the separate Meta key. */
export function createSubscriptionClient(
  meta: ProviderClient,
  deps: SubscriptionRegistryDeps,
): ProviderClient {
  let tallies = [...(deps.loadUsage?.() ?? [])]
  const configured = async (model: string) => {
    const ref = parseModelRef(model)
    const file = await deps.providers()
    const entries = file.providers
    const entry = entries.find((row) => row.id === ref?.providerId)
    if (ref === undefined || !entry?.models.includes(ref.modelId))
      throw new Error(UI_TEXT.acpChatGpt.failure)
    return ref
  }
  const client: ProviderClient = {
    isPlanModel,
    modelContextLimit: (model) => {
      const ref = parseModelRef(model)
      return ref?.providerId === 'copilot'
        ? deps.copilot?.().get(ref.modelId)?.model?.maxInputTokens
        : undefined
    },
    readPlanUsage: () =>
      deps.copilotUsage === undefined
        ? tallies
        : [...tallies.filter((row) => row.providerId !== 'copilot'), ...deps.copilotUsage()],
    currentKeyDigest: async () => {
      return (await deps.hasMetaKey?.()) === true
        ? await meta.currentKeyDigest()
        : ((await deps.accountId()) ?? (await meta.currentKeyDigest()))
    },
    retryDelayMs: (attempt) => meta.retryDelayMs(attempt),
    waitBeforeRetry: (ms, signal) => meta.waitBeforeRetry(ms, signal),
    createImage: (...args) => meta.createImage(...args),
    editImage: (...args) => meta.editImage(...args),
    listModels: async () => {
      const file = await deps.providers()
      const ids: string[] = []
      for (const entry of file.providers) {
        if (entry.id === 'chatgpt') {
          const available = await chatGptModels(await deps.chatgpt(), deps.fetch)
          ids.push(
            ...available.filter((id) => entry.models.includes(id)).map((id) => `chatgpt/${id}`),
          )
        } else if (entry.id === 'copilot') {
          ids.push(
            ...entry.models
              .filter((id) => deps.copilot?.().has(id) === true)
              .map((id) => `copilot/${id}`),
          )
        }
      }
      // A plan-only account makes no Meta request; keyed users keep both catalogues.
      if ((await deps.hasMetaKey?.()) === true) return [...(await meta.listModels()), ...ids]
      if (ids.length === 0 && file.providers.some((entry) => entry.auth === 'subscription')) {
        throw new Error(UI_TEXT.planUi.copilotUnavailable)
      }
      return ids.length > 0 ? ids : await meta.listModels()
    },
    countInputTokens: async (body) => {
      if (!isPlanModel(body.model)) return await meta.countInputTokens(body)
      const ref = await configured(body.model)
      if (ref.providerId === 'copilot') {
        const adapter = deps.copilot?.().get(ref.modelId)
        if (adapter === undefined) throw new Error(UI_TEXT.actionFailed)
        return await adapter.countInputTokens({ ...body, model: ref.modelId })
      }
      return Buffer.byteLength(JSON.stringify(body.input)) + Buffer.byteLength(body.instructions)
    },
    streamResponse: async function* (body, signal, onRetry, budget, admitAttempt, confirmed) {
      if (!isPlanModel(body.model)) {
        yield* meta.streamResponse(body, signal, onRetry, budget, admitAttempt, confirmed)
        return
      }
      const ref = await configured(body.model)
      let isDispatched = false
      let usage: Usage | undefined
      const note = (event: StreamEvent) => {
        if ('response' in event && event.response.usage != null) usage = event.response.usage
      }
      try {
        if (confirmed !== undefined) throw new Error(UI_TEXT.scheduleConfirmationExpired)
        if (ref.providerId === 'copilot') {
          const adapter = deps.copilot?.().get(ref.modelId)
          if (adapter === undefined) throw new Error(UI_TEXT.actionFailed)
          const guard = Object.assign(() => admitAttempt?.(undefined), {
            onRequestStarted: () => {
              isDispatched = true
              admitAttempt?.onRequestStarted?.()
            },
          })
          const stream = adapter.streamResponse(
            { ...body, model: ref.modelId },
            signal,
            onRetry,
            budget,
            guard,
          )
          for await (const event of stream) {
            note(event)
            yield event
          }
          return
        }
        const signIn = await deps.chatgpt()
        const token = await signIn.accessToken(RESPONSES_URL, MODEL_API_REQUEST_TIMEOUT_MS)
        const stop = new AbortController()
        const codec = createResponsesCodec({ profile: 'chatgpt', toolNamespace: 'functions' })
        const request = codec.encodeRequest({ ...body, model: ref.modelId })
        admitAttempt?.(await deps.accountId())
        if (signal.aborted) throw signal.reason
        admitAttempt?.onRequestStarted?.()
        isDispatched = true
        const response = await deps.fetch(RESPONSES_URL, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.any([
            signal,
            stop.signal,
            AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
          ]),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
        if (!response.ok || response.body === null) throw new Error(UI_TEXT.acpChatGpt.failure)
        // The captured endpoint streams SSE without Content-Type. Never branch on that header.
        const reader = response.body.getReader()
        async function* bytes() {
          let receivedBytes = 0
          try {
            for (;;) {
              const next = await reader.read()
              if (next.done) return
              const chunk = z.instanceof(Uint8Array).parse(next.value)
              receivedBytes += chunk.byteLength
              if (receivedBytes > SUBSCRIPTION_STREAM_MAX_BYTES)
                throw new Error(UI_TEXT.actionFailed)
              yield chunk
            }
          } finally {
            try {
              await reader.cancel()
            } catch {
              /* Preserve the stream failure during cancellation. */
            }
            reader.releaseLock()
          }
        }
        try {
          const stream = codec.decodeStream(bytes(), {
            outputCap: {
              maxOutputTokens: body.max_output_tokens,
              countOutputTokens: outputCounter(),
              abort: () => {
                stop.abort()
              },
            },
          })
          for await (const event of stream) {
            note(event)
            yield event
          }
        } catch (error) {
          if (error instanceof ChatgptPlanLimitError) {
            yield { type: 'error', code: error.code, message: UI_TEXT.planUi.limitDetail }
          } else if (error instanceof ResponsesOutputCapError) {
            usage = error.usage
            yield {
              type: 'response.failed',
              response: {
                id: 'client-output-cap',
                status: 'failed',
                output: [],
                ...(usage !== undefined && { usage }),
                error: { code: error.name, message: UI_TEXT.actionFailed },
              },
            }
          } else throw error
        }
      } catch (error) {
        if (signal.aborted) throw error
        if (ref.providerId === 'copilot' && error instanceof Error) {
          yield { type: 'error', message: error.message }
          return
        }
        const code = error instanceof ChatGptSignInError ? error.code : 'request-failed'
        let message = UI_TEXT.acpChatGpt.failure
        if (code === 'expired') message = UI_TEXT.planUi.expired
        else if (code === 'request-failed') message = UI_TEXT.planUi.retry
        yield {
          type: 'error',
          code: code === 'sign-in-required' ? 'invalid_api_key' : code,
          message,
        }
      } finally {
        if (isDispatched && (ref.providerId !== 'copilot' || deps.copilotUsage === undefined)) {
          tallies = recordPlanUsage(tallies, {
            providerId: ref.providerId,
            ...(usage !== undefined && {
              tokens: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                source: ref.providerId === 'copilot' ? 'estimated' : 'reported',
              },
            }),
          })
          deps.saveUsage?.(tallies)
        }
      }
    },
  }
  return client
}

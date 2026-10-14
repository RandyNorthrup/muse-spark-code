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
import { responses, modelRef, recordPlanUsage } from '../../../host/backend/providersEntry'
const { ChatgptPlanLimitError, createResponsesCodec, ResponsesOutputCapError } = responses
const { parseModelRef } = modelRef
import {
  CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
  MILLISECONDS_PER_SECOND,
  MODEL_API_REQUEST_TIMEOUT_MS,
  MODEL_API_STREAM_IDLE_MS,
  SUBSCRIPTION_STREAM_MAX_BYTES,
  UI_TEXT,
} from '../../../shared/constants'
import {
  assertConfirmedAllowed,
  isStaleConfirmedError,
  noteConfirmedRequestStarted,
} from '../../backends/modelapi/transport'
import { fill } from '../../../shared/l10n/text'
import { DeadlineError, withDeadline } from '../../timeouts'
import type { ProvidersFile } from '../providersFile'
import { type ChatGptSignIn, ChatGptSignInError, chatGptRecordSchema } from './chatgpt'
import {
  chatGptCatalogEntrySchema,
  chatGptPlanFacts,
  type ChatGptPlanFacts,
} from './chatgptPlanFacts'
import type { PlanUsageRow } from './planUsage'

// Owner captures acdc0f60 / 577bc807 (0 + 1 model attempts), 2026-10-05.
const catalogueSchema = z.object({ models: z.array(chatGptCatalogEntrySchema) })
const MODELS_URL = 'https://api.openai.com/v1/models'
const RESPONSES_URL = 'https://api.openai.com/v1/responses'

export interface ChatGptCatalog {
  readonly slugs: readonly string[]
  readonly facts: ReadonlyMap<string, ChatGptPlanFacts>
}

/**
 * The plan catalogue with each entry's capability facts. An entry that
 * fails the facts parse still lists by slug, without facts: listing never
 * loses a model to a field the app does not use.
 */
export async function chatGptCatalog(
  signIn: ChatGptSignIn,
  fetcher: typeof fetch,
): Promise<ChatGptCatalog> {
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
  const rows = parsed.data.models.filter((row) => row.visibility === 'list' && row.supported_in_api)
  const slugs = [...new Set(rows.map((row) => row.slug))]
  if (slugs.length === 0) throw new Error(UI_TEXT.acpChatGpt.failure)
  const facts = new Map<string, ChatGptPlanFacts>()
  for (const row of rows) {
    const parsedFacts = chatGptPlanFacts(row)
    if (parsedFacts !== undefined && !facts.has(row.slug)) facts.set(row.slug, parsedFacts)
  }
  return { slugs, facts }
}

export async function chatGptModels(
  signIn: ChatGptSignIn,
  fetcher: typeof fetch,
): Promise<string[]> {
  const catalog = await chatGptCatalog(signIn, fetcher)
  return [...catalog.slugs]
}

// The catalogue slug for one model reference. Bare ids read as slugs;
// a qualified foreign provider reads as undescribed, so plan facts are
// never fetched for a provider the catalogue does not describe.
function planSlug(model: string): string | undefined {
  const ref = parseModelRef(model)
  return ref === undefined || ref.providerId === 'chatgpt' ? (ref?.modelId ?? model) : undefined
}

function subscriptionRecord(record: unknown) {
  if (record === undefined) return
  let value: unknown = record
  try {
    if (typeof record === 'string') value = JSON.parse(record)
  } catch {
    throw new Error(UI_TEXT.acpChatGpt.failure)
  }
  const parsed = chatGptRecordSchema.safeParse(value)
  if (!parsed.success) throw new Error(UI_TEXT.acpChatGpt.failure)
  return parsed.data
}

export function chatGptAccountId(record: unknown): string | undefined {
  const parsed = subscriptionRecord(record)
  return parsed === undefined ? undefined : createHash('sha256').update(parsed.hostId).digest('hex')
}

export function chatGptPlanAccount(record: unknown) {
  const parsed = subscriptionRecord(record)
  return parsed?.accountIdHash === undefined || parsed.pendingRefresh !== undefined
    ? undefined
    : { providerId: 'chatgpt', accountIdHash: parsed.accountIdHash }
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
  /**
   * How long the ChatGPT stream may send nothing, headers or frames, before
   * it is ended (MODEL_API_STREAM_IDLE_MS when absent). It is the only time
   * limit on that stream: there is no limit on its total.
   */
  readonly streamIdleMs?: number
}

/** Routes the existing canonical tool loop; image extras still use the separate Meta key. */
export function createSubscriptionClient(
  meta: ProviderClient,
  deps: SubscriptionRegistryDeps,
): ProviderClient {
  let tallies = [...(deps.loadUsage?.() ?? [])]
  // The catalogue's per-model facts, refreshed by every model listing and
  // fetched on demand where a turn resolves before any listing ran. One
  // in-flight fetch is shared; a failed fetch leaves the cache cold so the
  // next read retries, and every read without facts keeps today's behaviour.
  let cachedFacts: ReadonlyMap<string, ChatGptPlanFacts> | undefined
  let inflightFacts: Promise<ReadonlyMap<string, ChatGptPlanFacts>> | undefined
  const readFacts = (): Promise<ReadonlyMap<string, ChatGptPlanFacts>> => {
    if (cachedFacts !== undefined) return Promise.resolve(cachedFacts)
    return (inflightFacts ??= (async () => {
      try {
        const catalog = await chatGptCatalog(await deps.chatgpt(), deps.fetch)
        cachedFacts = catalog.facts
        return cachedFacts
      } finally {
        inflightFacts = undefined
      }
    })())
  }
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
    hasPaidDailyBudget: meta.hasPaidDailyBudget,
    isPlanModel,
    modelContextLimit: (model) => {
      const ref = parseModelRef(model)
      // The catalogue's own window once a listing warmed the cache; cold
      // keeps today's undefined.
      return ref?.providerId === 'copilot'
        ? deps.copilot?.().get(ref.modelId)?.model?.maxInputTokens
        : cachedFacts?.get(planSlug(model) ?? model)?.contextTokens
    },
    planModelFacts: async (model: string) => {
      const slug = planSlug(model)
      if (slug === undefined) return
      const facts = await readFacts()
      return facts.get(slug)
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
          // Every listing refreshes the cached catalogue facts the plan
          // send path resolves from.
          const catalog = await chatGptCatalog(await deps.chatgpt(), deps.fetch)
          cachedFacts = catalog.facts
          ids.push(
            ...catalog.slugs.filter((id) => entry.models.includes(id)).map((id) => `chatgpt/${id}`),
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
        // A confirmed run may use a plan model: the hook model is the session
        // model, and reviews and scheduled prompts keep their confirmed one.
        // Like the other clients, proceed while still allowed and refuse with
        // the run's guidance only once the confirmation has lapsed.
        assertConfirmedAllowed(body.model, confirmed)
        if (ref.providerId === 'copilot') {
          const adapter = deps.copilot?.().get(ref.modelId)
          if (adapter === undefined) throw new Error(UI_TEXT.actionFailed)
          const account = await deps.accountId()
          const guard = Object.assign(() => admitAttempt?.(account), {
            onRequestStarted: () => {
              isDispatched = true
              noteConfirmedRequestStarted(confirmed, admitAttempt)
            },
          })
          const stream = adapter.streamResponse(
            { ...body, model: ref.modelId },
            signal,
            onRetry,
            budget,
            guard,
            // The adapter re-checks the gate around its own send; its start
            // callback stays inert so the guard above counts this paid use
            // once, like the hook and review entries.
            confirmed === undefined
              ? undefined
              : {
                  ...confirmed,
                  onRequestStarted: () => {
                    // The guard above counts this paid use once.
                  },
                },
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
        // No limit on the stream's total time. Silence ends it. The idle clock
        // starts with the request and restarts when the headers arrive and at
        // every event the codec decodes, as on the configured-provider path
        // (only a validated canonical event renews the deadline there). Bytes
        // that decode to no event, such as SSE comments and empty lines, do
        // not restart it, so keep-alive traffic cannot hold a reply open.
        const idleMs = deps.streamIdleMs ?? MODEL_API_STREAM_IDLE_MS
        let lastEventAt = Date.now()
        const withinIdle = async <T>(waiting: Promise<T>): Promise<T> => {
          try {
            return await withDeadline(
              waiting,
              Math.max(0, lastEventAt + idleMs - Date.now()),
              fill(UI_TEXT.modelApiStalled, {
                seconds: Math.round(idleMs / MILLISECONDS_PER_SECOND),
              }),
            )
          } catch (error) {
            if (error instanceof DeadlineError) stop.abort()
            throw error
          }
        }
        const codec = createResponsesCodec({
          profile: 'chatgpt',
          toolNamespace: 'functions',
          toolNamespaceDescription: CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
        })
        const request = codec.encodeRequest({ ...body, model: ref.modelId })
        admitAttempt?.(await deps.accountId())
        if (signal.aborted) throw signal.reason
        // A paid-gate lapse during sign-in still refuses: re-check the gate
        // immediately before the send, like the other clients.
        assertConfirmedAllowed(body.model, confirmed)
        noteConfirmedRequestStarted(confirmed, admitAttempt)
        isDispatched = true
        lastEventAt = Date.now()
        const response = await withinIdle(
          deps.fetch(RESPONSES_URL, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.any([signal, stop.signal]),
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          }),
        )
        lastEventAt = Date.now()
        if (!response.ok || response.body === null) throw new Error(UI_TEXT.acpChatGpt.failure)
        // The captured endpoint streams SSE without Content-Type. Never branch on that header.
        const reader = response.body.getReader()
        async function* bytes() {
          let receivedBytes = 0
          try {
            for (;;) {
              const next = await withinIdle(reader.read())
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
            lastEventAt = Date.now()
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
        // A lapsed confirmation names the run (hook, schedule, review) with
        // its own guidance instead of the generic plan retry sentence, on
        // both plan branches: the gate throws above, and an admission guard
        // may throw a stale-model refusal with the same strings.
        if (error instanceof Error && isStaleConfirmedError(error)) {
          yield { type: 'error', message: error.message }
          return
        }
        if (ref.providerId === 'copilot' && error instanceof Error) {
          yield { type: 'error', message: error.message }
          return
        }
        if (error instanceof DeadlineError) {
          // Only the ChatGPT idle limit above raises it: the user is told the stream went silent.
          yield { type: 'error', code: 'request-failed', message: error.message }
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

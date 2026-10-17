function isPlanModel(model: string): boolean {
  return ['chatgpt', 'copilot'].includes(parseModelRef(model)?.providerId ?? '')
}
// M95b's subscription dispatch. Only the account catalogue chooses ChatGPT
// models; neither tokens nor service error text cross the host bridge.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { ProviderClient } from '../../backends/modelapi/client'
import { errorBodySchema, type StreamEvent, type Usage } from '../../backends/modelapi/schemas'
import { responses, modelRef, recordPlanUsage } from '../../../host/backend/providersEntry'
const { ChatgptPlanLimitError, createResponsesCodec, ResponsesDecodeError } = responses
const { parseModelRef } = modelRef
import {
  CHATGPT_DIRECT_UNAVAILABLE_CODE,
  CHATGPT_PLAN_LIMIT_ERROR_KIND,
  CHATGPT_PLAN_NOT_ELIGIBLE_CODE,
  CHATGPT_PLAN_RETRYABLE_CODES,
  CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
  HTTP_TOO_MANY_REQUESTS,
  MILLISECONDS_PER_SECOND,
  MODEL_API_REQUEST_TIMEOUT_MS,
  MODEL_API_STREAM_IDLE_MS,
  PROVIDER_RETRY_HTTP_STATUS,
  UI_TEXT,
} from '../../../shared/constants'
import {
  assertConfirmedAllowed,
  isStaleConfirmedError,
  noteConfirmedRequestStarted,
  rateLimitHeaders,
  type ResponseAttemptGuard,
} from '../../backends/modelapi/transport'
import { fill } from '../../../shared/l10n/text'
import { DeadlineError, withDeadline } from '../../timeouts'
import { failureCodeNames } from '../../networkFailure'
import type { ProvidersFile } from '../providersFile'
import { type ChatGptSignIn, ChatGptSignInError, chatGptRecordSchema } from './chatgpt'
import type { ChatGptPlanFacts } from '../../backends/modelapi/planFacts'
import { chatGptCatalogEntrySchema, chatGptPlanFacts } from './chatgptPlanFacts'
import type { PlanUsageRow } from './planUsage'

// Owner captures acdc0f60 / 577bc807 (0 + 1 model attempts), 2026-10-05.
const catalogueSchema = z.object({ models: z.array(chatGptCatalogEntrySchema) })
const MODELS_URL = 'https://api.openai.com/v1/models'
const RESPONSES_URL = 'https://api.openai.com/v1/responses'

export interface ChatGptCatalog {
  readonly slugs: readonly string[]
  readonly facts: ReadonlyMap<string, ChatGptPlanFacts>
}

/** A refused answer named by its HTTP status and OpenAI's own code, never its text. */
async function refusalOf(response: Response): Promise<string> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const envelope = errorBodySchema.safeParse(body)
  const code = envelope.success ? envelope.data.error.code : undefined
  const status = `HTTP ${String(response.status)}`
  return code == null || code === '' ? status : `${status} ${code}`
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
  let response: Response
  try {
    response = await fetcher(MODELS_URL, {
      redirect: 'error',
      signal: AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    throw new ChatGptSignInError('request-failed', failureCodeNames(error))
  }
  if (!response.ok) throw new ChatGptSignInError('catalogue-refused', await refusalOf(response))
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new ChatGptSignInError('catalogue-unreadable')
  }
  const parsed = catalogueSchema.safeParse(value)
  if (!parsed.success) throw new ChatGptSignInError('catalogue-unreadable')
  const rows = parsed.data.models.filter((row) => row.visibility === 'list' && row.supported_in_api)
  const slugs = [...new Set(rows.map((row) => row.slug))]
  if (slugs.length === 0) throw new ChatGptSignInError('catalogue-empty')
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

/**
 * A non-OK answer from the plan route, handled as OpenAI's errors and
 * recovery page says (read 2026-10-17). `code` is OpenAI's own `error.code`
 * (or this app's name for the code-less direct-route 503), and the message
 * is what the person reads: OpenAI's own `error.message` or `detail` for a
 * refusal, never a header or a token. The usage limit is the plan-limit
 * answer; a 503 rides the turn's bounded retry with the credentials kept;
 * every other refusal is terminal and is never retried.
 */
class ChatgptPlanRequestError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
  }
}

/** A direct-route admission refusal before any Responses request: diagnostic text, no code. */
const directAdmissionSchema = z.object({ detail: z.string() })

/**
 * The one sentence for a failed ChatGPT sign-in, refresh, lock or catalogue
 * read, shared by the terminal and ACP commands, the Models panel, the
 * session's model listing and the plan stream's catch. Every code has its
 * own cause; none falls back to a general sentence. `reason` is the
 * operating system's code, OpenAI's error code, an HTTP status, Node's
 * network codes or this app's own word, never provider text.
 */
export function chatGptFailureText(code: ChatGptSignInError['code'], reason?: string): string {
  const named = reason ?? code
  switch (code) {
    case 'invalid-discovery': {
      return UI_TEXT.acpChatGpt.discoveryInvalid
    }
    case 'invalid-callback': {
      return UI_TEXT.acpChatGpt.callbackInvalid
    }
    case 'callback-timeout': {
      return UI_TEXT.acpChatGpt.callbackTimeout
    }
    case 'invalid-state': {
      return UI_TEXT.acpChatGpt.stateMismatch
    }
    case 'invalid-token': {
      return UI_TEXT.acpChatGpt.tokenAnswerInvalid
    }
    case 'invalid-id-token': {
      return UI_TEXT.acpChatGpt.idTokenInvalid
    }
    case 'missing-plan-scope': {
      return UI_TEXT.acpChatGpt.missingPlanScope
    }
    case 'origin-mismatch': {
      return UI_TEXT.acpChatGpt.originMismatch
    }
    case 'not-signed-in': {
      return UI_TEXT.acpChatGpt.states['signed-out']
    }
    case 'still-signed-in': {
      return UI_TEXT.acpChatGpt.states['signed-in']
    }
    case 'sign-in-required': {
      return fill(UI_TEXT.acpChatGpt.signInRefused, { reason: named })
    }
    case 'grant-unreadable': {
      return UI_TEXT.acpChatGpt.grantUnreadable
    }
    case 'registration-unreadable': {
      return UI_TEXT.acpChatGpt.registrationUnreadable
    }
    case 'host-id-unreadable': {
      return fill(UI_TEXT.acpChatGpt.hostIdUnreadable, { reason: named })
    }
    case 'catalogue-refused': {
      return fill(UI_TEXT.acpChatGpt.catalogueRefused, { reason: named })
    }
    case 'catalogue-unreadable': {
      return UI_TEXT.acpChatGpt.catalogueUnreadable
    }
    case 'catalogue-empty': {
      return UI_TEXT.acpChatGpt.catalogueEmpty
    }
    case 'added-models-unlisted': {
      return UI_TEXT.acpChatGpt.addedModelsUnlisted
    }
    case 'model-not-added': {
      return fill(UI_TEXT.acpChatGpt.modelNotAdded, { model: named })
    }
    case 'store-unavailable': {
      return UI_TEXT.acpChatGpt.storeUnavailable
    }
    case 'lock-unavailable': {
      return fill(UI_TEXT.acpChatGpt.lockUnavailable, { reason: reason ?? code })
    }
    case 'lock-busy': {
      return UI_TEXT.acpChatGpt.lockBusy
    }
    case 'cancelled': {
      return UI_TEXT.acpChatGpt.cancelled
    }
    case 'browser-unavailable': {
      return UI_TEXT.acpChatGpt.browserUnavailable
    }
    case 'local-failed': {
      return fill(UI_TEXT.acpChatGpt.localFailed, { reason: reason ?? code })
    }
    case 'providers-file-unreadable': {
      return fill(UI_TEXT.acpChatGpt.providersFileUnreadable, { reason: reason ?? code })
    }
    case 'providers-file-unwritable': {
      return fill(UI_TEXT.acpChatGpt.providersFileUnwritable, { reason: reason ?? code })
    }
    case 'already-added': {
      return UI_TEXT.acpChatGpt.alreadyAdded
    }
    case 'account-mismatch': {
      return UI_TEXT.acpChatGpt.accountMismatch
    }
    case 'client-refused': {
      return UI_TEXT.acpChatGpt.clientRefused
    }
    case 'authorize-refused': {
      return fill(UI_TEXT.acpChatGpt.authorizeRefused, { reason: reason ?? code })
    }
    case 'expired': {
      return UI_TEXT.planUi.expired
    }
    case 'request-failed': {
      // OpenAI or the network, named by status or Node's codes where known.
      return reason === undefined
        ? UI_TEXT.planUi.retry
        : fill(UI_TEXT.acpChatGpt.requestFailed, { reason })
    }
  }
}

async function planRequestError(response: Response): Promise<ChatgptPlanRequestError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const envelope = errorBodySchema.safeParse(body)
  const code = envelope.success ? (envelope.data.error.code ?? undefined) : undefined
  if (code === CHATGPT_PLAN_LIMIT_ERROR_KIND) {
    return new ChatgptPlanRequestError(UI_TEXT.planUi.limitDetail, code)
  }
  const isRetryCode = code !== undefined && CHATGPT_PLAN_RETRYABLE_CODES.includes(code)
  if (isRetryCode || response.status === PROVIDER_RETRY_HTTP_STATUS.serviceUnavailable) {
    return new ChatgptPlanRequestError(
      UI_TEXT.planUi.retry,
      isRetryCode ? code : CHATGPT_DIRECT_UNAVAILABLE_CODE,
    )
  }
  if (code === CHATGPT_PLAN_NOT_ELIGIBLE_CODE) {
    return new ChatgptPlanRequestError(UI_TEXT.planUi.notEligible, code)
  }
  const admission = directAdmissionSchema.safeParse(body)
  let detail = ''
  if (envelope.success) detail = envelope.data.error.message
  else if (admission.success) detail = admission.data.detail
  return new ChatgptPlanRequestError(
    detail === '' ? UI_TEXT.planUi.retry : fill(UI_TEXT.planUi.requestFailed, { message: detail }),
    code ?? 'request-failed',
  )
}

/**
 * What the plan route reports in its headers is kept as reported, through
 * the usage journal's allow list; nothing is read as a meter or a reset
 * time (OpenAI documents none for this route, and the 2026-10-05 capture
 * carries none). An observation failure never changes the request.
 */
function observePlanAnswer(guard: ResponseAttemptGuard | undefined, response: Response): void {
  try {
    guard?.observe?.({
      headers: rateLimitHeaders(response.headers),
      ...(!response.ok && { rateLimited: response.status === HTTP_TOO_MANY_REQUESTS }),
    })
  } catch {
    /* The journal's own refusal is not the plan request's. */
  }
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
    throw new ChatGptSignInError('grant-unreadable')
  }
  const parsed = chatGptRecordSchema.safeParse(value)
  if (!parsed.success) throw new ChatGptSignInError('grant-unreadable')
  return parsed.data
}

/**
 * A session's model listing and resolution say a ChatGPT failure in its own
 * sentence: the error a session shows is its message, and a sign-in error's
 * message is only its technical code.
 */
async function named<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ChatGptSignInError) {
      throw new Error(chatGptFailureText(error.code, error.reason), { cause: error })
    }
    throw error
  }
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
  /** The signed-in plans' model references; makes no Meta request. */
  const planModelIds = async (): Promise<string[]> => {
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
    return ids
  }
  const configured = async (model: string) => {
    const ref = parseModelRef(model)
    const file = await deps.providers()
    const entries = file.providers
    const entry = entries.find((row) => row.id === ref?.providerId)
    if (ref === undefined || !entry?.models.includes(ref.modelId))
      throw new ChatGptSignInError('model-not-added', model)
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
    planModelFacts: async (model: string) =>
      await named(async () => {
        const slug = planSlug(model)
        if (slug === undefined) return
        const facts = await readFacts()
        return facts.get(slug)
      }),
    readPlanUsage: () =>
      deps.copilotUsage === undefined
        ? tallies
        : [...tallies.filter((row) => row.providerId !== 'copilot'), ...deps.copilotUsage()],
    currentKeyDigest: async () =>
      await named(async () =>
        (await deps.hasMetaKey?.()) === true
          ? await meta.currentKeyDigest()
          : ((await deps.accountId()) ?? (await meta.currentKeyDigest())),
      ),
    retryDelayMs: (attempt) => meta.retryDelayMs(attempt),
    waitBeforeRetry: (ms, signal) => meta.waitBeforeRetry(ms, signal),
    createImage: (...args) => meta.createImage(...args),
    editImage: (...args) => meta.editImage(...args),
    listPlanModels: async () => await named(planModelIds),
    listModels: async () =>
      await named(async () => {
        const file = await deps.providers()
        const ids = await planModelIds()
        // A plan-only account makes no Meta request; keyed users keep both catalogues.
        if ((await deps.hasMetaKey?.()) === true) return [...(await meta.listModels()), ...ids]
        if (ids.length === 0 && file.providers.some((entry) => entry.id === 'chatgpt')) {
          // The plan answered, but none of the models added here is in its list now.
          throw new ChatGptSignInError('added-models-unlisted')
        }
        if (ids.length === 0 && file.providers.some((entry) => entry.auth === 'subscription')) {
          throw new Error(UI_TEXT.planUi.copilotUnavailable)
        }
        return ids.length > 0 ? ids : await meta.listModels()
      }),
    countInputTokens: async (body) =>
      await named(async () => {
        if (!isPlanModel(body.model)) return await meta.countInputTokens(body)
        const ref = await configured(body.model)
        if (ref.providerId === 'copilot') {
          const adapter = deps.copilot?.().get(ref.modelId)
          if (adapter === undefined) throw new Error(UI_TEXT.actionFailed)
          return await adapter.countInputTokens({ ...body, model: ref.modelId })
        }
        return Buffer.byteLength(JSON.stringify(body.input)) + Buffer.byteLength(body.instructions)
      }),
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
        observePlanAnswer(admitAttempt, response)
        if (!response.ok) throw await planRequestError(response)
        if (response.body === null) {
          throw new ChatgptPlanRequestError(UI_TEXT.planUi.noReply, 'request-failed')
        }
        // The captured endpoint streams SSE without Content-Type. Never branch on that header.
        // No size or output cap of this app's own: the plan route takes no
        // `max_output_tokens` (SIWC preview limitations), so the reply ends
        // where the model's own limit ends it.
        const reader = response.body.getReader()
        async function* bytes() {
          try {
            for (;;) {
              const next = await withinIdle(reader.read())
              if (next.done) return
              yield z.instanceof(Uint8Array).parse(next.value)
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
          for await (const event of codec.decodeStream(bytes())) {
            lastEventAt = Date.now()
            note(event)
            // A documented retry answer keeps OpenAI's code for the retry
            // notice; the person reads the standing retry sentence.
            yield event.type === 'error' &&
            event.code != null &&
            CHATGPT_PLAN_RETRYABLE_CODES.includes(event.code)
              ? { ...event, message: UI_TEXT.planUi.retry }
              : event
          }
        } catch (error) {
          if (error instanceof ChatgptPlanLimitError) {
            yield { type: 'error', code: error.code, message: UI_TEXT.planUi.limitDetail }
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
        if (error instanceof ChatgptPlanRequestError) {
          yield { type: 'error', code: error.code, message: error.message }
          return
        }
        // This app's own refusal to build the request (a tool it cannot
        // send) is said as that.
        if (error instanceof ResponsesDecodeError && error.isLocal) {
          yield {
            type: 'error',
            code: 'request-failed',
            message: fill(UI_TEXT.planUi.requestNotBuilt, { reason: error.reason }),
          }
          return
        }
        const signInCode = error instanceof ChatGptSignInError ? error.code : undefined
        const code = signInCode ?? 'request-failed'
        yield {
          type: 'error',
          code: code === 'sign-in-required' ? 'invalid_api_key' : code,
          // Anything untyped (the network, a malformed stream) is named by
          // its own codes, never as an unexplained outage.
          message: chatGptFailureText(
            code,
            error instanceof ChatGptSignInError ? error.reason : failureCodeNames(error),
          ),
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

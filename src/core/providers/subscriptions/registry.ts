function isPlanModel(model: string): boolean {
  return PLAN_MODEL_PROVIDERS.includes(parseModelRef(model)?.providerId ?? '')
}
// M95b's subscription dispatch. Only the account catalogue chooses ChatGPT
// models; neither tokens nor service error text cross the host bridge.
import { createHash } from 'node:crypto'
import { isUserRefusal } from '../../refusal'
import * as z from 'zod/mini'
import type { ProviderClient } from '../../backends/modelapi/client'
import { errorBodySchema, type StreamEvent, type Usage } from '../../backends/modelapi/schemas'
import {
  responses,
  modelRef,
  recordPlanUsage,
  parsePlanLimitHeaders,
  planRefusals,
} from '../../../host/backend/providersEntry'
import { PLAN_MODEL_PROVIDERS } from '../../../shared/providerRouting'
// RVCM1054D P2: the typed refusal comes from the leaf module, never the
// codec bundle — the subscriptions bundle must not carry
// src/core/backends/modelapi/codecs/* (they load only in dist/providers.js).
import { isChatCodecError } from '../../media/codecRefusal'
const { ChatgptPlanRefusalError, ResponsesDecodeError } = responses
const { parseModelRef } = modelRef
import { USAGE_HEADER_ALLOW_LIST } from '../../../shared/usageJournal'
// The limit windows and refusal sentences ride the providers bundle (D6):
// the subscriptions bundle requires them across the seam, like the codec.
import type { PlanLimits } from './planUsage'

/** Response header names the plan route may keep, as a set for lookup. */
const PLAN_HEADER_NAMES: ReadonlySet<string> = new Set<string>(USAGE_HEADER_ALLOW_LIST)
import {
  CHATGPT_DIRECT_UNAVAILABLE_CODE,
  CHATGPT_PLAN_LIMIT_ERROR_KIND,
  CHATGPT_PLAN_NOT_ELIGIBLE_CODE,
  CHATGPT_PLAN_RETRYABLE_CODES,
  CHATGPT_TOKEN_MIN_VALIDITY_MS,
  CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
  GROK_TOKEN_MIN_VALIDITY_MS,
  HTTP_TOO_MANY_REQUESTS,
  INDUSTRY_RETRY_MAX_RETRIES,
  MILLISECONDS_PER_SECOND,
  PROVIDER_RETRY_HTTP_STATUS,
  STILL_WAITING_NOTICE_MS,
  UI_TEXT,
} from '../../../shared/constants'
import {
  assertConfirmedAllowed,
  isStaleConfirmedError,
  noteConfirmedRequestStarted,
  rateLimitHeaders,
  whenAborted,
  type ResponseAttemptGuard,
} from '../../backends/modelapi/transport'
import { fill } from '../../../shared/l10n/text'
import {
  DeadlineError,
  startStillWaiting,
  stillWaitingText,
  withDeadline,
  type StillWaitingSubject,
} from '../../timeouts'
import type { CoreLogger } from '../../logging'
import { failureCodeNames } from '../../networkFailure'
import type { ProvidersFile } from '../providersFile'
import type { ChatGptSignIn } from './chatgpt'
import type { GrokSignIn } from './grok'
// The sign-in cores stay in dist/subscriptions.js; the registry reads them
// through subscriptionsEntry (one `instanceof` across the boundary), exactly
// like providersEntry above.
import {
  ChatGptSignInError,
  CopilotFailureError,
  GrokSignInError,
  chatGptRecordSchema,
  grokRecordSchema,
} from '../../../host/backend/subscriptionsEntry'
import type { ChatGptPlanFacts } from '../../backends/modelapi/planFacts'
import { chatGptPlanFacts } from './chatgptPlanFacts'
import type { PlanUsageRow } from './planUsage'

// Owner captures acdc0f60 / 577bc807 (0 + 1 model attempts), 2026-10-05.
const catalogueRowSchema = z.looseObject({
  slug: z.string().check(z.minLength(1)),
  visibility: z.enum(['list', 'hide']),
  supported_in_api: z.boolean(),
})
// The outer array carries only rows: one entry with a capability field this
// build cannot parse (a `service_tiers` entry without a description) must
// not fail the whole listing. Rows parse minimally here; capability facts
// parse per row in `chatGptCatalog`, so that model still lists by slug,
// without facts.
const catalogueSchema = z.object({ models: z.array(z.unknown()) })
const MODELS_URL = 'https://api.openai.com/v1/models'
const RESPONSES_URL = 'https://api.openai.com/v1/responses'
// The xAI Responses API (research: HERMES; the product's `xai` API-key
// preset sends the Responses wire shape to this origin).
const GROK_RESPONSES_URL = 'https://api.x.ai/v1/responses'

export interface ChatGptCatalog {
  readonly slugs: readonly string[]
  readonly facts: ReadonlyMap<string, ChatGptPlanFacts>
}

/** The answer's JSON body, or undefined when it is not JSON at all. */
async function jsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    // Only a body that is not JSON stays unread; anything else is not the
    // body and reaches the caller.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

/**
xAI's own refusal envelope, beside OpenAI's: `{code, error}` with the
sentence in `error` (real-life captures 2026-10-13,
`test/fixtures/provider-refusals/xai/unknown-model.json` and
`bad-key.json`: a 404 for an unknown model, a 400 for a wrong key).
*/
const xaiRefusalSchema = z.looseObject({ code: z.string(), error: z.string() })

/** A refused answer named by its HTTP status and the provider's own code, never its text. */
async function refusalOf(response: Response): Promise<string> {
  const body = await jsonBody(response)
  const status = `HTTP ${String(response.status)}`
  // xAI's envelope first: the OpenAI codec also reads a string `error`,
  // but drops xAI's sibling `code`.
  const xai = xaiRefusalSchema.safeParse(body)
  if (xai.success && xai.data.code !== '') return `${status} ${xai.data.code}`
  const envelope = errorBodySchema.safeParse(body)
  return envelope.success && envelope.data.error.code != null && envelope.data.error.code !== ''
    ? `${status} ${envelope.data.error.code}`
    : status
}

/**
The plan catalogue with each entry's capability facts. An entry that
fails the facts parse still lists by slug, without facts: listing never
loses a model to a field the app does not use.
*/
export async function chatGptCatalog(
  signIn: Pick<ChatGptSignIn, 'accessToken'>,
  fetcher: typeof fetch,
): Promise<ChatGptCatalog> {
  const token = await signIn.accessToken(MODELS_URL, CHATGPT_TOKEN_MIN_VALIDITY_MS)
  let response: Response
  try {
    // No deadline of our own (owner 2026-10-16): the catalogue read ends at
    // the provider's answer or a network failure.
    response = await fetcher(MODELS_URL, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    throw new ChatGptSignInError('request-failed', failureCodeNames(error))
  }
  if (!response.ok) throw new ChatGptSignInError('catalogue-refused', await refusalOf(response))
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    // Only a body that is not JSON reads unreadable; anything else is not
    // the body and reaches the caller.
    if (!(error instanceof SyntaxError)) throw error
    throw new ChatGptSignInError('catalogue-unreadable')
  }
  const parsed = catalogueSchema.safeParse(value)
  if (!parsed.success) throw new ChatGptSignInError('catalogue-unreadable')
  // A row without the listing fields cannot list; a row with them but with
  // unparseable capability fields still lists by slug, without facts.
  const rows: { readonly slug: string; readonly entry: unknown }[] = []
  for (const row of parsed.data.models) {
    const listing = catalogueRowSchema.safeParse(row)
    if (!listing.success || listing.data.visibility !== 'list' || !listing.data.supported_in_api)
      continue
    rows.push({ slug: listing.data.slug, entry: row })
  }
  const slugs = [...new Set(rows.map((row) => row.slug))]
  if (slugs.length === 0) throw new ChatGptSignInError('catalogue-empty')
  const facts = new Map<string, ChatGptPlanFacts>()
  for (const row of rows) {
    const parsedFacts = chatGptPlanFacts(row.entry)
    if (parsedFacts !== undefined && !facts.has(row.slug)) facts.set(row.slug, parsedFacts)
  }
  return { slugs, facts }
}

export async function chatGptModels(
  signIn: Pick<ChatGptSignIn, 'accessToken'>,
  fetcher: typeof fetch,
): Promise<string[]> {
  const catalog = await chatGptCatalog(signIn, fetcher)
  return [...catalog.slugs]
}

// The model list shape is the captured one (`{data: [{id,
// context_length, ...}]}`, `docs/certification/m95-captures/xai/01-models-list.json`,
// key auth 2026-10-04; the product's `xai` preset lists the same path).
// A subscription answer in any other shape reads unreadable rather than
// guessed; the first live sign-in pins it.
const GROK_MODELS_URL = 'https://api.x.ai/v1/models'
const grokCatalogueSchema = z.object({ data: z.array(z.unknown()) })
const grokCatalogueRowSchema = z.looseObject({
  id: z.string().check(z.minLength(1)),
  context_length: z.optional(z.number().check(z.nonnegative())),
})

export interface GrokCatalog {
  readonly slugs: readonly string[]
  /** The rows' own context windows where the list names them. */
  readonly windows: ReadonlyMap<string, number | undefined>
}

/**
The subscription's model slugs with each row's own context window. Rows
parse minimally: a row without an id cannot list, and a list in any
other shape reads unreadable rather than guessed.
*/
export async function grokCatalog(
  signIn: Pick<GrokSignIn, 'accessToken'>,
  fetcher: typeof fetch,
): Promise<GrokCatalog> {
  const token = await signIn.accessToken(GROK_MODELS_URL, GROK_TOKEN_MIN_VALIDITY_MS)
  let response: Response
  try {
    // No deadline of our own (owner 2026-10-16): the catalogue read ends at
    // the provider's answer or a network failure.
    response = await fetcher(GROK_MODELS_URL, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    throw new GrokSignInError('request-failed', failureCodeNames(error), { cause: error })
  }
  if (!response.ok) throw new GrokSignInError('catalogue-refused', await refusalOf(response))
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    // Only a body that is not JSON reads unreadable; anything else is not
    // the body and reaches the caller.
    if (!(error instanceof SyntaxError)) throw error
    throw new GrokSignInError('catalogue-unreadable')
  }
  const parsed = grokCatalogueSchema.safeParse(value)
  if (!parsed.success) throw new GrokSignInError('catalogue-unreadable')
  const windows = new Map<string, number | undefined>()
  const slugs: string[] = []
  for (const row of parsed.data.data) {
    const listing = grokCatalogueRowSchema.safeParse(row)
    if (!listing.success || windows.has(listing.data.id)) continue
    windows.set(listing.data.id, listing.data.context_length)
    slugs.push(listing.data.id)
  }
  if (slugs.length === 0) throw new GrokSignInError('catalogue-empty')
  return { slugs, windows }
}

export async function grokModels(
  signIn: Pick<GrokSignIn, 'accessToken'>,
  fetcher: typeof fetch,
): Promise<string[]> {
  const catalog = await grokCatalog(signIn, fetcher)
  return [...catalog.slugs]
}

/**
A non-OK answer from the plan route, handled as OpenAI's errors and
recovery page says (read 2026-10-17). `code` is OpenAI's own `error.code`
(or this app's name for the code-less direct-route 503), and the message
is what the person reads: OpenAI's own `error.message` or `detail` for a
refusal, never a header or a token. The usage limit is the plan-limit
answer; a 503 rides the turn's bounded retry with the credentials kept;
every other refusal is terminal and is never retried.
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
A refused plan answer's own words: the error envelope's message, else
xAI's refusal sentence, else an admission detail, else the HTTP status.
Both plan legs read refusals this way; only ChatGPT names limit,
retryable and eligibility codes of its own on top.
*/
async function refusalWords(response: Response): Promise<{
  readonly message: string
  readonly code: string | undefined
  /** The envelope's `error.param` (OPENAI-G27), a technical name. */
  readonly param: string | undefined
}> {
  const body = await jsonBody(response)
  // xAI's envelope first: the OpenAI codec also reads a string `error`,
  // but drops xAI's sibling `code`.
  const xai = xaiRefusalSchema.safeParse(body)
  if (xai.success && xai.data.error !== '')
    return { message: xai.data.error, code: xai.data.code, param: undefined }
  const envelope = errorBodySchema.safeParse(body)
  const code = envelope.success ? (envelope.data.error.code ?? undefined) : undefined
  const param = envelope.success ? (envelope.data.error.param ?? undefined) : undefined
  if (envelope.success && envelope.data.error.message !== '')
    return { message: envelope.data.error.message, code, param }
  const admission = directAdmissionSchema.safeParse(body)
  return {
    message:
      admission.success && admission.data.detail !== ''
        ? admission.data.detail
        : `HTTP ${String(response.status)}`,
    code,
    param,
  }
}

/**
The one sentence for a failed ChatGPT sign-in, refresh, lock or catalogue
read, shared by the terminal and ACP commands, the Models panel, the
session's model listing and the plan stream's catch. Every code has its
own cause; none falls back to a general sentence. `reason` is the
operating system's code, OpenAI's error code, an HTTP status, Node's
network codes or this app's own word, never provider text.
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

/**
The one sentence for a failed Grok sign-in, refresh, lock or catalogue
read, shared by the terminal and ACP commands, the Models panel, the
session's model listing and the plan stream's catch. Every code has its
own cause; none falls back to a general sentence. `reason` is the
operating system's code, xAI's error code, an HTTP status, Node's
network codes or this app's own word, never provider text.
*/
export function grokFailureText(code: GrokSignInError['code'], reason?: string): string {
  const named = reason ?? code
  switch (code) {
    case 'client-id-unset': {
      return UI_TEXT.acpGrok.clientIdUnset
    }
    case 'invalid-discovery': {
      return UI_TEXT.acpGrok.discoveryInvalid
    }
    case 'invalid-callback': {
      return UI_TEXT.acpGrok.callbackInvalid
    }
    case 'callback-timeout': {
      return UI_TEXT.acpGrok.callbackTimeout
    }
    case 'invalid-state': {
      return UI_TEXT.acpGrok.stateMismatch
    }
    case 'invalid-token': {
      return UI_TEXT.acpGrok.tokenAnswerInvalid
    }
    case 'invalid-id-token': {
      return UI_TEXT.acpGrok.idTokenInvalid
    }
    case 'scope-refused': {
      return UI_TEXT.acpGrok.scopeRefused
    }
    case 'origin-mismatch': {
      return UI_TEXT.acpGrok.originMismatch
    }
    case 'device-expired': {
      return UI_TEXT.acpGrok.deviceExpired
    }
    case 'device-denied': {
      return UI_TEXT.acpGrok.deviceDenied
    }
    case 'device-refused': {
      return fill(UI_TEXT.acpGrok.deviceRefused, { reason: reason ?? code })
    }
    case 'verification-refused': {
      return UI_TEXT.acpGrok.verificationRefused
    }
    case 'not-signed-in': {
      return UI_TEXT.acpGrok.states['signed-out']
    }
    case 'still-signed-in': {
      return UI_TEXT.acpGrok.states['signed-in']
    }
    case 'sign-in-required': {
      return fill(UI_TEXT.acpGrok.signInRefused, { reason: named })
    }
    case 'expired': {
      return UI_TEXT.acpGrok.expired
    }
    case 'grant-unreadable': {
      return UI_TEXT.acpGrok.grantUnreadable
    }
    case 'store-unavailable': {
      return UI_TEXT.acpGrok.storeUnavailable
    }
    case 'lock-unavailable': {
      return fill(UI_TEXT.acpGrok.lockUnavailable, { reason: reason ?? code })
    }
    case 'lock-busy': {
      return UI_TEXT.acpGrok.lockBusy
    }
    case 'cancelled': {
      return UI_TEXT.acpGrok.cancelled
    }
    case 'browser-unavailable': {
      return UI_TEXT.acpGrok.browserUnavailable
    }
    case 'local-failed': {
      return fill(UI_TEXT.acpGrok.localFailed, { reason: reason ?? code })
    }
    case 'providers-file-unreadable': {
      return fill(UI_TEXT.acpGrok.providersFileUnreadable, { reason: reason ?? code })
    }
    case 'providers-file-unwritable': {
      return fill(UI_TEXT.acpGrok.providersFileUnwritable, { reason: reason ?? code })
    }
    case 'already-added': {
      return UI_TEXT.acpGrok.alreadyAdded
    }
    case 'catalogue-refused': {
      return fill(UI_TEXT.acpGrok.catalogueRefused, { reason: named })
    }
    case 'catalogue-unreadable': {
      return UI_TEXT.acpGrok.catalogueUnreadable
    }
    case 'catalogue-empty': {
      return UI_TEXT.acpGrok.catalogueEmpty
    }
    case 'added-models-unlisted': {
      return UI_TEXT.acpGrok.addedModelsUnlisted
    }
    case 'model-not-added': {
      return fill(UI_TEXT.acpGrok.modelNotAdded, { model: named })
    }
    case 'authorize-refused': {
      return fill(UI_TEXT.acpGrok.authorizeRefused, { reason: reason ?? code })
    }
    case 'request-failed': {
      // xAI or the network, named by status or Node's codes where known.
      return reason === undefined
        ? UI_TEXT.planUi.retry
        : fill(UI_TEXT.acpGrok.requestFailed, { reason })
    }
  }
}

/**
The sentence for a refused plan answer, from a real `Response`: OpenAI's
own error message or admission detail where it sent one, the HTTP status
where it sent none, and the standing retry sentence only for the
documented transient (503 / retryable code).
*/
export async function planRequestError(response: Response): Promise<ChatgptPlanRequestError> {
  const { message, code, param } = await refusalWords(response)
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
  // OPENAI-G27: the provider's further documented refusals each read as
  // their own sentence. Limit, retryable and not-eligible answers keep
  // their own sentences above; an unknown code keeps the provider's own
  // words below.
  if (code !== undefined) {
    const sentence = planRefusals.planRefusalMessage(code, undefined, param)
    if (sentence !== undefined) return new ChatgptPlanRequestError(sentence, code)
  }
  return new ChatgptPlanRequestError(
    fill(UI_TEXT.planUi.requestFailed, { message }),
    code ?? 'request-failed',
  )
}

class GrokPlanRequestError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
  }
}

/**
The sentence for a refused xAI answer, from a real `Response`: xAI's
own error message where it sent one, else the HTTP status. xAI
documents no plan-limit, retryable or eligibility codes of its own, so
none is named here: every refusal is terminal and is never retried by
this leg.
*/
export async function grokPlanRequestError(response: Response): Promise<GrokPlanRequestError> {
  const { message, code = 'request-failed' } = await refusalWords(response)
  return new GrokPlanRequestError(fill(UI_TEXT.planUi.requestFailed, { message }), code)
}

/**
What the plan route reports in its headers is kept as reported, through
the usage journal's allow list; nothing is read as a meter or a reset
time (OpenAI documents none for this route, and the 2026-10-05 capture
carries none). An observation failure never changes the request.
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
/**
The shared codec-refusal verdict, read as a boolean: the predicate's
false branch would narrow the plan catch's later checks to never.
*/
function isCodecRefused(cause: unknown): boolean {
  return isChatCodecError(cause)
}
function planSlug(model: string): string | undefined {
  const ref = parseModelRef(model)
  return ref === undefined || ref.providerId === 'chatgpt' ? (ref?.modelId ?? model) : undefined
}

function parsedGrant<T>(
  record: unknown,
  schema: z.ZodMiniType<T>,
  unreadable: () => Error,
): T | undefined {
  if (record === undefined) return undefined
  let value: unknown = record
  try {
    if (typeof record === 'string') value = JSON.parse(record)
  } catch (error) {
    // Only malformed stored text reads unreadable; anything else is not
    // the grant and reaches the caller.
    if (!(error instanceof SyntaxError)) throw error
    throw unreadable()
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw unreadable()
  return parsed.data
}

function subscriptionRecord(record: unknown) {
  return parsedGrant(record, chatGptRecordSchema, () => new ChatGptSignInError('grant-unreadable'))
}

function parseGrokGrant(record: unknown) {
  return parsedGrant(record, grokRecordSchema, () => new GrokSignInError('grant-unreadable'))
}

/**
A session's model listing and resolution say a ChatGPT failure in its own
sentence: the error a session shows is its message, and a sign-in error's
message is only its technical code.
*/
async function named<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ChatGptSignInError) {
      throw new Error(chatGptFailureText(error.code, error.reason), { cause: error })
    }
    if (error instanceof GrokSignInError) {
      throw new Error(grokFailureText(error.code, error.reason), { cause: error })
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

export function grokAccountId(record: unknown): string | undefined {
  return parseGrokGrant(record)?.accountIdHash
}

export function grokPlanAccount(record: unknown) {
  const parsed = parseGrokGrant(record)
  return parsed?.accountIdHash === undefined || parsed.pendingRefresh !== undefined
    ? undefined
    : { providerId: 'grok', accountIdHash: parsed.accountIdHash }
}

/** One Responses plan leg's provider-specific pieces; the send skeleton is shared. */
export interface ResponsesLeg {
  /** A fresh access token for the send URL, refreshed where the grant allows. */
  token(): Promise<string>
  readonly sendUrl: string
  codec(): ReturnType<typeof responses.createResponsesCodec>
  /** A refused answer's typed error, from the real Response. */
  refusal(response: Response): Promise<Error>
  /** The refused-answer error class, matched in the catch. */
  readonly refusalError: new (message: string, code: string) => Error & { readonly code: string }
  /** An empty success body never carries a reply. */
  noReply(): Error
  /** Mid-stream error codes the leg retries with the standing sentence. */
  readonly retryableCodes: readonly string[]
  /** Whether the decode failure is this leg's usage-limit error. */
  isLimitError(error: unknown): boolean
  /** The limit error's code and sentence; read only where `isLimitError` holds. */
  limitDetail(error: unknown): { readonly code: string; readonly message: string }
  /** This leg's sign-in failure as code and sentence, or undefined for foreign errors. */
  signInFailure(error: unknown): { readonly code: string; readonly message: string } | undefined
  /** A foreign failure's sentence, named by the caller's codes. */
  foreignFailure(reason: string): string
}

export interface SubscriptionRegistryDeps {
  readonly fetch: typeof fetch
  readonly hasMetaKey?: () => Promise<boolean>
  readonly providers: () => Promise<ProvidersFile>
  readonly chatgpt: () => Promise<Pick<ChatGptSignIn, 'accessToken'>>
  /** Absent on hosts without Grok support; a Grok entry there refuses as unwired. */
  readonly grok?: () => Promise<Pick<GrokSignIn, 'accessToken'>>
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
  Lane PR225W1: the person's `museSpark.modelApiMaxRetries` setting, read
  live. The plan routes document no retry maximum, so with none set their
  limit is undefined. Headless passes none (unset).
  */
  readonly personCap?: () => number | undefined
  /**
  How long the ChatGPT stream may send nothing, headers or frames, before
  it is ended; absent, the stream ends at Stop, never at an invented kill
  (owner 2026-10-16). It is the only time limit on that stream: there is
  no limit on its total.
  */
  readonly streamIdleMs?: number
  /**
  Where indefinite stream waits say so (PR #214 review): without a
  provider-named idle nothing else ends the silence, so the wait would
  otherwise look hung until Stop. Unnamed, the branch stays silent.
  */
  readonly log?: CoreLogger
}

/**
Periodic still-waiting notices for an indefinite provider wait (PR #214
review): each notice restarts the silence clock, as the transport does
for its own streams. A named log with a provider-named idle, or no log
at all, notices nothing — the idle ends silence itself.
*/
export function silentWaitNotices(
  log: CoreLogger | undefined,
  idleMs: number | undefined,
  everyMs: number = STILL_WAITING_NOTICE_MS,
): {
  notice(subject: StillWaitingSubject): void
  stop(): void
} {
  let stopNoticing: (() => void) | undefined
  return {
    notice(subject: StillWaitingSubject): void {
      stopNoticing?.()
      stopNoticing = undefined
      if (log === undefined || idleMs !== undefined) return
      stopNoticing = startStillWaiting((elapsedMs) => {
        log.info(stillWaitingText(subject, elapsedMs))
      }, everyMs)
    },
    stop(): void {
      stopNoticing?.()
      stopNoticing = undefined
    },
  }
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
  let cachedGrokWindows: ReadonlyMap<string, number | undefined> | undefined
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
  const chatGptLeg: ResponsesLeg = {
    token: async () => {
      const signIn = await deps.chatgpt()
      return await signIn.accessToken(RESPONSES_URL, CHATGPT_TOKEN_MIN_VALIDITY_MS)
    },
    sendUrl: RESPONSES_URL,
    codec: () =>
      responses.createResponsesCodec({
        profile: 'chatgpt',
        toolNamespace: 'functions',
        toolNamespaceDescription: CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
      }),
    refusal: planRequestError,
    refusalError: ChatgptPlanRequestError,
    noReply: () => new ChatgptPlanRequestError(UI_TEXT.planUi.noReply, 'request-failed'),
    retryableCodes: CHATGPT_PLAN_RETRYABLE_CODES,
    isLimitError: (error) => error instanceof ChatgptPlanRefusalError,
    limitDetail: (error) =>
      error instanceof ChatgptPlanRefusalError
        ? {
            code: error.code,
            message: planRefusals.planRefusalMessage(error.code, error.message) ?? error.message,
          }
        : { code: 'request-failed', message: UI_TEXT.planUi.retry },
    signInFailure: (error) =>
      error instanceof ChatGptSignInError
        ? { code: error.code, message: chatGptFailureText(error.code, error.reason) }
        : undefined,
    foreignFailure: (reason) => chatGptFailureText('request-failed', reason),
  }
  /** A Grok signer, or the unwired-host refusal where the host has none. */
  const grokSigner = async (): Promise<Pick<GrokSignIn, 'accessToken'>> => {
    if (deps.grok === undefined) throw new GrokSignInError('local-failed', 'signer-unavailable')
    return await deps.grok()
  }
  const grokLeg: ResponsesLeg = {
    token: async () => {
      const signIn = await grokSigner()
      return await signIn.accessToken(GROK_RESPONSES_URL, GROK_TOKEN_MIN_VALIDITY_MS)
    },
    sendUrl: GROK_RESPONSES_URL,
    // The default API profile: xAI takes the standard Responses fields,
    // and prompt-cache keying is automatic server-side, so no cache fields
    // are sent.
    codec: () =>
      responses.createResponsesCodec({
        sendPromptCacheKey: false,
        sendPromptCacheRetention: false,
      }),
    refusal: grokPlanRequestError,
    refusalError: GrokPlanRequestError,
    noReply: () => new GrokPlanRequestError(UI_TEXT.planUi.noReply, 'request-failed'),
    // xAI documents no retryable plan codes and no limit sentence of its
    // own: refusals surface with xAI's own words, terminally.
    retryableCodes: [],
    isLimitError: () => false,
    limitDetail: () => {
      // Never read: this leg's `isLimitError` never holds.
      return { code: 'request-failed', message: UI_TEXT.planUi.retry }
    },
    signInFailure: (error) =>
      error instanceof GrokSignInError
        ? { code: error.code, message: grokFailureText(error.code, error.reason) }
        : undefined,
    foreignFailure: (reason) => grokFailureText('request-failed', reason),
  }
  /** The signed-in plans' model references; makes no Meta request. */
  const planModelIds = async (): Promise<string[]> => {
    const file = await deps.providers()
    const ids: string[] = []
    const listEntry = async (entry: ProvidersFile['providers'][number]): Promise<void> => {
      switch (entry.id) {
        case 'chatgpt': {
          // Every listing refreshes the cached catalogue facts the plan
          // send path resolves from.
          const catalog = await chatGptCatalog(await deps.chatgpt(), deps.fetch)
          cachedFacts = catalog.facts
          ids.push(
            ...catalog.slugs.filter((id) => entry.models.includes(id)).map((id) => `chatgpt/${id}`),
          )
          break
        }
        case 'grok': {
          // Every listing refreshes the cached windows the Grok
          // context-limit read resolves from.
          const catalog = await grokCatalog(await grokSigner(), deps.fetch)
          cachedGrokWindows = catalog.windows
          ids.push(
            ...catalog.slugs.filter((id) => entry.models.includes(id)).map((id) => `grok/${id}`),
          )
          break
        }
        case 'copilot': {
          ids.push(
            ...entry.models
              .filter((id) => deps.copilot?.().has(id) === true)
              .map((id) => `copilot/${id}`),
          )
          break
        }
        default: {
          break
        }
      }
    }
    for (const entry of file.providers) {
      await listEntry(entry)
    }
    return ids
  }
  const configured = async (model: string) => {
    const ref = parseModelRef(model)
    const file = await deps.providers()
    const entries = file.providers
    const entry = entries.find((row) => row.id === ref?.providerId)
    if (ref === undefined || !entry?.models.includes(ref.modelId)) {
      if (ref?.providerId === 'grok') throw new GrokSignInError('model-not-added', model)
      throw new ChatGptSignInError('model-not-added', model)
    }
    return ref
  }
  // Production media (D85.2): the Files transport rides to Meta untouched;
  // a subscription client without it keeps the established refusal.
  const filesTransport = meta.requestFile?.bind(meta)
  const transcription = meta.requestTranscription?.bind(meta)
  const client: ProviderClient = {
    ...(meta.withAccountKey !== undefined && {
      withAccountKey: (apiKey, isCurrent) => {
        const selected = meta.withAccountKey?.(apiKey, isCurrent)
        if (selected === undefined) throw new Error(UI_TEXT.accounts.unavailable)
        return selected
      },
    }),
    hasPaidDailyBudget: meta.hasPaidDailyBudget,
    ...(filesTransport !== undefined && { requestFile: filesTransport }),
    ...(transcription !== undefined && { requestTranscription: transcription }),
    isPlanModel,
    modelContextLimit: (model) => {
      const ref = parseModelRef(model)
      // The catalogue's own window once a listing warmed the cache; cold
      // keeps today's undefined.
      if (ref?.providerId === 'grok') return cachedGrokWindows?.get(ref.modelId)
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
    // Lane PR225W1: each subscription route answers its own retry limit.
    // Neither plan route documents a maximum (provider-refusals.md
    // lane RETRYLIMITS), so a plan model reads the person's setting when
    // set and the industry-standard default otherwise (D228); off-plan
    // models are Meta's own.
    maxRetries: (model) =>
      model !== undefined && !isPlanModel(model)
        ? meta.maxRetries()
        : (deps.personCap?.() ?? INDUSTRY_RETRY_MAX_RETRIES),
    personCap: () => deps.personCap?.(),
    createImage: (...args) => meta.createImage(...args),
    editImage: (...args) => meta.editImage(...args),
    listPlanModels: async () => await named(planModelIds),
    listModels: async (signal) =>
      await named(async () => {
        const file = await deps.providers()
        const ids = await planModelIds()
        // A plan-only account makes no Meta request; keyed users keep both catalogues.
        if ((await deps.hasMetaKey?.()) === true)
          return [...(await meta.listModels(signal)), ...ids]
        if (ids.length === 0 && file.providers.some((entry) => entry.id === 'chatgpt')) {
          // The plan answered, but none of the models added here is in its list now.
          throw new ChatGptSignInError('added-models-unlisted')
        }
        if (ids.length === 0 && file.providers.some((entry) => entry.id === 'grok')) {
          // The subscription answered, but none of the models added here is in its list now.
          throw new GrokSignInError('added-models-unlisted')
        }
        if (ids.length === 0 && file.providers.some((entry) => entry.auth === 'subscription')) {
          throw new Error(UI_TEXT.planUi.copilotUnavailable)
        }
        return ids.length > 0 ? ids : await meta.listModels(signal)
      }),
    countInputTokens: async (body, signal) =>
      await named(async () => {
        if (!isPlanModel(body.model)) return await meta.countInputTokens(body, signal)
        const ref = await configured(body.model)
        if (ref.providerId === 'copilot') {
          const adapter = deps.copilot?.().get(ref.modelId)
          // The adapter is VS Code's Language Model API
          // (src/host/providers/copilotClient.ts), injected only by editor
          // hosts: a host without it cannot reach the Copilot grant at all.
          if (adapter === undefined) throw new Error(UI_TEXT.planUi.copilotHostGrant)
          return await adapter.countInputTokens({ ...body, model: ref.modelId }, signal)
        }
        return Buffer.byteLength(JSON.stringify(body.input)) + Buffer.byteLength(body.instructions)
      }),
    streamResponse: async function* (body, signal, onRetry, budget, admitAttempt, confirmed) {
      if (!isPlanModel(body.model)) {
        yield* meta.streamResponse(body, signal, onRetry, budget, admitAttempt, confirmed)
        return
      }
      const ref = await configured(body.model)
      // The Copilot branch below returns before any leg runs, so it keeps
      // the ChatGPT leg: the catch reads exactly as it always has for it.
      const leg = ref.providerId === 'grok' ? grokLeg : chatGptLeg
      // Declared at function scope (PR #214 review): the Responses section's
      // finally below stops the notices, and a declaration inside the try
      // is not visible there on every path the generator can take.
      const idleMs = deps.streamIdleMs
      const notices = silentWaitNotices(deps.log, idleMs)
      let isDispatched = false
      let usage: Usage | undefined
      let limits: PlanLimits | undefined
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
          // Same unreachable grant as above: name VS Code, never a key. Typed
          // so the catch below yields the grant's own words (D207), never the
          // ChatGPT failure text, before the throw keeps its kind.
          if (adapter === undefined) throw new CopilotFailureError(UI_TEXT.planUi.copilotHostGrant)
          const account = await deps.accountId()
          const guard = Object.assign(() => admitAttempt?.(account), {
            ...admitAttempt,
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
        const token = await leg.token()
        const stop = new AbortController()
        // No limit on the stream's total time (owner 2026-10-16). A provider
        // that names its own idle through `streamIdleMs` still ends silence
        // at it, as on the configured-provider path; otherwise the wait ends
        // at Stop, never at an invented kill. The idle clock starts with the
        // request and restarts when the headers arrive and at every event the
        // codec decodes. Bytes that decode to no event, such as SSE comments
        // and empty lines, do not restart it, so keep-alive traffic cannot
        // hold a reply open past a named idle.
        // An unnamed wait says so out loud (PR #214 review): the provider
        // answer while the send is out, the reply between its bytes after.
        let lastEventAt = Date.now()
        const withinIdle = async <T>(waiting: Promise<T>): Promise<T> => {
          if (idleMs === undefined) {
            const aborted = whenAborted(stop.signal)
            try {
              return await Promise.race([waiting, aborted.promise])
            } finally {
              aborted.dispose()
            }
          }
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
        const codec = leg.codec()
        const request = codec.encodeRequest({ ...body, model: ref.modelId })
        const account = await deps.accountId()
        await admitAttempt?.prepare?.()
        admitAttempt?.(account)
        if (signal.aborted) throw signal.reason
        // Stop ends an unnamed wait: without a named idle nothing else would.
        signal.addEventListener(
          'abort',
          () => {
            stop.abort()
          },
          { once: true },
        )
        // A paid-gate lapse during sign-in still refuses: re-check the gate
        // immediately before the send, like the other clients.
        assertConfirmedAllowed(body.model, confirmed)
        noteConfirmedRequestStarted(confirmed, admitAttempt)
        isDispatched = true
        lastEventAt = Date.now()
        notices.notice({ key: 'providerAnswer' })
        const response = await withinIdle(
          deps.fetch(leg.sendUrl, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.any([signal, stop.signal]),
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          }),
        )
        lastEventAt = Date.now()
        notices.notice({ key: 'modelReply' })
        observePlanAnswer(admitAttempt, response)
        // The error body reads under the stream-idle deadline too: headers
        // that arrive with a stalled body end the turn instead of hanging it
        // past cancellation, like a silent stream.
        if (!response.ok) throw await withinIdle(leg.refusal(response))
        if (response.body === null) {
          throw leg.noReply()
        }
        // OPENAI-G28: the plan's limit headers ride on the inference
        // response. Only allow-listed names are kept; the parser reads the
        // x-codex-* windows out of them (only ChatGPT's leg sends any).
        const reported: Record<string, string> = {}
        response.headers.forEach((value, name) => {
          if (PLAN_HEADER_NAMES.has(name)) reported[name] = value
        })
        limits = parsePlanLimitHeaders(reported, Date.now()) ?? limits
        // Stream SSE without branching on Content-Type: the captured
        // ChatGPT endpoint omits it. No size or output cap of this app's
        // own: each leg's codec decides the wire fields (the ChatGPT
        // profile sends no `max_output_tokens`: SIWC preview limitations),
        // so the reply ends where the model's own limit ends it.
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
            notices.notice({ key: 'modelReply' })
            note(event)
            // A documented retry answer keeps the provider's code for the
            // retry notice; the person reads the standing retry sentence.
            yield event.type === 'error' &&
            event.code != null &&
            leg.retryableCodes.includes(event.code)
              ? { ...event, message: UI_TEXT.planUi.retry }
              : event
          }
        } catch (error) {
          if (!leg.isLimitError(error)) throw error
          const limit = leg.limitDetail(error)
          yield { type: 'error', code: limit.code, message: limit.message }
        }
      } catch (error) {
        if (isUserRefusal(error) || signal.aborted) throw error
        // Anything that is not an error keeps its kind past this boundary:
        // the fixed retry sentence below must never stand in for it.
        if (!(error instanceof Error)) throw error
        // M105 lane V R3 (RVCM1054B P2): a typed codec refusal (a held
        // video with no vendor capture) reaches the user as its own
        // sentence on every plan leg, never the generic retry text. One
        // shared helper decides; this client keeps no list of its own.
        if (isCodecRefused(error)) {
          deps.log?.info('a plan response ended in a codec refusal or a lapsed confirmation')
          yield { type: 'error', message: error.message }
          return
        }
        // A lapsed confirmation names the run (hook, schedule, review) with
        // its own guidance instead of the generic plan retry sentence, on
        // every plan leg: the gate throws above, and an admission guard
        // may throw a stale-model refusal with the same strings.
        if (isStaleConfirmedError(error)) {
          // A failed turn leaves one fixed line in the product log; the
          // person reads the error's own sentence below.
          deps.log?.info('a plan response ended in a codec refusal or a lapsed confirmation')
          yield { type: 'error', message: error.message }
          return
        }
        if (ref.providerId === 'copilot' && error instanceof CopilotFailureError) {
          yield { type: 'error', message: error.message }
          return
        }
        if (error instanceof DeadlineError) {
          // Only a leg's idle limit above raises it: the user is told the stream went silent.
          yield { type: 'error', code: 'request-failed', message: error.message }
          return
        }
        if (error instanceof leg.refusalError) {
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
        const signIn = leg.signInFailure(error)
        const code = signIn?.code ?? 'request-failed'
        yield {
          type: 'error',
          code: code === 'sign-in-required' ? 'invalid_api_key' : code,
          // Anything untyped (the network, a malformed stream) is named by
          // its own codes, never as an unexplained outage.
          message: signIn?.message ?? leg.foreignFailure(failureCodeNames(error)),
        }
        // Anything else keeps its kind past this boundary, like the sibling
        // clients' streams: the fixed retry sentence must never stand in
        // for a failure it does not describe (PLAN.md D207).
        throw error
      } finally {
        notices.stop()
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
            ...(limits !== undefined && { limits }),
          })
          deps.saveUsage?.(tallies)
        }
      }
    },
  }
  return client
}

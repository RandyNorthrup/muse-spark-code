// Shared configured-provider transport. Hosts supply their own secret store;
// every send rechecks configuration, credential origin and pinned DNS answers.
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { request as httpRequest } from 'node:http'
import { request as httpsGet } from 'node:https'
import { isIP } from 'node:net'
import * as z from 'zod/mini'
import {
  anthropic,
  capabilities,
  chat,
  endpointPolicy,
  gemini,
  modelMetadata,
  modelRef,
  ollama,
  presets,
  pkce,
  priceCard,
  providersFile,
  responses,
  tokenCount,
  createProviderRegistry,
  recordPlanUsage,
  metaResolvedModel,
} from '../../host/backend/providersEntry'
import {
  outputTokenMinimumMessage,
  providerOutputMinimum,
  pruneModelLimits,
} from '../../shared/providerRouting'
import { pinnedHttpsRequest, pinnedPostRequest } from '../../host/backend/modelApiEntry'
import type { PinnedResponse, PinnedTarget } from '../web/webFetch'
import type { ProviderClient } from '../backends/modelapi/client'
import type { CreateResponseBody, StreamEvent, Usage } from '../backends/modelapi/schemas'
import type { ProviderEntry, ProviderFormat } from './providersFile'
import type { RegistryModel } from './providerRegistry'
import { providersFileUnreadable } from '../accountStoreError'
import type { ModelCapabilityRecord } from './capabilityRecord'
import type { NativeModelMetadata } from './modelMetadata'
import { parseNdjson } from '../backends/modelapi/ndjson'
import { parseSse } from '../backends/modelapi/sse'
import { ApiKeyAuthSource, NoAuthSource } from '../backends/modelapi/authSource'
import { CodecClient, type WireCodec } from '../backends/modelapi/providerClient'
import {
  RequestTransport,
  abortableSleep,
  parseJsonResponse,
  readBoundedText,
  ModelApiError,
  assertConfirmedAllowed,
  isModelApiError,
} from '../backends/modelapi/transport'
import { isUserRefusal, UserRefusalError } from '../refusal'
import {
  anthropicPacingLimits,
  openaiPacingLimits,
  xaiPacingLimits,
  type PacingLimits,
} from '../backends/modelapi/pacing'

/**
The rate-limit header reader for a preset (PROVM95): each provider's own
header names with their real meaning, from the 2026-10-04 captures.
Presets whose providers send no limit headers get none, so only a 429
pause applies; Groq's per-day scope, xAI's per-second scope and
DeepSeek's concurrency need a capture that names them.
*/
function pacingReaderFor(
  presetId: string,
): ((headers: Headers) => PacingLimits | undefined) | undefined {
  switch (presetId.replace('-plan', '')) {
    case 'openai':
    case 'groq': {
      return openaiPacingLimits
    }
    case 'xai': {
      return xaiPacingLimits
    }
    case 'anthropic': {
      return anthropicPacingLimits
    }
    default: {
      return undefined
    }
  }
}
import {
  boundProviderMessage,
  isRefusalRetryable,
  parseRefusalError,
  refusalOf,
  refusalSentence,
} from '../backends/modelapi/providerRefusal'
import { isConnectionFailure, networkFailureCodes } from '../networkFailure'
import type { CoreLogger } from '../logging'
import { withDeadline, unlessAborted } from '../timeouts'
import { Usd, type UsdAmount } from '../../shared/usd'
import { fill } from '../../shared/l10n/text'
import {
  ADDRESS_FAMILIES,
  ANTHROPIC_MAX_ARGUMENT_BYTES,
  ANTHROPIC_MAX_FRAME_BYTES,
  ANTHROPIC_MAX_ITEMS,
  EFFORT_PROVIDER_DEFAULT,
  MANUAL_THINKING_BUDGET_BY_EFFORT,
  PROVIDER_CONNECTION_LOST_CODE,
  PROVIDER_MANUAL_THINKING_BUDGET,
  PROVIDER_SECRET_PREFIX,
  SUBSCRIPTION_STREAM_MAX_BYTES,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../shared/constants'
import { isEffortLevel } from '../../shared/effort'
import { hasUsableEffortLevels } from '../backends/modelapi/modelPolicy'

export interface ConfiguredProviderOptions {
  readonly configFile: string
  readonly catalogFile: string
  readonly secrets: { get(key: string): PromiseLike<string | undefined> }
  readonly hasMetaKey?: () => Promise<boolean>
  readonly loadUsage?: () => ReturnType<typeof recordPlanUsage>
  readonly saveUsage?: (rows: ReturnType<typeof recordPlanUsage>) => void
  readonly resolve?: (host: string) => Promise<readonly string[]>
  readonly send?: (
    target: PinnedTarget,
    body: string | undefined,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ) => Promise<PinnedResponse>
  /**
  How long an inference stream may send nothing, headers or frames,
  before it is ended; absent, the stream ends at Stop, never at an
  invented kill (owner 2026-10-16). It is the only time limit on an
  inference stream: there is no limit on its total.
  */
  readonly streamIdleMs?: number
  /**
  Where the transport's notices go (PR #214 review): without one its
  still-waiting notices during an indefinite stream wait reach the
  no-op logger below and the request looks hung until Stop. Per-request
  timing still never reaches a log, named or not.
  */
  readonly log?: CoreLogger
  /**
  Lane RETRYLIMITS: the person's `museSpark.modelApiMaxRetries` setting,
  read live so a change applies without a restart. Set, it caps every
  configured provider's retries; unset, each preset's documented maximum
  governs, and a preset that documents none retries until the provider's
  own wait or stop answer ends it.
  */
  readonly personCap?: () => number | undefined
}
const secretSchema = z.object({
  v: z.literal(1),
  auth: z.literal('apiKey'),
  origin: z.string(),
  secret: z.string().check(z.minLength(1)),
})
const catalogSchema = z.object({
  unpriced: z.optional(
    z.record(z.string(), z.record(z.string(), modelMetadata.nativeModelMetadataSchema)),
  ),
  fetchedAt: z.optional(z.string()),
  providers: z.record(
    z.string(),
    z.object({ models: z.record(z.string(), modelMetadata.nativeModelMetadataSchema) }),
  ),
})
const costRates = {
  input: z.number().check(z.nonnegative()),
  output: z.number().check(z.nonnegative()),
  cache_read: z.optional(z.number().check(z.nonnegative())),
  cache_write: z.optional(z.number().check(z.nonnegative())),
}
const costSchema = z.object({
  ...costRates,
  tiers: z.optional(
    z.array(
      z.object({
        ...costRates,
        tier: z.object({ type: z.literal('context'), size: z.int().check(z.minimum(1)) }),
      }),
    ),
  ),
})
// GET /api/v1/key: m95-captures/openrouter/02-key-usage.json (2026-10-04).
/**
An exact decimal the response tokenizer minted. A class instance, never a
plain object: response JSON parses to plain objects only, so no wire
shape can forge one (a `{"decimal": "1e101"}` object is refused below).
*/
class ExactDecimal {
  public constructor(public readonly decimal: string) {}
}
/** Exponents past this bound never become an amount, on any path. */
const EXACT_DECIMAL_MAX_EXPONENT = 100
function exactDecimalToAmount(value: ExactDecimal) {
  const exponent = Number(value.decimal.split(/[eE]/, 2)[1] ?? 0)
  // A forged or out-of-range amount reaches `openRouterUsage`'s catch, which
  // reports the usage read as failed (lane PROVERRORS: no generic panel error).
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > EXACT_DECIMAL_MAX_EXPONENT)
    throw new Error(UI_TEXT.providerUsageFailed)
  const amount = Usd.from(value.decimal).toAmount()
  // Usage amounts are non-negative exact decimals on every field (RVCM952D):
  // a negative vendor amount is refused, never reported as success.
  if (amount.startsWith('-')) throw new Error(UI_TEXT.providerUsageFailed)
  return amount
}
const keyDollars = z.pipe(z.instanceof(ExactDecimal), z.transform(exactDecimalToAmount))
/**
Replaces per-call tokenizer markers with their minted amounts. A
marker-shaped wire string cannot match the call's nonce, so it survives
as a string and the usage schema refuses it.
*/
function materializeExactDecimals(value: unknown, nonce: string): unknown {
  const prefix = `exact-decimal:${nonce}:`
  if (typeof value === 'string')
    return value.startsWith(prefix) ? new ExactDecimal(value.slice(prefix.length)) : value
  if (Array.isArray(value)) return value.map((item) => materializeExactDecimals(item, nonce))
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries(value))
      out[name] = materializeExactDecimals(entry, nonce)
    return out
  }
  return value
}
const openRouterUsageSchema = z.object({
  data: z.object({
    usage: keyDollars,
    usage_daily: keyDollars,
    usage_weekly: keyDollars,
    usage_monthly: keyDollars,
    limit: z.nullable(keyDollars),
    limit_remaining: z.nullable(keyDollars),
  }),
})
// Public PKCE documentation, read 2026-10-11; live exchange receipt pending CM952.
const openRouterExchangeSchema = z.object({ key: z.string().check(z.minLength(1)) })
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
/**
A provider entry the services cannot use, as a closed cause (round 2,
finding 6): every cause a person can meet gets its own translated
sentence, with technical values (ids, origins, paths) as slots and no
English prose inside; a cause only a programming error can reach is one
defect sentence. Typed, with no HTTP status, so the `streamResponse` catch
below keeps its words instead of the generic error, and the ledger (which
only releases answered refusals) leaves it uncertain.
*/
type InvalidEntryCause =
  | { readonly kind: 'unknownPreset'; readonly preset: string }
  | { readonly kind: 'unsupportedAuth'; readonly auth: string }
  | { readonly kind: 'missingAddress' }
  | { readonly kind: 'storedKeyMissing' }
  | { readonly kind: 'unusableModelsEntry'; readonly model: string }
  | { readonly kind: 'contextWindowUnset'; readonly model: string }
  | { readonly kind: 'addressMismatch'; readonly address: string }
  | { readonly kind: 'changedDuringRequest' }
  | { readonly kind: 'defect'; readonly detail: string }
const invalidEntry = (entry: ProviderEntry, cause: InvalidEntryCause): ModelApiError => {
  switch (cause.kind) {
    case 'unknownPreset': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderUnknownPreset, {
          entry: entry.id,
          preset: cause.preset,
        }),
        0,
        undefined,
        undefined,
      )
    }
    case 'unsupportedAuth': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderUnsupportedAuth, { entry: entry.id, auth: cause.auth }),
        0,
        undefined,
        undefined,
      )
    }
    case 'missingAddress': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderMissingAddress, { entry: entry.id }),
        0,
        undefined,
        undefined,
      )
    }
    case 'storedKeyMissing': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderStoredKeyMissing, { entry: entry.id }),
        0,
        undefined,
        undefined,
      )
    }
    case 'unusableModelsEntry': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderUnusableModelsEntry, {
          entry: entry.id,
          model: cause.model,
        }),
        0,
        undefined,
        undefined,
      )
    }
    case 'contextWindowUnset': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderContextWindowUnset, { model: cause.model }),
        0,
        undefined,
        undefined,
      )
    }
    case 'addressMismatch': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderAddress, { entry: entry.id, address: cause.address }),
        0,
        undefined,
        undefined,
      )
    }
    case 'changedDuringRequest': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderChangedDuringRequest, { entry: entry.id }),
        0,
        undefined,
        undefined,
      )
    }
    case 'defect': {
      return new ModelApiError(
        fill(UI_TEXT.configuredProviderDefect, { entry: entry.id, detail: cause.detail }),
        0,
        undefined,
        undefined,
      )
    }
  }
}
/** The name a refusal sentence shows: the provider's own label, or the entry
id for a user's own server. */
const providerDisplayName = (
  entry: ProviderEntry,
  preset: { readonly label: string; readonly category: string },
): string => (preset.category === 'custom' || preset.category === 'local' ? entry.id : preset.label)
/** Chat Completions, Responses, every chat-format quirk and the
ChatGPT-plan and Copilot routes share one shape-driven extractor with all
other formats (round 2, finding 2): it reads the body by what it IS, never
by a vendor's name. Anything else in it carries `parsed: false`, never a
product sentence. */
const openAiRefusal = (status: number, value: unknown): ModelApiError => {
  const refusal = parseRefusalError(status, value)
  // A documented reason or error code (Anthropic's `details.error_code`,
  // Google's `details[].reason`) decides over the echo `code`, so the
  // classifier sees it; the transport's credential redact already ran.
  return new ModelApiError(
    refusal.message,
    status,
    refusal.kind,
    refusal.errorCode ?? refusal.reason ?? refusal.code,
  )
}
/** Every wire format's HTTP error parser, keyed by the closed format. */
const parseByFormat: Record<ProviderFormat, (status: number, value: unknown) => ModelApiError> = {
  anthropic: (status, value) => anthropic.parseAnthropicError(status, value),
  gemini: (status, value) => gemini.parseGeminiError(status, value),
  ollama: (status, value) => ollama.parseOllamaError(status, value, ''),
  chat: (status, value) => openAiRefusal(status, value),
  responses: (status, value) => openAiRefusal(status, value),
}
/** One format's parser from the total table above. */
const parseFormatError = (
  format: ProviderFormat,
  status: number,
  value: unknown,
): ModelApiError => {
  const parse = parseByFormat[format]
  // The table is total over the closed ProviderFormat, so the throw below is
  // unreachable; the index type still carries undefined for tsc under
  // `noUncheckedIndexedAccess`.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- tsc's index access says possibly undefined
  if (parse === undefined) throw new Error(UI_TEXT.actionFailed)
  return parse(status, value)
}
/** An answered refusal with the sentence the person reads, keeping its
status, kind, code, request id and wait for the ledger and the log. */
const refusalError = (
  entry: ProviderEntry,
  preset: { readonly label: string; readonly category: string },
  error: ModelApiError,
): ModelApiError => {
  const out = new ModelApiError(
    refusalSentence(refusalOf(error), providerDisplayName(entry, preset)),
    error.status,
    error.kind,
    error.code,
  )
  out.requestId = error.requestId
  out.retryAfterMs = error.retryAfterMs
  return out
}
/**
How a configured provider's failure is read, wherever that provider is
asked (lane PROVERRORS): its own format's parser for an answer, the
sentence for a send that produced no answer (the provider, Node's own
failure codes, and that whether the request arrived is unknown), and the
sentence for an answered refusal. The turn, the key check and the
runtime's `providers test` all read failures through this one reader.
*/
export function providerFailureReader(
  entry: ProviderEntry,
  preset: { readonly label: string; readonly category: string; readonly format: ProviderFormat },
) {
  return {
    parseError: (status: number, value: unknown): ModelApiError =>
      parseFormatError(entry.format ?? preset.format, status, value),
    sendFailure: (error: unknown): string =>
      fill(UI_TEXT.providerUnreachable, {
        provider: providerDisplayName(entry, preset),
        detail: boundProviderMessage(networkFailureCodes(error)),
      }),
    refusal: (error: ModelApiError): string =>
      refusalSentence(refusalOf(error), providerDisplayName(entry, preset)),
  }
}

function ignoreTransportLog(): void {
  // This adapter reports fixed failures through its caller, without retaining
  // per-request diagnostics or forwarding arbitrary provider text to a log.
  // Still-waiting notices and scrubbed retry sentences are the host's own
  // words, so they go to the host's log when it named one (PR #214 review);
  // per-request timing (trace) never does, named or not.
}

/** The transport's log: notices and scrubbed sentences to the host's log when named. */
export function configuredTransportLog(log: CoreLogger | undefined): CoreLogger {
  if (log === undefined) {
    return {
      trace: ignoreTransportLog,
      info: ignoreTransportLog,
      warn: ignoreTransportLog,
      error: ignoreTransportLog,
    }
  }
  return {
    trace: ignoreTransportLog,
    info: (message: string) => {
      log.info(message)
    },
    warn: (message: string) => {
      log.warn(message)
    },
    error: (message: string) => {
      log.error(message)
    },
  }
}

/**
A manual thinking step fitted under the output cap, keeping room for the
answer. No output cap sent (a D121 hook call on a record-silent model)
keeps the full step; every other caller sends one, so their budget is
unchanged.
*/
export function manualThinkingBudget(
  budgetStep: number,
  maxOutputTokens: number | undefined,
): number {
  return Math.min(
    budgetStep,
    Math.max(
      PROVIDER_MANUAL_THINKING_BUDGET,
      (maxOutputTokens ?? Infinity) - PROVIDER_MANUAL_THINKING_BUDGET,
    ),
  )
}

async function* chunks(response: PinnedResponse, idleMs: number | undefined, provider: string) {
  let size = 0
  const iterator = response.body[Symbol.asyncIterator]()
  try {
    for (;;) {
      // No deadline of our own (owner 2026-10-16) unless the provider names one.
      const part =
        idleMs === undefined
          ? await iterator.next()
          : await withDeadline(iterator.next(), idleMs, UI_TEXT.actionFailed)
      if (part.done) return
      const bytes = z.instanceof(Uint8Array).parse(part.value)
      size += bytes.byteLength
      if (size > SUBSCRIPTION_STREAM_MAX_BYTES)
        throw new ModelApiError(
          fill(UI_TEXT.providerStreamTooLarge, { provider }),
          0,
          undefined,
          undefined,
        )
      yield bytes
    }
  } finally {
    response.close()
  }
}

export function createConfiguredProviderServices(
  meta: ProviderClient | undefined,
  options: ConfiguredProviderOptions,
) {
  // The only time limit on an inference stream: silence, of headers or
  // frames, and only when the provider names an idle (owner 2026-10-16:
  // unnamed, the stream ends at Stop). The transport ends such a stream
  // with its stalled sentence, which passes through the `streamResponse`
  // catch below untouched.
  const idleMs = options.streamIdleMs
  const readCatalog = async () => {
    try {
      return catalogSchema.parse(JSON.parse(await readFile(options.catalogFile, 'utf8')))
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const packed: unknown = await import(
        pathToFileURL(options.catalogFile.replace(/\.json$/, '.js')).href
      )
      return z.object({ default: catalogSchema }).parse(packed).default
    }
  }
  const delegate = (): ProviderClient => {
    if (meta === undefined)
      throw new ModelApiError(UI_TEXT.mainServiceUnavailable, 0, undefined, undefined)
    return meta
  }
  // Production media (D85.2): the Files transport rides to the Meta
  // delegate; a provider set without Meta keeps the established refusal.
  const filesTransport = meta?.requestFile?.bind(meta)
  const transcription = meta?.requestTranscription?.bind(meta)
  const base: ProviderClient = {
    hasPaidDailyBudget: meta?.hasPaidDailyBudget ?? false,
    currentKeyDigest: () => delegate().currentKeyDigest(),
    listModels: (signal) => delegate().listModels(signal),
    retryDelayMs: (attempt) => delegate().retryDelayMs(attempt),
    waitBeforeRetry: (delay, signal) => delegate().waitBeforeRetry(delay, signal),
    maxRetries: () => delegate().maxRetries(),
    personCap: () => delegate().personCap(),
    countInputTokens: (body, signal) => delegate().countInputTokens(body, signal),
    streamResponse: (body, ...args) => delegate().streamResponse(body, ...args),
    createImage: (...args) => delegate().createImage(...args),
    editImage: (...args) => delegate().editImage(...args),
    ...(filesTransport !== undefined && { requestFile: filesTransport }),
    ...(transcription !== undefined && { requestTranscription: transcription }),
  }
  let revision = ''
  let plans = options.loadUsage?.() ?? []
  const versions = new WeakMap<RegistryModel, string>()
  const records = new Map<
    string,
    { entry: ProviderEntry; record: ModelCapabilityRecord; revision: string }
  >()
  const read = async () => {
    const result = await providersFile.readProvidersFile(options.configFile)
    if (!result.ok) {
      if (result.reason === 'missing') return providersFile.emptyProvidersFile()
      // The providers-file refusal, with its own sentence: the account check
      // and the editor say the file's fault, never the credential store's.
      throw providersFileUnreadable(result.reason)
    }
    revision = digest(JSON.stringify(result.file))
    return result.file
  }
  const presetFor = (entry: ProviderEntry) => {
    const preset = presets.planKeyPresetById(entry.preset) ?? presets.presetById(entry.preset)
    if (preset === undefined)
      throw invalidEntry(entry, { kind: 'unknownPreset', preset: entry.preset })
    return preset
  }
  const credential = async (entry: ProviderEntry, supplied?: string) => {
    if (entry.auth === 'none') return
    if (entry.auth !== 'apiKey')
      throw invalidEntry(entry, { kind: 'unsupportedAuth', auth: entry.auth })
    if (supplied !== undefined) return supplied
    const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}${entry.id}`)
    if (stored === undefined)
      throw new ModelApiError(
        fill(UI_TEXT.providerKeyAbsent, { provider: entry.id }),
        0,
        undefined,
        undefined,
      )
    let value: unknown
    try {
      value = JSON.parse(stored)
    } catch (error) {
      // Only malformed stored text reads unreadable; anything else is not
      // the secret and reaches the caller.
      if (!(error instanceof SyntaxError)) throw error
      throw new ModelApiError(
        fill(UI_TEXT.providerSecretUnreadable, { provider: entry.id }),
        0,
        undefined,
        undefined,
      )
    }
    const parsed = secretSchema.safeParse(value)
    if (!parsed.success)
      throw new ModelApiError(
        fill(UI_TEXT.providerSecretUnreadable, { provider: entry.id }),
        0,
        undefined,
        undefined,
      )
    if (
      endpointPolicy.originOf(parsed.data.origin) !== endpointPolicy.originOf(entry.address ?? '')
    )
      throw new ModelApiError(
        fill(UI_TEXT.providerOriginMismatch, {
          provider: entry.id,
          stored: parsed.data.origin,
          current: entry.address ?? '',
        }),
        0,
        undefined,
        undefined,
      )
    return parsed.data.secret
  }
  const transportFor = (entry: ProviderEntry, supplied?: string, keyTestOrigin?: string) => {
    const preset = presetFor(entry)
    if (entry.address === undefined) throw invalidEntry(entry, { kind: 'missingAddress' })
    const configuredUrl = new URL(entry.address)
    const base = new URL(keyTestOrigin ?? configuredUrl.href)
    if (
      // No capture, no calls (rule 13): `custom` is the user's own server,
      // but an uncaptured preset stays refused even when keyless
      // (C-M95-4 R2: the old `auth !== 'none'` escape let a picked vLLM or
      // Ollama entry send chat with no capture behind it).
      (!preset.wireCapture && entry.preset !== 'custom') ||
      (preset.origin.kind === 'fixed' && configuredUrl.origin !== preset.origin.origin) ||
      (keyTestOrigin !== undefined &&
        (preset.keyTest.kind !== 'provider-key' || preset.keyTest.origin !== keyTestOrigin))
    )
      throw invalidEntry(entry, { kind: 'addressMismatch', address: configuredUrl.origin })
    const auth =
      entry.auth === 'none'
        ? new NoAuthSource(base.origin)
        : new ApiKeyAuthSource(
            async () => {
              const key = await credential(entry, supplied)
              return { record: { v: 1, auth: 'apiKey', origin: base.origin }, key }
            },
            entry.preset === 'custom' && entry.format === 'anthropic'
              ? 'x-api-key'
              : (preset.authHeader ?? 'bearer'),
          )
    let target: PinnedTarget | undefined
    const readLimits = pacingReaderFor(preset.id)
    return {
      auth,
      transport: {
        // Lane PR225FIX2: a Stop clears the wait's own timer, so an
        // abandoned wait leaves none behind.
        sleep: abortableSleep,
        now: Date.now,
        random: Math.random,
        ...(idleMs !== undefined && { streamIdleMs: idleMs }),
        // The entry's own header interpreter: Meta's reader is the
        // transport default, every other provider reads its own headers.
        // A preset with no limit headers omits the reader instead of
        // sending undefined, so only a 429 pause applies. The identity is
        // the stable preset id, never the configurable entry id: aliases
        // of one key (`providers add --as`) share what the account's
        // quota observations and 429 pauses teach (the base URL and the
        // credential digest in the account key disambiguate servers
        // and keys).
        pacingProvider: () =>
          readLimits === undefined
            ? { identity: { provider: preset.id } }
            : { identity: { provider: preset.id }, readLimits },
        log: configuredTransportLog(options.log),
        // A send that produced no answer: the provider, Node's own failure
        // codes (never what a server wrote) and that whether the request
        // arrived is unknown (lane PROVERRORS).
        sendFailure: providerFailureReader(entry, preset).sendFailure,
        // Lane RETRYLIMITS: the preset's documented retry bounds
        // (`FormatQuirks.retryLimits`: the format default plus the preset's
        // own override, so e.g. xAI's 4 and Azure's 10 are read), and the
        // person's setting when set.
        retryLimits: presets.quirksOf(preset).retryLimits,
        ...(options.personCap !== undefined && {
          personCap: options.personCap,
        }),
        fetch: async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          let requestUrl: string
          if (typeof url === 'string') requestUrl = url
          else if (url instanceof URL) requestUrl = url.href
          else requestUrl = url.url
          if (target?.url.href !== requestUrl || init?.redirect !== 'error')
            throw invalidEntry(entry, { kind: 'defect', detail: requestUrl })
          // The caller's signal, if any; no deadline of our own (owner 2026-10-16).
          // Without one the send still needs a signal to listen to, so it
          // gets one that never aborts.
          const signal = init.signal ?? new AbortController().signal
          const headers = Object.fromEntries(
            Object.entries(z.record(z.string(), z.string()).parse(init.headers)).map(
              ([name, value]) => [
                ['Authorization', 'Content-Type', 'Accept'].includes(name)
                  ? name.toLowerCase()
                  : name,
                value,
              ],
            ),
          )
          const body = typeof init.body === 'string' ? init.body : undefined
          // A send that throws produced no answer. A typed failure keeps its
          // kind; a native one goes to the transport as it is, which retries
          // it as a transient send failure and, when it stops, reads it with
          // `sendFailure` above (the network codes, and the send's unknown
          // fate). Its status stays 0, so any liability is kept uncertain.
          let response: PinnedResponse
          const connection = { isConnected: false }
          const connected = () => {
            connection.isConnected = true
          }
          try {
            if (options.send !== undefined)
              response = await options.send(target, body, headers, signal)
            else if (body === undefined) {
              response = await pinnedHttpsRequest(
                target,
                signal,
                connected,
                (requestOptions, callback) => {
                  const request = target?.url.protocol === 'http:' ? httpRequest : httpsGet
                  return request(
                    { ...requestOptions, headers: { host: base.host, ...headers } },
                    callback,
                  )
                },
                target.url.protocol !== 'http:',
              )
            } else {
              response = await pinnedPostRequest(
                target,
                body,
                headers,
                signal,
                connected,
                target.url.protocol === 'http:' ? httpRequest : undefined,
                target.url.protocol !== 'http:',
              )
            }
          } catch (error: unknown) {
            // An injected send reports no dispatch, so a failure after it
            // was called may have reached the provider: it keeps ambiguous
            // liability below instead of `not_sent`, which would release
            // the run's ticket and record zero.
            if (!connection.isConnected && options.send === undefined)
              throw new UserRefusalError(
                isUserRefusal(error) ? error.message : UI_TEXT.providerProbeUnreachable,
                'not_sent',
                error,
              )
            if (isUserRefusal(error) || signal.aborted) throw error
            // A pinned send can have reached the provider; retain its liability
            // and refuse an ambiguous retry, with no echoed diagnostic text.
            throw new ModelApiError(UI_TEXT.modelsPanelUnavailable, 0, undefined, undefined)
          }
          const iterator = chunks(response, idleMs, providerDisplayName(entry, preset))[
            Symbol.asyncIterator
          ]()
          return new Response(
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                try {
                  const next = await iterator.next()
                  if (next.done) controller.close()
                  else controller.enqueue(next.value)
                } catch (error: unknown) {
                  // The provider answered 200 and the connection was lost
                  // while its reply came: said as that, with Node's codes,
                  // never as the provider's error (lane PROVERRORS). A typed
                  // failure, the idle deadline, a refusal of ours and a Stop
                  // keep their own.
                  controller.error(
                    signal.aborted || isModelApiError(error) || !isConnectionFailure(error)
                      ? error
                      : new ModelApiError(
                          fill(UI_TEXT.providerConnectionLost, {
                            provider: providerDisplayName(entry, preset),
                            detail: boundProviderMessage(networkFailureCodes(error)),
                          }),
                          0,
                          undefined,
                          PROVIDER_CONNECTION_LOST_CODE,
                        ),
                  )
                }
              },
              cancel: async () => {
                response.close()
                await iterator.return(undefined)
              },
            }),
            {
              status: response.status,
              headers: Object.fromEntries(
                Object.entries(response.headers).filter(
                  (row): row is [string, string] => row[1] !== undefined,
                ),
              ),
            },
          )
        },
      },
      verifyEndpoint: async (url: string) => {
        const parsed = new URL(url)
        if (parsed.origin !== base.origin)
          throw invalidEntry(entry, { kind: 'addressMismatch', address: parsed.origin })
        if (
          keyTestOrigin !== undefined &&
          (preset.keyTest.kind !== 'provider-key' || parsed.pathname !== preset.keyTest.path)
        )
          throw invalidEntry(entry, { kind: 'addressMismatch', address: parsed.pathname })
        const host = parsed.hostname.replaceAll(/^\[|\]$/g, '')
        const answers =
          isIP(host) === 0
            ? await (
                options.resolve ??
                (async (name) => {
                  const rows = await lookup(name, { all: true })
                  return rows.map((row) => row.address)
                })
              )(host)
            : [host]
        const verdict = endpointPolicy.checkEndpointUrl(base.href, answers)
        if (
          verdict.kind === 'refused' ||
          (preset.origin.kind === 'fixed' &&
            verdict.kind === 'ok' &&
            verdict.network !== 'public') ||
          (verdict.kind === 'confirm-private' &&
            (keyTestOrigin !== undefined || entry.privateNetwork !== true))
        )
          throw invalidEntry(entry, { kind: 'addressMismatch', address: base.href })
        const address = answers[0]
        if (address === undefined)
          throw invalidEntry(entry, { kind: 'addressMismatch', address: host })
        if (supplied === undefined) {
          const file = await read()
          if (
            JSON.stringify(file.providers.find((row) => row.id === entry.id)) !==
            JSON.stringify(entry)
          )
            throw invalidEntry(entry, { kind: 'changedDuringRequest' })
        }
        target = {
          url: parsed,
          host,
          address,
          family:
            isIP(address) === ADDRESS_FAMILIES.ipv6 ? ADDRESS_FAMILIES.ipv6 : ADDRESS_FAMILIES.ipv4,
        }
      },
    }
  }
  const baseAndPath = (entry: ProviderEntry, path: string) => {
    if (entry.address === undefined) throw invalidEntry(entry, { kind: 'missingAddress' })
    const url = new URL(entry.address)
    const prefix = url.pathname.replace(/\/$/, '')
    return { baseUrl: url.origin, path: prefix + path }
  }
  const getJson = async (
    entry: ProviderEntry,
    path: string,
    supplied: string | undefined,
    signal: AbortSignal | undefined,
    keyTestOrigin?: string,
    isExact = false,
  ) => {
    const preset = presetFor(entry)
    const bound = transportFor(entry, supplied, keyTestOrigin)
    const address =
      keyTestOrigin === undefined ? baseAndPath(entry, path) : { baseUrl: keyTestOrigin, path }
    const transport = new RequestTransport({
      ...bound.transport,
      auth: bound.auth,
      verifyEndpoint: async (url) => {
        if (signal === undefined) {
          await bound.verifyEndpoint(url)
          return
        }
        await unlessAborted(bound.verifyEndpoint(url), signal)
        signal.throwIfAborted()
      },
      baseUrl: address.baseUrl,
      // OPENAI-G20: the key-check path retries by the preset's own table too.
      retryTable: presets.quirksOf(preset).retry,
      // RVPROVERR: the models list / key check is where the recorded bad-key
      // answers arrive, so it reads them with the same format parser and
      // never-retry rule as the turn path; without this the transport's
      // default envelope (a string `code`) rejects e.g. Google's numeric
      // code and the provider's words are lost behind a bare "HTTP 400".
      parseError: providerFailureReader(entry, preset).parseError,
      isRetryableFailure: (failure) => isRefusalRetryable(failure, presets.quirksOf(preset).retry),
    })
    const headers: Record<string, string> = {}
    if ((entry.format ?? preset.format) === 'anthropic') headers['anthropic-version'] = '2023-06-01'
    if (preset.id === 'openrouter') {
      const attribution = presets.OPENROUTER_ATTRIBUTION
      headers[attribution.refererHeader] = attribution.referer
      headers[attribution.titleHeader] = attribution.title
      headers[attribution.categoriesHeader] = attribution.categories
    }
    const result = await transport.request(
      address.path,
      { method: 'GET', accept: 'application/json', headers, retries: 'rateLimitOnly' },
      signal,
    )
    if (isExact) {
      // Tokenize strings and numbers together: digits in labels or escaped
      // strings are untouched. JSON validates syntax; only markers minted
      // here materialize into amounts, so a wire object or string can never
      // forge one. The nonce is per call; the exponent bound is enforced
      // here and again in the amount schema.
      const nonce = randomUUID()
      const text = await readBoundedText(result.response)
      const exact = text.replaceAll(
        /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
        (token) => {
          if (token.startsWith('"')) return token
          const exponent = Number(token.split(/[eE]/, 2)[1] ?? 0)
          // An out-of-range exponent reaches `openRouterUsage`'s catch, which
          // reports the usage read as failed (lane PROVERRORS: no generic panel error).
          if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > EXACT_DECIMAL_MAX_EXPONENT)
            throw new Error(UI_TEXT.providerUsageFailed)
          return JSON.stringify(`exact-decimal:${nonce}:${token}`)
        },
      )
      return materializeExactDecimals(JSON.parse(exact), nonce)
    }
    return await parseJsonResponse(result, (json) => z.json().parse(json))
  }
  const scan = async (
    entry: ProviderEntry,
    supplied?: string,
    // No deadline of our own (owner 2026-10-16): the catalogue read ends at
    // the provider's answer or a network failure.
    signal?: AbortSignal,
  ): Promise<readonly NativeModelMetadata[]> => {
    // A scan failure keeps its own text: the key test names it
    // `providerProbeUnparseable`, and the panel shows what the list said.
    const format = entry.format ?? presetFor(entry).format
    const value = await getJson(entry, presetFor(entry).modelsList.path, supplied, signal)
    if (format === 'anthropic')
      return anthropic.parseAnthropicModelsList(value).map((row) => {
        if (row.native === undefined)
          throw invalidEntry(entry, { kind: 'unusableModelsEntry', model: row.id })
        return row.native
      })
    if (format === 'gemini')
      return gemini.parseGeminiModelsList(value).map((row) => {
        if (row.native === undefined)
          throw invalidEntry(entry, { kind: 'unusableModelsEntry', model: row.id })
        return { ...row.native, id: row.id }
      })
    return format === 'ollama'
      ? ollama.parseOllamaModelsList(value)
      : modelMetadata.parseNativeModelsList(value)
  }
  const models = async (): Promise<RegistryModel[]> => {
    const file = await read()
    const catalogue = await readCatalog()
    const rows: RegistryModel[] = []
    for (const entry of file.providers) {
      if (entry.auth === 'subscription') continue
      const preset = presetFor(entry)
      for (const nativeModel of entry.models) {
        const ref = `${entry.id}/${nativeModel}`
        const native =
          catalogue.providers[preset.id.replace('-plan', '')]?.models[nativeModel] ??
          catalogue.unpriced?.[preset.id.replace('-plan', '')]?.[nativeModel]
        // Dated provider-documentation facts the snapshot lacks (lane
        // REASONSHAPES): `preset`-kind evidence, shadowing the pinned
        // catalogue where it speaks and losing to the live list, a
        // capture and the user's overrides (capabilityRecord PRIORITY).
        const documented = (preset.reasoningFacts ?? []).filter(
          (fact) => fact.modelId === nativeModel,
        )
        const evidence: capabilities.CapabilityEvidence[] = documented.map((fact) => ({
          source: { kind: 'preset', ref: `${fact.docUrl} (read ${fact.readOn})` },
          fields: fact.fields,
        }))
        if (native !== undefined)
          evidence.push(
            modelMetadata.nativeCapabilityEvidence(preset.id, native, {
              kind: 'catalogue',
              ref: options.catalogFile,
            }),
          )
        const overrides = entry.modelCapabilities?.[nativeModel]
        if (overrides !== undefined)
          evidence.push({ source: { kind: 'user', ref }, fields: overrides })
        const record = capabilities.resolveModelCapabilities(
          { provider: entry.id, nativeModel, format: entry.format ?? preset.format },
          evidence,
        )
        const four = capabilities.capabilitiesOf({ capabilityRecord: record })
        const entered = entry.prices?.[nativeModel]
        const cost = costSchema.safeParse(native?.['cost'])
        const tier = cost.success ? cost.data.tiers?.[0] : undefined
        const card = priceCard.resolvePriceCard([
          ...(cost.success
            ? [
                {
                  input: cost.data.input / TOKENS_PER_MILLION,
                  output: cost.data.output / TOKENS_PER_MILLION,
                  cachedInput:
                    cost.data.cache_read === undefined
                      ? undefined
                      : cost.data.cache_read / TOKENS_PER_MILLION,
                  cacheWrite:
                    cost.data.cache_write === undefined
                      ? undefined
                      : cost.data.cache_write / TOKENS_PER_MILLION,
                  fetchedAt: catalogue.fetchedAt,
                  ...(tier !== undefined && {
                    longContextTier: {
                      fromTokens: tier.tier.size,
                      input: tier.input / TOKENS_PER_MILLION,
                      output: tier.output / TOKENS_PER_MILLION,
                      cachedInput:
                        tier.cache_read === undefined
                          ? undefined
                          : tier.cache_read / TOKENS_PER_MILLION,
                      cacheWrite:
                        tier.cache_write === undefined
                          ? undefined
                          : tier.cache_write / TOKENS_PER_MILLION,
                    },
                  }),
                  source: 'catalogue' as const,
                },
              ]
            : []),
          ...(entered === undefined ? [] : [{ ...entered, source: 'user' as const }]),
        ])
        records.set(ref, { entry, record, revision })
        let pricing: priceCard.ModelPricing = { kind: 'unpriced' }
        if (presets.planKeyPresetById(entry.preset) !== undefined) pricing = { kind: 'plan' }
        else if (entry.auth === 'none') pricing = { kind: 'local' }
        else if (card !== undefined) pricing = { kind: 'priced', card }
        const origin = endpointPolicy.originOf(entry.address ?? '')
        if (origin === undefined) throw invalidEntry(entry, { kind: 'missingAddress' })
        const model: RegistryModel = {
          ref,
          catalogueMissing:
            native === undefined &&
            preset.id !== 'custom' &&
            entry.auth !== 'none' &&
            entered === undefined,
          origin,
          evidence: {
            capabilities: four,
            effortLevels: capabilities.capabilityEffortLevels(record),
            maxOutputTokens:
              entry.modelLimits?.[nativeModel]?.outputTokens ?? record.output.maxTokens,
            minOutputTokens: providerOutputMinimum(
              entry.address,
              nativeModel,
              record.output.minTokens ?? 1,
              entry.format ?? preset.format,
            ),
            canDisableReasoning: record.reasoning.canDisable.state === 'yes',
            // Sonnet 5.5's `between_tools` off switch rides the policy so
            // Thinking off is not refused where `disabled` is (GAPANTH-G02).
            ...(record.reasoning.offSwitch !== undefined && {
              offSwitch: record.reasoning.offSwitch,
            }),
            // The list's own default effort lights the picker's default
            // (XAI-G01); the controller falls back without it.
            ...(record.reasoning.defaultEffort !== undefined && {
              defaultEffort: record.reasoning.defaultEffort,
            }),
            // Manual-only thinking rides unlisted tiers through unnamed
            // (GAPANTH-G10/G17).
            ...(() => {
              const modes =
                record.reasoning.modes.state === 'yes' ? record.reasoning.modes.value : []
              return modes.includes('manual') && !modes.includes('adaptive')
                ? { manualOnly: true as const }
                : {}
            })(),
            // The switch rides the policy only where the record affirms
            // reasoning (see the codec quirks above).
            thinkingOff:
              record.reasoning.supported.state === 'yes' ? preset.quirks.thinkingOff : undefined,
            ...(preset.quirks.sendUndeclaredEffort === true && { sendUndeclaredEffort: true }),
          },
          pricing,
          // The send path's record: the same joined capabilities the
          // evidence above projects, so fresh media meets the model's own
          // caps instead of riding through record-less.
          record,
          displayLabel: typeof native?.['name'] === 'string' ? native['name'] : nativeModel,
          providerLabel: preset.label,
          contextTokens:
            entry.modelLimits?.[nativeModel]?.contextTokens ?? record.limits.contextTokens,
          isDefault: file.defaultModel === ref,
          isPinned: entry.pinned?.includes(nativeModel),
          planLimitsUrl: presets.planKeyPresetById(entry.preset)?.limitsUrl,
        }
        versions.set(model, revision)
        rows.push(model)
      }
    }
    return rows
  }
  const boundClient = (ref: string): ProviderClient => {
    const bound = records.get(ref)
    if (bound === undefined) throw new ModelApiError(UI_TEXT.actionFailed, 0, undefined, undefined)
    const { entry, record } = bound
    const preset = presetFor(entry)
    const native = modelRef.parseModelRef(ref)?.modelId
    if (native === undefined) throw new ModelApiError(UI_TEXT.actionFailed, 0, undefined, undefined)
    let reasoningParam: chat.ChatPresetQuirks['reasoningParam'] = 'none'
    if (record.reasoning.effortLevels.state === 'yes')
      reasoningParam = preset.id === 'openrouter' ? 'effort-object' : 'effort-flat'
    // C-M95-4 R2: local presets never replay thinking (fail closed on
    // unversioned servers); see `replayFieldFor`. A `content-list` cloud
    // preset (Mistral) still replays its chunks.
    let replayField: chat.ChatPresetQuirks['replayField'] = presets.replayFieldFor(preset)
    if (preset.category !== 'local' && preset.quirks.reasoningField === 'content-list')
      replayField = 'chunks'
    const quirks: chat.ChatPresetQuirks = {
      presetId: preset.id.replace('-plan', ''),
      providerId: entry.id,
      outputCap:
        preset.quirks.outputCapParam === 'max_completion_tokens'
          ? 'max_completion_tokens'
          : 'max_tokens',
      reasoningParam,
      // A preset's declared Thinking-off switch (presets.ts) hands the codec
      // the record facts the shared resolver maps every effort with. Only
      // where the record affirms reasoning: on a model that cannot think,
      // Thinking off is already satisfied and the turn goes plain.
      ...(preset.quirks.thinkingOff !== undefined &&
        record.reasoning.supported.state === 'yes' && {
          thinkingOff: preset.quirks.thinkingOff,
          effortLevels:
            record.reasoning.effortLevels.state === 'yes'
              ? record.reasoning.effortLevels.value
              : undefined,
          canDisable: record.reasoning.canDisable.state === 'yes',
        }),
      // Groq's presentation rides only where the record affirms reasoning.
      ...(preset.quirks.reasoningFormat !== undefined &&
        record.reasoning.supported.state === 'yes' && {
          reasoningFormat: preset.quirks.reasoningFormat,
        }),
      ...(preset.quirks.sendUndeclaredEffort === true && { sendUndeclaredEffort: true }),
      // OpenRouter's `supported_parameters` enforcement: a model the
      // record refuses tools keeps its turn though never its tools.
      ...(record.tools.calling.state === 'no' && { sendTools: false }),
      ...(record.output.formats.state === 'yes' && {
        outputFormats: record.output.formats.value,
      }),
      ...(preset.quirks.thinkingPreserved === true && { thinkingPreserved: true }),
      // Strict tool schemas ride where the preset declares the model
      // takes them (DeepSeek's `guides/tool_calls`, DS-G02): on the
      // address the entry has. The beta and the production address
      // both answered 200 with `strict: true` (DS-STRICT,
      // DS-STRICT-PROD); production enforcement stays UNVERIFIED.
      ...(preset.quirks.supportsStrictTools === true && {
        supportsStrictTools: true,
      }),
      sendCacheKey: record.cache.acceptsKey,
      includeUsage: true,
      toolStream: preset.id === 'zai',
      parallelToolCalls: record.tools.parallel.state === 'yes' || undefined,
      toolResultName: preset.id.startsWith('mistral'),
      replayField,
      toolChoice: preset.quirks.toolChoice === 'omit' ? 'omit' : 'auto',
      ...(preset.id === 'openrouter' && {
        routing: {
          ...((entry.routing?.privacy ?? 'zdr') === 'zdr' && { zdr: true }),
          ...(entry.routing?.privacy === 'no-training' && { dataCollection: 'deny' as const }),
          order: entry.routing?.order,
          allowFallbacks: entry.routing?.allowFallbacks,
        },
        extraHeaders: [
          [presets.OPENROUTER_ATTRIBUTION.refererHeader, presets.OPENROUTER_ATTRIBUTION.referer],
          [presets.OPENROUTER_ATTRIBUTION.titleHeader, presets.OPENROUTER_ATTRIBUTION.title],
          [
            presets.OPENROUTER_ATTRIBUTION.categoriesHeader,
            presets.OPENROUTER_ATTRIBUTION.categories,
          ],
        ],
      }),
    }
    const format = entry.format ?? preset.format
    const decode = (
      bytes: AsyncIterable<Uint8Array>,
      status: number,
    ): AsyncIterable<StreamEvent> => {
      switch (format) {
        case 'chat': {
          const decoder = new chat.ChatStreamDecoder(ref, quirks, {
            frameBytes: ANTHROPIC_MAX_FRAME_BYTES,
            streamBytes: SUBSCRIPTION_STREAM_MAX_BYTES,
            argumentBytes: ANTHROPIC_MAX_ARGUMENT_BYTES,
            outputItems: ANTHROPIC_MAX_ITEMS,
          })
          return (async function* () {
            for await (const frame of parseSse(bytes)) {
              if (frame.data === '[DONE]' || frame.data.trim() === '') continue
              const value: unknown = JSON.parse(frame.data)
              yield* decoder.feed(value)
            }
            yield* decoder.finish().events
          })()
        }
        case 'anthropic': {
          // The replay envelope binds thinking to the native model id
          // (lane REASONSHAPESR2, GAPANTH-G01): stamping the qualified
          // `ref` here while the encoder compares the bare `native` id
          // dropped every thinking block between tool turns.
          return anthropic.decodeAnthropicStream(parseSse(bytes), { model: native })
        }
        case 'gemini': {
          return gemini.decodeGeminiStream(bytes, ref)
        }
        case 'ollama': {
          const frames = (async function* () {
            const encoder = new TextEncoder()
            for await (const frame of parseNdjson(bytes))
              yield encoder.encode(JSON.stringify(frame) + '\n')
          })()
          return ollama.decodeOllamaStream(frames, {
            model: native,
            status,
            responseId: randomUUID(),
          })
        }
        default: {
          return responses
            .createResponsesCodec({
              sendPromptCacheKey: record.cache.acceptsKey,
              sendPromptCacheRetention: record.cache.retention.length > 0,
            })
            .decodeStream(bytes)
        }
      }
    }
    const connection = transportFor(entry)
    const codec: WireCodec = {
      format,
      models: {
        // Joined with the address root, so an Azure entry lists below its
        // `/openai/v1` root instead of the bare origin (PROVM95).
        path: baseAndPath(entry, preset.modelsList.path).path,
        parse: (value) =>
          modelMetadata.parseNativeModelsList(value).map((row) => ({
            id: z.string().parse(row['id']),
            capabilities: capabilities.capabilitiesOf({ capabilityRecord: record }),
            contextWindow: record.limits.contextTokens ?? 0,
            maxOutputTokens: record.output.maxTokens ?? 0,
          })),
      },
      // Every wire format parses its own envelope: the table is keyed by
      // the closed ProviderFormat, so there is no `default:` branch that
      // could invent a product sentence, and a new member fails to typecheck
      // until it gets its own parser.
      parseError: (status, value) => parseFormatError(format, status, value),
      encode: (body) => {
        let path = '/v1/responses'
        let wire: unknown
        let extras: Readonly<Record<string, string>> = {}
        switch (format) {
          case 'chat': {
            const request = chat.encodeChatRequest(body, native, quirks, {
              capabilities: { vision: record.modalities.image.state === 'yes' },
            })
            wire = request.body
            extras = Object.fromEntries(request.headers)
            path = preset.modelsList.path.replace(/models$/, 'chat/completions')

            break
          }
          case 'anthropic': {
            // Manual thinking carries no effort level, so the chosen tier
            // sizes the budget instead (lane REASONSHAPESR2, GAPANTH-G17);
            // adaptive models take the effort and no budget. The budget
            // stays below the run's cap, keeping room for the answer.
            const anthropicModes =
              record.reasoning.modes.state === 'yes' ? record.reasoning.modes.value : []
            const isManualOnly =
              anthropicModes.includes('manual') && !anthropicModes.includes('adaptive')
            const budgetStep = isEffortLevel(body.reasoning.effort)
              ? MANUAL_THINKING_BUDGET_BY_EFFORT[body.reasoning.effort]
              : undefined
            const request = anthropic.encodeAnthropicRequest(body, {
              model: native,
              maxTokens: body.max_output_tokens,
              effort: body.reasoning.effort,
              capabilityRecord: record,
              ...(isManualOnly &&
                budgetStep !== undefined && {
                  thinkingBudget: manualThinkingBudget(budgetStep, body.max_output_tokens),
                }),
            })
            wire = request.body
            extras = request.headers
            path = '/v1/messages'

            break
          }
          case 'gemini': {
            wire = gemini.encodeGeminiRequest(body, native, record).body
            path = gemini.geminiStreamPath(native)

            break
          }
          case 'ollama': {
            const numCtx = entry.numCtx?.[native] ?? record.limits.contextTokens
            if (numCtx === undefined)
              throw invalidEntry(entry, { kind: 'contextWindowUnset', model: native })
            wire = JSON.parse(
              ollama.encodeOllamaRequest(body, {
                model: native,
                numCtx,
                ...(record.reasoning.supported.state === 'yes' && {
                  think: ollama.thinkForEffort(body.reasoning.effort),
                }),
              }).body,
            )
            path = ollama.OLLAMA_CHAT_PATH

            break
          }
          default: {
            // A model whose record has no effort levels gets no reasoning
            // field in any request (lane REASONSHAPESR2): the parameter
            // itself is what xAI refuses (`api.x.ai/v1/responses` answers
            // 400 to `reasoning` on grok-build-0.1), and the provider
            // default applies. Per model, from the record, never per
            // vendor. `default` (an unlisted level) omits the same way.
            const shouldOmitReasoning =
              body.reasoning.effort === EFFORT_PROVIDER_DEFAULT ||
              record.reasoning.supported.state === 'no' ||
              !hasUsableEffortLevels(record.reasoning.effortLevels)
            // Azure's v1 API is Responses as OpenAI's, rooted at the
            // entry's `/openai/v1` address with the deployment name as the
            // model (research §1.2 [AZ1, AZ3, AZ6]); the record above stays
            // keyed by the model family, never the deployment name.
            const isAzure = preset.id === 'azure'
            wire = responses
              .createResponsesCodec(
                {
                  sendPromptCacheKey: record.cache.acceptsKey,
                  sendPromptCacheRetention: record.cache.retention.length > 0,
                },
                // The record resolved for this model gates the wire (tool
                // choice modes, vision, strict tools); without it the codec
                // would send `auto` for every model, listed or not.
                () => capabilities.capabilitiesOf({ capabilityRecord: record }),
              )
              .encodeRequest({
                ...body,
                model: presets.wireModelFor(entry, native),
                ...(shouldOmitReasoning && { reasoning: undefined }),
              })
            if (isAzure) path = '/responses'
          }
        }

        return { path: baseAndPath(entry, path).path, body: wire, headers: extras }
      },
      decode: async function* (response) {
        if (response.body === null)
          throw new ModelApiError(UI_TEXT.actionFailed, response.status, undefined, undefined)
        for await (const event of decode(response.body, response.status)) {
          if (event.type === 'error') {
            // A refusal inside the stream is its own kind (round 2,
            // finding 8): the provider ended its answer with an error, at
            // the answer's own status (200 when the stream carried it). The
            // sentence is built once, by the `streamResponse` catch below,
            // after the credential scrub; liability stays uncertain.
            throw new ModelApiError(
              event.message,
              response.status,
              'streamError',
              event.code ?? undefined,
            )
          }
          yield 'response' in event
            ? { ...event, response: { ...event.response, model: ref } }
            : event
          // A failed terminal can still carry final billed usage. Deliver that
          // receipt before surfacing its error so accounting never loses it.
          if ('response' in event && event.response.error != null) {
            // Same kind as above: the answer ended with an error after its
            // final usage, at the stream's own status.
            throw new ModelApiError(
              event.response.error.message,
              response.status,
              'streamError',
              event.response.error.code ?? undefined,
            )
          }
        }
      },
    }
    const providerModel = () => ({
      id: ref,
      capabilities: capabilities.capabilitiesOf({ capabilityRecord: record }),
      contextWindow: record.limits.contextTokens ?? 0,
      maxOutputTokens: record.output.maxTokens ?? 0,
    })
    const client = new CodecClient({
      provider: {
        id: entry.id,
        label: preset.label,
        origin: new URL(entry.address ?? '').origin,
        format,
        auth: entry.auth,
        isLocal: entry.auth === 'none',
      },
      baseUrl: new URL(entry.address ?? '').origin,
      codec,
      auth: connection.auth,
      verifyEndpoint: connection.verifyEndpoint,
      // OPENAI-G20: the stream path retries by the preset's own table
      // (`quirks.retry`: the format default plus the preset's override, so
      // OpenAI's documented retryable `server_error` is read), and the
      // envelope code (e.g. a quota 429's) reaches the real classifier.
      transport: { ...connection.transport, retryTable: presets.quirksOf(preset).retry },
      ...(idleMs !== undefined && { streamIdleMs: idleMs }),
      modelFor: providerModel,
    })
    /**
    EXECPROV round 7: the exact same-body input count for every wire
    that documents one, declared per preset/format in data
    (`FormatQuirks.exactCount`, preset overrides where only some
    providers of a format document one) and off-switchable per entry.
    The count request is built from the already-built native request by
    buildExactCountRequest (drop these fields, send to this path), so it
    cannot drift from what is sent. It rides the same pinned-address,
    proxy and credential path as the real request (no second network
    path), carries the request's own headers (auth, version, beta), is
    never recorded as a model call, and any failure throws so the
    accounting layer falls back to the byte bound with the fixed reason.
    A count is never retried for send failures (`rateLimitOnly`: only a
    pre-work 429 may retry inside the short deadline); its failure text
    never carries the body. Counts are free on every wire that has one,
    so no billed cost rides along.
    */
    // Through the externalized providers entry (never a static edge into
    // tokenCount.ts: the split gate forbids carrying provider modules).
    const exactCountKind = tokenCount.exactCountKindFor(entry, preset)
    const exactInputCount =
      exactCountKind === undefined
        ? undefined
        : async (
            body: CreateResponseBody,
            signal?: AbortSignal,
          ): Promise<{
            readonly tokens: number
            readonly costUsd?: UsdAmount | undefined
            readonly accuracy: 'exact' | 'estimate'
          }> => {
            signal?.throwIfAborted()
            const encoded = codec.encode(body, providerModel())
            // Built from the request path the request itself takes — never
            // a fixed string — so a custom prefix or model still addresses
            // its own counting sibling, or keeps the byte bound.
            const count = tokenCount.buildExactCountRequest(exactCountKind, {
              path: encoded.path,
              body: encoded.body,
              ...(encoded.headers !== undefined && { headers: encoded.headers }),
            })
            if (count === undefined) throw new Error(UI_TEXT.modelsPanelUnavailable)
            if (entry.address === undefined) throw invalidEntry(entry, { kind: 'missingAddress' })
            const transport = new RequestTransport({
              ...connection.transport,
              auth: connection.auth,
              verifyEndpoint: connection.verifyEndpoint,
              baseUrl: new URL(entry.address).origin,
            })
            // No deadline of our own (owner 2026-10-16): the count ends at
            // the provider's answer, a network failure, or the caller's stop.
            const result = await transport.request(
              count.path,
              {
                method: 'POST',
                body: count.body,
                ...(encoded.headers !== undefined && { headers: encoded.headers }),
                accept: 'application/json',
                retries: 'rateLimitOnly',
              },
              signal,
            )
            const tokens = await parseJsonResponse(result, (json) =>
              tokenCount.parseExactCountResponse(exactCountKind, json),
            )
            if (tokens === undefined) throw new Error(UI_TEXT.modelsPanelUnavailable)
            return {
              tokens,
              costUsd: undefined,
              accuracy: exactCountKind === 'anthropic-count-tokens' ? 'estimate' : 'exact',
            }
          }
    return {
      ...base,
      currentKeyDigest: client.currentKeyDigest,
      retryDelayMs: client.retryDelayMs,
      waitBeforeRetry: client.waitBeforeRetry,
      // This provider's own limit (its preset's documented maximum, or the
      // person's setting), never `base`'s, which answers for Meta (PR #225).
      maxRetries: () => client.maxRetries(),
      listModels: () => Promise.resolve([ref]),
      // UTF-8 bytes bound text tokens conservatively and include tool schemas.
      countInputTokens: (body) => Promise.resolve(Buffer.byteLength(JSON.stringify(body))),
      ...(exactInputCount !== undefined && { countInputTokensDetailed: exactInputCount }),
      streamResponse: async function* (body, signal, onRetry, budget, admitAttempt, confirmed) {
        const minimum = providerOutputMinimum(
          entry.address,
          native,
          record.output.minTokens ?? 1,
          format,
        )
        if (body.max_output_tokens < minimum)
          throw new RangeError(outputTokenMinimumMessage(minimum))
        // C-M95-4 R3: a local server's report is its only window. A
        // windowless local model refuses here with a plain reason instead
        // of sending Meta-sized history at a small server. Before the
        // `try`, so the plain reason reaches the caller.
        const windowTokens =
          entry.modelLimits?.[native]?.contextTokens ?? record.limits.contextTokens
        if (windowTokens === undefined && entry.auth === 'none' && preset.wireCapture)
          throw new Error(fill(UI_TEXT.localModelWindowUnknown, { model: ref }))
        let usage: Usage | undefined
        const dispatch = { attempts: 0 }
        const observe = Object.assign(
          (keyDigest: string | undefined) => admitAttempt?.(keyDigest),
          {
            ...admitAttempt,
            onRequestStarted: () => {
              dispatch.attempts += 1
              admitAttempt?.onRequestStarted?.()
            },
          },
        )
        try {
          // The shared helper is the only confirmed-dispatch decision: a
          // lapsed or mismatched confirmation refuses with the run's own
          // guidance before the provider's unavailable text.
          assertConfirmedAllowed(body.model, confirmed)
          if (body.model !== ref)
            throw new ModelApiError(UI_TEXT.actionFailed, 0, undefined, undefined)
          // No limit on the stream's total time: it ends when it finishes,
          // on the caller's signal, on a budget or request cap, or after a
          // provider-named idle of silence (the transport bounds the wait
          // for headers and every gap between frames only then).
          const events = client.streamResponse(
            body,
            signal,
            onRetry,
            budget,
            observe,
            confirmed === undefined ? undefined : { ...confirmed, providerId: entry.id },
          )
          for await (const event of events) {
            if ('response' in event && event.response.usage != null) usage = event.response.usage
            yield event
          }
        } catch (error: unknown) {
          // An answered refusal keeps its status and kind, with the
          // sentence the person reads (lane PROVERR) — including a refusal
          // the provider ended its answer with, which carries the stream's
          // own status.
          if (isModelApiError(error) && (error.status !== 0 || error.kind === 'streamError'))
            throw refusalError(entry, preset, error)
          // Everything else is the product's own, raised before any answer
          // (the client turns whatever decoding an answer throws into a
          // ModelApiError): a cancellation, the stall limit, an unreachable
          // send or a lost connection, a typed codec refusal and its
          // localized reason (FIXDSTHINK2 finding 3), the output-cap minimum
          // (MINOUT), a lapsed confirmation's own guidance, a session-budget
          // or ledger stop. Each passes on unchanged, with its own message
          // and type, so the caller and the ledger see what stopped the
          // request and a refusal of ours is never retried (lane PROVERRORS:
          // a budget stop that read as "not available in this build" was
          // retried until the job died). A non-Error keeps its kind too.
          throw error
        } finally {
          if (presets.planKeyPresetById(entry.preset) !== undefined)
            for (let index = 0; index < dispatch.attempts; index++)
              plans = recordPlanUsage(plans, {
                providerId: entry.id,
                ...(usage !== undefined && {
                  tokens: {
                    inputTokens: usage.input_tokens,
                    outputTokens: usage.output_tokens,
                    source: 'reported',
                  },
                }),
              })
          options.saveUsage?.(plans)
        }
      },
    }
  }
  const registry = createProviderRegistry({
    models,
    createClient: (model) => Promise.resolve(boundClient(model.ref)),
    isCurrent: (model) => versions.get(model) === revision,
  })
  const client: ProviderClient = {
    ...base,
    listModels: async (signal) =>
      options.hasMetaKey !== undefined &&
      !(await options.hasMetaKey()) &&
      meta?.isPlanModel === undefined
        ? []
        : await delegate().listModels(signal),
    models: {
      defaultModel: async () => {
        const file = await read()
        return file.defaultModel
      },
      list: registry.list,
      resolve: async (ref) =>
        modelRef.parseModelRef(ref)?.providerId === 'meta' || meta?.isPlanModel?.(ref) === true
          ? metaResolvedModel(ref, delegate(), await delegate().planModelFacts?.(ref))
          : await registry.resolve(ref),
    },
    isPlanModel: (ref) =>
      presets.planKeyPresetById(records.get(ref)?.entry.preset ?? '') !== undefined ||
      meta?.isPlanModel?.(ref) === true,
    readPlanUsage: () => [...(meta?.readPlanUsage?.() ?? []), ...plans],
    // The plan client's catalogue facts and its Meta-free listing, so a plan
    // model listed through this client keeps its effort levels, default and
    // Fast tier (finding F79: they stopped here, and every plan model offered
    // no effort level).
    ...(meta?.planModelFacts !== undefined && {
      planModelFacts: async (ref: string) => await delegate().planModelFacts?.(ref),
    }),
    ...(meta?.listPlanModels !== undefined && {
      listPlanModels: async () => (await delegate().listPlanModels?.()) ?? [],
    }),
    // C-M95-4 R5: the saved record read at use time, for compaction
    // sizing (the host's `contextModel` seam is synchronous). The file is
    // tiny; a synchronous parse keeps every writer (panel, wizard, CLI,
    // ACP) current with no snapshot to invalidate. A carried
    // `modelLimits` window wins; otherwise the last listing's catalogue
    // window stands (catalogue records are static). An unlisted model or
    // an unknown window reads undefined.
    peekContextModel: (ref) => {
      const parsed = modelRef.parseModelRef(ref)
      const native = parsed?.modelId
      if (parsed === undefined || native === undefined) return
      try {
        const saved = providersFile.providersFileSchema.safeParse(
          JSON.parse(readFileSync(options.configFile, 'utf8')) as unknown,
        )
        if (parsed.providerId !== 'meta' && saved.success) {
          const entry = saved.data.providers.find((row) => row.id === parsed.providerId)
          // The load prunes limits for unlisted models for every other
          // reader; this synchronous read applies the same rule instead of
          // trusting a lingering map.
          const windowTokens = pruneModelLimits(entry?.models ?? [], entry?.modelLimits)?.[native]
            ?.contextTokens
          if (
            entry !== undefined &&
            windowTokens !== undefined &&
            Number.isSafeInteger(windowTokens) &&
            windowTokens > 0
          ) {
            const format = providersFile.providerFormatSchema.safeParse(
              entry.format ?? presetFor(entry).format,
            )
            if (format.success) return { format: format.data, contextTokens: windowTokens }
          }
          // A readable file that no longer lists the provider or the
          // model ends here: the cached last listing below must not
          // resurrect a removed window. A listed model without a manual
          // window falls through to its catalogue record below.
          if (entry?.models.includes(native) !== true) return
        }
      } catch {
        // An unreadable file keeps the last listing's answer below.
      }
      const bound = records.get(ref)
      if (bound === undefined) return
      const windowTokens =
        bound.entry.modelLimits?.[native]?.contextTokens ?? bound.record.limits.contextTokens
      if (windowTokens === undefined || !Number.isSafeInteger(windowTokens) || windowTokens <= 0)
        return
      const format = providersFile.providerFormatSchema.safeParse(
        bound.entry.format ?? presetFor(bound.entry).format,
      )
      return format.success ? { format: format.data, contextTokens: windowTokens } : undefined
    },
    streamResponse: async function* (body, ...args) {
      if (body.model.includes('/') && !meta?.isPlanModel?.(body.model)) {
        const resolved = await registry.resolve(body.model)
        yield* resolved.client.streamResponse(body, ...args)
      } else yield* delegate().streamResponse(body, ...args)
    },
  }
  return {
    client,
    registry,
    scan,
    openRouterExchange: async (code: string, verifier: string, callerSignal?: AbortSignal) => {
      try {
        // No timeout of our own: the exchange ends at the provider's
        // answer, a network failure, or the caller's cancellation.
        const signal = AbortSignal.any([...(callerSignal === undefined ? [] : [callerSignal])])
        signal.throwIfAborted()
        // A bad exchange input reaches the catch below, which reports the
        // connect as failed (lane PROVERRORS: no generic panel error).
        if (code.trim() === '' || !pkce.isPkceVerifier(verifier))
          throw new Error(UI_TEXT.providerConnectFailed)
        const origin = presets.presetById('openrouter')?.origin
        if (origin?.kind !== 'fixed') throw new Error(UI_TEXT.providerConnectFailed)
        const entry: ProviderEntry = {
          id: 'openrouter',
          preset: 'openrouter',
          address: origin.origin,
          auth: 'none',
          models: [],
        }
        // No credential, retries or redirects: a code can be exchanged only once.
        const bound = transportFor(entry, '')
        const url = presets.OPENROUTER_TOKEN_URL
        await unlessAborted(bound.verifyEndpoint(url), signal)
        signal.throwIfAborted()
        const response = await bound.transport.fetch(url, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(UI_TEXT.providerConnectFailed)
        }
        const value: unknown = JSON.parse(await readBoundedText(response))
        // A complete successful exchange has minted a key even if cancellation
        // arrived while its body was read. The Connect owner must report disposal.
        const key = openRouterExchangeSchema.parse(value).key
        const keyShape = presets.presetById('openrouter')?.keyShape
        if (keyShape === undefined || !presets.isKeyShape(keyShape, key))
          throw new Error(UI_TEXT.providerConnectFailed)
        return key
      } catch {
        // Never expose a response body, authorization code, verifier or returned key.
        throw new Error(UI_TEXT.providerConnectFailed)
      }
    },
    openRouterUsage: async (
      entry: ProviderEntry,
      supplied?: string,
      callerSignal?: AbortSignal,
    ) => {
      try {
        const origin = presets.presetById('openrouter')?.origin
        // A misrouted usage read reaches the catch below, which reports the
        // usage read as failed (lane PROVERRORS: no generic panel error).
        if (
          origin?.kind !== 'fixed' ||
          entry.preset !== 'openrouter' ||
          entry.auth !== 'apiKey' ||
          entry.address !== origin.origin
        )
          throw new Error(UI_TEXT.providerUsageFailed)
        // No timeout of our own: the read ends at the provider's answer, a
        // network failure, or the caller's cancellation.
        const value = await getJson(
          entry,
          '/api/v1/key',
          supplied,
          AbortSignal.any([...(callerSignal === undefined ? [] : [callerSignal])]),
          undefined,
          true,
        )
        callerSignal?.throwIfAborted()
        const { data } = openRouterUsageSchema.parse(value)
        return {
          usedTotal: data.usage,
          unlimited: data.limit === null,
          usedToday: data.usage_daily,
          usedThisWeek: data.usage_weekly,
          usedThisMonth: data.usage_monthly,
          limit: data.limit ?? undefined,
          remaining: data.limit_remaining ?? undefined,
        }
      } catch {
        throw new Error(UI_TEXT.providerUsageFailed)
      }
    },
    accountId: async () => {
      const file = await read()
      for (const entry of file.providers) {
        if (entry.auth === 'subscription') continue
        if (entry.auth === 'none') {
          const origin = endpointPolicy.originOf(entry.address ?? '')
          if (origin === undefined) throw invalidEntry(entry, { kind: 'missingAddress' })
          return digest(origin)
        }
        if ((await options.secrets.get(`${PROVIDER_SECRET_PREFIX}${entry.id}`)) === undefined)
          continue
        const key = await credential(entry)
        if (key === undefined) throw invalidEntry(entry, { kind: 'storedKeyMissing' })
        return digest(key)
      }
      return
    },
    scanRows: async (entry: ProviderEntry, key?: string, signal?: AbortSignal) => {
      const catalogue = await readCatalog()
      const preset = presetFor(entry)
      const scanned = await scan(entry, key, signal)
      return scanned.map((native) => {
        if (entry.address === undefined) throw invalidEntry(entry, { kind: 'missingAddress' })
        const id = z
          .string()
          .check(z.minLength(1))
          .parse(native['id'] ?? native['name'])
        // C-M95-4 R2: the quirks above were captured against
        // `capturedBuild`, whose list carries the live window as
        // `meta.n_ctx`. A list without it is an unknown build: offering
        // its models with an unknown window would let manual compact
        // assume Meta's window, so the scan fails closed instead.
        if (preset.id === 'llamacpp') {
          const meta = native['meta']
          const live =
            typeof meta === 'object' && meta !== null && 'n_ctx' in meta
              ? Reflect.get(meta, 'n_ctx')
              : undefined
          if (typeof live !== 'number' || !(live > 0)) {
            throw new Error(
              fill(UI_TEXT.llamacppScanMissingWindow, {
                build: preset.capturedBuild ?? preset.id,
              }),
            )
          }
        }
        // `missingAddress` above fails closed on an address-less entry, so
        // `address` is set here (lane PROVERRORS).
        const source = { kind: 'models-list' as const, ref: entry.address }
        const known =
          catalogue.providers[preset.id.replace('-plan', '')]?.models[id] ??
          catalogue.unpriced?.[preset.id.replace('-plan', '')]?.[id]
        const record = capabilities.resolveModelCapabilities(
          { provider: entry.id, nativeModel: id, format: entry.format ?? preset.format },
          [
            ...(known === undefined
              ? []
              : [
                  modelMetadata.nativeCapabilityEvidence(preset.id, known, {
                    kind: 'catalogue',
                    ref: options.catalogFile,
                  }),
                ]),
            modelMetadata.nativeCapabilityEvidence(preset.id, native, source),
          ],
        )
        const four = capabilities.capabilitiesOf({ capabilityRecord: record })
        const listed = priceCard.listedPriceCard(preset.id, native)
        const card = listed !== undefined && priceCard.isValidPriceCard(listed) ? listed : undefined
        const isPlan = presets.planKeyPresetById(entry.preset) !== undefined
        const isLocal = entry.auth === 'none'
        const isFree =
          !isPlan &&
          (isLocal ||
            (card !== undefined &&
              [
                card.input,
                card.output,
                card.cachedInput,
                card.cacheWrite,
                card.cacheWrite1h,
                card.request,
                card.image,
                card.longContextTier?.input,
                card.longContextTier?.output,
                card.longContextTier?.cachedInput,
              ].every((rate = 0) => rate === 0)))
        let priceFingerprint = 'unpriced'
        if (isPlan) priceFingerprint = 'plan'
        else if (isLocal) priceFingerprint = 'local'
        else if (card !== undefined) {
          const upstreams = z
            .array(
              z.object({
                provider: z.string(),
                pricing: z.optional(
                  z.object({
                    input: z.number().check(z.nonnegative()),
                    output: z.number().check(z.nonnegative()),
                  }),
                ),
              }),
            )
            .safeParse(native['providers'])
          priceFingerprint = JSON.stringify({
            card,
            upstreams: upstreams.success
              ? upstreams.data.toSorted((left, right) =>
                  left.provider.localeCompare(right.provider),
                )
              : undefined,
          })
        }
        return {
          id,
          label: modelRef.sanitizeModelLabel(
            typeof native['name'] === 'string' ? native['name'] : id,
          ),
          toolCapable: four.toolCalling,
          vision: four.vision,
          reasoning: four.reasoning,
          context: record.limits.contextTokens,
          priceFingerprint,
          ...(!isPlan &&
            card !== undefined && {
              inputPerMillion: Number(Usd.from(card.input).times(TOKENS_PER_MILLION).toAmount()),
              outputPerMillion: Number(Usd.from(card.output).times(TOKENS_PER_MILLION).toAmount()),
              cachedPerMillion:
                card.cachedInput === undefined
                  ? undefined
                  : Number(Usd.from(card.cachedInput).times(TOKENS_PER_MILLION).toAmount()),
            }),
          isFree,
          isLocal,
        }
      })
    },
    test: async (entry: ProviderEntry, key: string) => {
      if (entry.address === undefined) throw invalidEntry(entry, { kind: 'missingAddress' })
      const address: string = entry.address
      // RVPROVERR: an answered refusal on the probe reads as that refusal
      // (a rejected key is neither "unreachable" nor "could not be read").
      // Lane PROVERRORS: a failure with no answer says what happened — the
      // network codes of a failed send, or the entry's own cause — and only
      // a list that cannot be read keeps the probe sentences. The probe has
      // no deadline of our own (owner 2026-10-16): it ends at the provider's
      // answer or a network failure.
      const probeFailure = (error: unknown, fallback: string): string => {
        if (!isModelApiError(error)) return fallback
        return error.status === 0
          ? error.message
          : refusalSentence(refusalOf(error), providerDisplayName(entry, presetFor(entry)))
      }
      const outcome = await presets.runProviderKeyTest(
        presetFor(entry).keyTest,
        new URL(address).origin,
        async (origin, path) => {
          try {
            await getJson(
              entry,
              path,
              key,
              undefined,
              origin === new URL(address).origin ? undefined : origin,
            )
            return { ok: true, modelCount: undefined }
          } catch (error: unknown) {
            return {
              ok: false,
              paid: false,
              reason: probeFailure(error, UI_TEXT.providerProbeUnreachable),
            }
          }
        },
        async () => {
          try {
            const rows = await scan(entry, key)
            return { ok: true, modelCount: rows.length }
          } catch (error: unknown) {
            return {
              ok: false,
              paid: false,
              reason: probeFailure(error, UI_TEXT.providerProbeUnparseable),
            }
          }
        },
      )
      if (outcome.ok) return { kind: 'ok' as const, models: outcome.modelCount ?? 0 }
      // No free check exists for this preset: testing would spend money, so
      // no request is dispatched here. The panel asks the price first.
      if (outcome.paid)
        return {
          kind: 'failed' as const,
          detail: fill(UI_TEXT.providerPaidTest, {
            provider: providerDisplayName(entry, presetFor(entry)),
          }),
        }
      return { kind: 'failed' as const, detail: outcome.reason }
    },
  }
}

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
import type { StreamEvent, Usage } from '../backends/modelapi/schemas'
import type { ProviderEntry, ProviderFormat } from './providersFile'
import type { RegistryModel } from './providerRegistry'
import type { ModelCapabilityRecord } from './capabilityRecord'
import type { NativeModelMetadata } from './modelMetadata'
import { parseNdjson } from '../backends/modelapi/ndjson'
import { parseSse } from '../backends/modelapi/sse'
import { ApiKeyAuthSource, NoAuthSource } from '../backends/modelapi/authSource'
import { CodecClient, type WireCodec } from '../backends/modelapi/providerClient'
import {
  RequestTransport,
  parseJsonResponse,
  readBoundedText,
  ModelApiError,
  assertConfirmedAllowed,
  isModelApiError,
} from '../backends/modelapi/transport'
import {
  anthropicPacingLimits,
  openaiPacingLimits,
  xaiPacingLimits,
  type PacingLimits,
} from '../backends/modelapi/pacing'

/**
 * The rate-limit header reader for a preset (PROVM95): each provider's own
 * header names with their real meaning, from the 2026-10-04 captures.
 * Presets whose providers send no limit headers get none, so only a 429
 * pause applies; Groq's per-day scope, xAI's per-second scope and
 * DeepSeek's concurrency need a capture that names them.
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
import { withDeadline, unlessAborted } from '../timeouts'
import { Usd } from '../../shared/usd'
import { fill } from '../../shared/l10n/text'
import {
  ADDRESS_FAMILIES,
  ANTHROPIC_MAX_ARGUMENT_BYTES,
  ANTHROPIC_MAX_FRAME_BYTES,
  ANTHROPIC_MAX_ITEMS,
  MODEL_API_REQUEST_TIMEOUT_MS,
  MODEL_API_STREAM_IDLE_MS,
  PROVIDER_CONNECTION_LOST_CODE,
  PROVIDER_SECRET_PREFIX,
  SUBSCRIPTION_STREAM_MAX_BYTES,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../shared/constants'

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
   * How long an inference stream may send nothing, headers or frames,
   * before it is ended (MODEL_API_STREAM_IDLE_MS when absent). It is the
   * only time limit on an inference stream: there is no limit on its total.
   */
  readonly streamIdleMs?: number
}
const secretSchema = z.object({
  v: z.literal(1),
  auth: z.literal('apiKey'),
  origin: z.string(),
  secret: z.string().check(z.minLength(1)),
})
const catalogSchema = z.object({
  providers: z.record(
    z.string(),
    z.object({ models: z.record(z.string(), modelMetadata.nativeModelMetadataSchema) }),
  ),
})
const costSchema = z.object({
  input: z.number().check(z.nonnegative()),
  output: z.number().check(z.nonnegative()),
  cache_read: z.optional(z.number().check(z.nonnegative())),
  cache_write: z.optional(z.number().check(z.nonnegative())),
})
// GET /api/v1/key: m95-captures/openrouter/02-key-usage.json (2026-10-04).
/**
 * An exact decimal the response tokenizer minted. A class instance, never a
 * plain object: response JSON parses to plain objects only, so no wire
 * shape can forge one (a `{"decimal": "1e101"}` object is refused below).
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
 * Replaces per-call tokenizer markers with their minted amounts. A
 * marker-shaped wire string cannot match the call's nonce, so it survives
 * as a string and the usage schema refuses it.
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
 * A provider entry the services cannot use, as a closed cause (round 2,
 * finding 6): every cause a person can meet gets its own translated
 * sentence, with technical values (ids, origins, paths) as slots and no
 * English prose inside; a cause only a programming error can reach is one
 * defect sentence. Typed, with no HTTP status, so the `streamResponse` catch
 * below keeps its words instead of the generic error, and the ledger (which
 * only releases answered refusals) leaves it uncertain.
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
 * id for a user's own server. */
const providerDisplayName = (
  entry: ProviderEntry,
  preset: { readonly label: string; readonly category: string },
): string => (preset.category === 'custom' || preset.category === 'local' ? entry.id : preset.label)
/** Chat Completions, Responses, every chat-format quirk and the
 * ChatGPT-plan and Copilot routes share one shape-driven extractor with all
 * other formats (round 2, finding 2): it reads the body by what it IS, never
 * by a vendor's name. Anything else in it carries `parsed: false`, never a
 * product sentence. */
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
 * status, kind, code, request id and wait for the ledger and the log. */
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
 * How a configured provider's failure is read, wherever that provider is
 * asked (lane PROVERRORS): its own format's parser for an answer, the
 * sentence for a send that produced no answer (the provider, Node's own
 * failure codes, and that whether the request arrived is unknown), and the
 * sentence for an answered refusal. The turn, the key check and the
 * runtime's `providers test` all read failures through this one reader.
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
}

function ignoreProviderCache(): void {
  // Provider requests do not maintain a page cache.
}

async function* chunks(response: PinnedResponse, idleMs: number, provider: string) {
  let size = 0
  const iterator = response.body[Symbol.asyncIterator]()
  try {
    for (;;) {
      const part = await withDeadline(iterator.next(), idleMs, UI_TEXT.actionFailed)
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
  // frames. The transport ends such a stream with its stalled sentence,
  // which passes through the `streamResponse` catch below untouched.
  const idleMs = options.streamIdleMs ?? MODEL_API_STREAM_IDLE_MS
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
  const base: ProviderClient = {
    hasPaidDailyBudget: meta?.hasPaidDailyBudget ?? false,
    currentKeyDigest: () => delegate().currentKeyDigest(),
    listModels: () => delegate().listModels(),
    retryDelayMs: (attempt) => delegate().retryDelayMs(attempt),
    waitBeforeRetry: (delay, signal) => delegate().waitBeforeRetry(delay, signal),
    countInputTokens: (body) => delegate().countInputTokens(body),
    streamResponse: (body, ...args) => delegate().streamResponse(body, ...args),
    createImage: (...args) => delegate().createImage(...args),
    editImage: (...args) => delegate().editImage(...args),
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
      if (result.reason === 'invalid') throw new RangeError(result.detail)
      throw new ModelApiError(UI_TEXT.actionFailed, 0, undefined, undefined)
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
    } catch {
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
        sleep: (ms: number) =>
          new Promise<void>((done) => {
            setTimeout(done, ms)
          }),
        now: Date.now,
        random: Math.random,
        streamIdleMs: idleMs,
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
        log: {
          trace: ignoreTransportLog,
          info: ignoreTransportLog,
          warn: ignoreTransportLog,
          error: ignoreTransportLog,
        },
        // A send that produced no answer: the provider, Node's own failure
        // codes (never what a server wrote) and that whether the request
        // arrived is unknown (lane PROVERRORS).
        sendFailure: providerFailureReader(entry, preset).sendFailure,
        fetch: async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          let requestUrl: string
          if (typeof url === 'string') requestUrl = url
          else if (url instanceof URL) requestUrl = url.href
          else requestUrl = url.url
          if (target?.url.href !== requestUrl || init?.redirect !== 'error')
            throw invalidEntry(entry, { kind: 'defect', detail: requestUrl })
          const signal = init.signal ?? AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)
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
          if (options.send !== undefined)
            response = await options.send(target, body, headers, signal)
          else if (body === undefined) {
            response = await pinnedHttpsRequest(
              target,
              signal,
              ignoreProviderCache,
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
              ignoreProviderCache,
              target.url.protocol === 'http:' ? httpRequest : undefined,
              target.url.protocol !== 'http:',
            )
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
    signal: AbortSignal,
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
    signal = AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
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
        const native = catalogue.providers[preset.id.replace('-plan', '')]?.models[nativeModel]
        const evidence =
          native === undefined
            ? []
            : [
                modelMetadata.nativeCapabilityEvidence(preset.id, native, {
                  kind: 'catalogue',
                  ref: options.catalogFile,
                }),
              ]
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
            thinkingOff: preset.quirks.thinkingOff,
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
    // unversioned servers); see `replayFieldFor`.
    const replayField = presets.replayFieldFor(preset)
    const quirks: chat.ChatPresetQuirks = {
      presetId: preset.id.replace('-plan', ''),
      providerId: entry.id,
      outputCap:
        preset.quirks.outputCapParam === 'max_completion_tokens'
          ? 'max_completion_tokens'
          : 'max_tokens',
      reasoningParam,
      // A preset's declared Thinking-off switch (presets.ts) hands the codec
      // the record facts the shared resolver maps every effort with.
      ...(preset.quirks.thinkingOff !== undefined && {
        thinkingOff: preset.quirks.thinkingOff,
        effortLevels:
          record.reasoning.effortLevels.state === 'yes'
            ? record.reasoning.effortLevels.value
            : undefined,
        canDisable: record.reasoning.canDisable.state === 'yes',
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
          return anthropic.decodeAnthropicStream(parseSse(bytes), { model: ref })
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
            const request = anthropic.encodeAnthropicRequest(body, {
              model: native,
              maxTokens: body.max_output_tokens,
              effort: body.reasoning.effort,
              capabilityRecord: record,
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
            // Azure's v1 API is Responses as OpenAI's, rooted at the
            // entry's `/openai/v1` address with the deployment name as the
            // model (research §1.2 [AZ1, AZ3, AZ6]); the record above stays
            // keyed by the model family, never the deployment name.
            const isAzure = preset.id === 'azure'
            wire = responses
              .createResponsesCodec({
                sendPromptCacheKey: record.cache.acceptsKey,
                sendPromptCacheRetention: record.cache.retention.length > 0,
              })
              .encodeRequest({ ...body, model: presets.wireModelFor(entry, native) })
            if (isAzure) path = '/responses'
          }
        }

        return { path: baseAndPath(entry, path).path, body: wire, headers: extras }
      },
      decode: async function* (response) {
        if (response.body === null)
          throw new ModelApiError(UI_TEXT.actionFailed, response.status, undefined, undefined)
        for await (const event of decode(response.body, response.status)) {
          let failure: { message: string; code: string | undefined } | undefined
          if (event.type === 'error')
            failure = { message: event.message, code: event.code ?? undefined }
          else if ('response' in event && event.response.error != null)
            failure = {
              message: event.response.error.message,
              code: event.response.error.code ?? undefined,
            }
          if (failure !== undefined) {
            // A refusal inside the stream is its own kind (round 2,
            // finding 8): the provider ended its answer with an error, at
            // the answer's own status (200 when the stream carried it). The
            // sentence is built once, by the `streamResponse` catch below,
            // after the credential scrub; liability stays uncertain.
            throw new ModelApiError(failure.message, response.status, 'streamError', failure.code)
          }
          yield 'response' in event
            ? { ...event, response: { ...event.response, model: ref } }
            : event
        }
      },
    }
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
      streamIdleMs: idleMs,
      modelFor: () => ({
        id: ref,
        capabilities: capabilities.capabilitiesOf({ capabilityRecord: record }),
        contextWindow: record.limits.contextTokens ?? 0,
        maxOutputTokens: record.output.maxTokens ?? 0,
      }),
    })
    return {
      ...base,
      currentKeyDigest: client.currentKeyDigest,
      retryDelayMs: client.retryDelayMs,
      waitBeforeRetry: client.waitBeforeRetry,
      listModels: () => Promise.resolve([ref]),
      // UTF-8 bytes bound text tokens conservatively and include tool schemas.
      countInputTokens: (body) => Promise.resolve(Buffer.byteLength(JSON.stringify(body))),
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
          // on the caller's signal, on a budget or request cap, or after
          // `idleMs` of silence (the transport bounds the wait for headers
          // and every gap between frames).
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
          // retried until the job died).
          if (error instanceof Error) throw error
          throw new ModelApiError(UI_TEXT.actionFailed, 0, undefined, undefined)
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
    listModels: async () =>
      options.hasMetaKey !== undefined &&
      !(await options.hasMetaKey()) &&
      meta?.isPlanModel === undefined
        ? []
        : await delegate().listModels(),
    models: {
      list: registry.list,
      resolve: async (ref) =>
        modelRef.parseModelRef(ref)?.providerId === 'meta' || meta?.isPlanModel?.(ref) === true
          ? metaResolvedModel(ref, delegate())
          : await registry.resolve(ref),
    },
    isPlanModel: (ref) =>
      presets.planKeyPresetById(records.get(ref)?.entry.preset ?? '') !== undefined ||
      meta?.isPlanModel?.(ref) === true,
    readPlanUsage: () => [...(meta?.readPlanUsage?.() ?? []), ...plans],
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
        const signal = AbortSignal.any([
          ...(callerSignal === undefined ? [] : [callerSignal]),
          AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
        ])
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
        const value = await getJson(
          entry,
          '/api/v1/key',
          supplied,
          AbortSignal.any([
            ...(callerSignal === undefined ? [] : [callerSignal]),
            AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
          ]),
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
        const known = catalogue.providers[preset.id.replace('-plan', '')]?.models[id]
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
              ].every((rate) => (rate ?? 0) === 0)))
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
      // the probe's own time running out, or a list that cannot be read,
      // keeps the probe sentences.
      const probeFailure = (error: unknown, signal: AbortSignal, fallback: string): string => {
        if (!isModelApiError(error) || (error.status === 0 && signal.aborted)) return fallback
        return error.status === 0
          ? error.message
          : refusalSentence(refusalOf(error), providerDisplayName(entry, presetFor(entry)))
      }
      const outcome = await presets.runProviderKeyTest(
        presetFor(entry).keyTest,
        new URL(address).origin,
        async (origin, path) => {
          const signal = AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)
          try {
            await getJson(
              entry,
              path,
              key,
              signal,
              origin === new URL(address).origin ? undefined : origin,
            )
            return { ok: true, modelCount: undefined }
          } catch (error: unknown) {
            return {
              ok: false,
              paid: false,
              reason: probeFailure(error, signal, UI_TEXT.providerProbeUnreachable),
            }
          }
        },
        async () => {
          const signal = AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)
          try {
            const rows = await scan(entry, key, signal)
            return { ok: true, modelCount: rows.length }
          } catch (error: unknown) {
            return {
              ok: false,
              paid: false,
              reason: probeFailure(error, signal, UI_TEXT.providerProbeUnparseable),
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

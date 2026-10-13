// Shared configured-provider transport. Hosts supply their own secret store;
// every send rechecks configuration, credential origin and pinned DNS answers.
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
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
  priceCard,
  providersFile,
  responses,
  createProviderRegistry,
  recordPlanUsage,
  metaResolvedModel,
} from '../../host/backend/providersEntry'
import { outputTokenMinimumMessage, providerOutputMinimum } from '../../shared/providerRouting'
import { pinnedHttpsRequest, pinnedPostRequest } from '../../host/backend/modelApiEntry'
import type { PinnedResponse, PinnedTarget } from '../web/webFetch'
import type { ProviderClient } from '../backends/modelapi/client'
import type { StreamEvent, Usage } from '../backends/modelapi/schemas'
import type { ProviderEntry } from './providersFile'
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
  ModelApiError,
  assertConfirmedAllowed,
  isStaleConfirmedError,
} from '../backends/modelapi/transport'
import { withDeadline } from '../timeouts'
import { Usd } from '../../shared/usd'
import { fill } from '../../shared/l10n/text'
import {
  ADDRESS_FAMILIES,
  ANTHROPIC_MAX_ARGUMENT_BYTES,
  ANTHROPIC_MAX_FRAME_BYTES,
  ANTHROPIC_MAX_ITEMS,
  MILLISECONDS_PER_SECOND,
  MODEL_API_REQUEST_TIMEOUT_MS,
  MODEL_API_STREAM_IDLE_MS,
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
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const fail = (): never => {
  throw new Error(UI_TEXT.modelsPanelUnavailable)
}

function ignoreTransportLog(): void {
  // This adapter reports fixed failures through its caller, without retaining
  // per-request diagnostics or forwarding arbitrary provider text to a log.
}

function ignoreProviderCache(): void {
  // Provider requests do not maintain a page cache.
}

async function* chunks(response: PinnedResponse, idleMs: number) {
  let size = 0
  const iterator = response.body[Symbol.asyncIterator]()
  try {
    for (;;) {
      const part = await withDeadline(iterator.next(), idleMs, UI_TEXT.actionFailed)
      if (part.done) return
      const bytes = z.instanceof(Uint8Array).parse(part.value)
      size += bytes.byteLength
      if (size > SUBSCRIPTION_STREAM_MAX_BYTES) return fail()
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
  // frames. The transport ends such a stream with this sentence (read when
  // it is compared: the language can change while the services live).
  const idleMs = options.streamIdleMs ?? MODEL_API_STREAM_IDLE_MS
  const stalled = () =>
    fill(UI_TEXT.modelApiStalled, { seconds: Math.round(idleMs / MILLISECONDS_PER_SECOND) })
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
  const delegate = () => meta ?? fail()
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
      return fail()
    }
    revision = digest(JSON.stringify(result.file))
    return result.file
  }
  const presetFor = (entry: ProviderEntry) =>
    presets.planKeyPresetById(entry.preset) ?? presets.presetById(entry.preset) ?? fail()
  const credential = async (entry: ProviderEntry, supplied?: string) => {
    if (entry.auth === 'none') return
    if (entry.auth !== 'apiKey') return fail()
    if (supplied !== undefined) return supplied
    const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}${entry.id}`)
    if (stored === undefined) return fail()
    let value: unknown
    try {
      value = JSON.parse(stored)
    } catch {
      return fail()
    }
    const parsed = secretSchema.safeParse(value)
    return !parsed.success ||
      endpointPolicy.originOf(parsed.data.origin) !== endpointPolicy.originOf(entry.address ?? '')
      ? fail()
      : parsed.data.secret
  }
  const transportFor = (entry: ProviderEntry, supplied?: string, keyTestOrigin?: string) => {
    const preset = presetFor(entry)
    const configuredUrl = new URL(entry.address ?? fail())
    const base = new URL(keyTestOrigin ?? configuredUrl.href)
    if (
      (!preset.wireCapture && entry.preset !== 'custom' && entry.auth !== 'none') ||
      (preset.origin.kind === 'fixed' && configuredUrl.origin !== preset.origin.origin) ||
      (keyTestOrigin !== undefined &&
        (preset.keyTest.kind !== 'provider-key' || preset.keyTest.origin !== keyTestOrigin))
    )
      return fail()
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
        log: {
          trace: ignoreTransportLog,
          info: ignoreTransportLog,
          warn: ignoreTransportLog,
          error: ignoreTransportLog,
        },
        fetch: async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          let requestUrl: string
          if (typeof url === 'string') requestUrl = url
          else if (url instanceof URL) requestUrl = url.href
          else requestUrl = url.url
          if (target?.url.href !== requestUrl || init?.redirect !== 'error') return fail()
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
          let response: PinnedResponse
          try {
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
          } catch {
            // A pinned send can have reached the provider; retain its liability
            // and refuse an ambiguous retry, with no echoed diagnostic text.
            throw new ModelApiError(UI_TEXT.modelsPanelUnavailable, 0, undefined, undefined)
          }
          const iterator = chunks(response, idleMs)[Symbol.asyncIterator]()
          return new Response(
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                try {
                  const next = await iterator.next()
                  if (next.done) controller.close()
                  else controller.enqueue(next.value)
                } catch (error: unknown) {
                  controller.error(error)
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
        if (parsed.origin !== base.origin) return fail()
        if (
          keyTestOrigin !== undefined &&
          (preset.keyTest.kind !== 'provider-key' || parsed.pathname !== preset.keyTest.path)
        )
          return fail()
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
          (verdict.kind === 'confirm-private' &&
            (keyTestOrigin !== undefined || entry.privateNetwork !== true))
        )
          return fail()
        const address = answers[0] ?? fail()
        if (supplied === undefined) {
          const file = await read()
          if (
            JSON.stringify(file.providers.find((row) => row.id === entry.id)) !==
            JSON.stringify(entry)
          )
            return fail()
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
    const url = new URL(entry.address ?? fail())
    const prefix = url.pathname.replace(/\/$/, '')
    return { baseUrl: url.origin, path: prefix + path }
  }
  const getJson = async (
    entry: ProviderEntry,
    path: string,
    supplied: string | undefined,
    signal: AbortSignal,
    keyTestOrigin?: string,
  ) => {
    const preset = presetFor(entry)
    const bound = transportFor(entry, supplied, keyTestOrigin)
    const address =
      keyTestOrigin === undefined ? baseAndPath(entry, path) : { baseUrl: keyTestOrigin, path }
    const transport = new RequestTransport({
      ...bound.transport,
      auth: bound.auth,
      verifyEndpoint: bound.verifyEndpoint,
      baseUrl: address.baseUrl,
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
    return await parseJsonResponse(result, (json) => z.json().parse(json))
  }
  const scan = async (
    entry: ProviderEntry,
    supplied?: string,
    signal = AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
  ): Promise<readonly NativeModelMetadata[]> => {
    try {
      const format = entry.format ?? presetFor(entry).format
      const value = await getJson(entry, presetFor(entry).modelsList.path, supplied, signal)
      if (format === 'anthropic')
        return anthropic.parseAnthropicModelsList(value).map((row) => row.native ?? fail())
      if (format === 'gemini')
        return gemini.parseGeminiModelsList(value).map((row) => ({
          ...(row.native ?? fail()),
          id: row.id,
        }))
      return format === 'ollama'
        ? ollama.parseOllamaModelsList(value)
        : modelMetadata.parseNativeModelsList(value)
    } catch {
      return fail()
    }
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
        const model: RegistryModel = {
          ref,
          origin: endpointPolicy.originOf(entry.address ?? '') ?? fail(),
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
            // The switch rides the policy only where the record affirms
            // reasoning (see the codec quirks above).
            thinkingOff:
              record.reasoning.supported.state === 'yes' ? preset.quirks.thinkingOff : undefined,
            effortAliases: preset.quirks.effortAliases,
            ...(preset.quirks.sendUndeclaredEffort === true && { sendUndeclaredEffort: true }),
          },
          pricing,
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
    const bound = records.get(ref) ?? fail()
    const { entry, record } = bound
    const preset = presetFor(entry)
    const native = modelRef.parseModelRef(ref)?.modelId ?? fail()
    let reasoningParam: chat.ChatPresetQuirks['reasoningParam'] = 'none'
    if (record.reasoning.effortLevels.state === 'yes')
      reasoningParam = preset.id === 'openrouter' ? 'effort-object' : 'effort-flat'
    let replayField: chat.ChatPresetQuirks['replayField'] = 'none'
    switch (preset.quirks.reasoningField) {
      case 'reasoning_details': {
        replayField = 'details'
        break
      }
      case 'reasoning_content': {
        replayField = 'content'
        break
      }
      case 'content-list': {
        {
          replayField = 'chunks'
          // No default
        }
        break
      }
    }
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
          ...(preset.quirks.effortAliases !== undefined && {
            effortAliases: preset.quirks.effortAliases,
          }),
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
        path: preset.modelsList.path,
        parse: (value) =>
          modelMetadata.parseNativeModelsList(value).map((row) => ({
            id: z.string().parse(row['id']),
            capabilities: capabilities.capabilitiesOf({ capabilityRecord: record }),
            contextWindow: record.limits.contextTokens ?? 0,
            maxOutputTokens: record.output.maxTokens ?? 0,
          })),
      },
      parseError: (status, value) => {
        switch (format) {
          case 'anthropic': {
            return anthropic.parseAnthropicError(status, value)
          }
          case 'gemini': {
            return gemini.parseGeminiError(status, value)
          }
          case 'ollama': {
            return ollama.parseOllamaError(status, value, '')
          }
          default: {
            return new ModelApiError(UI_TEXT.modelsPanelUnavailable, status, undefined, undefined)
          }
        }
      },
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
            wire = JSON.parse(
              ollama.encodeOllamaRequest(body, {
                model: native,
                numCtx: entry.numCtx?.[native] ?? record.limits.contextTokens ?? fail(),
                ...(record.reasoning.supported.state === 'yes' && {
                  think: ollama.thinkForEffort(body.reasoning.effort),
                }),
              }).body,
            )
            path = ollama.OLLAMA_CHAT_PATH

            break
          }
          default: {
            wire = responses
              .createResponsesCodec({
                sendPromptCacheKey: record.cache.acceptsKey,
                sendPromptCacheRetention: record.cache.retention.length > 0,
              })
              .encodeRequest({ ...body, model: native })
          }
        }

        return { path: baseAndPath(entry, path).path, body: wire, headers: extras }
      },
      decode: async function* (response) {
        if (response.body === null) return fail()
        for await (const event of decode(response.body, response.status)) {
          if (event.type === 'error' || ('response' in event && event.response.error != null))
            return fail()
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
      transport: connection.transport,
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
          if (body.model !== ref) return fail()
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
          // A typed codec refusal (an unsupported reasoning effort and its
          // localized reason) and the output-cap minimum refusal (MINOUT)
          // reach the caller; genuinely unknown errors keep the generic
          // unavailable error (lane FIXDSTHINK2 finding 3).
          if (chat.isChatCodecError(error)) throw error
          if (error instanceof RangeError) throw error
          // A lapsed confirmation keeps the run's own guidance instead of
          // the provider's unavailable text.
          if (isStaleConfirmedError(error)) throw error
          // The idle limit ended the stream: the user is told so, in the
          // sentence the Meta Model API path uses.
          if (error instanceof ModelApiError && error.message === stalled()) throw error
          return fail()
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
    accountId: async () => {
      const file = await read()
      for (const entry of file.providers) {
        if (entry.auth === 'subscription') continue
        if (
          entry.auth === 'none' ||
          (await options.secrets.get(`${PROVIDER_SECRET_PREFIX}${entry.id}`)) !== undefined
        )
          return digest(
            entry.auth === 'none'
              ? (endpointPolicy.originOf(entry.address ?? '') ?? fail())
              : ((await credential(entry)) ?? fail()),
          )
      }
      return
    },
    scanRows: async (entry: ProviderEntry, key?: string, signal?: AbortSignal) => {
      const catalogue = await readCatalog()
      const preset = presetFor(entry)
      const scanned = await scan(entry, key, signal)
      return scanned.map((native) => {
        const id = z
          .string()
          .check(z.minLength(1))
          .parse(native['id'] ?? native['name'])
        const source = { kind: 'models-list' as const, ref: entry.address ?? fail() }
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
      const outcome = await presets.runProviderKeyTest(
        presetFor(entry).keyTest,
        new URL(entry.address ?? fail()).origin,
        async (origin, path) => {
          try {
            await getJson(
              entry,
              path,
              key,
              AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
              origin === new URL(entry.address ?? fail()).origin ? undefined : origin,
            )
            return { ok: true, modelCount: undefined }
          } catch {
            return { ok: false, paid: false, reason: UI_TEXT.providerProbeUnreachable }
          }
        },
        async () => {
          try {
            const rows = await scan(entry, key)
            return { ok: true, modelCount: rows.length }
          } catch {
            return { ok: false, paid: false, reason: UI_TEXT.providerProbeUnparseable }
          }
        },
      )
      if (outcome.ok) return { kind: 'ok' as const, models: outcome.modelCount ?? 0 }
      // No captured paid-token request is installed; never dispatch one here.
      return {
        kind: 'failed' as const,
        detail: outcome.paid ? UI_TEXT.modelsPanelUnavailable : outcome.reason,
      }
    },
  }
}

// Shared configured-provider transport. Hosts supply their own secret store;
// every send rechecks configuration, credential origin and pinned DNS answers.
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { readFile } from 'node:fs/promises'
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
import { pinnedHttpsRequest, pinnedPostRequest } from '../../host/web/pinnedRequest'
import type { PinnedResponse, PinnedTarget } from '../web/webFetch'
import type { ProviderClient } from '../backends/modelapi/client'
import type { StreamEvent, Usage } from '../backends/modelapi/schemas'
import type { ProviderEntry } from './providersFile'
import type { RegistryModel } from './providerRegistry'
import type { ModelCapabilityRecord } from './capabilityRecord'
import { parseSse } from '../backends/modelapi/sse'
import { withDeadline } from '../timeouts'
import {
  ADDRESS_FAMILIES,
  HTTP_SUCCESS_MIN,
  HTTP_SUCCESS_MAX,
  ANTHROPIC_MAX_ARGUMENT_BYTES,
  ANTHROPIC_MAX_FRAME_BYTES,
  ANTHROPIC_MAX_ITEMS,
  MODEL_API_MAX_RETRIES,
  MODEL_API_REQUEST_TIMEOUT_MS,
  MODEL_API_STREAM_IDLE_MS,
  MODEL_API_RETRYABLE_STATUSES,
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

async function* chunks(response: PinnedResponse) {
  let size = 0
  const iterator = response.body[Symbol.asyncIterator]()
  try {
    for (;;) {
      const part = await withDeadline(
        iterator.next(),
        MODEL_API_STREAM_IDLE_MS,
        UI_TEXT.actionFailed,
      )
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
      return result.reason === 'missing' ? providersFile.emptyProvidersFile() : fail()
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
  const send = async (
    entry: ProviderEntry,
    path: string,
    body: string | undefined,
    signal: AbortSignal,
    supplied?: string,
    extra: Readonly<Record<string, string>> = {},
    admit?: (keyDigest: string) => void,
  ) => {
    const preset = presetFor(entry)
    if (
      entry.address === undefined ||
      (!preset.wireCapture && entry.preset !== 'custom' && entry.auth !== 'none')
    )
      return fail()
    const url = new URL(path, entry.address)
    if (url.origin !== endpointPolicy.originOf(entry.address)) return fail()
    if (preset.origin.kind === 'fixed' && url.origin !== preset.origin.origin) return fail()
    const host = url.hostname.replaceAll(/^\[|\]$/g, '')
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
    const verdict = endpointPolicy.checkEndpointUrl(entry.address, answers)
    if (
      verdict.kind === 'refused' ||
      (verdict.kind === 'confirm-private' && entry.privateNetwork !== true)
    )
      return fail()
    const address = answers[0]
    if (address === undefined) return fail()
    const key = await credential(entry, supplied)
    const headers: Record<string, string> = { 'content-type': 'application/json', ...extra }
    if (key !== undefined)
      headers[
        (preset.authHeader ?? 'bearer') === 'bearer'
          ? 'authorization'
          : (preset.authHeader ?? 'authorization')
      ] = (preset.authHeader ?? 'bearer') === 'bearer' ? `Bearer ${key}` : key
    if (entry.format === 'anthropic') headers['anthropic-version'] = '2023-06-01'
    const target: PinnedTarget = {
      url,
      host,
      address,
      family:
        isIP(address) === ADDRESS_FAMILIES.ipv6 ? ADDRESS_FAMILIES.ipv6 : ADDRESS_FAMILIES.ipv4,
    }
    // Resolve and read the key first; then re-read the authored file immediately
    // before the synchronous admission fence and the pinned request.
    if (supplied === undefined) {
      const file = await read()
      const current = file.providers.find((row) => row.id === entry.id)
      if (JSON.stringify(current) !== JSON.stringify(entry)) return fail()
    }
    signal.throwIfAborted()
    admit?.(digest(`${url.origin}\n${key ?? ''}`))
    if (options.send !== undefined) return await options.send(target, body, headers, signal)
    if (body !== undefined)
      return await pinnedPostRequest(
        target,
        body,
        headers,
        signal,
        () => {
          /* Provider requests do not maintain a page cache. */
        },
        url.protocol === 'http:' ? httpRequest : undefined,
        url.protocol !== 'http:',
      )
    // GET carries the same origin-bound auth as POST, including free key tests.
    return await pinnedHttpsRequest(
      target,
      signal,
      () => {
        /* Provider requests do not maintain a page cache. */
      },
      (requestOptions, callback) => {
        const request = url.protocol === 'http:' ? httpRequest : undefined
        return request === undefined
          ? httpsGet({ ...requestOptions, headers: { host: url.host, ...headers } }, callback)
          : request({ ...requestOptions, headers: { host: url.host, ...headers } }, callback)
      },
      url.protocol !== 'http:',
    )
  }
  const scan = async (
    entry: ProviderEntry,
    supplied?: string,
    signal = AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
  ) => {
    try {
      const response = await send(
        entry,
        presetFor(entry).modelsList.path,
        undefined,
        signal,
        supplied,
      )
      if (response.status < HTTP_SUCCESS_MIN || response.status > HTTP_SUCCESS_MAX) {
        response.close()
        return fail()
      }
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let text = ''
      for await (const chunk of chunks(response)) text += decoder.decode(chunk, { stream: true })
      text += decoder.decode()
      const value: unknown = JSON.parse(text)
      if (entry.format === 'anthropic')
        return anthropic.parseAnthropicModelsList(value).map((row) => row.native ?? fail())
      if (entry.format === 'gemini')
        return gemini.parseGeminiModelsList(value).map((row) => row.native ?? fail())
      return entry.format === 'ollama'
        ? ollama.parseOllamaModelsList(value)
        : modelMetadata.parseNativeModelsList(value)
    } catch {
      return fail()
    }
  }
  const models = async (): Promise<RegistryModel[]> => {
    const file = await read()
    const catalogue = catalogSchema.parse(JSON.parse(await readFile(options.catalogFile, 'utf8')))
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
        const model: RegistryModel = {
          ref,
          origin: endpointPolicy.originOf(entry.address ?? '') ?? fail(),
          evidence: {
            capabilities: four,
            effortLevels: capabilities.capabilityEffortLevels(record),
            maxOutputTokens:
              entry.modelLimits?.[nativeModel]?.outputTokens ?? record.output.maxTokens,
            canDisableReasoning: record.reasoning.canDisable.state === 'yes',
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
    if (preset.quirks.reasoningField === 'reasoning_details') replayField = 'details'
    else if (preset.quirks.reasoningField === 'reasoning_content') replayField = 'content'
    const quirks: chat.ChatPresetQuirks = {
      presetId: preset.id.replace('-plan', ''),
      providerId: entry.id,
      outputCap:
        preset.quirks.outputCapParam === 'max_completion_tokens'
          ? 'max_completion_tokens'
          : 'max_tokens',
      reasoningParam,
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
          return ollama.decodeOllamaStream(bytes, {
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
    return {
      ...base,
      currentKeyDigest: async () =>
        digest(`${new URL(entry.address ?? '').origin}\n${(await credential(entry)) ?? ''}`),
      listModels: () => Promise.resolve([ref]),
      // UTF-8 bytes bound text tokens conservatively and include tool schemas.
      countInputTokens: (body) => Promise.resolve(Buffer.byteLength(JSON.stringify(body))),
      streamResponse: async function* (body, signal, onRetry, budget, admitAttempt, confirmed) {
        if (body.model !== ref) return fail()
        const format = entry.format ?? preset.format
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
        const retry = budget ?? { retriesUsed: 0 }
        for (;;) {
          let usage: Usage | undefined
          const attempt = { isDispatched: false }
          let response: PinnedResponse | undefined
          try {
            response = await send(
              entry,
              path,
              JSON.stringify(wire),
              AbortSignal.any([signal, AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)]),
              undefined,
              extras,
              (keyDigest) => {
                if (
                  confirmed !== undefined &&
                  (!confirmed.isStillAllowed() ||
                    confirmed.modelId !== ref ||
                    (confirmed.origin !== undefined &&
                      confirmed.origin !== new URL(entry.address ?? '').origin) ||
                    confirmed.keyDigest !== keyDigest)
                )
                  throw new Error(UI_TEXT.scheduleConfirmationExpired)
                admitAttempt?.(keyDigest)
                admitAttempt?.onRequestStarted?.()
                confirmed?.onRequestStarted()
                attempt.isDispatched = true
              },
            )
            if (
              MODEL_API_RETRYABLE_STATUSES.has(response.status) &&
              retry.retriesUsed < MODEL_API_MAX_RETRIES
            ) {
              response.close()
              const delayMs = delegate().retryDelayMs(retry.retriesUsed)
              retry.retriesUsed += 1
              onRetry?.({
                attempt: retry.retriesUsed,
                maxAttempts: MODEL_API_MAX_RETRIES,
                delayMs,
                reason: `HTTP ${String(response.status)}`,
              })
              await delegate().waitBeforeRetry(delayMs, signal)
              continue
            }
            if (response.status < HTTP_SUCCESS_MIN || response.status > HTTP_SUCCESS_MAX)
              return fail()
            const bytes = chunks(response)
            const events = decode(bytes, response.status)
            for await (const event of events) {
              if ('response' in event && event.response.usage != null) usage = event.response.usage
              if (event.type === 'error' || ('response' in event && event.response.error != null))
                return fail()
              yield 'response' in event
                ? { ...event, response: { ...event.response, model: ref } }
                : event
            }
            return
          } catch {
            // Provider errors and schema diagnostics can echo arbitrary keys.
            // Only fixed product text crosses the client boundary.
            return fail()
          } finally {
            response?.close()
            if (attempt.isDispatched && presets.planKeyPresetById(entry.preset) !== undefined)
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
            `${endpointPolicy.originOf(entry.address ?? '') ?? fail()}\n${(await credential(entry)) ?? ''}`,
          )
      }
      return
    },
    scanRows: async (entry: ProviderEntry, key?: string, signal?: AbortSignal) => {
      const catalogue = catalogSchema.parse(JSON.parse(await readFile(options.catalogFile, 'utf8')))
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
        return {
          id,
          label: modelRef.sanitizeModelLabel(
            typeof native['name'] === 'string' ? native['name'] : id,
          ),
          toolCapable: four.toolCalling,
          vision: four.vision,
          reasoning: four.reasoning,
          context: record.limits.contextTokens,
          priceFingerprint:
            presets.planKeyPresetById(entry.preset) === undefined ? 'unpriced' : 'plan',
          isFree: entry.auth === 'none',
          isLocal: entry.auth === 'none',
        }
      })
    },
    test: async (entry: ProviderEntry, key: string) => {
      const rows = await scan(entry, key)
      return { kind: 'ok' as const, models: rows.length }
    },
  }
}

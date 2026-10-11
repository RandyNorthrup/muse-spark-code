// M95-T: canonical client seam. Codecs/registry load only in the BYO bundle.
import type { ModelCapabilities } from '../../providers/capabilities'
import * as z from 'zod/mini'
import type { CredentialAuth } from '../../providers/credentialRecord'
import type { ProviderFormat } from '../../providers/providersFile'
import { presets } from '../../../host/backend/providersEntry'
import type { CreateResponseBody, StreamEvent } from './schemas'
import {
  RequestTransport,
  ignoreClosingError,
  redactModelApiError,
  ModelApiError,
  parseJsonResponse,
  type TransportDeps,
  type ConfirmedModelRequest,
  type ResponseAttemptGuard,
  type RetryBudget,
  type RetryNotice,
} from './transport'
import type { AuthSource } from './authSource'
import { MODEL_API_REQUEST_TIMEOUT_MS, UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { streamEventSchema, usageSchema } from '../../../host/backend/modelApiEntry'

// Only usage metadata is extensible here; item guards consume the stripped,
// parsed canonical representation, never a codec's unvalidated original.
const extendedUsageSchema = z.object({
  response: z.object({ usage: z.optional(z.nullable(z.looseObject(usageSchema.shape))) }),
})
function parseCanonicalEvent(value: unknown): StreamEvent {
  const parsed = streamEventSchema.parse(value)
  if ('response' in parsed) {
    const metadata = extendedUsageSchema.parse(value)
    return { ...parsed, response: { ...parsed.response, ...metadata.response } }
  }
  return parsed
}

export interface ProviderIdentity {
  readonly id: string
  readonly label: string
  readonly origin: string
  readonly format: ProviderFormat
  readonly auth: CredentialAuth
  readonly isLocal: boolean
}

export interface ProviderClient {
  readonly provider: ProviderIdentity
  readonly capabilities: (modelId: string) => ModelCapabilities
  streamResponse(
    body: CreateResponseBody,
    signal: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
  ): AsyncGenerator<StreamEvent>
  countInputTokens(body: Omit<CreateResponseBody, 'stream'>): Promise<number>
  /** Preserve today's host contract; registry owns the richer catalogue/model rows. */
  listModels(): Promise<readonly string[]>
  currentKeyDigest(): Promise<string>
  retryDelayMs(attempt: number): number
  waitBeforeRetry(ms: number, signal: AbortSignal): Promise<void>
}

export interface ProviderModel {
  readonly id: string
  readonly capabilities: ModelCapabilities
  readonly contextWindow: number
  readonly maxOutputTokens: number
}

export interface NativeRequest {
  /** Relative to the configured base, always confined to its exact origin. */
  readonly path: string
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>>
}

/** Implementations belong to R/H/A/G/O; every external shape is parsed there. */
export interface WireCodec {
  readonly format: ProviderFormat
  encode(body: CreateResponseBody, model: ProviderModel): NativeRequest
  decode(response: Response, model: ProviderModel): AsyncGenerator<StreamEvent>
  parseError(status: number, body: unknown, headers: Headers): ModelApiError
  readonly models: {
    readonly path: string
    readonly parse: (body: unknown) => readonly ProviderModel[]
  }
  readonly countTokens?: {
    readonly encode: (
      body: Omit<CreateResponseBody, 'stream'>,
      model: ProviderModel,
    ) => NativeRequest
    readonly parse: (body: unknown) => number
  }
}

export interface CodecClientDeps {
  readonly provider: ProviderIdentity
  readonly baseUrl: string
  readonly codec: WireCodec
  readonly auth: AuthSource
  readonly modelFor: (modelId: string) => ProviderModel
  /** Resolve names and apply P's saved-network policy before every attempt. */
  readonly verifyEndpoint: (url: string) => Promise<void>
  readonly transport: Omit<
    TransportDeps,
    'baseUrl' | 'auth' | 'apiKey' | 'parseError' | 'verifyEndpoint' | 'isTerminalError'
  >
  readonly streamIdleMs?: number
}

/** The only BYO HTTP adapter: no codec or provider implementation loads on activation. */
export class CodecClient implements ProviderClient {
  private readonly transport: RequestTransport
  public readonly provider: ProviderIdentity
  public readonly capabilities: (modelId: string) => ModelCapabilities
  public readonly currentKeyDigest: () => Promise<string>
  public readonly retryDelayMs: (attempt: number) => number
  public readonly waitBeforeRetry: (ms: number, signal: AbortSignal) => Promise<void>
  public constructor(private readonly deps: CodecClientDeps) {
    this.provider = deps.provider
    if (
      new URL(deps.baseUrl).origin !== deps.provider.origin ||
      deps.codec.format !== deps.provider.format
    ) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'provider_pin_mismatch' }),
        0,
        'origin_mismatch',
        undefined,
      )
    }
    this.capabilities = (modelId) => deps.modelFor(modelId).capabilities
    const zaiOrigin = presets.presetById('zai')?.origin
    const isZai = zaiOrigin?.kind === 'fixed' && zaiOrigin.origin === deps.provider.origin
    this.transport = new RequestTransport({
      ...deps.transport,
      baseUrl: deps.baseUrl,
      auth: deps.auth,
      verifyEndpoint: deps.verifyEndpoint,
      parseError: (status, body, headers) => deps.codec.parseError(status, body, headers),
      isTerminalError: (failure) => isZai && (failure.code === '1113' || failure.code === '1308'),
    })
    this.currentKeyDigest = this.transport.currentKeyDigest.bind(this.transport)
    this.retryDelayMs = this.transport.backoffMs.bind(this.transport)
    this.waitBeforeRetry = this.transport.pause.bind(this.transport)
  }
  public async listModels(): Promise<readonly string[]> {
    const result = await this.transport.request(
      this.deps.codec.models.path,
      { method: 'GET', accept: 'application/json' },
      AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    )
    const models = await parseJsonResponse(result, (json) => this.deps.codec.models.parse(json))
    return models.map((model) => result.redact(model.id))
  }
  public async countInputTokens(body: Omit<CreateResponseBody, 'stream'>): Promise<number> {
    const counter = this.deps.codec.countTokens
    if (counter === undefined) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'token_count_unavailable' }),
        0,
        'token_count_unavailable',
        undefined,
      )
    }
    const request = counter.encode(body, this.deps.modelFor(body.model))
    const result = await this.transport.request(
      request.path,
      {
        method: 'POST',
        body: request.body,
        ...(request.headers !== undefined && { headers: request.headers }),
        accept: 'application/json',
      },
      AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    )
    const count = await parseJsonResponse(result, (json) => counter.parse(json))
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'invalid_token_count' }),
        0,
        'invalid_token_count',
        undefined,
      )
    }
    return count
  }
  public async *streamResponse(
    ...args: Parameters<ProviderClient['streamResponse']>
  ): AsyncGenerator<StreamEvent> {
    const [body, signal, onRetry, budget, admitAttempt, confirmed] = args
    if (
      confirmed !== undefined &&
      (confirmed.modelId !== body.model ||
        confirmed.providerId !== this.provider.id ||
        confirmed.origin !== this.provider.origin ||
        !confirmed.isStillAllowed())
    ) {
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    const model = this.deps.modelFor(body.model)
    const request = this.deps.codec.encode(body, model)
    const { response, redact, redactContent, eventParsed } = await this.transport.streamRequest(
      request.path,
      {
        body: request.body,
        ...(request.headers !== undefined && { headers: request.headers }),
        accept: this.provider.format === 'ollama' ? 'application/x-ndjson' : 'text/event-stream',
      },
      signal,
      onRetry,
      budget,
      admitAttempt,
      confirmed,
      this.deps.streamIdleMs,
    )
    try {
      for await (const event of this.deps.codec.decode(response, model)) {
        const parsed = parseCanonicalEvent(event)
        // Arguments are executable payloads, not diagnostic text. Retain
        // their bytes while keeping the codec's ordinary output redaction.
        const safe: unknown = JSON.parse(JSON.stringify(parsed), (key, value: unknown) => {
          if (typeof value !== 'string') return value
          const isExecutable =
            key === 'arguments' ||
            (key === 'delta' && parsed.type === 'response.function_call_arguments.delta')
          return isExecutable ? redactContent(value) : redact(value)
        })
        const validated = parseCanonicalEvent(safe)
        eventParsed(validated)
        yield validated
      }
    } catch (error: unknown) {
      throw redactModelApiError(error, redact, response.status)
    } finally {
      if (response.body !== null && !response.body.locked) {
        void response.body.cancel().catch(ignoreClosingError)
      }
    }
  }
}

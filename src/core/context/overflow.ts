// Context protection (M101, D81), inspired by Pi's overflow classifier.
// These are already validated canonical errors/usage, never native wire parsers.
import { HTTP_TOO_MANY_REQUESTS, MODEL_API_SILENT_OVERFLOW_FRACTION } from '../../shared/constants'
import type { ModelRow } from '../providers/modelFilters'
import type { ProviderFormat } from '../providers/providersFile'

/** The selected registry row and its preset format; local windows must be loaded windows. */
export interface ContextModel extends Pick<ModelRow, 'contextTokens'> {
  readonly format: ProviderFormat
}

export type ContextOverflowKind = 'error' | 'input-above-window' | 'empty-near-window' | 'preflight'

/** An engine event for C2's guarded recovery, without native error text. */
export interface ContextOverflowEvent {
  readonly sessionId: string
  readonly turnId: string
  readonly modelId: string
  readonly kind: ContextOverflowKind
  readonly contextTokens: number | undefined
}

// Error prose is format-specific; the broad "too long" by itself is not sufficient.
const RESPONSE_PATTERNS = [
  /maximum context length/i,
  /context (?:length|window).*(?:exceed|full|limit)/i,
  /(?:input|prompt).*(?:exceed|too long).*(?:token|context|length)/i,
  /(?:input|prompt) is too long/i,
  /reduce the length of (?:the |your )?(?:messages|input|prompt)/i,
  /exceeds the (?:available context size|context window)/i,
  /(?:token limit exceeded|exceeded model token limit|context_length_exceeded)/i,
]
const PATTERNS: Record<ProviderFormat, readonly RegExp[]> = {
  responses: RESPONSE_PATTERNS,
  chat: [
    ...RESPONSE_PATTERNS,
    /(?:requested|input|prompt).*tokens.*(?:exceed|maximum|limit)/i,
    /(?:exceed|too many).*(?:context|input|prompt).*tokens/i,
    /maximum prompt length is \d+/i,
    /too many tokens/i,
    /(?:input|prompt).*greater than.*context length/i,
  ],
  anthropic: [
    /prompt is too long/i,
    /input is too long for requested model/i,
    /(?:input|prompt).*tokens.*(?:maximum|exceed|limit)/i,
  ],
  gemini: [/input token count.*exceeds.*maximum/i, /(?:input|prompt).*too (?:long|large)/i],
  ollama: [
    /(?:input|prompt).*exceeds.*context (?:length|window)/i,
    /context (?:length|window).*(?:exceed|full|limit)/i,
    /input length.*context length/i,
  ],
}
const RATE_LIMIT =
  /(?:rate[\s_-]*limit|rate exceeded|too many requests|tokens per (?:minute|day)|\b(?:429|tpm|rpm)\b)/i
const QUOTA_OR_BILLING = /(?:quota|billing|credit)/i

/** Unknown windows disable usage heuristics; unknown formats disable error-text matching. */
export function classifyContextOverflow(input: {
  readonly format: ProviderFormat | undefined
  readonly contextTokens?: number | undefined
  readonly error?: {
    readonly message: string
    readonly status?: number | undefined
    readonly code?: string | undefined
    readonly kind?: string | undefined
  }
  readonly response?: {
    readonly completed: boolean
    readonly inputTokens: number
    readonly outputTokens: number
  }
}): ContextOverflowKind | undefined {
  const { error, response, contextTokens, format } = input
  if (error !== undefined) {
    if (
      error.status === HTTP_TOO_MANY_REQUESTS ||
      RATE_LIMIT.test(`${error.code ?? ''} ${error.kind ?? ''} ${error.message}`) ||
      QUOTA_OR_BILLING.test(`${error.code ?? ''} ${error.kind ?? ''} ${error.message}`)
    )
      return undefined
    return format !== undefined &&
      PATTERNS[format].some((pattern) => pattern.test(`${error.code ?? ''} ${error.message}`))
      ? 'error'
      : undefined
  }
  if (
    contextTokens === undefined ||
    response?.completed !== true ||
    !Number.isSafeInteger(contextTokens) ||
    contextTokens <= 0 ||
    !Number.isSafeInteger(response.inputTokens) ||
    !Number.isSafeInteger(response.outputTokens) ||
    response.inputTokens < 0 ||
    response.outputTokens < 0
  )
    return undefined
  if (response.inputTokens > contextTokens) return 'input-above-window'
  return response.outputTokens === 0 &&
    response.inputTokens >= contextTokens * MODEL_API_SILENT_OVERFLOW_FRACTION
    ? 'empty-near-window'
    : undefined
}

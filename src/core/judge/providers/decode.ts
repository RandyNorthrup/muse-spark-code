// Response decoding for a bring-your-own judge (M98 phase 2, lane E).
// The Ollama chat body is the committed capture in
// test/unit/fixtures/localJudgeCapture.json (token, singular `logprob`,
// `top_logprobs`). A missing or empty logprob field is an engine failure,
// never certainty. Other vendor envelopes stay unparsed until their own
// counted capture; the normalized seam below is ours, not a guessed wire.
// No `vscode` import.

import * as z from 'zod/mini'
import type { AnswerMaterial, JudgeQuestionKind } from '../judge'
import { materialForLogprobs, materialForStated, materialForTop1 } from '../techniques'

const alternativeSchema = z.looseObject({
  token: z.string(),
  logprob: z.number(),
})

const ollamaTokenSchema = z.looseObject({
  token: z.string(),
  logprob: z.number(),
  top_logprobs: z.optional(z.array(z.unknown())),
})

const ollamaChatSchema = z.looseObject({
  model: z.string().check(z.minLength(1)),
  done: z.literal(true),
  message: z.looseObject({
    role: z.literal('assistant'),
    content: z.string(),
  }),
  prompt_eval_count: z.int().check(z.nonnegative()),
  eval_count: z.int().check(z.nonnegative()),
})

/** Codec boundary. Not a vendor body: strict, so a plural `logprobs` key fails. */
const normalizedSchema = z.strictObject({
  text: z.string(),
  usage: z.strictObject({
    input_tokens: z.int().check(z.nonnegative()),
    output_tokens: z.int().check(z.nonnegative()),
  }),
  alternatives: z.optional(z.array(z.strictObject({ token: z.string(), logprob: z.number() }))),
})

export interface ByoDecodeRequest {
  readonly model: string
  readonly technique: 'logprob' | 'top1' | 'stated'
  readonly kind: JudgeQuestionKind
  readonly optionCount: number
  /** `JUDGE_TOP1_MIN_PROB`. Passed in so a test can show the floor is applied. */
  readonly top1Floor: number
}

export interface ByoUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export type ByoDecoded =
  | { readonly outcome: 'answer'; readonly material: AnswerMaterial; readonly usage: ByoUsage }
  | { readonly outcome: 'fallback'; readonly usage: ByoUsage }
  | { readonly outcome: 'failure' }

const failure: ByoDecoded = { outcome: 'failure' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
One alternative. A plural `logprobs` key is the legacy metadata RVM98J
rejected, even when a singular `logprob` sits beside it.
*/
function readAlternative(
  value: unknown,
): { readonly token: string; readonly logprob: number } | undefined {
  if (!isRecord(value) || Object.hasOwn(value, 'logprobs')) return undefined
  const parsed = alternativeSchema.safeParse(value)
  return !parsed.success || !Number.isFinite(parsed.data.logprob)
    ? undefined
    : { token: parsed.data.token, logprob: parsed.data.logprob }
}

function readAlternatives(
  values: readonly unknown[],
): ByoDecoded | { readonly candidates: readonly { token: string; logprob: number }[] } {
  if (values.length === 0) return failure
  const candidates = []
  for (const value of values) {
    const alternative = readAlternative(value)
    if (alternative === undefined) return failure
    candidates.push(alternative)
  }
  return { candidates }
}

function fromCandidates(
  request: ByoDecodeRequest,
  candidates: readonly { readonly token: string; readonly logprob: number }[],
  usage: ByoUsage,
): ByoDecoded {
  try {
    if (request.technique === 'top1') {
      const first = candidates[0]
      if (first === undefined) return failure
      const reading = materialForTop1(
        request.kind,
        { token: first.token, probability: Math.exp(first.logprob) },
        request.top1Floor,
      )
      return reading.outcome === 'answer'
        ? { outcome: 'answer', material: reading.material, usage }
        : { outcome: 'fallback', usage }
    }
    const reading = materialForLogprobs({
      kind: request.kind,
      optionCount: request.optionCount,
      candidates,
    })
    return reading.outcome === 'answer'
      ? { outcome: 'answer', material: reading.material, usage }
      : failure
  } catch {
    return failure
  }
}

function statedFromText(request: ByoDecodeRequest, text: string, usage: ByoUsage): ByoDecoded {
  if (request.technique !== 'stated') return failure
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return failure
  }
  const reading = materialForStated({
    kind: request.kind,
    optionCount: request.optionCount,
    response: parsed,
  })
  return reading.outcome === 'answer'
    ? { outcome: 'answer', material: reading.material, usage }
    : failure
}

function decodeOllama(value: Record<string, unknown>, request: ByoDecodeRequest): ByoDecoded {
  const chat = ollamaChatSchema.safeParse(value)
  if (!chat.success || chat.data.model !== request.model) return failure
  const usage = {
    inputTokens: chat.data.prompt_eval_count,
    outputTokens: chat.data.eval_count,
  }
  if (request.technique === 'stated') {
    return statedFromText(request, chat.data.message.content, usage)
  }
  // Accepted-and-omitted (xAI, Z.ai) and an empty list are both failures.
  // The assistant text is not a probability.
  if (!Object.hasOwn(value, 'logprobs') || !Array.isArray(value['logprobs'])) return failure
  const first = ollamaTokenSchema.safeParse(value['logprobs'][0])
  if (!first.success) return failure
  const listed = first.data.top_logprobs
  const raw = listed ?? [value['logprobs'][0]]
  const alternatives = readAlternatives(raw)
  return 'outcome' in alternatives
    ? alternatives
    : fromCandidates(request, alternatives.candidates, usage)
}

function decodeNormalized(value: unknown, request: ByoDecodeRequest): ByoDecoded {
  const parsed = normalizedSchema.safeParse(value)
  if (!parsed.success) return failure
  const usage = {
    inputTokens: parsed.data.usage.input_tokens,
    outputTokens: parsed.data.usage.output_tokens,
  }
  if (request.technique === 'stated') return statedFromText(request, parsed.data.text, usage)
  if (parsed.data.alternatives === undefined) return failure
  const alternatives = readAlternatives(parsed.data.alternatives)
  return 'outcome' in alternatives
    ? alternatives
    : fromCandidates(request, alternatives.candidates, usage)
}

/**
Decode one completion. An Ollama-shaped body (`done` and `message`) is
only the captured chat schema. Anything else must be the normalized seam.
*/
export function decodeByoResponse(value: unknown, request: ByoDecodeRequest): ByoDecoded {
  if (!isRecord(value)) return failure
  return Object.hasOwn(value, 'done') || Object.hasOwn(value, 'message')
    ? decodeOllama(value, request)
    : decodeNormalized(value, request)
}

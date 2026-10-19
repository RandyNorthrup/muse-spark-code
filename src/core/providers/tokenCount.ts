// EXECPROV round 7: the exact same-body input count, built from the
// already-built native request by a per-kind function, so the count cannot
// drift from what is sent. Each kind drops the fields that are not input
// (output caps, stream flags) and sends to the request path's documented
// counting sibling on the same origin. Anything unrecognised (a path the
// kind does not own, a body that is not an object) yields undefined and the
// caller keeps the byte bound: a count is never guessed.

import * as z from 'zod/mini'
import { quirksOf, type ExactCountKind, type ProviderPreset } from './presets'

/**
The wire's counting capability from data, not from a format `if`: the
preset's own `exactCount` where only some providers of a format document
one (OpenAI's Responses siblings do; xAI's and Azure's do not), else the
format default. The entry switch turns it off. Both the client offer
(configured.ts) and the start line (runExec.ts) read this one function,
so the line can never promise a count the wire does not send.
*/
export function exactCountKindFor(
  entry: { readonly exactInputCount?: boolean | undefined },
  preset: ProviderPreset,
): ExactCountKind | undefined {
  return entry.exactInputCount === false ? undefined : quirksOf(preset).exactCount
}

/** The native request the count is derived from: path, body and headers. */
export interface EncodedCountSource {
  readonly path: string
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>> | undefined
}

/** A count request on the same origin: path and body, headers ride along. */
export interface ExactCountRequest {
  readonly path: string
  readonly body: unknown
}

const COUNT_SCHEMA_LIMIT = Number.MAX_SAFE_INTEGER

function asRecord(body: unknown): Record<string, unknown> | undefined {
  return typeof body !== 'object' || body === null || Array.isArray(body)
    ? undefined
    : (body as Record<string, unknown>)
}

/** The request body without the listed keys (shallow copy; never mutates). */
function without(body: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)))
}

/**
The count request for one already-built native request, or undefined
where the kind does not own the path or the body. Callers treat
undefined (and every transport or parse failure after it) as the byte
bound with the fixed reason: a count is never retried and never invents
a sibling for a path it does not recognise.
*/
export function buildExactCountRequest(
  kind: ExactCountKind,
  encoded: EncodedCountSource,
): ExactCountRequest | undefined {
  switch (kind) {
    case 'responses-input-tokens': {
      // OpenAI documents `POST {request-path}/input_tokens` taking the
      // same body as the response (m95-research §1.1 [O8, O13, O14]).
      return encoded.path.endsWith('/responses')
        ? { path: `${encoded.path}/input_tokens`, body: encoded.body }
        : undefined
    }
    case 'anthropic-count-tokens': {
      // `POST /v1/messages/count_tokens` takes the message request's
      // model, system, messages, tools, tool_choice and thinking — no
      // max_tokens, no stream, no metadata.
      if (!encoded.path.endsWith('/messages')) return undefined
      const body = asRecord(encoded.body)
      if (body === undefined) return undefined
      return {
        path: `${encoded.path}/count_tokens`,
        body: without(body, ['max_tokens', 'stream', 'metadata']),
      }
    }
  }
}

const tokenCountSchema = z.object({
  input_tokens: z.number().check(z.int(), z.gte(0), z.lte(COUNT_SCHEMA_LIMIT)),
})

/**
The counted input tokens from a count answer, or undefined where the
body is not a non-negative integer count. A lying count (a count larger
than the byte bound) is NOT caught here: the caller compares against
the byte bound it already holds and falls back with the fixed reason.
*/
export function parseExactCountResponse(kind: ExactCountKind, json: unknown): number | undefined {
  try {
    switch (kind) {
      case 'responses-input-tokens':
      case 'anthropic-count-tokens': {
        return tokenCountSchema.parse(json).input_tokens
      }
    }
  } catch {
    return undefined
  }
}

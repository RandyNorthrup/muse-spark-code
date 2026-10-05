// Shared BYO codec hygiene (M101 lane P1, PLAN.md D81).
//
// Three small pure helpers every BYO codec (anthropic, gemini, chat,
// responses, ollama) applies on encode, so one bad history item never breaks
// a later request (research `docs/research/pi-solpi-2026-10-05.md` §3):
//   - BYO 13: lone surrogates are removed (`cleanWireText`);
//   - BYO 1: text that is blank after trimming is dropped (`isBlankWireText`);
//   - BYO 3: tool-call ids are rewritten per target format (`nativeCallId`).
//
// No clock, no randomness, no network: the same input encodes to the same
// bytes, so the cache-stable prefix (D49, D81.5) is untouched. Compliant
// inputs pass through byte-identical; only inputs the wire would reject are
// rewritten, deterministically (FNV-1a, no dependency).

/** What a lone surrogate becomes on the wire (Unicode's own replacement). */
const SURROGATE_REPLACEMENT = '�'
/** A symbol in this scalar range, iterating alone, is a lone surrogate half. */
const LONE_SURROGATE_MIN = 0xd8_00
const LONE_SURROGATE_MAX = 0xdf_ff

/**
 * BYO 13 (Pi `sanitize-unicode.ts`): remove lone surrogates. Iterating by
 * symbol keeps valid pairs whole (one astral symbol, untouched) while a
 * lone half iterates alone and becomes U+FFFD. Applied to free text
 * crossing into native request bytes (instructions, message text, tool
 * output text, tool argument strings). Ids, names and other structural
 * fields are constrained to safe charsets elsewhere and never cleaned, so
 * call pairing cannot shift under a replacement.
 */
export function cleanWireText(text: string): string {
  return Array.from(text, (symbol) => {
    const code = symbol.codePointAt(0) ?? 0
    return code >= LONE_SURROGATE_MIN && code <= LONE_SURROGATE_MAX ? SURROGATE_REPLACEMENT : symbol
  }).join('')
}

/** BYO 1 (Pi `transform-messages.ts`): text with nothing left after trimming. */
export function isBlankWireText(text: string): boolean {
  return text.trim() === ''
}

/** A parsed JSON object (never an array, never null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * BYO 13 for parsed tool arguments: the same replacement applied to every
 * string value of a parsed JSON payload. Keys are structural and stay as
 * the model wrote them; the host's own zod parsing of the arguments stays
 * the backstop for anything else a loosened payload carries.
 */
export function cleanJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return cleanWireText(value)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cleanJsonStrings(entry))
  }
  if (!isRecord(value)) {
    return value
  }
  const cleaned: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    cleaned[key] = cleanJsonStrings(entry)
  }
  return cleaned
}

// --- BYO 3: tool-call ids per target format (Pi `openai-completions.ts`) ---

/** The wire formats with an id rule this harness replays calls onto. */
export type CallIdFormat = 'anthropic' | 'chat' | 'mistral'

/** Anthropic `tool_use` ids (the capture replays `toolu_…`). */
const ANTHROPIC_CALL_ID_PATTERN = /^[A-Za-z0-9_-]+$/
/**
 * Chat `tool_calls[].id`: OpenAI-shaped. Pi caps these at 40, but our own
 * Together capture replays a 41-character server id verbatim
 * (`call_01a10910-…`, `04-tool-call-stream-gpt-oss-120b.json`), so proven
 * wire ids must pass through. The cap stays well above anything captured
 * (64) and only catches pathological ids no format was seen to accept.
 */
const CHAT_CALL_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const CHAT_CALL_ID_MAX_LENGTH = 64
/** Mistral `tool_calls[].id`: exactly 9 alphanumerics (capture `TFgpitTpa`). */
const MISTRAL_CALL_ID_PATTERN = /^[A-Za-z0-9]{9}$/
const MISTRAL_CALL_ID_LENGTH = 9

const FNV_OFFSET_BASIS = 0x81_1c_9d_c5
const FNV_PRIME = 0x01_00_01_93
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE62_SIZE = 62
const HEX_RADIX = 16
const HEX_WIDTH = 8
const HEX_PAD = '0'

/** FNV-1a over Unicode scalar values (deterministic; byte-exact across runs). */
function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0
  for (const symbol of text) {
    hash ^= symbol.codePointAt(0) ?? 0
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

function toHex8(hash: number): string {
  return hash.toString(HEX_RADIX).padStart(HEX_WIDTH, HEX_PAD)
}

/**
 * A Mistral-shaped id for any call id: 9 base-62 digits drawn alternately
 * from two FNV-1a streams, so distinct calls stay distinct.
 */
function mistralCallId(callId: string): string {
  let first = fnv1a32(callId, FNV_OFFSET_BASIS)
  let second = fnv1a32(callId, FNV_PRIME)
  let out = ''
  for (let index = 0; index < MISTRAL_CALL_ID_LENGTH; index += 1) {
    if (index % 2 === 0) {
      out += BASE62_ALPHABET.charAt(first % BASE62_SIZE)
      first = Math.floor(first / BASE62_SIZE)
    } else {
      out += BASE62_ALPHABET.charAt(second % BASE62_SIZE)
      second = Math.floor(second / BASE62_SIZE)
    }
  }
  return out
}

/**
 * BYO 3: the call id to send on a target format. Ids the format already
 * accepts go back byte-identical (goldens only move where the old bytes
 * would have been rejected); anything else is rewritten deterministically,
 * so the call and its result still pair: both sides map the same canonical
 * `call_id` through this function.
 */
export function nativeCallId(callId: string, format: CallIdFormat): string {
  switch (format) {
    case 'anthropic': {
      if (ANTHROPIC_CALL_ID_PATTERN.test(callId)) {
        return callId
      }
      const stem = callId.replaceAll(/[^A-Za-z0-9_-]/g, '_')
      return `${stem}-${toHex8(fnv1a32(callId, FNV_OFFSET_BASIS))}`
    }
    case 'chat': {
      return callId.length <= CHAT_CALL_ID_MAX_LENGTH && CHAT_CALL_ID_PATTERN.test(callId)
        ? callId
        : `chat-${toHex8(fnv1a32(callId, FNV_OFFSET_BASIS))}`
    }
    case 'mistral': {
      return MISTRAL_CALL_ID_PATTERN.test(callId) ? callId : mistralCallId(callId)
    }
  }
}

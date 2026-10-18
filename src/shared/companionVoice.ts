import * as z from 'zod/mini'
import { MAX_TEXT_ATTACHMENT_BYTES, MUSE_VOICE_BYTES_PER_SECOND } from './constants'

// CMICCOMP: held off until Windows/macOS companion and helper receipts pass.
// These live beside the companion's protocol (not in constants.ts) so the
// activation bundle, which never speaks it, does not carry them (D6).
export const COMPANION_VOICE_RELEASE = { isReady: false }
export const COMPANION_VOICE_MAX_SECONDS = 60
export const COMPANION_VOICE_WAV_HEADER_BYTES = 44
export const COMPANION_VOICE_MAX_BYTES =
  COMPANION_VOICE_MAX_SECONDS * MUSE_VOICE_BYTES_PER_SECOND + COMPANION_VOICE_WAV_HEADER_BYTES
const BASE64_INPUT_QUANTUM_BYTES = 3
const BASE64_OUTPUT_QUANTUM_CHARS = 4
const COMPANION_VOICE_REQUEST_SLACK_BYTES = 1024
export const COMPANION_VOICE_MAX_BASE64 =
  /* @__PURE__ */ Math.ceil(COMPANION_VOICE_MAX_BYTES / BASE64_INPUT_QUANTUM_BYTES) *
  BASE64_OUTPUT_QUANTUM_CHARS
export const COMPANION_VOICE_BODY_BYTES =
  COMPANION_VOICE_MAX_BASE64 + COMPANION_VOICE_REQUEST_SLACK_BYTES
export const COMPANION_VOICE_REQUEST_MS = 120_000
export const COMPANION_VOICE_TICKET_MS = 90_000
export const COMPANION_VOICE_RECORDER_BPS = 32_000
export const COMPANION_VOICE_PCM_MAX = 32_767
export const COMPANION_VOICE_PCM_MIN = -32_768

export const companionVoiceEngineSchema = z.enum(['system', 'museVoice'])
const ticket = z.uuid()
export const companionVoiceInputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('begin'), id: ticket, engine: companionVoiceEngineSchema }),
  z.strictObject({
    type: z.literal('audio'),
    ticket,
    wav: z
      .string()
      .check(
        z.maxLength(COMPANION_VOICE_MAX_BASE64),
        z.regex(/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/),
      ),
  }),
  z.strictObject({ type: z.literal('cancel') }),
  z.strictObject({
    type: z.literal('answer'),
    id: ticket,
    answer: z.enum(['once', 'always', 'deny']),
  }),
  z.strictObject({
    type: z.literal('send'),
    text: z.string().check(z.minLength(1), z.maxLength(MAX_TEXT_ATTACHMENT_BYTES)),
  }),
])
export const companionVoiceOutputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready'), id: ticket, ticket, paid: z.boolean() }),
  z.strictObject({
    type: z.literal('transcript'),
    ticket,
    text: z.string(),
    paid: z.boolean(),
    seconds: z.number().check(z.gte(0)),
  }),
  z.strictObject({ type: z.literal('sent') }),
  z.strictObject({
    type: z.literal('consent'),
    id: ticket,
    capture: ticket,
    title: z.string(),
    detail: z.string(),
    canRemember: z.boolean(),
  }),
  z.strictObject({ type: z.literal('error'), text: z.string() }),
])
export type CompanionVoiceInput = z.infer<typeof companionVoiceInputSchema>
export type CompanionVoiceOutput = z.infer<typeof companionVoiceOutputSchema>
export type CompanionVoiceEngine = z.infer<typeof companionVoiceEngineSchema>

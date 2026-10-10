import * as z from 'zod/mini'
import { COMPANION_VOICE_MAX_BASE64, MAX_TEXT_ATTACHMENT_BYTES } from './constants'

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

// The context part that rides with a message replying to, asking about or
// commenting on something in the chat (M17). Pure: a tagged block the model
// reads alongside the typed text, naming who wrote the referenced passage
// and what the user is doing with it. The transcript shows the typed text
// only (M5's displayText).

import {
  CHAT_REFERENCE_AUTHORS,
  CHAT_REFERENCE_MAX_CHARS,
  CHAT_REFERENCE_TAG,
  MODEL_TEXT,
} from '../shared/constants'
import type { ChatReference } from '../shared/protocol'

const LEADS: Readonly<Record<ChatReference['intent'], string>> = {
  reply: MODEL_TEXT.replyContextLead,
  question: MODEL_TEXT.questionContextLead,
  comment: MODEL_TEXT.commentContextLead,
}

function authorOf(role: string): string {
  return CHAT_REFERENCE_AUTHORS[role] ?? role
}

function clipped(text: string): string {
  return text.length <= CHAT_REFERENCE_MAX_CHARS
    ? text
    : `${text.slice(0, CHAT_REFERENCE_MAX_CHARS)}\n${MODEL_TEXT.referenceTruncated} ${String(CHAT_REFERENCE_MAX_CHARS)} ${MODEL_TEXT.referenceCharacters}`
}

export function chatReferenceText(reference: ChatReference): string {
  const lead = `${LEADS[reference.intent]} ${authorOf(reference.role)}.`
  return `<${CHAT_REFERENCE_TAG} intent="${reference.intent}" from="${reference.role}">${lead}\n"""\n${clipped(reference.text)}\n"""</${CHAT_REFERENCE_TAG}>`
}

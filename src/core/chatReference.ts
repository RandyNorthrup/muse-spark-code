// The context part that rides with a message replying to, asking about or
// commenting on something in the chat (M17). Pure: a tagged block the model
// reads alongside the typed text, naming who wrote the referenced passage
// and what the user is doing with it. The transcript shows the typed text
// only (M5's displayText).

import {
  CHAT_REFERENCE_AUTHORS,
  CHAT_REFERENCE_MAX_CHARS,
  CHAT_REFERENCE_TAG,
  UI_TEXT,
} from '../shared/constants'
import type { ChatReference } from '../shared/protocol'

const LEADS: Readonly<Record<ChatReference['intent'], string>> = {
  reply: UI_TEXT.replyContextLead,
  question: UI_TEXT.questionContextLead,
  comment: UI_TEXT.commentContextLead,
}

function authorOf(role: string): string {
  return CHAT_REFERENCE_AUTHORS[role] ?? role
}

function clipped(text: string): string {
  return text.length <= CHAT_REFERENCE_MAX_CHARS
    ? text
    : `${text.slice(0, CHAT_REFERENCE_MAX_CHARS)}\n${UI_TEXT.referenceTruncated} ${String(CHAT_REFERENCE_MAX_CHARS)} ${UI_TEXT.referenceCharacters}`
}

export function chatReferenceText(reference: ChatReference): string {
  const lead = `${LEADS[reference.intent]} ${authorOf(reference.role)}.`
  return `<${CHAT_REFERENCE_TAG} intent="${reference.intent}" from="${reference.role}">${lead}\n"""\n${clipped(reference.text)}\n"""</${CHAT_REFERENCE_TAG}>`
}

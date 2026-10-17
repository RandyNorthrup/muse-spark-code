import type { AgentSession } from '../agent/agentBackend'
import { isPromptSettledError, PromptSettledError } from '../agent/agentBackend'
import { CLARIFICATION_MAX_CHARS, QUESTION_MODEL_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { withDeadline } from '../timeouts'

export function questionDeferralText(userInputId: string): string {
  return fill(QUESTION_MODEL_TEXT.deferred, { id: userInputId })
}

/** M46's captured clarification, loaded only when an actual question defers. */
export async function deferMuseQuestions(
  session: Pick<AgentSession, 'onEvent' | 'clarifyQuestions'>,
  userInputId: string,
  canMark: () => boolean,
  unmark: () => void,
  timeoutMs: number,
  timeoutText: string,
): Promise<void> {
  const text = fill(QUESTION_MODEL_TEXT.deferredClarification, { id: userInputId })
  if (text.length > CLARIFICATION_MAX_CHARS || !canMark())
    throw new PromptSettledError('alreadySettled', `question ${userInputId} cannot defer`)
  let release: (() => void) | undefined
  const settled = new Promise<void>((resolve) => {
    release = session.onEvent((event) => {
      if (event.type === 'questionSettled' && event.userInputId === userInputId) resolve()
    })
  })
  try {
    await session.clarifyQuestions(userInputId, text)
    await withDeadline(settled, timeoutMs, timeoutText)
  } catch (error: unknown) {
    if (isPromptSettledError(error)) unmark()
    throw error
  } finally {
    release?.()
  }
}

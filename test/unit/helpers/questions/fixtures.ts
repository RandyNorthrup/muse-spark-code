import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { UI_TEXT } from '../../../../src/shared/constants'
import type { OpenQuestion } from '../../../../src/shared/questions'

/** Internal harness fixture; M46 remains the source for actual MSP frames. */
export function questionFixture(overrides: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    userInputId: 'q-1',
    sessionId: 'session-1',
    itemId: 'item-1',
    turnId: 'turn-1',
    questions: [
      {
        id: 'colour',
        header: 'Colour',
        question: 'Which colour?',
        selection: { mode: 'single' },
        options: [{ label: 'Blue' }, { label: 'Green' }],
      },
    ],
    key: 'which colour?|blue|green',
    state: 'open',
    askedAt: 1000,
    deadlineAt: 61_000,
    deferredAt: 61_000,
    reminders: 0,
    backend: 'modelApi',
    ...overrides,
  }
}

/** The ACP-local commands announced without invoking the conversation model. */
export function expectedQuestionCommandsUpdate(): SessionUpdate {
  return {
    sessionUpdate: 'available_commands_update',
    availableCommands: [
      { name: 'help', description: UI_TEXT.referenceIntro, input: null },
      { name: 'answer', description: UI_TEXT.acpAnswerHelp, input: { hint: '<n> <text>' } },
      { name: 'questions', description: UI_TEXT.acpQuestionsHelp, input: null },
    ],
  }
}

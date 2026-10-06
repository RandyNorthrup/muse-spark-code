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
    deferredAt: 61_000,
    reminders: 0,
    backend: 'modelApi',
    ...overrides,
  }
}

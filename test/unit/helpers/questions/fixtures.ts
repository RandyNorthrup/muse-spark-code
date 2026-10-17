import type { OpenQuestion } from '../../../../src/shared/questions'
import type { WaitingApproval } from '../../../../src/webview/state/uiState'

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

/** A shell approval waiting on its first step, for dock-arrival scenes. */
export function approvalFixture(overrides: Partial<WaitingApproval> = {}): WaitingApproval {
  return {
    entryId: 'approval-row-2',
    toolName: 'exec',
    approval: {
      approvalId: 'a2',
      requirementId: { approvalId: 'a2', sourceIndex: 0 },
      subject: { kind: 'shell', command: 'Get-Date' },
      rawArgs: '{"command":"Get-Date"}',
      availableChoices: [
        { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
      ],
      isProtectedWrite: false,
      isJudgeEscalated: false,
    },
    ...overrides,
  }
}

// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATTENTION_DOCK_MAX_VIEWPORT_FRACTION,
  MCP_ELICITATION_TIMEOUT_MS,
} from '../../src/shared/constants'
import { QUESTION_STATES } from '../../src/shared/questions'
import { AttentionDock, type AttentionDockProps } from '../../src/webview/components/AttentionDock'
import { QuestionCard } from '../../src/webview/components/QuestionCard'
import { QuestionSurface } from '../../src/webview/components/QuestionSurface'
import type {
  PendingElicitation,
  PendingQuestion,
  WaitingApproval,
} from '../../src/webview/state/uiState'
import { questionFixture } from './helpers/questions/fixtures'
import { warmDeferredSurfaces } from './helpers/warmDeferredSurfaces'

beforeAll(warmDeferredSurfaces)

type Group = NonNullable<AttentionDockProps['questionGroup']>
const form: PendingElicitation = {
  elicitationId: 'form-1',
  server: 'Profile',
  message: 'Your nickname?',
  fields: [{ name: 'nickname', type: 'string', required: true }],
}
const approval: WaitingApproval = {
  entryId: 'approval-row',
  toolName: 'shell',
  approval: {
    approvalId: 'a1',
    requirementId: { approvalId: 'a1', sourceIndex: 0 },
    subject: { kind: 'shell', command: 'pwd' },
    rawArgs: '{}',
    availableChoices: [
      { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
    ],
    isProtectedWrite: false,
    isJudgeEscalated: false,
  },
}
function group(
  questions: readonly PendingQuestion[],
  elicitations: readonly PendingElicitation[] = [],
): Group {
  return {
    questions,
    elicitations,
    onAnswer: vi.fn(),
    onCancel: vi.fn(),
    onClarify: vi.fn(),
    onAcceptElicitation: vi.fn(),
    onDeclineElicitation: vi.fn(),
    onCancelElicitation: vi.fn(),
    onJump: vi.fn(),
  }
}
function scene(
  questionGroup: Group,
  waiting: readonly WaitingApproval[] = [],
  isInert = false,
  sessionId = 'session-1',
) {
  return (
    <QuestionSurface sessionId={sessionId} navigation={undefined} onDismiss={vi.fn()}>
      <main>
        {questionGroup.questions.map((question) => (
          <QuestionCard
            key={question.userInputId}
            question={question}
            onAnswer={questionGroup.onAnswer}
            onCancel={questionGroup.onCancel}
            onClarify={questionGroup.onClarify}
          />
        ))}
      </main>
      <AttentionDock
        waiting={waiting}
        onDecide={vi.fn()}
        questionGroup={questionGroup}
        isInert={isInert}
      />
    </QuestionSurface>
  )
}
async function mountScene(...args: Parameters<typeof scene>) {
  const view = render(scene(...args))
  await act(async () => {
    await import('../../src/webview/components/QuestionUi')
  })
  return view
}
function dock() {
  return screen.getByRole('region')
}
function waitingQuestion(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return { ...questionFixture({ state: 'waiting', deferredAt: undefined }), ...overrides }
}

function newestQuestion(askedAt = questionFixture().askedAt): PendingQuestion {
  return waitingQuestion({
    userInputId: 'q-2',
    askedAt,
    questions: [{ ...questionFixture().questions[0]!, header: 'Newest' }],
  })
}

async function focusedWaitingScene() {
  const actions = group([waitingQuestion()])
  const view = await mountScene(actions)
  const input = within(dock()).getByLabelText('Other: Colour')
  act(() => {
    input.focus()
  })
  return { ...view, actions, input }
}

afterEach(() => {
  vi.useRealTimers()
})
describe('M112 attention dock and the two views', () => {
  it('lets a new waiting question replace an unfocused retained draft without losing it', async () => {
    const { actions, rerender, input } = await focusedWaitingScene()
    fireEvent.change(input, { target: { value: 'Teal' } })
    const composer = document.createElement('textarea')
    composer.value = 'typing'
    document.body.append(composer)
    act(() => {
      composer.focus()
    })
    const newest = newestQuestion(2000)
    rerender(scene({ ...actions, questions: [questionFixture(), newest] }))
    expect(within(dock()).getByRole('group', { name: 'Newest' })).toBeVisible()
    expect(composer).toHaveFocus()
    rerender(scene({ ...actions, questions: [questionFixture()] }))
    fireEvent.click(within(dock()).getByRole('button', { name: '1 open question' }))
    expect(within(dock()).getByLabelText('Other: Colour')).toHaveValue('Teal')
    composer.remove()
  })

  it('prefers the last arrival when waiting questions have matching timestamps', async () => {
    const newest = newestQuestion()
    await mountScene(group([waitingQuestion(), newest]))
    expect(within(dock()).getByRole('group', { name: 'Newest' })).toBeVisible()
  })

  it.each(['focus', 'typing'])(
    'protects a question with %s when a newer waiting question arrives',
    async (protection) => {
      const { actions, rerender, input } = await focusedWaitingScene()
      if (protection === 'typing') {
        fireEvent.change(input, { target: { value: 'Teal' } })
      }
      const newest = newestQuestion(2000)
      rerender(scene({ ...actions, questions: [questionFixture(), newest] }))
      expect(within(dock()).getByRole('group', { name: 'Colour' })).toBeVisible()
      expect(within(dock()).queryByRole('group', { name: 'Newest' })).toBeNull()
      if (protection === 'typing') expect(input).toHaveValue('Teal')
      expect(input).toHaveFocus()
    },
  )

  it('pins waiting questions newest first, MCP forms next, with one full dock card', async () => {
    const older = waitingQuestion({
      userInputId: 'old',
      askedAt: 0,
      questions: [{ ...questionFixture().questions[0]!, header: 'Oldest' }],
    })
    await mountScene(group([waitingQuestion(), older], [form]))
    const region = within(dock())
    expect(
      region
        .getAllByRole('button', { name: /^Open question:/ })
        .map((button) => button.textContent),
    ).toEqual(['Open question: Colour', 'Open question: Oldest'])
    expect(region.getByRole('group', { name: 'Colour' })).toBeVisible()
    expect(region.queryByRole('group', { name: 'Oldest' })).toBeNull()
    expect(region.queryByRole('form')).toBeNull()
    expect(dock().style.maxHeight).toBe(`${String(ATTENTION_DOCK_MAX_VIEWPORT_FRACTION * 100)}vh`)
    fireEvent.click(region.getByRole('button', { name: 'Profile' }))
    expect(region.getByRole('form')).toBeVisible()
    expect(region.queryByRole('group', { name: 'Oldest' })).toBeNull()
    expect(MCP_ELICITATION_TIMEOUT_MS).toBe(300_000)
  })

  it('puts approvals first and keeps every question/form compact until the approval settles', async () => {
    const questions = group([waitingQuestion(), questionFixture({ userInputId: 'open-2' })], [form])
    const { rerender } = await mountScene(questions, [approval])
    const region = within(dock())
    expect(region.getByRole('button', { name: 'Allow once' })).toBeEnabled()
    expect(region.queryByRole('radio')).toBeNull()
    expect(region.queryByRole('form')).toBeNull()
    expect(region.getByRole('button', { name: '1 open question' })).toBeVisible()
    rerender(scene(questions))
    expect(within(dock()).getByRole('group', { name: 'Colour' })).toBeVisible()
  })

  it('renders exactly one interactive card and a labelled compact transcript marker', async () => {
    const questions = group([waitingQuestion()])
    await mountScene(questions)
    const row = within(screen.getByRole('main'))
    expect(row.getByText('Open question')).toBeVisible()
    expect(row.getByRole('button', { name: 'Answer Open question Colour' })).toBeEnabled()
    expect(row.queryByRole('radio')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Submit' })).toHaveLength(1)
    expect(screen.getByRole('main').querySelector('input, textarea, [role="tab"]')).toBeNull()
    fireEvent.click(row.getByRole('button', { name: 'Answer Open question Colour' }))
    expect(within(dock()).getByRole('radio', { name: 'Blue' })).toHaveFocus()
    fireEvent.click(within(dock()).getByRole('radio', { name: 'Blue' }))
    fireEvent.click(within(dock()).getByRole('button', { name: 'Explain instead' }))
    fireEvent.change(within(dock()).getByLabelText('Your explanation'), {
      target: { value: 'Need more context' },
    })
    expect(screen.getAllByLabelText('Your explanation')).toHaveLength(1)
    expect(within(dock()).getByLabelText('Your explanation')).toHaveValue('Need more context')
  })

  it('defers on the host snapshot while keeping a focused or drafted card full, preserving its late answer', async () => {
    const actions = group([waitingQuestion()])
    const { rerender } = await mountScene(actions)
    const box = within(dock()).getByLabelText('Other: Colour')
    act(() => {
      box.focus()
    })
    fireEvent.change(box, { target: { value: 'Teal' } })
    rerender(scene({ ...actions, questions: [questionFixture()] }))
    expect(box).toHaveFocus()
    expect(box).toBeVisible()
    expect(box).toHaveValue('Teal')
    fireEvent.click(within(dock()).getByRole('button', { name: 'Collapse question' }))
    expect(within(dock()).queryByRole('textbox')).toBeNull()
    fireEvent.click(within(dock()).getByRole('button', { name: 'Answer' }))
    expect(within(dock()).getByLabelText('Other: Colour')).toHaveValue('Teal')
    fireEvent.click(within(dock()).getByRole('button', { name: 'Submit' }))
    expect(actions.onAnswer).toHaveBeenCalledWith('q-1', [
      { questionId: 'colour', freeText: 'Teal' },
    ])
  })

  it('folds an unfocused undrafted question at deferral and opens it from the chip', async () => {
    const actions = group([waitingQuestion()])
    // Typing in the composer prevents arrival focus, as it does for approvals.
    const composer = document.createElement('textarea')
    composer.value = 'typing'
    document.body.append(composer)
    composer.focus()
    const { rerender } = await mountScene(actions)
    rerender(scene({ ...actions, questions: [questionFixture()] }))
    expect(composer).toHaveFocus()
    const region = within(dock())
    expect(region.queryByRole('textbox')).toBeNull()
    fireEvent.click(region.getByRole('button', { name: '1 open question' }))
    expect(region.getByRole('textbox')).toBeVisible()
    fireEvent.click(region.getByRole('button', { name: 'Next open question' }))
    fireEvent.click(region.getByRole('button', { name: 'Previous open question' }))
    expect(vi.mocked(actions.onJump).mock.calls).toEqual([['next'], ['previous']])
    composer.remove()
  })

  it('preserves an MCP draft while selecting another card; settlement removes its send controls', async () => {
    const actions = group([waitingQuestion()], [form])
    const { rerender } = await mountScene(actions)
    fireEvent.click(within(dock()).getByRole('button', { name: 'Profile' }))
    fireEvent.change(within(dock()).getByLabelText('nickname'), { target: { value: 'River' } })
    fireEvent.click(within(dock()).getByRole('button', { name: 'Open question: Colour' }))
    fireEvent.click(within(dock()).getByRole('button', { name: 'Profile' }))
    expect(within(dock()).getByLabelText('nickname')).toHaveValue('River')
    rerender(scene(actions, [], false, 'new-session'))
    fireEvent.click(within(dock()).getByRole('button', { name: 'Profile' }))
    expect(within(dock()).getByLabelText('nickname')).toHaveValue('')
    rerender(scene({ ...actions, elicitations: [] }, [], false, 'new-session'))
    expect(within(dock()).queryByRole('form')).toBeNull()
  })

  it('clears only the question draft on a session change and never takes focus behind a modal', async () => {
    const actions = group([waitingQuestion()])
    const { rerender } = await mountScene(actions)
    const box = within(dock()).getByLabelText('Other: Colour')
    fireEvent.change(box, { target: { value: 'Old draft' } })
    rerender(scene(actions, [], true, 'other'))
    expect(within(dock()).getByLabelText('Other: Colour')).toHaveValue('')
    expect(dock()).toHaveAttribute('inert')
  })

  it('has a non-ticking countdown, no live region in the card, and distinct terminal state labels/icons', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const actions = group([waitingQuestion()])
    const { container, rerender } = await mountScene(actions)
    expect(within(dock()).getByText('Muse keeps working in 60 s if you don’t answer')).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(within(dock()).getByText('Muse keeps working in 59 s if you don’t answer')).toBeVisible()
    expect(container.querySelector('[aria-live]')).toBeNull()
    const labels = [
      'Open question',
      'Open question',
      'Answered',
      'Declined',
      'Explained',
      'Answered later',
      'Answered when asked again',
      'Dismissed',
      'Expired',
    ]
    const icons = new Set<string>()
    for (const [index, state] of QUESTION_STATES.entries()) {
      rerender(scene({ ...actions, questions: [{ ...questionFixture(), state }] }))
      expect(within(screen.getByRole('main')).getByText(labels[index]!)).toBeVisible()
      if (state === 'waiting' || state === 'open') {
        continue
      }

      icons.add(screen.getByRole('main').querySelector('.question-state-icon')?.textContent ?? '')
      expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Submit' })).toBeNull()
    }
    expect(icons.size).toBe(QUESTION_STATES.length - 2)
  })
})

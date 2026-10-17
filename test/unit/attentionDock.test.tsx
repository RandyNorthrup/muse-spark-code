// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AttentionDock, type AttentionDockProps } from '../../src/webview/components/AttentionDock'
import { QuestionCard } from '../../src/webview/components/QuestionCard'
import { QuestionSurface } from '../../src/webview/components/QuestionSurface'
import { questionFixture } from './helpers/questions/fixtures'

beforeAll(async () => {
  await import('../../src/webview/components/QuestionUi')
})

type Group = NonNullable<AttentionDockProps['questionGroup']>
function actions(): Group {
  return {
    questions: [questionFixture({ state: 'waiting', deferredAt: undefined })],
    elicitations: [],
    onAnswer: vi.fn(),
    onCancel: vi.fn(),
    onClarify: vi.fn(),
    onAcceptElicitation: vi.fn(),
    onDeclineElicitation: vi.fn(),
    onCancelElicitation: vi.fn(),
    onJump: vi.fn(),
  }
}

function scene(group: Group, sessionId = 'session-1', isInert = false) {
  return (
    <QuestionSurface sessionId={sessionId} navigation={undefined} onDismiss={vi.fn()}>
      <main>
        {group.questions.map((question) => (
          <QuestionCard
            key={question.userInputId}
            question={question}
            onAnswer={group.onAnswer}
            onCancel={group.onCancel}
            onClarify={group.onClarify}
          />
        ))}
      </main>
      <AttentionDock waiting={[]} onDecide={vi.fn()} questionGroup={group} isInert={isInert} />
    </QuestionSurface>
  )
}

async function focusedDraft(group: Group) {
  const view = await mount(group)
  const box = dock().getByLabelText('Other: Colour')
  act(() => {
    box.focus()
  })
  fireEvent.change(box, { target: { value: 'Teal' } })
  return { view, box }
}

async function mount(group: Group) {
  let view: ReturnType<typeof render> | undefined
  await act(async () => {
    view = render(scene(group))
    await import('../../src/webview/components/QuestionUi')
  })
  if (view === undefined) throw new Error('Question surface did not mount')
  return view
}

const dock = () => within(screen.getByRole('region'))

describe('real question dock and draft surface', () => {
  it('keeps a focused draft through deferral and submits that same late answer', async () => {
    const group = actions()
    const { view, box } = await focusedDraft(group)
    view.rerender(scene({ ...group, questions: [questionFixture()] }))
    expect(box).toHaveFocus()
    expect(box).toBeVisible()
    expect(box).toHaveValue('Teal')
    fireEvent.click(dock().getByRole('button', { name: 'Collapse Question' }))
    expect(dock().queryByRole('textbox')).toBeNull()
    fireEvent.click(dock().getByRole('button', { name: 'Answer' }))
    expect(dock().getByLabelText('Other: Colour')).toHaveValue('Teal')
    fireEvent.click(dock().getByRole('button', { name: 'Submit' }))
    expect(group.onAnswer).toHaveBeenCalledWith('q-1', [{ questionId: 'colour', freeText: 'Teal' }])
  })

  it('does not replace the focused question when another waiting question arrives', async () => {
    const group = actions()
    const { view, box } = await focusedDraft(group)
    const newest = questionFixture({
      userInputId: 'q-2',
      state: 'waiting',
      deferredAt: undefined,
      askedAt: 2000,
      questions: [{ ...questionFixture().questions[0]!, header: 'Newest' }],
    })
    view.rerender(scene({ ...group, questions: [questionFixture(), newest] }))
    expect(dock().getByRole('group', { name: 'Colour' })).toBeVisible()
    expect(dock().queryByRole('group', { name: 'Newest' })).toBeNull()
    expect(box).toHaveFocus()
    expect(box).toHaveValue('Teal')
  })

  it('discards the old session draft and remains inert behind a modal', async () => {
    const group = actions()
    const view = await mount(group)
    fireEvent.change(dock().getByLabelText('Other: Colour'), { target: { value: 'Old draft' } })
    view.rerender(scene(group, 'other-session', true))
    expect(dock().getByLabelText('Other: Colour')).toHaveValue('')
    expect(screen.getByRole('region')).toHaveAttribute('inert')
  })
})

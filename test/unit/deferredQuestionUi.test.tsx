// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeferredQuestionCard } from '../../src/webview/components/DeferredQuestionUi'
import { AttentionDock } from '../../src/webview/components/AttentionDock'
import { QuestionSurface, useAttentionSurface } from '../../src/webview/components/QuestionSurface'
import { questionFixture } from './helpers/questions/fixtures'

const loading = vi.hoisted(() => Promise.withResolvers<undefined>())
vi.mock('../../src/webview/components/QuestionUi', async (original) => {
  await loading.promise
  return await original()
})

function DraftControl() {
  const surface = useAttentionSurface()
  return (
    <button
      type="button"
      onClick={() => {
        surface?.update('q-1', {
          isExplaining: true,
          explanation: 'Kept while loading',
        })
      }}
    >
      Seed draft
    </button>
  )
}

describe('the first lazy question', () => {
  it('keeps an arrival visible and preserves a shared draft through chunk loading and remounting', async () => {
    const question = questionFixture({ state: 'waiting' })
    const actions = { onAnswer: vi.fn(), onCancel: vi.fn(), onClarify: vi.fn() }
    function scene(isMounted = true) {
      return (
        <QuestionSurface sessionId="session-1" navigation={undefined} onDismiss={vi.fn()}>
          <DraftControl />
          {isMounted ? (
            <>
              <DeferredQuestionCard question={question} {...actions} />
              <AttentionDock
                waiting={[]}
                onDecide={vi.fn()}
                questionGroup={{
                  questions: [question],
                  elicitations: [],
                  ...actions,
                  onAcceptElicitation: vi.fn(),
                  onDeclineElicitation: vi.fn(),
                  onCancelElicitation: vi.fn(),
                  onJump: vi.fn(),
                }}
              />
            </>
          ) : null}
        </QuestionSurface>
      )
    }
    const { rerender } = render(scene())
    const pending = screen.getAllByRole('group', { name: 'Colour' })
    expect(pending).toHaveLength(2)
    for (const card of pending) {
      expect(card).toBeVisible()
      expect(card).toHaveAttribute('aria-busy', 'true')
      expect(within(card).queryByRole('button', { name: 'Submit' })).toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Seed draft' }))
    await act(async () => {
      loading.resolve(undefined)
      await loading.promise
    })
    const explanations = await screen.findAllByLabelText('Your explanation')
    expect(explanations).toHaveLength(2)
    for (const explanation of explanations) expect(explanation).toHaveValue('Kept while loading')
    rerender(scene(false))
    rerender(scene())
    for (const explanation of screen.getAllByLabelText('Your explanation'))
      expect(explanation).toHaveValue('Kept while loading')
    fireEvent.click(screen.getAllByRole('button', { name: 'Send explanation' })[0]!)
    expect(actions.onClarify).toHaveBeenCalledWith('q-1', 'Kept while loading')
  })
})

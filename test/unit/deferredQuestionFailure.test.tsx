// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { DeferredQuestionCard } from '../../src/webview/components/DeferredQuestionUi'
import { ErrorBoundary } from '../../src/webview/components/ErrorBoundary'
import { retrySurface } from '../../src/webview/surfaceRetry'
import { questionFixture } from './helpers/questions/fixtures'

vi.mock('../../src/webview/surfaceRetry', () => ({ retrySurface: vi.fn() }))
vi.mock('../../src/webview/components/QuestionUi', () => {
  throw new Error('private chunk failure detail')
})

it('keeps a failed question chunk local and offers the shared document retry', async () => {
  const onError = vi.fn()
  const errors = vi.spyOn(console, 'error').mockImplementation(vi.fn())
  try {
    render(
      <ErrorBoundary onError={onError} onReload={vi.fn()}>
        <DeferredQuestionCard
          question={questionFixture({ state: 'waiting' })}
          onAnswer={vi.fn()}
          onCancel={vi.fn()}
          onClarify={vi.fn()}
        />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('group', { name: 'Colour' })).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.surfaceLoadFailed)
    expect(onError).not.toHaveBeenCalled()
    expect(screen.queryByText('private chunk failure detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry }))
    expect(retrySurface).toHaveBeenCalledOnce()
  } finally {
    errors.mockRestore()
  }
})

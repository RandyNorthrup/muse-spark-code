// A rejected chunk stays local: the shared deferred boundary announces the
// failure with a retry instead of reaching the application boundary.
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, vi } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import { retrySurface } from '../../../src/webview/surfaceRetry'
import { ErrorBoundary } from '../../../src/webview/components/ErrorBoundary'

/**
 * Render a node under the application boundary and expect a failed chunk to
 * fail locally: an announced failure with a retry, and no escalation. Each
 * caller mocks `surfaceRetry` and keeps its own sentinel and leak assertions.
 */
export async function expectLocalChunkFailure(node: ReactNode): Promise<void> {
  const onError = vi.fn()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    render(
      <ErrorBoundary onError={onError} onReload={vi.fn()}>
        {node}
      </ErrorBoundary>,
    )
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.surfaceLoadFailed)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry }))
    expect(retrySurface).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  } finally {
    errors.mockRestore()
  }
}

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { retrySurface } from '../../src/webview/surfaceRetry'
import { ErrorBoundary } from '../../src/webview/components/ErrorBoundary'
import {
  DeferredPlaybookNotes,
  DeferredPlaybookPanel,
} from '../../src/webview/playbook/DeferredPlaybook'
import { surfacePort } from './playbookSurfaceFixtures'

vi.mock('../../src/webview/surfaceRetry', () => ({ retrySurface: vi.fn() }))
// A failed chunk load rejects the dynamic import with exactly this error.
vi.mock('../../src/webview/playbook/PlaybookRows', () => {
  throw new Error('playbook rows chunk failed')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('deferred playbook surfaces', () => {
  it('announces loading while the panel chunk loads', async () => {
    render(
      <>
        <p>Chat</p>
        <DeferredPlaybookPanel port={surfacePort()} />
      </>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.loadingOutput)
    expect(document.querySelector('[data-deferred-loading]')).not.toBeNull()
    await screen.findByText(/workspace-panel/u)
    expect(document.querySelector('[data-deferred-loading]')).toBeNull()
    expect(screen.getByText('Chat')).toBeInTheDocument()
  })

  it('keeps the chat mounted with a local retry when a chunk fails', async () => {
    const onError = vi.fn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <ErrorBoundary onError={onError} onReload={vi.fn()}>
          <p>Chat</p>
          <DeferredPlaybookNotes notes={[]} />
        </ErrorBoundary>,
      )
      await screen.findByRole('alert')
      expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.surfaceLoadFailed)
      expect(screen.queryByText('playbook rows chunk failed')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry }))
      expect(retrySurface).toHaveBeenCalledOnce()
      expect(screen.getByText('Chat')).toBeInTheDocument()
      expect(onError).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })
})

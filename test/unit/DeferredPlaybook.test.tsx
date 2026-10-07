// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  DeferredPlaybookNotes,
  DeferredPlaybookPanel,
} from '../../src/webview/playbook/DeferredPlaybook'
import { expectLocalChunkFailure } from './helpers/chunkFailure'
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
    await expectLocalChunkFailure(
      <>
        <p>Chat</p>
        <DeferredPlaybookNotes notes={[]} />
      </>,
    )
    expect(screen.queryByText('playbook rows chunk failed')).toBeNull()
    expect(screen.getByText('Chat')).toBeInTheDocument()
  })
})

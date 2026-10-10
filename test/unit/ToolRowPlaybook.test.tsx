// @vitest-environment jsdom
// RVF116I P2: the outer playbook wrapper chunk (DeferredPlaybook) loads
// through a bare React.lazy/Suspense whose only error boundary sits inside
// the module being loaded. A rejected wrapper import must stay local — an
// announced failure with a retry that leaves the chat mounted — instead of
// reaching the application error boundary.
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybookWhyNote } from '../../src/shared/playbook'
import { ToolRow } from '../../src/webview/components/ToolRow'
import { expectLocalChunkFailure } from './helpers/chunkFailure'
import { tool, transcriptProps } from './helpers/transcriptFixtures'

vi.mock('../../src/webview/surfaceRetry', () => ({ retrySurface: vi.fn() }))
// The outer wrapper chunk fails to load: every import of it rejects.
vi.mock('../../src/webview/playbook/DeferredPlaybook', () => {
  throw new Error('playbook wrapper chunk failed')
})

const NOTES: readonly PlaybookWhyNote[] = [
  { rule: 'continuousIntegration', code: 'checksPassed', at: 100, needsUser: false },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ToolRow playbook wrapper chunk', () => {
  it('keeps the chat mounted with a local retry when the wrapper chunk fails', async () => {
    await expectLocalChunkFailure(
      <>
        <p>Chat</p>
        <ol>
          <ToolRow
            {...transcriptProps([], {})}
            entry={tool({})}
            patchPage={undefined}
            onRefuseLink={undefined}
            quoteMenu={null}
            playbookNotes={NOTES}
          />
        </ol>
      </>,
    )
    expect(screen.queryByText('playbook wrapper chunk failed')).toBeNull()
    expect(screen.getByText('Chat')).toBeInTheDocument()
  })
})

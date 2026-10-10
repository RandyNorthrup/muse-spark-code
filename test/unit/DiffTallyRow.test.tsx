// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { DiffTally } from '../../src/webview/components/DiffTally'
import { diffTally } from '../../src/shared/diffTally'
import type { TranscriptEntry } from '../../src/webview/state/transcriptEntries'

const edit: TranscriptEntry = {
  kind: 'tool',
  id: 'edit-1',
  tool: 'edit_file',
  args: '{"path":"notes.md"}',
  status: 'completed',
  output: '',
  isBackground: false,
  patchSummary: { files: 1, added: 1234, removed: 5678 },
}

afterEach(() => {
  setUiText(EN, 'en')
})

describe('DiffTally', () => {
  it('renders nothing for a conversation without edits, even with Review available', () => {
    const { container } = render(<DiffTally counts={diffTally([])} onReview={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows singular files, formatted line totals, and the scope tooltip from real edits', () => {
    render(<DiffTally counts={diffTally([edit])} />)
    expect(screen.getByText('1 file changed')).toBeInTheDocument()
    const added = screen.getByText('+1,234')
    expect(added).toHaveClass('diff-tally-added')
    expect(screen.getByText('−5,678')).toHaveClass('diff-tally-removed')
    expect(added.parentElement).toHaveTextContent('+1,234 −5,678')
    const row = screen.getByRole('group', { name: 'Changes in this conversation' })
    expect(row).toHaveAttribute('title', EN.diffTallyTitle)
    expect(row).toHaveAccessibleDescription(EN.diffTallyTitle)
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
  })

  it('uses the plural file form and keeps a zero-line edit visible', () => {
    render(<DiffTally counts={{ files: 2, added: 0, removed: 0 }} />)
    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(screen.getByText('+0').parentElement).toHaveTextContent('+0 −0')
  })

  it('offers Review only with its callback and invokes it once', () => {
    const onReview = vi.fn()
    const counts = diffTally([edit])
    const { rerender } = render(<DiffTally counts={counts} onReview={onReview} />)
    const review = screen.getByRole('button', { name: 'Review' })
    expect(review).toHaveAttribute('type', 'button')
    expect(review).toHaveAttribute('title', EN.diffTallyReviewTitle)
    review.focus()
    expect(review).toHaveFocus()
    fireEvent.click(review)
    expect(onReview).toHaveBeenCalledExactlyOnceWith()
    rerender(<DiffTally counts={counts} />)
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
  })

  it('reads installed text at render time and preserves translated order and number grouping', () => {
    const counts = { files: 1234, added: 2345, removed: 3456 }
    const { rerender } = render(<DiffTally counts={counts} />)
    setUiText(
      {
        ...EN,
        diffTallyFiles: { one: '{count} Datei geändert', other: '{count} Dateien geändert' },
        diffTallyLines: '−{removed} / +{added}',
        diffTallyLabel: 'Änderungen in diesem Gespräch',
        diffTallyReview: 'Prüfen',
      },
      'de',
    )
    rerender(<DiffTally counts={counts} onReview={vi.fn()} />)
    expect(screen.getByText('1.234 Dateien geändert')).toBeInTheDocument()
    expect(screen.getByText('/ +2.345').parentElement).toHaveTextContent('−3.456 / +2.345')
    expect(screen.getByRole('group', { name: 'Änderungen in diesem Gespräch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeInTheDocument()
  })
})

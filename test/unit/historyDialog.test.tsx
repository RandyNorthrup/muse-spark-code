// @vitest-environment jsdom
// M88 lane B: History's Bookmarked group, its stars and Alt+B. The group
// comes first with live rows and stored-title stand-ins; Alt+B toggles the
// highlighted row from the search box on every OS; a session no page names
// offers only Remove.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import type { BookmarkRecord } from '../../src/shared/protocol'
import type { SessionRow } from '../../src/shared/sessions'
import { HistoryDialog, type HistoryDialogProps } from '../../src/webview/components/HistoryDialog'

const NOW = new Date(2026, 9, 22, 15, 30).getTime()
const HOUR = 60 * 60 * 1000

function row(overrides: Partial<SessionRow> & { readonly sessionId: string }): SessionRow {
  return {
    title: overrides.sessionId,
    isNamed: false,
    createdAt: new Date(NOW - HOUR).toISOString(),
    updatedAt: new Date(NOW - HOUR).toISOString(),
    status: 'notLoaded',
    turnCount: 1,
    isFork: false,
    ...overrides,
  }
}

function bookmark(
  overrides: Partial<BookmarkRecord> & { readonly sessionId: string },
): BookmarkRecord {
  return {
    backend: 'modelApi',
    title: 'Stored',
    bookmarkedAtMs: NOW - 1000,
    ...overrides,
  }
}

function dialogProps(overrides: Partial<HistoryDialogProps> = {}): {
  readonly props: HistoryDialogProps
  readonly toggled: { sessionId: string; isBookmarked: boolean; title: string }[]
  readonly resumed: string[]
} {
  const toggled: { sessionId: string; isBookmarked: boolean; title: string }[] = []
  const resumed: string[] = []
  return {
    props: {
      sessions: [
        row({ sessionId: 's-pinned', title: 'Pinned chat' }),
        row({ sessionId: 's-plain', title: 'Ordinary' }),
      ],
      archivedIds: [],
      currentSessionId: undefined,
      archiveAfterDays: 14,
      now: () => NOW,
      onResume: (sessionId) => void resumed.push(sessionId),
      onSetArchived: () => undefined,
      bookmarks: [
        bookmark({ sessionId: 's-pinned', title: 'Stored pinned', bookmarkedAtMs: NOW - 1000 }),
        bookmark({ sessionId: 's-gone', title: 'Stored gone', bookmarkedAtMs: NOW - 2000 }),
      ],
      onToggleBookmark: (sessionId, isBookmarked, title) =>
        void toggled.push({ sessionId, isBookmarked, title }),
      onClose: () => undefined,
      ...overrides,
    },
    toggled,
    resumed,
  }
}

describe('history bookmarks', () => {
  it('lists the Bookmarked group first, live rows once and stored titles standing in', async () => {
    const { props } = dialogProps()
    render(<HistoryDialog {...props} />)
    expect(screen.getByText(UI_TEXT.historyGroupBookmarked)).toBeDefined()
    expect(await screen.findByText('Pinned chat')).toBeDefined()
    // The bookmarked row shows in the Bookmarked group only.
    expect(screen.getAllByText('Pinned chat')).toHaveLength(1)
    expect(await screen.findByText('Stored gone')).toBeDefined()
    expect(screen.getByText(UI_TEXT.bookmarkUnavailable)).toBeDefined()
    expect(await screen.findByText('Ordinary')).toBeDefined()
  })

  it('toggles the highlighted row on Alt+B by code, even as macOS ∫', async () => {
    const { props, toggled } = dialogProps()
    render(<HistoryDialog {...props} />)
    const search = await screen.findByRole('combobox')
    fireEvent.keyDown(search, { key: 'b', code: 'KeyB', altKey: true })
    expect(toggled).toEqual([{ sessionId: 's-pinned', isBookmarked: false, title: 'Pinned chat' }])
    fireEvent.keyDown(search, { key: '∫', code: 'KeyB', altKey: true })
    expect(toggled).toHaveLength(2)
    // A plain B is text, not a toggle.
    fireEvent.keyDown(search, { key: 'b', code: 'KeyB', altKey: false })
    expect(toggled).toHaveLength(2)
  })

  it('toggles through the row star with the mouse', async () => {
    const { props, toggled } = dialogProps()
    render(<HistoryDialog {...props} />)
    await screen.findByText('Pinned chat')
    const bookmarkedStars = screen.getAllByTitle(`${UI_TEXT.bookmarkRemove} (Alt+B)`)
    expect(bookmarkedStars).toHaveLength(2)
    const [first] = bookmarkedStars
    if (first === undefined) throw new Error('no remove star rendered')
    fireEvent.click(first)
    expect(toggled).toEqual([{ sessionId: 's-pinned', isBookmarked: false, title: 'Pinned chat' }])
    fireEvent.click(screen.getByTitle(`${UI_TEXT.bookmarkAdd} (Alt+B)`))
    expect(toggled).toHaveLength(2)
    expect(toggled[1]).toMatchObject({ sessionId: 's-plain', isBookmarked: true })
  })

  it('announces the bookmarked row with its state and both commands', async () => {
    const { props } = dialogProps()
    const { container } = render(<HistoryDialog {...props} />)
    await screen.findByText('Pinned chat')
    const options = [...container.querySelectorAll('[role="option"]')]
    const pinned = options.find((option) => option.textContent.includes('Pinned chat'))
    expect(pinned?.getAttribute('aria-keyshortcuts')).toBe('Delete Alt+B')
    expect(pinned?.getAttribute('aria-description')).toBe(
      `${UI_TEXT.historyArchive} · ${UI_TEXT.bookmarkRemove}`,
    )
    expect(pinned?.querySelector('.sr-only')?.textContent).toBe(UI_TEXT.bookmarkedState)
    const gone = options.find((option) => option.textContent.includes('Stored gone'))
    expect(gone?.getAttribute('aria-keyshortcuts')).toBe('Alt+B')
    expect(gone?.getAttribute('aria-description')).toBe(UI_TEXT.bookmarkRemove)
  })

  it('offers a gone session only Remove: no resume, archive or delete', async () => {
    const archived: string[] = []
    const { props, toggled, resumed } = dialogProps({
      onSetArchived: (sessionId) => void archived.push(sessionId),
      onDelete: () => undefined,
    })
    render(<HistoryDialog {...props} />)
    const search = await screen.findByRole('combobox')
    // Past the live bookmarked row to the stand-in.
    fireEvent.keyDown(search, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
    expect(resumed).toEqual([])
    fireEvent.keyDown(search, { key: 'Delete', code: 'Delete' })
    expect(archived).toEqual([])
    fireEvent.click(await screen.findByText('Stored gone'))
    expect(resumed).toEqual([])
    fireEvent.keyDown(search, { key: 'b', code: 'KeyB', altKey: true })
    expect(toggled).toEqual([{ sessionId: 's-gone', isBookmarked: false, title: 'Stored gone' }])
  })

  it('lists as before without the toggle: no group, no stars', async () => {
    const { props } = dialogProps({ bookmarks: undefined, onToggleBookmark: undefined })
    const { container } = render(<HistoryDialog {...props} />)
    await screen.findByText('Pinned chat')
    expect(screen.queryByText(UI_TEXT.historyGroupBookmarked)).toBeNull()
    expect(container.querySelector('.history-bookmark')).toBeNull()
    const search = screen.getByRole('combobox')
    fireEvent.keyDown(search, { key: 'b', code: 'KeyB', altKey: true })
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('closes and resumes around the bookmarks', async () => {
    let closes = 0
    const { props, resumed } = dialogProps({
      onClose: () => {
        closes += 1
      },
    })
    render(<HistoryDialog {...props} />)
    const search = await screen.findByRole('combobox')
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
    expect(resumed).toEqual(['s-pinned'])
    fireEvent.keyDown(search, { key: 'Escape', code: 'Escape' })
    expect(closes).toBeGreaterThan(0)
  })
})

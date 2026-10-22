// @vitest-environment jsdom
// M88 lane B: the header's star for the open conversation, a toggle button
// with its pressed state.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { Header } from '../../src/webview/components/Header'

describe('header bookmark star', () => {
  it('toggles the open conversation with its pressed state', () => {
    let toggles = 0
    const onToggleBookmark = () => {
      toggles += 1
    }
    const { rerender } = render(
      <Header
        title="Parser fix"
        isFocusView={false}
        onNewConversation={() => undefined}
        isBookmarked={false}
        onToggleBookmark={onToggleBookmark}
      />,
    )
    const star = screen.getByRole('button', { name: UI_TEXT.bookmarkCurrentTitle })
    expect(star.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(star)
    expect(toggles).toBe(1)
    rerender(
      <Header
        title="Parser fix"
        isFocusView={false}
        onNewConversation={() => undefined}
        isBookmarked={true}
        onToggleBookmark={onToggleBookmark}
      />,
    )
    expect(
      screen
        .getByRole('button', { name: UI_TEXT.bookmarkCurrentTitle })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('shows no star without the toggle', () => {
    render(<Header title="Parser fix" isFocusView={false} onNewConversation={() => undefined} />)
    expect(screen.queryByRole('button', { name: UI_TEXT.bookmarkCurrentTitle })).toBeNull()
  })
})

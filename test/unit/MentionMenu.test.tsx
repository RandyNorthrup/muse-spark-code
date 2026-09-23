// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MentionMenu } from '../../src/webview/components/MentionMenu'

const items = [
  { path: 'src/a.ts', isFolder: false },
  { path: 'src', isFolder: true },
]

describe('MentionMenu', () => {
  it('marks the active row, hovers to move it, and selects on click without stealing focus', () => {
    const onSelect = vi.fn()
    const onHover = vi.fn()
    render(<MentionMenu items={items} activeIndex={1} onSelect={onSelect} onHover={onHover} />)
    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    fireEvent.mouseEnter(options[0]!)
    expect(onHover).toHaveBeenCalledWith(0)
    // The textarea keeps the focus (default prevented), the click still selects.
    expect(fireEvent.mouseDown(options[0]!)).toBe(false)
    fireEvent.click(options[0]!)
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })

  it('says so when nothing matches', () => {
    render(<MentionMenu items={[]} activeIndex={0} onSelect={vi.fn()} onHover={vi.fn()} />)
    expect(screen.getByText('No matching files')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

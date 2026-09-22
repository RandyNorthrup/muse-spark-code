// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownView } from '../../src/webview/components/MarkdownView'

function renderMarkdown(text: string) {
  const onOpenLink = vi.fn()
  const onCopy = vi.fn()
  const onInsert = vi.fn()
  render(<MarkdownView text={text} onOpenLink={onOpenLink} onCopy={onCopy} onInsert={onInsert} />)
  return { onOpenLink, onCopy, onInsert }
}

describe('MarkdownView', () => {
  it('renders GFM (tables, task lists, strikethrough) and inline code', () => {
    renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n~~old~~ `x`')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('old').tagName).toBe('DEL')
    expect(screen.getByText('x')).toHaveClass('markdown-inline')
  })

  it('never renders raw HTML and reduces images to their alt text', () => {
    renderMarkdown('<script>alert(1)</script>\n\n![diagram](http://x/y.png)')
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('diagram')).toHaveClass('markdown-image')
  })

  it('routes links through the host instead of navigating', () => {
    const { onOpenLink } = renderMarkdown('[docs](https://dev.meta.ai/)')
    const link = screen.getByRole('link', { name: 'docs' })
    expect(fireEvent.click(link)).toBe(false)
    expect(onOpenLink).toHaveBeenCalledWith('https://dev.meta.ai/')
  })

  it('turns fenced code into a highlighted block with Copy and Insert', () => {
    vi.useFakeTimers()
    const { onCopy, onInsert } = renderMarkdown('```ts\nconst a = 1\n```')
    expect(screen.getByText('typescript')).toBeInTheDocument()
    expect(document.querySelector('.hljs-keyword')).not.toBeNull()
    fireEvent.click(screen.getByText('Copy'))
    expect(onCopy).toHaveBeenCalledWith('const a = 1')
    expect(screen.getByText('Copied')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('Copy')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Insert at cursor'))
    expect(onInsert).toHaveBeenCalledWith('const a = 1')
    vi.useRealTimers()
  })

  it('treats an untagged multi-line fence as a plain code block', () => {
    renderMarkdown('```\nline one\nline two\n```')
    expect(screen.getByText('Copy')).toBeInTheDocument()
    expect(document.querySelector('.code-block-body')?.textContent).toBe('line one\nline two')
  })
})

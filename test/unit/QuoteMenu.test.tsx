// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuoteMenu } from '../../src/webview/components/QuoteMenu'

describe('QuoteMenu', () => {
  it.each([
    ['Copy', undefined],
    ['Ask about this', 'question'],
    ['Comment on this', 'comment'],
  ])('relays %s unchanged', (label, intent) => {
    const onChoose = vi.fn()
    const onCopy = vi.fn()
    const onClose = vi.fn()
    render(<QuoteMenu onChoose={onChoose} onCopy={onCopy} onClose={onClose} />)
    expect(screen.getByRole('menu')).toHaveAccessibleName('Highlighted text')
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    if (intent === undefined) {
      expect(onCopy).toHaveBeenCalledOnce()
      expect(onChoose).not.toHaveBeenCalled()
    } else {
      expect(onChoose).toHaveBeenCalledExactlyOnceWith(intent)
      expect(onCopy).not.toHaveBeenCalled()
    }
    // The parent's action handler owns closing, as in M17.
    expect(onClose).not.toHaveBeenCalled()
  })
})

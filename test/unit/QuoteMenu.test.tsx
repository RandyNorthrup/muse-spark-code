// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { QuoteMenu } from '../../src/webview/components/QuoteMenu'
import { warmDeferredSurfaces } from './helpers/warmDeferredSurfaces'

beforeAll(warmDeferredSurfaces)

describe('QuoteMenu', () => {
  it.each([
    ['Copy', undefined],
    ['Ask about this', 'question'],
    ['Comment on this', 'comment'],
  ])('relays %s unchanged', async (label, intent) => {
    const onChoose = vi.fn()
    const onCopy = vi.fn()
    const onClose = vi.fn()
    render(<QuoteMenu onChoose={onChoose} onCopy={onCopy} onClose={onClose} />)
    expect(await screen.findByRole('menu')).toHaveAccessibleName('Highlighted text')
    // Pills with labels (2026-10-04): every action's name is on its pill.
    expect(screen.getAllByRole('menuitem').map((pill) => pill.textContent)).toEqual([
      'Copy',
      'Ask about this',
      'Comment on this',
    ])
    const pill = screen.getByRole('menuitem', { name: label })
    expect(within(pill).getByText(label)).toBeVisible()
    expect(pill.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(pill)
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

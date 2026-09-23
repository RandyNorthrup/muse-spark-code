// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from '../../src/webview/components/Modal'

describe('Modal', () => {
  it('is a labelled dialog that focuses its close button and closes on Escape, the button and the backdrop', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="Agent map" titleId="t" isWide onClose={onClose}>
        <p>body</p>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Agent map' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.className).toBe('modal modal-wide')
    expect(dialog).toHaveTextContent('body')
    expect(document.activeElement).toBe(screen.getByLabelText('Close'))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('Close'))
    const backdrop = container.querySelector('.modal-backdrop')
    if (backdrop === null) {
      throw new Error('no backdrop')
    }
    fireEvent.mouseDown(backdrop)
    // A press inside the dialog is not a backdrop press.
    fireEvent.mouseDown(dialog)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('keeps Tab inside the dialog, wrapping at both ends (M25)', () => {
    render(
      <Modal title="Account" titleId="t" onClose={vi.fn()}>
        <button type="button">first in body</button>
        <button type="button">last</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    const close = screen.getByLabelText('Close')
    const last = screen.getByText('last')
    last.focus()
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(close)
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(last)
    // In the middle, Tab moves as usual.
    screen.getByText('first in body').focus()
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(true)
  })
})

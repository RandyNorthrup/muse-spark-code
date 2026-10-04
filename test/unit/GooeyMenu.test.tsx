// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GooeyMenu, type GooeyItem } from '../../src/webview/components/GooeyMenu'

function setup() {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const items: readonly GooeyItem[] = [
    { id: 'copy', label: 'Copy', icon: 'C', onSelect },
    { id: 'off', label: 'Disabled', icon: 'D', onSelect, disabled: true },
    {
      id: 'rewind',
      label: 'Rewind',
      icon: 'R',
      children: [
        { id: 'code', label: 'Code', icon: 'K', onSelect },
        { id: 'off-child', label: 'Disabled child', icon: 'D', onSelect, disabled: true },
        { id: 'all', label: 'Everything', icon: 'E', onSelect },
      ],
    },
    { id: 'retry', label: 'Retry', icon: 'T', onSelect },
  ]
  const view = render(
    <GooeyMenu items={items} label="Actions" origin={{ x: 160, y: 380 }} onClose={onClose} />,
  )
  return { ...view, onSelect, onClose, opener, menu: screen.getByRole('menu') }
}

describe('GooeyMenu', () => {
  it('names menu and bubbles, focuses first enabled action, shows its label', () => {
    const { menu } = setup()
    expect(menu).toHaveAccessibleName('Actions')
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(screen.getByText('Copy')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Disabled' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('menuitem', { name: 'Rewind' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    )
  })

  it('moves all four arrows, wraps, Home/End; skips disabled items', () => {
    const { menu } = setup()
    const cases: readonly (readonly [string, string])[] = [
      ['ArrowRight', 'Rewind'],
      ['ArrowDown', 'Retry'],
      ['ArrowDown', 'Copy'],
      ['ArrowLeft', 'Retry'],
      ['ArrowUp', 'Rewind'],
      ['Home', 'Copy'],
      ['End', 'Retry'],
    ]
    for (const [key, name] of cases) {
      expect(fireEvent.keyDown(menu, { key })).toBe(false)
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name }))
    }
    expect(fireEvent.keyDown(menu, { key: 'x' })).toBe(true)
  })

  it('keeps focus where it is when the parent re-renders with new item objects', () => {
    const { menu, rerender, onClose } = setup()
    fireEvent.keyDown(menu, { key: 'End' })
    const fresh: readonly GooeyItem[] = [
      { id: 'copy', label: 'Copy', icon: 'C', onSelect: vi.fn() },
      { id: 'retry', label: 'Retry', icon: 'T', onSelect: vi.fn() },
    ]
    rerender(
      <GooeyMenu items={fresh} label="Actions" origin={{ x: 160, y: 380 }} onClose={onClose} />,
    )
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Retry' }))
  })

  it.each(['Enter', ' '])('activates once and prevents native duplicate click with %s', (key) => {
    const { menu, onSelect } = setup()
    expect(fireEvent.keyDown(menu, { key })).toBe(false)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('refreshes second-burst guards and handlers while preserving focus', () => {
    const { rerender, onClose, onSelect } = setup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rewind' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
    const freshSelect = vi.fn()
    rerender(
      <GooeyMenu
        label="Actions"
        onClose={onClose}
        items={[
          {
            id: 'rewind',
            label: 'Rewind',
            icon: 'R',
            children: [
              { id: 'code', label: 'Code', icon: 'K', disabled: true, onSelect },
              { id: 'all', label: 'Everything', icon: 'E', onSelect: freshSelect },
            ],
          },
        ]}
      />,
    )
    expect(screen.getByRole('menuitem', { name: 'Everything' })).toHaveFocus()
    const code = screen.getByRole('menuitem', { name: 'Code' })
    expect(code).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(code)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Everything' }))
    expect(freshSelect).toHaveBeenCalledOnce()
  })

  it('selects by pointer, displays hover label, refuses disabled selection', () => {
    const { onSelect } = setup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }))
    expect(onSelect).not.toHaveBeenCalled()
    const retry = screen.getByRole('menuitem', { name: 'Retry' })
    fireEvent.mouseEnter(retry)
    expect(screen.getByText('Retry')).toBeVisible()
    fireEvent.mouseLeave(retry)
    expect(screen.queryByText('Retry')).toBeNull()
    fireEvent.click(retry)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('opens second burst, skips disabled child, Escape restores group before closing', () => {
    const { menu, onClose, onSelect, opener } = setup()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(menu).toHaveAccessibleName('Rewind')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Code' }))
    fireEvent.keyDown(menu, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Everything' }))
    fireEvent.keyDown(menu, { key: ' ' })
    expect(onSelect).toHaveBeenCalledOnce()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(menu).toHaveAccessibleName('Actions')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rewind' }))
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(opener)
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('returns focus on unmount after selection and dismisses outside/focus departure', () => {
    const { unmount, opener } = setup()
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
    const second = setup()
    fireEvent.pointerDown(document.body)
    expect(second.onClose).toHaveBeenCalledOnce()
    second.unmount()
    const third = setup()
    fireEvent.blur(third.menu, { relatedTarget: third.opener })
    expect(third.onClose).toHaveBeenCalledOnce()
  })

  it('closes only once when Escape repeats or outside dismissal follows', () => {
    const { menu, onClose, opener } = setup()
    fireEvent.keyDown(menu, { key: 'Escape' })
    fireEvent.keyDown(menu, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(opener)
  })

  it('uses anchor element origin and provides motion/forced-color hooks and unique goo filter', () => {
    const anchor = document.createElement('button')
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(260, 30, 40, 40))
    const { container } = render(
      <GooeyMenu
        items={[{ id: 'a', label: 'Action', icon: 'A', onSelect: vi.fn() }]}
        label="Anchor"
        origin={anchor}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('menu')).toHaveClass('gooey-menu-motion-safe', 'gooey-menu-colors-safe')
    expect(screen.getByRole('menuitem').style.left).not.toBe('0px')
    expect(container.querySelector('feGaussianBlur')).toHaveAttribute('stdDeviation', '10')
    expect(container.querySelector('feColorMatrix')).toHaveAttribute(
      'values',
      '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7',
    )
    expect(container.querySelector('feBlend')).toHaveAttribute('in2', 'goo')
  })

  it('handles no enabled actions without activating or losing Escape', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <GooeyMenu
        items={[{ id: 'off', label: 'Off', icon: 'D', disabled: true, onSelect }]}
        label="Empty"
        onClose={onClose}
      />,
    )
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(menu)
    expect(screen.getByText('Off')).toBeVisible()
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' ']) {
      fireEvent.keyDown(menu, { key })
    }
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

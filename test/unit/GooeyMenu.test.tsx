// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GooeyMenuContent as GooeyMenu,
  type GooeyItem,
} from '../../src/webview/components/GooeyMenuContent'

afterEach(() => {
  vi.restoreAllMocks()
})

/** jsdom draws nothing: give each pill, or each pill's label, a drawn size. */
function drawn(
  property: 'offsetWidth' | 'scrollWidth' | 'clientWidth',
  size: (node: HTMLElement) => number,
) {
  vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function (this: HTMLElement) {
    return size(this)
  })
}

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
  it('names menu and pills, focuses first enabled action, labels every pill', () => {
    const { menu } = setup()
    expect(menu).toHaveAccessibleName('Actions')
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy' }))
    // The owner, 2026-10-04: each pill is its icon, then its label, always shown.
    for (const [name, icon] of [
      ['Copy', 'C'],
      ['Disabled', 'D'],
      ['Rewind', 'R'],
      ['Retry', 'T'],
    ] as const) {
      const pill = screen.getByRole('menuitem', { name })
      expect(pill).toHaveClass('gooey-menu-pill')
      expect([...pill.children].map((part) => part.textContent)).toEqual([icon, name])
      expect(pill.firstElementChild).toHaveAttribute('aria-hidden', 'true')
      expect(within(pill).getByText(name)).toBeVisible()
      expect(screen.getAllByText(name)).toHaveLength(1)
      // A label shown whole needs no tooltip.
      expect(pill).not.toHaveAttribute('title')
    }
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

  it('selects by pointer, refuses disabled selection, keeps labels without hover', () => {
    const { onSelect } = setup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }))
    expect(onSelect).not.toHaveBeenCalled()
    const retry = screen.getByRole('menuitem', { name: 'Retry' })
    expect(within(retry).getByText('Retry')).toBeVisible()
    fireEvent.mouseEnter(retry)
    fireEvent.mouseLeave(retry)
    expect(within(retry).getByText('Retry')).toBeVisible()
    fireEvent.click(retry)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it.each([
    [1024, 469],
    [320, 304],
  ])(
    'draws every pill as wide as the widest label in a %s px panel, a long pseudo-locale label included',
    (width, expected) => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width)
      const natural: number[] = []
      // Each pill's max-content width: 56 px of icon and padding, 7 px a character.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const label = this.getAttribute('aria-label') ?? ''
        if (this.classList.contains('gooey-menu-pill')) {
          natural.push(this.style.width === 'max-content' ? 56 + 7 * label.length : -1)
        }
        return new DOMRect(0, 0, 56 + 7 * label.length, 40)
      })
      render(
        <GooeyMenu
          items={[
            { id: 'a', label: 'Edit', icon: 'A', onSelect: vi.fn() },
            {
              id: 'b',
              label: '⟦Fórk çóñvérsátíóñ áñd réwíñd çódé xxxxx xxxxx xxxxx xxxxx⟧',
              icon: 'B',
              onSelect: vi.fn(),
            },
            { id: 'c', label: 'Reply to this output', icon: 'C', onSelect: vi.fn() },
          ]}
          label="Uniform"
          origin={{ x: width - 24, y: 380 }}
          onClose={vi.fn()}
        />,
      )
      // Measured once, drawn at max-content, before the first paint.
      expect(natural).toEqual([84, 469, 196])
      const pills = screen.getAllByRole('menuitem')
      // The owner, 2026-10-09: uniform, "only as long as the text in the
      // longest text button"; only a narrower panel cuts it, to 320 - 2 × 8.
      for (const pill of pills) {
        expect(pill.style.width).toBe(`${String(expected)}px`)
        expect(pill.style.height).toBe('40px')
        const left = Number(pill.style.left.replace('px', ''))
        expect(left).toBeGreaterThanOrEqual(8)
        expect(left + expected).toBeLessThanOrEqual(width - 8)
      }
      // They scale in one after another, 30 ms apart.
      expect(pills.map((pill) => pill.style.animationDelay)).toEqual(['0ms', '30ms', '60ms'])
    },
  )

  it('measures each burst on its own and again when the labels change', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return new DOMRect(0, 0, 56 + 7 * (this.getAttribute('aria-label') ?? '').length, 40)
    })
    const { rerender, onClose } = setup()
    const widths = () => new Set(screen.getAllByRole('menuitem').map((pill) => pill.style.width))
    // "Disabled" is the first burst's longest label: 56 + 7 × 8.
    expect(widths()).toEqual(new Set(['112px']))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rewind' }))
    // "Disabled child": 56 + 7 × 14.
    expect(widths()).toEqual(new Set(['154px']))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(widths()).toEqual(new Set(['112px']))
    rerender(
      <GooeyMenu
        items={[{ id: 'copy', label: 'Copy', icon: 'C', onSelect: vi.fn() }]}
        label="Actions"
        origin={{ x: 160, y: 380 }}
        onClose={onClose}
      />,
    )
    expect(widths()).toEqual(new Set(['84px']))
  })

  it('puts a clipped label whole in the tooltip, after an item’s own title', () => {
    drawn('scrollWidth', (node) => (node.classList.contains('gooey-menu-pill-label') ? 300 : 0))
    drawn('clientWidth', (node) => (node.classList.contains('gooey-menu-pill-label') ? 120 : 0))
    render(
      <GooeyMenu
        items={[
          { id: 'long', label: 'A label too long for the panel', icon: 'L', onSelect: vi.fn() },
          { id: 'tip', label: 'Edit', title: 'Its own tip', icon: 'E', onSelect: vi.fn() },
        ]}
        label="Clipped"
        origin={{ x: 160, y: 380 }}
        onClose={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('menuitem', { name: 'A label too long for the panel' }),
    ).toHaveAttribute('title', 'A label too long for the panel')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveAttribute('title', 'Its own tip')
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

  it('uses anchor element origin and a forced-colours hook, with no filter at all', () => {
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
    expect(screen.getByRole('menu')).toHaveClass('gooey-menu-colors-safe')
    // The anchor's centre is (280, 50): the lone pill sits 48 px to its right,
    // level with it, and bursts from that centre.
    const pill = screen.getByRole('menuitem')
    expect(pill.style.left).toBe('328px')
    expect(pill.style.top).toBe('30px')
    expect(pill.style.transformOrigin).toBe('-48px 20px')
    // The owner, 2026-10-04: crisp pills, "not with the faded smudge look".
    expect(container.querySelector('svg, filter, defs')).toBeNull()
    expect(container.querySelector('[style*="filter"]')).toBeNull()
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

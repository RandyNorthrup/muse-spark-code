// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PopoverMenu, type PopoverMenuProps } from '../../src/webview/components/PopoverMenu'

function renderMenu(overrides: Partial<PopoverMenuProps> = {}) {
  const props: PopoverMenuProps = {
    label: 'Choices',
    entries: [
      { id: 'a', label: 'Alpha', detail: 'first', isChecked: false },
      { id: 'b', label: 'Beta', isChecked: true },
      { id: 'c', label: 'Gamma', isChecked: false },
    ],
    align: 'left',
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  const view = render(<PopoverMenu {...props} />)
  return { props, menu: screen.getByRole('menu'), view }
}

function activeItem(): HTMLElement | undefined {
  return screen
    .getAllByRole('menuitemradio')
    .find((node) => node.classList.contains('menu-item-active'))
}

describe('PopoverMenu', () => {
  let onResize: (() => void) | undefined
  const observe = vi.fn()
  const disconnect = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    onResize = undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = observe
        public disconnect = disconnect
        public constructor(callback: () => void) {
          onResize = callback
        }
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('anchors at the pointer and clamps to the viewport after resize', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(150)
    const { menu, view } = renderMenu({ anchor: { x: 1020, y: 760 } })
    const popover = menu.parentElement
    expect(popover).toHaveClass('popover-pointer')
    expect(popover).toHaveStyle({ left: '784px', top: '618px' })
    expect(observe).toHaveBeenCalledWith(document.documentElement)
    expect(observe).toHaveBeenCalledWith(popover)
    vi.stubGlobal('innerWidth', 320)
    onResize?.()
    expect(popover).toHaveStyle({ left: '80px', top: '618px' })
    view.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('keeps a pointer anchor with room at its exact coordinates', () => {
    const { menu } = renderMenu({ anchor: { x: 120, y: 140 } })
    expect(menu.parentElement).toHaveStyle({ left: '120px', top: '140px' })
  })

  it('takes focus, starts on the checked row, and shows details and the tick', () => {
    const { menu } = renderMenu()
    expect(document.activeElement).toBe(menu)
    expect(activeItem()).toHaveTextContent('Beta')
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByTitle('Current').closest('li')).toHaveTextContent('Beta')
    expect(screen.getByRole('menuitemradio', { name: /Beta/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('moves with the arrows, wrapping, and activates with Enter or Space', () => {
    const { props, menu } = renderMenu()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(activeItem()).toHaveTextContent('Gamma')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(activeItem()).toHaveTextContent('Alpha')
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(activeItem()).toHaveTextContent('Gamma')
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(props.onSelect).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(menu, { key: ' ' })
    expect(props.onSelect).toHaveBeenCalledTimes(2)
  })

  it('selects by click without stealing focus, and follows the mouse', () => {
    const { props, menu } = renderMenu()
    const alpha = screen.getByRole('menuitemradio', { name: /Alpha/ })
    expect(fireEvent.mouseDown(alpha)).toBe(false)
    fireEvent.mouseEnter(alpha)
    expect(activeItem()).toHaveTextContent('Alpha')
    fireEvent.click(alpha)
    expect(props.onSelect).toHaveBeenLastCalledWith('a')
    expect(document.activeElement).toBe(menu)
  })

  it('closes on Escape and when focus leaves the popover', () => {
    const { props, menu } = renderMenu()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
    fireEvent.blur(menu, { relatedTarget: document.body })
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps open when focus moves into the footer and forwards Left/Right', () => {
    const onStep = vi.fn<(direction: -1 | 1) => boolean>(() => true)
    const { props, menu } = renderMenu({
      title: 'Modes',
      hint: <span>hint</span>,
      footer: <button type="button">step</button>,
      onStep,
    })
    expect(screen.getByText('Modes')).toBeInTheDocument()
    expect(screen.getByText('hint')).toBeInTheDocument()
    fireEvent.blur(menu, { relatedTarget: screen.getByText('step') })
    expect(props.onClose).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(menu, { key: 'ArrowRight' })).toBe(false)
    expect(onStep).toHaveBeenLastCalledWith(1)
    expect(fireEvent.keyDown(menu, { key: 'ArrowLeft' })).toBe(false)
    expect(onStep).toHaveBeenLastCalledWith(-1)
  })

  it('lets Left/Right through when there is no footer control', () => {
    const { menu } = renderMenu({ entries: [{ id: 'x', label: 'Only' }] })
    expect(screen.getByRole('menuitem')).toHaveTextContent('Only')
    expect(fireEvent.keyDown(menu, { key: 'ArrowRight' })).toBe(true)
    expect(fireEvent.keyDown(menu, { key: 'a' })).toBe(true)
  })
})

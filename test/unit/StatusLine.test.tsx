// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STATUS_VERB_INTERVAL_MS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { StatusLine } from '../../src/webview/components/StatusLine'

const VERBS = Object.values(EN.statusVerbs)

/** The one verb shown; the others are hidden width holders. */
function shownVerb(): string | null | undefined {
  return document.querySelector('.status-verb-text > :not([aria-hidden])')?.textContent
}

describe('StatusLine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom has no canvas backing; the trace renders its element and stops.
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: () => null,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext')
    setUiText(EN, BASE_LOCALE)
  })

  it('cycles through the verbs on its interval and wraps around, outside any live region (M25)', () => {
    render(<StatusLine />)
    // The verb changes every few seconds; a live region here read each one out.
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelector('[aria-live]')).toBeNull()
    expect(screen.getByRole('listitem')).toBeInTheDocument()
    expect(shownVerb()).toBe('Thinking…')
    act(() => {
      vi.advanceTimersByTime(STATUS_VERB_INTERVAL_MS)
    })
    expect(shownVerb()).toBe('Working…')
    act(() => {
      vi.advanceTimersByTime(STATUS_VERB_INTERVAL_MS * (VERBS.length - 1))
    })
    expect(shownVerb()).toBe('Thinking…')
  })

  it('shows the installed table’s verbs', () => {
    setUiText({ ...EN, statusVerbs: { ...EN.statusVerbs, thinking: 'Denkt nach…' } }, 'de')
    render(<StatusLine />)
    expect(shownVerb()).toBe('Denkt nach…')
  })

  it('keeps every verb in one cell, so the box is the longest verb wide and the trace stays put', () => {
    render(<StatusLine />)
    const cells = [...document.querySelectorAll('.status-verb-text > *')]
    expect(cells.map((cell) => cell.textContent)).toEqual(VERBS)
    // Exactly one is shown; every other one only holds the width, hidden from
    // sight and from assistive technology.
    const holders = cells.filter((cell) => cell.classList.contains('status-verb-sizer'))
    expect(holders).toHaveLength(VERBS.length - 1)
    for (const holder of holders) {
      expect(holder).toHaveAttribute('aria-hidden', 'true')
    }
    act(() => {
      vi.advanceTimersByTime(STATUS_VERB_INTERVAL_MS)
    })
    // The verb changes, the set of cells (and so the box's width) does not.
    expect(document.querySelectorAll('.status-verb-text > *')).toHaveLength(VERBS.length)
  })

  it('uses the step bullet and a decorative heartbeat outside live regions', () => {
    const { container } = render(<StatusLine />)
    expect(container.querySelector('.status-spark')).toBeNull()
    expect(container.querySelector('.tool-dot.tool-dot-running')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    // The beam draws on a canvas; nothing static is rendered.
    const trace = container.querySelector('canvas.heartbeat-trace')
    expect(trace).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('svg.heartbeat-trace')).toBeNull()
    expect(container.querySelector('.heartbeat-base')).toBeNull()
    expect(container.querySelector('.heartbeat-sweep')).toBeNull()
    expect(container.querySelector('[aria-live], [role="status"]')).toBeNull()
  })

  it('stops its timer when unmounted', () => {
    const { unmount } = render(<StatusLine />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

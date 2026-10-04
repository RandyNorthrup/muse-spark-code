// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STATUS_VERB_INTERVAL_MS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { StatusLine } from '../../src/webview/components/StatusLine'

const VERBS = Object.values(EN.statusVerbs)

describe('StatusLine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setUiText(EN, BASE_LOCALE)
  })

  it('cycles through the verbs on its interval and wraps around, outside any live region (M25)', () => {
    render(<StatusLine />)
    // The verb changes every few seconds; a live region here read each one out.
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelector('[aria-live]')).toBeNull()
    const status = screen.getByRole('listitem')
    expect(status).toHaveTextContent('Thinking…')
    act(() => {
      vi.advanceTimersByTime(STATUS_VERB_INTERVAL_MS)
    })
    expect(status).toHaveTextContent('Working…')
    act(() => {
      vi.advanceTimersByTime(STATUS_VERB_INTERVAL_MS * (VERBS.length - 1))
    })
    expect(status).toHaveTextContent('Thinking…')
  })

  it('shows the installed table’s verbs', () => {
    setUiText({ ...EN, statusVerbs: { ...EN.statusVerbs, thinking: 'Denkt nach…' } }, 'de')
    render(<StatusLine />)
    expect(screen.getByRole('listitem')).toHaveTextContent('Denkt nach…')
  })

  it('shows the looping circle mark and a decorative heartbeat outside live regions', () => {
    const { container } = render(<StatusLine />)
    expect(container.querySelector('.status-spark')).toBeNull()
    const line = container.querySelector('.status-line')
    expect(line?.querySelector('.tool-dot')).toBeNull()
    const mark = line?.querySelector('.status-mark')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark?.querySelectorAll('.status-mark-circle')).toHaveLength(6)
    const trace = container.querySelector('svg.heartbeat-trace')
    expect(trace).toHaveAttribute('aria-hidden', 'true')
    expect(trace).toHaveAttribute('focusable', 'false')
    const paths = trace?.querySelectorAll('path')
    expect(paths).toHaveLength(2)
    expect(paths?.[0]).toHaveAttribute('pathLength', '100')
    expect(paths?.[1]).toHaveAttribute('pathLength', '100')
    expect(paths?.[0]?.getAttribute('d')).toBe(paths?.[1]?.getAttribute('d'))
    expect(trace?.querySelector('.heartbeat-sweep')).toBeTruthy()
    expect(container.querySelector('[aria-live], [role="status"]')).toBeNull()
  })

  it('stops its timer when unmounted', () => {
    const { unmount } = render(<StatusLine />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STATUS_VERB_INTERVAL_MS, STATUS_VERBS } from '../../src/shared/constants'
import { StatusLine } from '../../src/webview/components/StatusLine'

describe('StatusLine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cycles through the verbs on its interval and wraps around, outside any live region (M25)', () => {
    render(<StatusLine />)
    // The verb changes every few seconds; a live region here read each one out.
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelector('[aria-live]')).toBeNull()
    const status = screen.getByRole('listitem')
    expect(status).toHaveTextContent(STATUS_VERBS[0])
    act(() => {
      vi.advanceTimersByTime(STATUS_VERB_INTERVAL_MS)
    })
    expect(status).toHaveTextContent(STATUS_VERBS[1])
    act(() => {
      vi.advanceTimersByTime(STATUS_VERB_INTERVAL_MS * (STATUS_VERBS.length - 1))
    })
    expect(status).toHaveTextContent(STATUS_VERBS[0])
  })

  it('stops its timer when unmounted', () => {
    const { unmount } = render(<StatusLine />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

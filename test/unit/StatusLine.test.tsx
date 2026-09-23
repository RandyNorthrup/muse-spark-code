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

  it('cycles through the verbs on its interval and wraps around', () => {
    render(<StatusLine />)
    const status = screen.getByRole('status')
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

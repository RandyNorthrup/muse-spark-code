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

  it('stops its timer when unmounted', () => {
    const { unmount } = render(<StatusLine />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

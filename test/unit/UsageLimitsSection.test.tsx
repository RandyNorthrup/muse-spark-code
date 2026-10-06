// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LimitCard, LimitsSection, BudgetCard } from '../../src/webview/usage/LimitsSection'
import { usageStateFor } from './helpers/usageFixtures'
import { USAGE_COUNTDOWN_REFRESH_MS, USAGE_STALE_MS } from '../../src/shared/constants'

const NOW = new Date(2026, 9, 5, 12).getTime()
const snapshot = usageStateFor('one-provider', NOW).limits[0]!
afterEach(() => {
  vi.useRealTimers()
})
describe('usage limits', () => {
  it('refreshes both countdowns each minute, expires independently and removes its timer', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const state = usageStateFor('one-provider', NOW)
    const { unmount } = render(<LimitsSection state={state} post={vi.fn()} />)
    expect(screen.getAllByText(/At least/)).toHaveLength(1)
    expect(screen.getByRole('progressbar', { name: '62% used, resets in 2h 5m' })).toHaveAttribute(
      'aria-valuetext',
      '62% used, resets in 2h 5m',
    )
    act(() => {
      vi.advanceTimersByTime(USAGE_COUNTDOWN_REFRESH_MS)
    })
    expect(
      screen.getByRole('progressbar', { name: '62% used, resets in 2h 4m' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: '90% used, resets in 2d 23h' }),
    ).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(125 * USAGE_COUNTDOWN_REFRESH_MS)
    })
    expect(screen.getAllByText('Awaiting fresh usage')).toHaveLength(1)
    expect(screen.queryByRole('progressbar', { name: /62%/ })).toBeNull()
    expect(screen.getByRole('progressbar', { name: /90%/ })).toBeInTheDocument()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('marks stale after 15 minutes, uses reported duration, and never invents weekly pace', () => {
    const { rerender } = render(
      <LimitCard snapshot={snapshot} window={snapshot.windows[0]!} now={NOW + USAGE_STALE_MS} />,
    )
    expect(screen.queryByText('Stale')).toBeNull()
    expect(screen.getByRole('heading', { name: 'museCode: 5-hour window' })).toBeInTheDocument()
    expect(screen.getByText(/Pace:/)).toBeInTheDocument()
    rerender(
      <LimitCard
        snapshot={snapshot}
        window={snapshot.windows[0]!}
        now={NOW + USAGE_STALE_MS + 1}
      />,
    )
    expect(screen.getByText('Stale')).toBeInTheDocument()
    rerender(
      <LimitCard
        snapshot={snapshot}
        window={{ ...snapshot.windows[1]!, windowMins: 10_080 }}
        now={NOW}
      />,
    )
    expect(screen.queryByText(/Pace:/)).toBeNull()
    rerender(
      <LimitCard
        snapshot={snapshot}
        window={{ ...snapshot.windows[0]!, windowMins: undefined }}
        now={NOW}
      />,
    )
    expect(screen.queryByText(/Pace:/)).toBeNull()
  })
  it.each([
    [75, 'At least 75% of the limit is used.'],
    [90, 'At least 90% of the limit is used.'],
    [130, 'The limit has been reached or exceeded.'],
  ])('warns at %s with text and icon and preserves the real percentage', (percent, text) => {
    render(
      <LimitCard
        snapshot={snapshot}
        window={{ ...snapshot.windows[0]!, usedPercent: percent }}
        now={NOW}
      />,
    )
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByText(text).textContent).toContain('⚠')
    expect(screen.getByText(`${String(percent)}% used`)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', String(Math.min(100, percent)))
  })
  it('shows the latest provider snapshot, raw headers without a meter, and unknown provider limits', () => {
    const state = usageStateFor('one-provider', NOW)
    state.limits.push({
      ...snapshot,
      id: 'newer',
      observedAt: NOW + 1,
      windows: [{ ...snapshot.windows[0]!, usedPercent: 70 }],
    })
    render(<LimitsSection state={state} post={vi.fn()} now={() => NOW} />)
    expect(screen.getByRole('progressbar', { name: /70%/ })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: /62%/ })).toBeNull()
    const raw = screen
      .getByRole('heading', { name: 'Request & token rate limits: openai' })
      .closest('article')!
    expect(within(raw).getByText('As reported')).toBeInTheDocument()
    expect(within(raw).getByText('6m0s')).toBeInTheDocument()
    expect(within(raw).queryByRole('progressbar')).toBeNull()
    expect(
      screen.getByText('gemini does not report a limit here.', { exact: false }),
    ).toBeInTheDocument()
  })
  it('keeps Stop, today’s raise and retained liability visible; omits projection and meters when unknown', () => {
    const budget = usageStateFor('over-limit', NOW).budgets[0]!
    const { rerender } = render(<BudgetCard budget={budget} now={NOW} />)
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('Raised for today')).toBeInTheDocument()
    expect(screen.getByText(/Uncertain: \$0.10/)).toBeInTheDocument()
    expect(
      screen.getByText('Daily spend & projection', { selector: 'figcaption' }),
    ).toBeInTheDocument()
    rerender(
      <BudgetCard budget={{ ...budget, capUsd: undefined, projectedUsd: undefined }} now={NOW} />,
    )
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText('Daily spend & projection', { selector: 'figcaption' })).toBeNull()
    expect(
      screen.getByText('Projection appears after at least 30m of spend today.'),
    ).toBeInTheDocument()
  })
  it('shows the reported account card and leaves a missing account limit unknown', () => {
    const state = usageStateFor('one-provider', NOW)
    state.limits.push({
      ...snapshot,
      id: 'openrouter-key',
      provider: 'openrouter',
      source: 'openRouter',
      observedAt: NOW,
      windows: [],
      account: { usedUsd: 2, limitUsd: 10, remainingUsd: 8, period: 'monthly' },
    })
    const { rerender } = render(<LimitsSection state={state} post={vi.fn()} now={() => NOW} />)
    const account = screen
      .getByRole('heading', { name: 'Provider account budget: openrouter' })
      .closest('article')!
    expect(within(account).getByText('monthly')).toBeInTheDocument()
    expect(within(account).getByRole('progressbar')).toHaveAttribute('value', '20')
    expect(within(account).getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      '$2.00 of $10.00',
    )
    expect(within(account).getByText('$8.00 remaining')).toBeInTheDocument()
    state.limits.at(-1)!.account = { usedUsd: 9, limitUsd: 10, remainingUsd: 1, period: 'monthly' }
    rerender(<LimitsSection state={state} post={vi.fn()} now={() => NOW} />)
    expect(within(account).getByText('At least 90% of the limit is used.')).toHaveTextContent('⚠')
    state.limits.at(-1)!.account = { usedUsd: 2, period: 'monthly' }
    rerender(<LimitsSection state={state} post={vi.fn()} now={() => NOW} />)
    expect(within(account).queryByRole('progressbar')).toBeNull()
    expect(within(account).getByText('$2.00 of Unknown')).toBeInTheDocument()
    expect(within(account).getByText('Unknown remaining')).toBeInTheDocument()
  })
})

// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UsageDialog, type UsageDialogProps } from '../../src/webview/components/UsageDialog'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = new Date(2026, 8, 22, 15, 30).getTime()

const subscription = {
  observedAtMs: NOW - 5 * 60 * 1000,
  tier: 'muse-pro',
  window: { usedPercent: 42, resetsAtMs: NOW + 2 * HOUR + 5 * 60 * 1000, windowDurationMins: 300 },
  weekly: { usedPercent: 130, resetsAtMs: NOW + 3 * DAY },
}

function renderDialog(overrides: Partial<UsageDialogProps> = {}) {
  const props: UsageDialogProps = {
    report: { backend: 'museCode', subscription },
    usage: { inputTokens: 12_345, outputTokens: 678, cachedTokens: 10_000 },
    context: { usedTokens: 21_014, windowTokens: 1_007_997, pressure: 'normal' },
    now: () => NOW,
    onOpenExternal: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<UsageDialog {...props} />)
  return props
}

describe('UsageDialog', () => {
  it('shows the plan, both windows as bars with reset times, and the observation age', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Account & usage' })
    expect(dialog).toHaveTextContent('Muse Code (your Muse subscription)')
    expect(dialog).toHaveTextContent('muse-pro')
    const window = screen.getByRole('progressbar', { name: 'Current window: 42% used' })
    expect(window).toHaveAttribute('value', '42')
    expect(dialog).toHaveTextContent('5-hour window · resets in 2 h 5 min')
    // Over quota keeps the real number in the label and fills the bar fully.
    const weekly = screen.getByRole('progressbar', { name: 'This week: 130% used' })
    expect(weekly).toHaveAttribute('value', '100')
    expect(dialog).toHaveTextContent('resets in 3 d')
    expect(dialog).toHaveTextContent('as of 5 min ago')
  })

  it('lists this conversation’s tokens and the context, and opens the dashboard', () => {
    const props = renderDialog()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Input12.3K')
    expect(dialog).toHaveTextContent('Output678')
    expect(dialog).toHaveTextContent('Cached10K')
    expect(dialog).toHaveTextContent('Context21K / 1M')
    fireEvent.click(screen.getByText('Open dev.meta.ai'))
    expect(props.onOpenExternal).toHaveBeenCalledWith('https://dev.meta.ai/')
  })

  it('explains a key-billed window and an unobserved subscription, and shows empty tokens', () => {
    renderDialog({
      report: { backend: 'modelApi', subscription: undefined },
      usage: undefined,
      context: undefined,
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('billed to the key at pay-as-you-go rates')
    expect(screen.getByRole('dialog')).toHaveTextContent('No tokens counted yet')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('reports a CLI that has not observed usage yet, and a context without a window', () => {
    renderDialog({
      report: { backend: 'museCode', subscription: undefined },
      usage: undefined,
      context: { usedTokens: 500, windowTokens: undefined, pressure: 'normal' },
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('No subscription usage reported yet')
    expect(screen.getByRole('dialog')).toHaveTextContent('Context500')
  })

  it('says it is loading before the host answers', () => {
    renderDialog({ report: undefined })
    expect(screen.getByRole('dialog')).toHaveTextContent('Reading usage…')
    expect(screen.getByRole('dialog')).toHaveTextContent('Backend—')
  })

  it('focuses the close button, closes on it and on Escape', () => {
    const props = renderDialog()
    const close = screen.getByLabelText('Close')
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(close)
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })
})

// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { EMPTY_PAID_TALLY } from '../../src/shared/paid'
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
    report: {
      backend: 'museCode',
      subscription,
      account: { signInMethod: 'cli', cliVersion: '1.3.0', delegationMode: 'off' },
      insights: {
        day: {
          attempts: 40,
          sessions: 2,
          reminderAttempts: 30,
          subagentAttempts: 4,
          longSessionAttempts: 0,
        },
        week: {
          attempts: 0,
          sessions: 0,
          reminderAttempts: 0,
          subagentAttempts: 0,
          longSessionAttempts: 0,
        },
      },
    },
    usage: { inputTokens: 12_345, outputTokens: 678, cachedTokens: 10_000 },
    context: { usedTokens: 21_014, windowTokens: 1_007_997, pressure: 'normal' },
    modelId: 'muse-spark-1.3',
    paid: { features: [], tally: EMPTY_PAID_TALLY },
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
    expect(dialog).toHaveTextContent('5-hour window · resets in 2h 5m')
    // Over quota keeps the real number in the label and fills the bar fully.
    const weekly = screen.getByRole('progressbar', { name: 'This week: 130% used' })
    expect(weekly).toHaveAttribute('value', '100')
    expect(dialog).toHaveTextContent('resets in 3d')
    expect(dialog).toHaveTextContent('as of 5 min. ago')
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

  it('leaves out the cached rows where the backend cannot total them (D26)', () => {
    renderDialog({ usage: { inputTokens: 30_000, outputTokens: 1200 } })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Input30K')
    expect(dialog).not.toHaveTextContent('Cached')
    expect(dialog).not.toHaveTextContent('Cache hits')
  })

  it('explains a key-billed window and an unobserved subscription, and shows empty tokens', () => {
    renderDialog({
      report: {
        backend: 'modelApi',
        subscription: undefined,
        account: { signInMethod: 'apiKey' },
        insights: undefined,
      },
      usage: undefined,
      context: undefined,
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('billed to the key at pay-as-you-go rates')
    expect(screen.getByRole('dialog')).toHaveTextContent('Auth methodModel API key')
    expect(screen.getByRole('dialog')).toHaveTextContent('PlanPay as you go')
    expect(screen.getByRole('dialog')).toHaveTextContent('no local trace logs')
    expect(screen.getByRole('dialog')).toHaveTextContent('No tokens counted yet')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('reports a CLI that has not observed usage yet, and a context without a window', () => {
    renderDialog({
      report: {
        backend: 'museCode',
        subscription: undefined,
        account: { signInMethod: 'cli' },
        insights: undefined,
      },
      usage: undefined,
      context: { usedTokens: 500, windowTokens: undefined, pressure: 'normal' },
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('No subscription usage reported yet')
    expect(screen.getByRole('dialog')).toHaveTextContent('Context500')
  })

  it('says it is loading before the host answers', () => {
    renderDialog({ report: undefined })
    expect(screen.getByRole('dialog')).toHaveTextContent('Reading usage…')
    expect(screen.queryByText('Account')).toBeNull()
  })

  it('shows the account facts, the cache-hit rate and the insights with a Day/Week toggle (M14)', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Auth methodMeta account (Muse Code CLI)')
    expect(dialog).toHaveTextContent('Muse Code1.3.0')
    expect(dialog).toHaveTextContent('Modelmuse-spark-1.3')
    expect(dialog).toHaveTextContent('Cache hits81%')
    expect(screen.queryByText('Estimated cost')).toBeNull()
    expect(dialog).toHaveTextContent('75% of model attempts came from Muse Code’s reminder agents')
    expect(dialog).toHaveTextContent('10% of model attempts came from subagents')
    expect(dialog).toHaveTextContent('40 model attempts across 2 sessions')
    fireEvent.click(screen.getByRole('radio', { name: 'Week' }))
    expect(dialog).toHaveTextContent('No CLI activity recorded in this window.')
  })

  it('estimates the dollar cost on the Model API from the published prices (M14)', () => {
    renderDialog({
      report: {
        backend: 'modelApi',
        subscription: undefined,
        account: { signInMethod: 'apiKey' },
        insights: undefined,
      },
      usage: { inputTokens: 1_000_000, outputTokens: 100_000, cachedTokens: 200_000 },
      modelId: 'muse-spark-1.3',
    })
    // 800K fresh input at $1.25, 200K cached at $0.15, 100K output at $4.25.
    expect(screen.getByRole('dialog')).toHaveTextContent('Estimated cost$1.46')
    expect(screen.getByRole('dialog')).toHaveTextContent('Prices read on 2026-09-22')
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

describe('UsageDialog in another display language (M40)', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it('puts the emphasised share where the template does and counts in the plural forms', () => {
    setUiText(
      {
        ...EN,
        usageInsightSubagents: 'Von Subagenten: {percent} der Modellversuche',
        modelAttemptsCount: { one: '{count} Modellversuch', other: '{count} Modellversuche' },
        sessionsCount: { one: '{count} Sitzung', other: '{count} Sitzungen' },
        usageInsightTotals: '{attempts} in {sessions}',
      },
      'de',
    )
    renderDialog({
      report: {
        backend: 'museCode',
        subscription: undefined,
        account: { signInMethod: 'cli' },
        insights: {
          day: {
            attempts: 1000,
            sessions: 1,
            reminderAttempts: 0,
            subagentAttempts: 250,
            longSessionAttempts: 0,
          },
          week: {
            attempts: 0,
            sessions: 0,
            reminderAttempts: 0,
            subagentAttempts: 0,
            longSessionAttempts: 0,
          },
        },
      },
    })
    const line = screen.getByText(/^Von Subagenten:/)
    expect(line).toHaveTextContent('Von Subagenten: 25 % der Modellversuche')
    expect(line.querySelector('.usage-insight-share')).toHaveTextContent('25 %')
    expect(screen.getByRole('dialog')).toHaveTextContent('1.000 Modellversuche in 1 Sitzung')
  })
})

describe('UsageDialog insights fallback (M18)', () => {
  it('says no logs were found on the CLI backend when the insights are missing', () => {
    renderDialog({
      report: {
        backend: 'museCode',
        subscription,
        account: { signInMethod: 'cli', cliVersion: '1.3.0', delegationMode: 'off' },
        insights: undefined,
      },
    })
    expect(
      screen.getByText('No Muse Code trace logs were found on this machine yet.'),
    ).toBeInTheDocument()
  })

  it('says the Model API has no local trace logs at all', () => {
    renderDialog({
      report: {
        backend: 'modelApi',
        subscription: undefined,
        account: { signInMethod: 'apiKey' },
        insights: undefined,
      },
    })
    expect(screen.getByText(/the Model API has no local trace logs/)).toBeInTheDocument()
  })
})

describe('UsageDialog: paid features (M33, PLAN.md D30)', () => {
  const modelApiReport = {
    backend: 'modelApi' as const,
    subscription: undefined,
    account: { signInMethod: 'apiKey' as const },
    insights: undefined,
  }

  it('tallies this window’s paid use with each feature’s state and estimated cost', () => {
    renderDialog({
      report: modelApiReport,
      paid: {
        features: ['webSearch'],
        tally: { webSearches: 4, images: 2, voiceSeconds: 90 },
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Paid features in this window')
    expect(dialog).toHaveTextContent('Web search (on)4 searches · $0.0100')
    expect(dialog).toHaveTextContent('Images (off)2 images · $0.0200')
    expect(dialog).toHaveTextContent('Muse Voice (off)1m 30s of audio · $0.0045')
    expect(dialog).toHaveTextContent('Estimated paid total$0.0345')
    expect(dialog).toHaveTextContent('published prices, read on 2026-09-24')
  })

  it('has no paid section on the Muse Code backend', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Paid features')
  })
})

// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
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

/** The Model API cost case: 1M tokens in with 200K cached, 100K out. */
function modelApiCostCase(): Partial<UsageDialogProps> {
  return {
    report: {
      backend: 'modelApi',
      subscription: undefined,
      account: { signInMethod: 'apiKey' },
      insights: undefined,
      providers: undefined,
    },
    usage: { inputTokens: 1_000_000, outputTokens: 100_000, cachedTokens: 200_000 },
    modelId: 'muse-spark-1.3',
  }
}

function renderDialog(overrides: Partial<UsageDialogProps> = {}) {
  const props: UsageDialogProps = {
    report: {
      backend: 'museCode',
      subscription,
      account: { signInMethod: 'cli', cliVersion: '1.3.0', delegationMode: 'off' },
      providers: undefined,
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
    modelPricing: undefined,
    paid: { features: [], tally: EMPTY_PAID_TALLY, isKeyStored: false, alwaysAllowed: [] },
    auth: {
      status: 'signedIn',
      detail: undefined,
      backend: 'museCode',
      methods: ['browser', 'apiKey'],
      hasCli: true,
      hasCliSession: true,
    },
    onInstallMuseCode: vi.fn(),
    onSetupSignIn: vi.fn(),
    onForgetPaidUse: vi.fn(),
    now: () => NOW,
    onOpenExternal: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  const view = render(<UsageDialog {...props} />)
  return { ...props, unmount: view.unmount }
}

function providersReport(): Partial<UsageDialogProps> {
  return {
    report: {
      backend: 'modelApi',
      subscription: undefined,
      account: { signInMethod: 'apiKey' },
      insights: undefined,
      providers: [
        {
          providerId: 'openrouter',
          providerLabel: 'OpenRouter',
          pricing: 'priced',
          inputTokens: 1200,
          outputTokens: 300,
          costUsd: 0.001,
          keyUsage: { todayUsd: 0.4, monthUsd: 2.1, limitUsd: 10, remainingUsd: 7.9 },
        },
        {
          providerId: 'ollama',
          providerLabel: 'Ollama',
          pricing: 'local',
          inputTokens: 800,
          outputTokens: 100,
        },
        {
          providerId: 'mystery',
          providerLabel: 'Mystery',
          pricing: 'unpriced',
          inputTokens: 50,
          outputTokens: 5,
        },
      ],
    },
  }
}

describe('UsageDialog', () => {
  it('names an installer terminal failure while the Model API stays available', () => {
    renderDialog({
      auth: {
        status: 'signedIn',
        detail: 'The installer terminal could not open. Try again or use the install instructions.',
        backend: 'modelApi',
        methods: ['apiKey'],
        hasCli: false,
        installState: 'failed',
      },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('The installer terminal could not open')
    expect(screen.getByRole('button', { name: 'Install Muse Code' })).toBeInTheDocument()
  })

  it('shows CLI install and key replacement inside its modal without running either on open', () => {
    const props = renderDialog({
      auth: {
        status: 'signedIn',
        detail: undefined,
        backend: 'modelApi',
        methods: ['apiKey'],
        hasCli: false,
        hasCliSession: false,
        installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
      },
      paid: { features: [], tally: EMPTY_PAID_TALLY, isKeyStored: true, alwaysAllowed: [] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Install Muse Code' }))
    expect(screen.getByText('irm https://dev.meta.ai/install.ps1 | iex')).toBeInTheDocument()
    expect(props.onInstallMuseCode).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run installer' }))
    expect(props.onInstallMuseCode).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Replace Model API key' }))
    expect(props.onSetupSignIn).toHaveBeenCalledWith('apiKey')
  })
  it('advances both reset countdowns while open and stops its clock when closed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    try {
      const view = renderDialog({
        now: () => Date.now(),
        report: {
          backend: 'museCode',
          account: undefined,
          insights: undefined,
          providers: undefined,
          subscription: {
            ...subscription,
            weekly: { ...subscription.weekly, resetsAtMs: NOW + HOUR + 60_000 },
          },
        },
      })
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveTextContent('5-hour window · resets in 2h 5m')
      expect(dialog).toHaveTextContent('resets in 1h 1m')
      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(dialog).toHaveTextContent('5-hour window · resets in 2h 4m')
      expect(dialog).toHaveTextContent('resets in 1h')
      view.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides expired percentages and waits for a fresh provider report per row', () => {
    renderDialog({
      report: {
        backend: 'museCode',
        account: undefined,
        insights: undefined,
        providers: undefined,
        subscription: {
          ...subscription,
          window: { ...subscription.window, resetsAtMs: NOW - 1 },
        },
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Current window')
    expect(dialog).toHaveTextContent('Waiting for a fresh Muse Code usage report.')
    expect(screen.queryByRole('progressbar', { name: /Current window/ })).toBeNull()
    expect(dialog).not.toHaveTextContent('resets in now')
    expect(screen.getByRole('progressbar', { name: 'This week: 130% used' })).toBeVisible()
  })

  it('expires the weekly row independently of the current five-hour window', () => {
    renderDialog({
      report: {
        backend: 'museCode',
        account: undefined,
        insights: undefined,
        providers: undefined,
        subscription: {
          ...subscription,
          weekly: { ...subscription.weekly, resetsAtMs: NOW - 1 },
        },
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(screen.getByRole('progressbar', { name: 'Current window: 42% used' })).toBeVisible()
    expect(screen.queryByRole('progressbar', { name: /This week/ })).toBeNull()
    expect(dialog).toHaveTextContent('This weekWaiting for a fresh Muse Code usage report.')
  })

  it('shows opaque tiers generically and provider percentages and reset times verbatim', () => {
    renderDialog({
      report: {
        backend: 'museCode',
        account: undefined,
        insights: undefined,
        providers: undefined,
        subscription: {
          ...subscription,
          tier: '27681393394859588',
          window: { usedPercent: 63, resetsAtMs: NOW + HOUR, windowDurationMins: 90 },
          weekly: { usedPercent: 11, resetsAtMs: NOW + DAY },
        },
      },
      modelId: 'muse-spark-1.2',
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('PlanMuse Code subscription')
    expect(dialog).toHaveTextContent('90-minute window · resets in 1h')
    expect(screen.getByRole('progressbar', { name: 'Current window: 63% used' })).toHaveValue(63)
    expect(dialog).toHaveTextContent('This week11% used')
    expect(dialog).toHaveTextContent('resets in 1d')
  })

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

  it('shows the packing ledger while packing runs, and hides it otherwise (M73)', () => {
    const packed = renderDialog({
      usage: { inputTokens: 30_000, outputTokens: 1200, packedTokensAvoided: 9000 },
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('Packing saved (estimate)9K')
    packed.unmount()
    renderDialog({ usage: { inputTokens: 30_000, outputTokens: 1200 } })
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Packing saved')
  })

  it('explains a key-billed window and an unobserved subscription, and shows empty tokens', () => {
    renderDialog({
      report: {
        backend: 'modelApi',
        subscription: undefined,
        account: { signInMethod: 'apiKey' },
        insights: undefined,
        providers: undefined,
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
        providers: undefined,
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
    renderDialog(modelApiCostCase())
    // 800K fresh input at $1.25, 200K cached at $0.15, 100K output at $4.25.
    expect(screen.getByRole('dialog')).toHaveTextContent('Estimated cost$1.46')
    expect(screen.getByRole('dialog')).toHaveTextContent('Prices read on 2026-09-26')
  })

  it('shows what the prompt cache saved on the Model API, and never on Muse Code (M82)', () => {
    renderDialog(modelApiCostCase())
    // Uncached: 1M at $1.25 plus 100K output at $4.25 ($1.675); priced $1.455;
    // saved $0.22 (four decimals, like every sub-dollar amount), 13% of why.
    expect(screen.getByRole('dialog')).toHaveTextContent('Cache savings$0.2200 (13%)')
    renderDialog()
    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs).toHaveLength(2)
    expect(dialogs[1]).not.toHaveTextContent('Cache savings')
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
        providers: undefined,
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
        providers: undefined,
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
        providers: undefined,
        insights: undefined,
      },
    })
    expect(screen.getByText(/the Model API has no local trace logs/)).toBeInTheDocument()
  })
})

describe('UsageDialog: paid features (M33, PLAN.md D30)', () => {
  it('shows unknown child request cost without claiming it was free', () => {
    renderDialog({
      report: {
        backend: 'modelApi',
        subscription: undefined,
        account: undefined,
        providers: undefined,
        insights: undefined,
      },
      paid: {
        features: ['subagents'],
        isKeyStored: true,
        alwaysAllowed: [],
        tally: { ...EMPTY_PAID_TALLY, subagentRequests: 1, subagentUnknownRequests: 1 },
      },
    })
    const label = screen.getByText('Subagents (on)')
    expect(label.nextElementSibling).toHaveTextContent('1 child request')
    expect(label.nextElementSibling).toHaveTextContent('1 request has no reported cost yet')
    expect(label.nextElementSibling).not.toHaveTextContent('$0')
    expect(label.nextElementSibling).not.toHaveTextContent('0 tokens')
    expect(screen.getByText(/Reported child costs are included/)).toBeInTheDocument()
  })

  const modelApiReport = {
    backend: 'modelApi' as const,
    subscription: undefined,
    account: { signInMethod: 'apiKey' as const },
    insights: undefined,
    providers: undefined,
  }

  it('tallies this window’s paid use with each feature’s state and estimated cost', () => {
    renderDialog({
      report: modelApiReport,
      paid: {
        features: ['webSearch'],
        tally: { webSearches: 4, images: 2, voiceSeconds: 90, scheduledRuns: 0 },
        isKeyStored: true,
        alwaysAllowed: [],
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Paid features in this window')
    expect(dialog).toHaveTextContent('Web search (on)4 searches · $0.0100')
    expect(dialog).toHaveTextContent('Images (off)2 images · $0.0200')
    expect(dialog).toHaveTextContent('Muse Voice (off)1m 30s of audio · $0.0045')
    expect(dialog).toHaveTextContent('Estimated extra-feature total$0.0345')
    expect(dialog).toHaveTextContent('published prices, read on 2026-09-24')
  })

  it('names what is allowed always in this workspace, and asks again on request (M58)', () => {
    const onForgetPaidUse = vi.fn()
    renderDialog({
      report: modelApiReport,
      onForgetPaidUse,
      paid: {
        features: ['webSearch', 'imageGeneration'],
        tally: EMPTY_PAID_TALLY,
        isKeyStored: true,
        alwaysAllowed: ['webSearch'],
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Web search (on, allowed always in this workspace)')
    expect(dialog).toHaveTextContent('Images (on)')
    expect(dialog).toHaveTextContent(
      'Allowed always in this workspace, without asking: Web search.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ask again every time' }))
    expect(onForgetPaidUse).toHaveBeenCalledTimes(1)
  })

  it('offers no "Ask again" while every paid use still asks (M58)', () => {
    renderDialog({
      report: modelApiReport,
      paid: {
        features: ['webSearch'],
        tally: EMPTY_PAID_TALLY,
        isKeyStored: true,
        alwaysAllowed: [],
      },
    })
    expect(screen.queryByRole('button', { name: 'Ask again every time' })).not.toBeInTheDocument()
  })

  it('counts scheduled runs without adding their tokens twice to the paid extra total (M52)', () => {
    renderDialog({
      report: modelApiReport,
      paid: {
        features: ['scheduledPrompts'],
        tally: { webSearches: 0, images: 0, voiceSeconds: 0, scheduledRuns: 2 },
        isKeyStored: true,
        alwaysAllowed: [],
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(
      'Scheduled prompts (on)2 scheduled runs · token cost included above',
    )
    expect(dialog).toHaveTextContent('Estimated extra-feature total$0.0000')
  })

  it('counts the Auto reviewer’s reviews and adds their cost to the extra total (M78)', () => {
    renderDialog({
      report: modelApiReport,
      paid: {
        features: ['autoReviewer'],
        tally: {
          webSearches: 0,
          images: 0,
          voiceSeconds: 0,
          scheduledRuns: 0,
          autoReviews: 3,
          autoReviewTokens: 3000,
          autoReviewCostUsd: 0.0042,
        },
        isKeyStored: true,
        alwaysAllowed: ['autoReviewer'],
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(
      'Auto reviewer (on, allowed always in this workspace)3 reviews · Reported token estimate: $0.0042 · 3,000 tokens',
    )
    expect(dialog).toHaveTextContent('Estimated extra-feature total$0.0042')
  })

  it('has no paid section on the Muse Code backend without a stored key', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Paid features')
  })

  it('tallies the key’s images and voice on the Muse Code backend with a stored key (M44)', () => {
    renderDialog({
      paid: {
        features: ['imageGeneration'],
        tally: { webSearches: 0, images: 3, voiceSeconds: 0, scheduledRuns: 0 },
        isKeyStored: true,
        alwaysAllowed: [],
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Images (on)3 images · $0.0300')
    expect(dialog).toHaveTextContent('Muse Voice (off)')
    // Muse Code searches on the subscription: no paid search row there.
    expect(dialog).not.toHaveTextContent('Web search (')
  })

  it('keeps a feature this window used on another backend in the list and the total (the review of PR #30)', () => {
    renderDialog({
      paid: {
        features: ['imageGeneration'],
        tally: { webSearches: 4, images: 3, voiceSeconds: 0, scheduledRuns: 0 },
        isKeyStored: true,
        alwaysAllowed: [],
      },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Web search (off)4 searches · $0.0100')
    expect(dialog).toHaveTextContent('Estimated paid total$0.0400')
  })

  it('lists this window’s tallies per provider with settled costs (M95)', () => {
    renderDialog(providersReport())
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Providers')
    expect(dialog).toHaveTextContent('OpenRouter1.2K / 300 · $0.0010')
    expect(dialog).toHaveTextContent('Ollama800 / 100 · $0.00')
    expect(dialog).toHaveTextContent('Mystery50 / 5 · unpriced')
  })

  it('shows an account-connected key’s usage, limit and remainder (M95)', () => {
    renderDialog(providersReport())
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('API key usage')
    expect(dialog).toHaveTextContent('Today$0.40')
    expect(dialog).toHaveTextContent('This month$2.10')
    expect(dialog).toHaveTextContent('Limit$10.00')
    expect(dialog).toHaveTextContent('Remaining$7.90')
  })

  it('counts only tokens for the unpriced current model (M95)', () => {
    renderDialog({
      ...modelApiCostCase(),
      usage: { inputTokens: 500, outputTokens: 50 },
      modelId: 'openrouter/mystery/model',
      modelPricing: 'unpriced',
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(
      'This model has no price card, so only its tokens are counted.',
    )
    expect(screen.queryByText('Estimated cost')).toBeNull()
  })

  it('offers the own-model choice in its setup rows (M95)', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Start with your own model' }))
    expect(props.onSetupSignIn).toHaveBeenCalledWith('byo')
  })
})

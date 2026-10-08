// @vitest-environment jsdom
// The lazy money hub (STARTUP017): exact display matches the direct
// arithmetic once loaded, stays absent while loading or failing, every
// consumer shares the document's one load, and a failed load is said in
// words with Retry, which rebuilds the document (a failed module fetch
// stays failed for the document it failed in).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatUsd as formatExactUsd } from '../../src/shared/l10n/exactUsd'
import { fill, formatTokenWindow } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'
import { paidFeaturePrice } from '../../src/shared/paid'
import { formatUsd as formatConservativeUsd } from '../../src/core/usage/insights'
import { UI_TEXT, type PaidFeature } from '../../src/shared/constants'
import {
  loadMoneyDisplay,
  MoneyUnavailable,
  useConservativeUsd,
  useFormatTestCost,
  useFormatUsd,
  usePriceOf,
  type MoneyDisplay,
} from '../../src/webview/money'
import {
  usePaidFeaturePrice,
  usePaidFeaturePrices,
  useReplyUsageText,
} from '../../src/webview/moneyHooks'
import { PaidBadge } from '../../src/webview/components/PaidBadge'

afterEach(cleanup)

function deferred<T>() {
  return Promise.withResolvers<T>()
}

function gatedLoad(gate: { promise: Promise<MoneyDisplay> }): () => Promise<MoneyDisplay> {
  return () => {
    return gate.promise
  }
}

describe('loadMoneyDisplay', () => {
  it('shares one load per document, and a failure stays said rather than retried in place', async () => {
    const first = deferred<MoneyDisplay>()
    const importer = vi.fn(() => first.promise)
    const attempt = loadMoneyDisplay(importer)
    expect(loadMoneyDisplay(importer)).toBe(attempt)
    first.reject(new Error('chunk gone'))
    await expect(attempt).rejects.toThrow('chunk gone')
    // The browser keeps the failed fetch: importing again in place cannot
    // recover, so the hub never pretends to; Retry rebuilds the document.
    await expect(loadMoneyDisplay(importer)).rejects.toThrow('chunk gone')
    expect(importer).toHaveBeenCalledTimes(1)
    await expect(loadMoneyDisplay()).resolves.toBeDefined()
  })

  it('states every exact display the direct arithmetic states', async () => {
    const money = await loadMoneyDisplay()
    for (const feature of ['webSearch', 'voice', 'subagents', 'tab'] as const) {
      expect(money.paidFeaturePrice(feature)).toBe(paidFeaturePrice(feature))
    }
    for (const amount of ['2.5', '0.01', '0.18', '0.000002', '1234.5']) {
      expect(money.formatMoney(amount, 2)).toBe(formatExactUsd(amount, 2))
      expect(money.formatConservativeUsd(amount)).toBe(formatConservativeUsd(amount))
    }
    expect(money.isPositiveUsd(Usd.from('0.5').toAmount())).toBe(true)
    expect(money.isPositiveUsd(Usd.from(0).toAmount())).toBe(false)
    expect(money.parseAmount(1.5)).toBe(Usd.from(1.5).toAmount())
    for (const raw of [0.000002, 0, 0.05]) {
      const cost = Usd.from(raw).toAmount()
      const digits = Usd.from(cost).compare(Usd.from(0.01)) < 0 ? 6 : 4
      expect(money.formatTestCost(cost)).toBe(formatExactUsd(cost, digits))
    }
  })
})

describe('money hooks', () => {
  it('withholds the price while loading, then states it exactly', async () => {
    const gate = deferred<MoneyDisplay>()
    const { result } = renderHook(({ load }) => usePaidFeaturePrice('voice', load), {
      initialProps: { load: gatedLoad(gate) },
    })
    expect(result.current).toBeUndefined()
    const money = await loadMoneyDisplay()
    gate.resolve(money)
    await waitFor(() => {
      expect(result.current).toBe(paidFeaturePrice('voice'))
    })
  })

  it('withholds every price until each is known', async () => {
    const gate = deferred<MoneyDisplay>()
    const features = ['voice', 'imageGeneration'] as const
    const { result } = renderHook(({ load }) => usePaidFeaturePrices(features, load), {
      initialProps: { load: gatedLoad(gate) },
    })
    expect(result.current).toBeUndefined()
    gate.resolve(await loadMoneyDisplay())
    await waitFor(() => {
      expect(result.current?.get('voice')).toBe(paidFeaturePrice('voice'))
      expect(result.current?.get('imageGeneration')).toBe(paidFeaturePrice('imageGeneration'))
    })
  })

  it('states the reply usage line exactly once loaded', async () => {
    const cost = Usd.from('0.000123').toAmount()
    const gate = deferred<MoneyDisplay>()
    const { result } = renderHook(({ load }) => useReplyUsageText(12_345, 678, cost, load), {
      initialProps: { load: gatedLoad(gate) },
    })
    expect(result.current).toBeUndefined()
    gate.resolve(await loadMoneyDisplay())
    await waitFor(() => {
      expect(result.current).toBe(
        fill(UI_TEXT.replyUsage, {
          input: formatTokenWindow(12_345),
          output: formatTokenWindow(678),
          cost: formatConservativeUsd(cost),
        }),
      )
    })
  })

  it('formats amounts with the stated precision once loaded', async () => {
    const gate = deferred<MoneyDisplay>()
    const { result } = renderHook(({ load }) => useFormatUsd('1.25', 2, load), {
      initialProps: { load: gatedLoad(gate) },
    })
    expect(result.current).toBeUndefined()
    gate.resolve(await loadMoneyDisplay())
    await waitFor(() => {
      expect(result.current).toBe(formatExactUsd('1.25', 2))
    })
  })

  it('keeps conservative display for sub-dollar picker rates', async () => {
    const gate = deferred<MoneyDisplay>()
    const { result } = renderHook(({ load }) => useConservativeUsd('0.15', load), {
      initialProps: { load: gatedLoad(gate) },
    })
    gate.resolve(await loadMoneyDisplay())
    await waitFor(() => {
      expect(result.current).toBe(formatConservativeUsd('0.15'))
    })
  })

  it('states the test cost exactly once loaded', async () => {
    const cost = Usd.from(0.000002).toAmount()
    const gate = deferred<MoneyDisplay>()
    const { result } = renderHook(({ load }) => useFormatTestCost(cost, load), {
      initialProps: { load: gatedLoad(gate) },
    })
    gate.resolve(await loadMoneyDisplay())
    const money = await loadMoneyDisplay()
    await waitFor(() => {
      expect(result.current).toBe(money.formatTestCost(cost))
    })
  })

  it('leaves the price out when the chunk fails, without throwing', async () => {
    const gate = deferred<MoneyDisplay>()
    const { result } = renderHook(({ load }) => usePaidFeaturePrice('voice', load), {
      initialProps: { load: gatedLoad(gate) },
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      gate.reject(new Error('chunk gone'))
      await waitFor(() => {
        expect(result.current).toBeUndefined()
      })
      // Settles without an unhandled rejection: the hook swallows the load.
      await actSettled()
      expect(result.current).toBeUndefined()
    } finally {
      errors.mockRestore()
    }
  })

  it('leaves the price out when the tariff refuses, without throwing', async () => {
    const money = await loadMoneyDisplay()
    const refused = vi.fn((_feature: PaidFeature): string => {
      throw new Error('unknown tariff')
    })
    const refusing: MoneyDisplay = { ...money, paidFeaturePrice: refused }
    const { result } = renderHook(
      ({ load }: { load: () => Promise<MoneyDisplay> }) => usePriceOf(load)('webSearch'),
      { initialProps: { load: () => Promise.resolve(refusing) } },
    )
    await waitFor(() => {
      expect(refused).toHaveBeenCalled()
    })
    expect(result.current).toBeUndefined()
  })
})

async function actSettled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('MoneyUnavailable', () => {
  it('says a failed load in words and retries by rebuilding the document', async () => {
    const gate = deferred<MoneyDisplay>()
    const importer = gatedLoad(gate)
    const rebuild = vi.fn()
    function Consumer() {
      const price = usePaidFeaturePrice('voice', importer)
      return (
        <>
          <span data-testid="price">{price ?? ''}</span>
          <MoneyUnavailable importer={importer} onRetry={rebuild} />
        </>
      )
    }
    render(<Consumer />)
    expect(screen.queryByRole('alert')).toBeNull()
    gate.reject(new Error('chunk gone'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(UI_TEXT.moneyLoadFailed)
    // No number stands in for the missing price.
    expect(screen.getByTestId('price')).toHaveTextContent('')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry }))
    expect(rebuild).toHaveBeenCalledTimes(1)
  })

  it('only reports: a view showing no price starts no load', () => {
    const importer = vi.fn(() => Promise.reject(new Error('never asked')))
    render(<MoneyUnavailable importer={importer} onRetry={vi.fn()} />)
    expect(importer).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names no price and loads nothing for a feature not on show', () => {
    const importer = vi.fn(() => Promise.reject(new Error('never asked')))
    const { result } = renderHook(() => usePaidFeaturePrice(undefined, importer))
    expect(result.current).toBeUndefined()
    expect(importer).not.toHaveBeenCalled()
  })
})

describe('PaidBadge', () => {
  it('paints the badge at once and states only the exact tooltip', async () => {
    // The document's money chunk is loaded by now (one load per document),
    // so the tooltip may already be there: either absent or exact.
    const { container } = render(<PaidBadge feature="voice" />)
    const badge = container.querySelector('.badge-paid')
    expect(badge?.textContent).toBe(UI_TEXT.paidRowBadge)
    expect([null, fill(UI_TEXT.paidRowTitle, { price: paidFeaturePrice('voice') })]).toContain(
      badge?.getAttribute('title'),
    )
    await waitFor(() => {
      expect(badge?.getAttribute('title')).toBe(
        fill(UI_TEXT.paidRowTitle, { price: paidFeaturePrice('voice') }),
      )
    })
  })
})

// Exact money display loads after first paint (STARTUP017): the composer
// badge, the dictate tooltip, row badges, reply usage costs, and every lazy
// surface's prices name their features and tokens from their own bundle, and
// fill in the exact price once this chunk arrives. While it loads, or when
// it fails, the price is absent — never a placeholder number. This hub is
// the only webview module that imports the money arithmetic, so the shared
// exact-USD chunks stay out of every startup and panel closure. Every load
// retries: nothing sticks a failure.
import { useCallback, useEffect, useState } from 'react'
import { UI_TEXT, type PaidFeature } from '../shared/constants'
import { fill, formatTokenWindow } from '../shared/l10n/text'
import type { UsdAmount } from '../shared/usdSchema'
import type { Usd } from '../shared/usd'

export interface MoneyDisplay {
  readonly paidFeaturePrice: (feature: PaidFeature) => string
  readonly formatReplyCost: (costUsd: UsdAmount) => string
  /** Exact display with an explicit precision, as rate tables state it. */
  readonly formatMoney: (amount: number | string | Usd, fractionDigits?: number) => string
  /** Conservative display, retaining four places for sub-dollar amounts. */
  readonly formatConservativeUsd: (amount: number | string | Usd) => string
  readonly isPositiveUsd: (amount: UsdAmount) => boolean
  /** A finite number as its exact decimal amount, for hub formatting. */
  readonly parseAmount: (amount: number | string) => UsdAmount
  /** A check's test cost as the language writes money: about $0.000002. */
  readonly formatTestCost: (costUsd: UsdAmount) => string
}

const SMALL_COST_USD = 0.01
const SMALL_COST_DIGITS = 6
const COST_DIGITS = 4

async function importMoneyDisplay(): Promise<MoneyDisplay> {
  // One await per chunk, destructured at once: the unused-export gate
  // follows this shape to the money modules' exact members.
  const { paidFeaturePrice, formatUsd, isPositiveUsd, Usd } = await import('../shared/paid')
  const { formatUsd: formatConservativeUsd } = await import('../core/usage/insights')
  return {
    paidFeaturePrice,
    formatReplyCost: formatConservativeUsd,
    formatMoney: formatUsd,
    formatConservativeUsd,
    isPositiveUsd,
    parseAmount: (amount) => Usd.from(amount).toAmount(),
    formatTestCost: (costUsd) =>
      formatUsd(
        costUsd,
        Usd.from(costUsd).compare(Usd.from(SMALL_COST_USD)) < 0 ? SMALL_COST_DIGITS : COST_DIGITS,
      ),
  }
}

/** The shared lazy money chunk; every call loads (and retries) on its own. */
export function loadMoneyDisplay(
  importer: () => Promise<MoneyDisplay> = importMoneyDisplay,
): Promise<MoneyDisplay> {
  return importer()
}

/**
 * The loaded money chunk for surfaces that format several amounts (the
 * palette's model prices): undefined while it loads or when it fails, so
 * rows render without prices rather than with guessed ones.
 */
export function useMoneyDisplay(
  load: () => Promise<MoneyDisplay> = loadMoneyDisplay,
): MoneyDisplay | undefined {
  const [api, setApi] = useState<MoneyDisplay | undefined>()
  useEffect(() => {
    let isLive = true
    async function settle(): Promise<void> {
      try {
        const loaded = await load()
        if (isLive) {
          setApi(loaded)
        }
      } catch {
        // Absent while the chunk fails: tooltips and costs wait for a retry.
      }
    }
    void settle()
    return () => {
      isLive = false
    }
  }, [load])
  return api
}

/** An exact feature price, or undefined while the money chunk loads or fails. */
export function usePaidFeaturePrice(
  feature: PaidFeature,
  load: () => Promise<MoneyDisplay> = loadMoneyDisplay,
): string | undefined {
  const api = useMoneyDisplay(load)
  if (api === undefined) {
    return
  }
  try {
    return api.paidFeaturePrice(feature)
  } catch {
    return
  }
}

/**
 * A registry-style price lookup for palette rows: undefined while the money
 * chunk loads, when it fails, or when the price refuses (unknown tariff).
 */
export function usePriceOf(
  load: () => Promise<MoneyDisplay> = loadMoneyDisplay,
): (feature: PaidFeature) => string | undefined {
  const api = useMoneyDisplay(load)
  return useCallback(
    (feature: PaidFeature) => {
      if (api === undefined) {
        return
      }
      try {
        return api.paidFeaturePrice(feature)
      } catch {
        return
      }
    },
    [api],
  )
}

/** Exact prices for several features, or undefined until every one is known. */
export function usePaidFeaturePrices(
  features: readonly PaidFeature[],
  load: () => Promise<MoneyDisplay> = loadMoneyDisplay,
): ReadonlyMap<PaidFeature, string> | undefined {
  const api = useMoneyDisplay(load)
  if (api === undefined) {
    return
  }
  try {
    return new Map(features.map((feature) => [feature, api.paidFeaturePrice(feature)] as const))
  } catch {
    return
  }
}

/** A reply's usage line with its exact cost, or undefined until loaded. */
export function useReplyUsageText(
  inputTokens: number,
  outputTokens: number,
  costUsd: UsdAmount,
  load: () => Promise<MoneyDisplay> = loadMoneyDisplay,
): string | undefined {
  const api = useMoneyDisplay(load)
  if (api === undefined) {
    return
  }
  return fill(UI_TEXT.replyUsage, {
    input: formatTokenWindow(inputTokens),
    output: formatTokenWindow(outputTokens),
    cost: api.formatReplyCost(costUsd),
  })
}

/** An exact amount with an explicit precision, or undefined until loaded. */
export function useFormatUsd(
  amount: number | string | Usd,
  fractionDigits?: number,
  load: () => Promise<MoneyDisplay> = loadMoneyDisplay,
): string | undefined {
  const api = useMoneyDisplay(load)
  return api?.formatMoney(amount, fractionDigits)
}

/** A conservative amount (four places under a dollar), or undefined until loaded. */
export function useConservativeUsd(
  amount: number | string | Usd,
  load: () => Promise<MoneyDisplay> = loadMoneyDisplay,
): string | undefined {
  const api = useMoneyDisplay(load)
  return api?.formatConservativeUsd(amount)
}

/** A check's test cost as the language writes it, or undefined until loaded. */
export function useFormatTestCost(
  costUsd: UsdAmount | undefined,
  load: () => Promise<MoneyDisplay> = loadMoneyDisplay,
): string | undefined {
  const api = useMoneyDisplay(load)
  if (api === undefined || costUsd === undefined) {
    return
  }
  return api.formatTestCost(costUsd)
}

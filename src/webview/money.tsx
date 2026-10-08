// Exact money display loads after first paint (STARTUP017): the composer
// badge, the dictate tooltip, row badges, reply usage costs, and every lazy
// surface's prices name their features and tokens from their own bundle, and
// fill in the exact price once this chunk arrives. While it loads the price
// is absent — never a placeholder number. This hub is the only webview
// module that imports the money arithmetic, so the shared exact-USD chunks
// stay out of every startup and panel closure.
//
// One load per document, shared by every consumer: the browser keeps a
// failed module fetch for the document's life, so importing again cannot
// recover. A failure is said in words (`MoneyUnavailable`) with Retry, and
// Retry rebuilds the document (the surface's own retry: the chat's shared
// `retrySurface`, the models panel's reload), where every mounted consumer
// fetches the chunk afresh. The chat-only hooks live in
// `moneyHooks.ts`, so panels sharing this chunk do not carry them.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { UI_TEXT, type PaidFeature } from '../shared/constants'
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

/** Where the document's money chunk stands: never started, loading, loaded or failed. */
export type MoneyLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly display: MoneyDisplay }
  | { readonly status: 'failed' }

export type MoneyImporter = () => Promise<MoneyDisplay>

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

interface MoneySource {
  load: MoneyLoad
  attempt: Promise<MoneyDisplay> | undefined
  readonly listeners: Set<() => void>
  readonly subscribe: (listener: () => void) => () => void
}

const IDLE: MoneyLoad = { status: 'idle' }
const LOADING: MoneyLoad = { status: 'loading' }
const FAILED: MoneyLoad = { status: 'failed' }
const sources = new WeakMap<MoneyImporter, MoneySource>()

function sourceOf(importer: MoneyImporter): MoneySource {
  const known = sources.get(importer)
  if (known !== undefined) {
    return known
  }
  const listeners = new Set<() => void>()
  const source: MoneySource = {
    load: IDLE,
    attempt: undefined,
    listeners,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  sources.set(importer, source)
  return source
}

function settle(source: MoneySource, load: MoneyLoad): void {
  source.load = load
  for (const listener of source.listeners) {
    listener()
  }
}

/**
 * The document's money chunk: the first call starts the one load, every
 * later call shares it, and a failure stays failed until Retry rebuilds
 * the document.
 */
export function loadMoneyDisplay(
  importer: MoneyImporter = importMoneyDisplay,
): Promise<MoneyDisplay> {
  const source = sourceOf(importer)
  if (source.attempt === undefined) {
    settle(source, LOADING)
    source.attempt = attemptLoad(source, importer)
  }
  return source.attempt
}

async function attemptLoad(source: MoneySource, importer: MoneyImporter): Promise<MoneyDisplay> {
  let display: MoneyDisplay
  try {
    display = await importer()
  } catch (error) {
    settle(source, FAILED)
    throw error
  }
  settle(source, { status: 'ready', display })
  return display
}

/**
 * The money chunk's state for a consumer. `isNeeded` starts the load; a
 * consumer that only reports the state (the failure notice) leaves it off,
 * so nothing is fetched for a view that shows no price.
 */
export function useMoneyLoad(importer?: MoneyImporter, isNeeded = true): MoneyLoad {
  const load = importer ?? importMoneyDisplay
  const source = sourceOf(load)
  const state = useSyncExternalStore(source.subscribe, () => source.load)
  useEffect(() => {
    if (!isNeeded) {
      return
    }
    async function start(): Promise<void> {
      try {
        await loadMoneyDisplay(load)
      } catch {
        // The failed state says it, with Retry (`MoneyUnavailable`).
      }
    }
    void start()
  }, [load, isNeeded])
  return state
}

/**
 * The loaded money chunk for surfaces that format several amounts (the
 * palette's model prices): undefined while it loads or when it fails, so
 * rows render without prices rather than with guessed ones.
 */
export function useMoneyDisplay(
  importer?: MoneyImporter,
  isNeeded = true,
): MoneyDisplay | undefined {
  const load = useMoneyLoad(importer, isNeeded)
  return load.status === 'ready' ? load.display : undefined
}

/**
 * A registry-style price lookup for palette rows: undefined while the money
 * chunk loads, when it fails, or when the price refuses (unknown tariff).
 */
export function usePriceOf(
  importer?: MoneyImporter,
  isNeeded = true,
): (feature: PaidFeature) => string | undefined {
  const api = useMoneyDisplay(importer, isNeeded)
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

/** An exact amount with an explicit precision, or undefined until loaded. */
export function useFormatUsd(
  amount: number | string | Usd,
  fractionDigits?: number,
  importer?: MoneyImporter,
): string | undefined {
  const api = useMoneyDisplay(importer)
  return api?.formatMoney(amount, fractionDigits)
}

/** A conservative amount (four places under a dollar), or undefined until loaded. */
export function useConservativeUsd(
  amount: number | string | Usd,
  importer?: MoneyImporter,
): string | undefined {
  const api = useMoneyDisplay(importer)
  return api?.formatConservativeUsd(amount)
}

/** A check's test cost as the language writes it, or undefined until loaded. */
export function useFormatTestCost(
  costUsd: UsdAmount | undefined,
  importer?: MoneyImporter,
): string | undefined {
  const api = useMoneyDisplay(importer, costUsd !== undefined)
  if (api === undefined || costUsd === undefined) {
    return
  }
  return api.formatTestCost(costUsd)
}

/**
 * A failed money load, said in words with Retry (STARTUP017): prices stay
 * absent rather than guessed, and `onRetry` rebuilds the document, where
 * the chunk is fetched afresh for every consumer. It only reports: it never
 * starts a load, so a view that shows no price fetches nothing.
 */
export function MoneyUnavailable({
  onRetry,
  buttonClassName = 'button-secondary',
  importer,
  isInert = false,
}: {
  readonly onRetry: () => void
  readonly buttonClassName?: string
  readonly importer?: MoneyImporter
  readonly isInert?: boolean
}) {
  if (useMoneyLoad(importer, false).status !== 'failed') {
    return null
  }
  return (
    <div role="alert" className="money-unavailable" inert={isInert}>
      <p>{UI_TEXT.moneyLoadFailed}</p>
      <button type="button" className={buttonClassName} onClick={onRetry}>
        {UI_TEXT.surfaceLoadRetry}
      </button>
    </div>
  )
}

// Judge presentation belongs to the lazy Models and Account & usage surfaces.
// Wire schemas and host projection stay in judgePanel without these labels.
import { MODEL_API_PRICE_DECIMALS, PROVIDER_PRICE_MAX_DECIMALS, UI_TEXT } from './constants'
import { formatUsd } from './l10n/exactUsd'
import { fill, formatDurationMs, formatNumber } from './l10n/text'
import type {
  JudgePanelFastRow,
  JudgePanelLabel,
  JudgePanelSnapshot,
  JudgePanelTechnique,
} from './judgePanelSchema'
import type { UsdAmount } from './usdSchema'

/**
Exact dollars. The paid view quotes provider prices at the same scale
(three decimals out to twenty significant digits), so a positive price or
liability is never rounded to zero and no significant digit is dropped:
$0.042 per million shows as $0.042. Amounts arrive exact; rates arrive as
the display dollars the projection filtered.
*/
export function judgePanelMoney(amount: number | UsdAmount): string {
  return formatUsd(amount, MODEL_API_PRICE_DECIMALS, PROVIDER_PRICE_MAX_DECIMALS)
}

export interface JudgePanelRow {
  readonly term: string
  readonly detail: string
}

function sourceDetail(snapshot: JudgePanelSnapshot): string {
  switch (snapshot.effectiveSource) {
    case 'same': {
      return UI_TEXT.judgeSourceSame
    }
    case 'separate': {
      return UI_TEXT.judgeSourceSeparate
    }
    case 'both': {
      return UI_TEXT.judgeSourceBoth
    }
    case 'none': {
      return snapshot.engine === 'off' ? UI_TEXT.judgeStatusOff : UI_TEXT.judgeStatusUnavailable
    }
  }
}

function techniqueDetail(technique: JudgePanelTechnique): string {
  switch (technique) {
    case 'logprob': {
      return UI_TEXT.judgePanel.techniques.logprob
    }
    case 'top1': {
      return UI_TEXT.judgePanel.techniques.top1
    }
    case 'stated': {
      return UI_TEXT.judgePanel.techniques.stated
    }
    case 'systemone': {
      return UI_TEXT.judgePanel.techniques.systemone
    }
    case 'sampling': {
      return UI_TEXT.judgePanel.techniques.sampling
    }
    case 'contrastive': {
      return UI_TEXT.judgePanel.techniques.contrastive
    }
    case 'cascade': {
      return UI_TEXT.judgePanel.techniques.cascade
    }
    case 'embedding': {
      return UI_TEXT.judgePanel.techniques.embedding
    }
  }
}

function labelDetail(label: JudgePanelLabel): string {
  switch (label) {
    case 'calibrated (logprob)': {
      return UI_TEXT.judgePanel.labels.logprob
    }
    case 'calibrated (stated)': {
      return UI_TEXT.judgePanel.labels.stated
    }
    case 'uncalibrated': {
      return UI_TEXT.judgePanel.labels.uncalibrated
    }
    case 'approximate (top-1)': {
      return UI_TEXT.judgePanel.labels.top1
    }
  }
}

/** The status line. Read when the section renders, never at module load. */
export function judgePanelStatusText(snapshot: JudgePanelSnapshot): string {
  if (snapshot.reason === 'confidential-refused') {
    return fill(UI_TEXT.judgeNoAnswer, { reason: snapshot.reason })
  }
  if (snapshot.unverifiedLocal) {
    return UI_TEXT.judgeLocalUnverified
  }
  if (
    snapshot.untested &&
    (snapshot.reason === undefined || snapshot.reason === 'source-untested')
  ) {
    return UI_TEXT.judgeSourceUntested
  }
  switch (snapshot.reason) {
    case 'explicit-off': {
      return UI_TEXT.judgeStatusOff
    }
    case 'consent-needed': {
      return UI_TEXT.judgeStatusConsent
    }
    case 'consent-declined': {
      return UI_TEXT.judgeStatusDeclined
    }
    case 'source-unavailable':
    case 'unknown-setting': {
      return UI_TEXT.judgeStatusUnavailable
    }
    case 'ready-rate-low': {
      return UI_TEXT.judgeStatusSlow
    }
    case 'local-unverified': {
      return UI_TEXT.judgeLocalUnverified
    }
    case 'source-untested': {
      return UI_TEXT.judgeSourceUntested
    }
    case undefined: {
      // A paid source selected on a subscription backend is billed, not
      // covered: it reads Paid, with its price in the rows below.
      if (snapshot.billing === 'subscription' && !snapshot.paidSourceSelected) {
        return UI_TEXT.judgeStatusSubscription
      }
      if (snapshot.billing === 'modelApi' || snapshot.paidSourceSelected) {
        return UI_TEXT.judgeStatusPaid
      }
      return snapshot.billing === 'free' ? UI_TEXT.judgePanel.freeLocal : UI_TEXT.paidJudgeName
    }
    default: {
      return fill(UI_TEXT.judgeNoAnswer, { reason: snapshot.reason })
    }
  }
}

function priceDetail(snapshot: JudgePanelSnapshot): string | undefined {
  const parts: string[] = []
  if (snapshot.inputPerMillion !== undefined) {
    parts.push(
      fill(UI_TEXT.judgePanel.priceInput, { input: judgePanelMoney(snapshot.inputPerMillion) }),
    )
  }
  if (snapshot.cachedPerMillion !== undefined) {
    parts.push(
      fill(UI_TEXT.judgePanel.priceCached, { cached: judgePanelMoney(snapshot.cachedPerMillion) }),
    )
  }
  if (snapshot.outputPerMillion !== undefined) {
    parts.push(
      fill(UI_TEXT.judgePanel.priceOutput, {
        output: judgePanelMoney(snapshot.outputPerMillion),
      }),
    )
  }
  return parts.length === 0 ? undefined : parts.join(' · ')
}

function moneyRow(
  term: string,
  amount: UsdAmount | undefined,
  isPaid: boolean,
): JudgePanelRow | undefined {
  if (amount !== undefined) {
    return { term, detail: judgePanelMoney(amount) }
  }
  return isPaid ? { term, detail: UI_TEXT.judgePanel.notKnown } : undefined
}

/**
D107 (M125 lane U): one fast decision's detail. The state names what
the window did with the decision; the reason token and the decision
id stay technical, as model ids do.
*/
function fastRowDetail(row: JudgePanelFastRow): string {
  const text = UI_TEXT.judgePanel.fast
  let state = text.stateIdle
  if (row.state === 'acted') {
    state = text.stateActed
  } else if (row.state === 'raised') {
    state = text.stateRaised
  }
  const windowed =
    row.noWindow === undefined || row.noWindow === 0
      ? ''
      : `, ${fill(text.noWindow, { count: formatNumber(row.noWindow) })}`
  return `${state} · ${row.reason}${windowed}`
}

/**
The definition list the panel and the usage dialog share. A subscription
with no paid source shows the subscription status, not a zero price.
An unknown paid amount says it is not known.
*/
export function judgePanelRows(snapshot: JudgePanelSnapshot): readonly JudgePanelRow[] {
  const isPaid = snapshot.billing === 'modelApi' || snapshot.paidSourceSelected
  const rows: JudgePanelRow[] = [
    { term: UI_TEXT.judgePanel.source, detail: sourceDetail(snapshot) },
  ]
  if (snapshot.modelId !== undefined) {
    const provider = snapshot.providerId === undefined ? '' : `${snapshot.providerId}/`
    rows.push({
      term: UI_TEXT.judgePanel.model,
      detail: `${provider}${snapshot.modelId}`,
    })
  }
  if (snapshot.technique !== undefined) {
    rows.push({
      term: UI_TEXT.judgePanel.technique,
      detail: techniqueDetail(snapshot.technique),
    })
  }
  if (snapshot.label !== undefined) {
    rows.push({ term: UI_TEXT.judgePanel.calibration, detail: labelDetail(snapshot.label) })
  }
  if (snapshot.partial === true) {
    rows.push({ term: UI_TEXT.judgePanel.partial, detail: UI_TEXT.judgePanel.partialYes })
  }
  const price = priceDetail(snapshot)
  if (price !== undefined) {
    rows.push({ term: UI_TEXT.judgePanel.price, detail: price })
  } else if (isPaid && snapshot.reason === 'unpriced') {
    rows.push({ term: UI_TEXT.judgePanel.price, detail: UI_TEXT.judgePanel.unpriced })
  }
  const reserved = moneyRow(UI_TEXT.judgePanel.reserved, snapshot.reservedUsd, isPaid)
  const settled = moneyRow(UI_TEXT.judgePanel.settled, snapshot.settledUsd, isPaid)
  const uncertain = moneyRow(UI_TEXT.judgePanel.uncertain, snapshot.uncertainUsd, isPaid)
  if (reserved !== undefined) {
    rows.push(reserved)
  }
  if (settled !== undefined) {
    rows.push(settled)
  }
  if (uncertain !== undefined) {
    rows.push(uncertain)
  }
  if (isPaid) {
    rows.push({
      term: UI_TEXT.judgePanel.dailyBudget,
      detail:
        snapshot.dailyBudgetUsd === undefined
          ? UI_TEXT.judgePanel.notKnown
          : judgePanelMoney(snapshot.dailyBudgetUsd),
    })
  }
  if (snapshot.dailySpentUsd !== undefined) {
    rows.push({
      term: UI_TEXT.judgePanel.spentToday,
      detail: judgePanelMoney(snapshot.dailySpentUsd),
    })
  }
  const fast = snapshot.fast
  if (fast !== undefined) {
    const text = UI_TEXT.judgePanel.fast
    rows.push(
      { term: text.method, detail: fast.method },
      { term: text.turns, detail: formatNumber(fast.totals.turns) },
      { term: text.applied, detail: formatNumber(fast.totals.appliedTurns) },
      { term: text.judgeCalls, detail: formatNumber(fast.totals.judgeCalls) },
      { term: text.judgeTokens, detail: formatNumber(fast.totals.judgeTokens) },
    )
    if (fast.savedMsTotal !== undefined) {
      rows.push({ term: text.saved, detail: formatDurationMs(fast.savedMsTotal) })
    }
    for (const row of fast.rows) {
      rows.push({ term: row.decision, detail: fastRowDetail(row) })
    }
  }
  return rows
}

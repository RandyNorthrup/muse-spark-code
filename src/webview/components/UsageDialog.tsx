// The Account & usage dialog (M8): the backend this window runs on, the
// subscription windows Muse Code last observed (the current block and the
// rolling week as bars with their reset times, "as of" the observation), and
// this conversation's token totals. Without a subscription window (a Model
// API key, or a CLI that has not run a turn yet) the tokens stand alone.
// Opened from the palette's Account & usage row, `/usage` and `/cost`; hangs
// from the header like History. Esc or the close button dismisses it.

import { type KeyboardEvent, useEffect, useRef } from 'react'
import { META_DASHBOARD_URL, UI_TEXT } from '../../shared/constants'
import { BACKEND_LABELS, formatTokenWindow } from '../../shared/palette'
import { relativeTime } from '../../shared/sessions'
import {
  barValue,
  FULL_PERCENT,
  formatDuration,
  formatWindowLength,
  planLabel,
  type SubscriptionUsage,
} from '../../shared/usage'
import type { ContextSummary, UsageReport, UsageSummary } from '../state/uiState'
import { CloseIcon } from './icons'

export interface UsageDialogProps {
  /** undefined while the host has not answered `readUsage`. */
  readonly report: UsageReport | undefined
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  readonly now: () => number
  readonly onOpenExternal: (url: string) => void
  readonly onClose: () => void
}

function percentLabel(usedPercent: number): string {
  return `${String(usedPercent)}% ${UI_TEXT.usageUsed}`
}

function UsageBar({
  label,
  usedPercent,
  resetsAtMs,
  detail,
  nowMs,
}: {
  readonly label: string
  readonly usedPercent: number
  readonly resetsAtMs: number
  readonly detail: string | undefined
  readonly nowMs: number
}) {
  const meta = [detail, `${UI_TEXT.usageResets} ${formatDuration(resetsAtMs, nowMs)}`]
    .filter((part) => part !== undefined)
    .join(' · ')
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <span>{label}</span>
        <span className="usage-percent">{percentLabel(usedPercent)}</span>
      </div>
      <progress
        className="usage-bar"
        value={barValue(usedPercent)}
        max={FULL_PERCENT}
        aria-label={`${label}: ${percentLabel(usedPercent)}`}
      />
      <div className="usage-row-meta">{meta}</div>
    </div>
  )
}

function SubscriptionSection({
  subscription,
  nowMs,
}: {
  readonly subscription: SubscriptionUsage
  readonly nowMs: number
}) {
  return (
    <>
      <dl className="usage-facts">
        <dt>{UI_TEXT.usagePlan}</dt>
        <dd>{planLabel(subscription.tier)}</dd>
      </dl>
      <UsageBar
        label={UI_TEXT.usageWindow}
        usedPercent={subscription.window.usedPercent}
        resetsAtMs={subscription.window.resetsAtMs}
        detail={formatWindowLength(subscription.window.windowDurationMins)}
        nowMs={nowMs}
      />
      <UsageBar
        label={UI_TEXT.usageWeekly}
        usedPercent={subscription.weekly.usedPercent}
        resetsAtMs={subscription.weekly.resetsAtMs}
        detail={undefined}
        nowMs={nowMs}
      />
      <p className="usage-row-meta">
        {UI_TEXT.usageAsOf} {relativeTime(new Date(subscription.observedAtMs).toISOString(), nowMs)}
      </p>
    </>
  )
}

/** "21K / 1M", or the used count alone when the window is unknown. */
function contextValueOf(context: ContextSummary | undefined): string | undefined {
  if (context === undefined) {
    return undefined
  }
  const used = formatTokenWindow(context.usedTokens)
  return context.windowTokens === undefined
    ? used
    : `${used} / ${formatTokenWindow(context.windowTokens)}`
}

function TokensSection({
  usage,
  context,
}: {
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
}) {
  if (usage === undefined && context === undefined) {
    return <p className="usage-row-meta">{UI_TEXT.usageNoSession}</p>
  }
  const contextValue = contextValueOf(context)
  return (
    <dl className="usage-facts">
      {usage !== undefined && (
        <>
          <dt>{UI_TEXT.usageInput}</dt>
          <dd>{formatTokenWindow(usage.inputTokens)}</dd>
          <dt>{UI_TEXT.usageOutput}</dt>
          <dd>{formatTokenWindow(usage.outputTokens)}</dd>
          <dt>{UI_TEXT.usageCached}</dt>
          <dd>{formatTokenWindow(usage.cachedTokens)}</dd>
        </>
      )}
      {contextValue !== undefined && (
        <>
          <dt>{UI_TEXT.usageContext}</dt>
          <dd>{contextValue}</dd>
        </>
      )}
    </dl>
  )
}

export function UsageDialog({
  report,
  usage,
  context,
  now,
  onOpenExternal,
  onClose,
}: UsageDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeButton.current?.focus()
  }, [])
  const nowMs = now()

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') {
      return
    }
    event.preventDefault()
    onClose()
  }

  let account
  if (report === undefined) {
    account = <p className="usage-row-meta">{UI_TEXT.usageLoading}</p>
  } else if (report.subscription === undefined) {
    account = (
      <p className="usage-row-meta">
        {report.backend === 'modelApi' ? UI_TEXT.usageModelApiNote : UI_TEXT.usageNoSubscription}
      </p>
    )
  } else {
    account = <SubscriptionSection subscription={report.subscription} nowMs={nowMs} />
  }

  return (
    <div
      className="palette history usage"
      role="dialog"
      aria-label={UI_TEXT.usageLabel}
      onKeyDown={handleKeyDown}
    >
      <div className="palette-header">
        <span className="usage-title">{UI_TEXT.usageLabel}</span>
        <button
          ref={closeButton}
          type="button"
          className="icon-button"
          aria-label={UI_TEXT.usageClose}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="usage-body">
        <dl className="usage-facts">
          <dt>{UI_TEXT.usageBackend}</dt>
          <dd>{report === undefined ? '—' : BACKEND_LABELS[report.backend]}</dd>
        </dl>
        {account}
        <h3 className="usage-heading">{UI_TEXT.usageSessionTokens}</h3>
        <TokensSection usage={usage} context={context} />
        <button
          type="button"
          className="usage-link"
          onClick={() => {
            onOpenExternal(META_DASHBOARD_URL)
          }}
        >
          {UI_TEXT.usageOpenDashboard}
        </button>
      </div>
    </div>
  )
}

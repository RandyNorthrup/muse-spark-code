import { CONTEXT_PRESSURE_HIGH, CONTEXT_PRESSURE_MEDIUM, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber, formatPercent, formatTokenWindow } from '../../shared/l10n/text'
import type { UiState } from '../state/uiState'

export interface ContextMeterProps {
  readonly context: UiState['context']
  readonly onCompact: () => void
}

/** The reported window only: colour follows the ratio, never the wire's pressure vocabulary. */
export function ContextMeter({ context, onCompact }: ContextMeterProps) {
  if (context?.windowTokens === undefined || context.windowTokens <= 0) {
    return null
  }
  const share = context.usedTokens / context.windowTokens
  const percent = Math.floor(share * 100)
  const arc = Math.min(100, Math.max(0, share * 100))
  let level = 'normal'
  if (share >= CONTEXT_PRESSURE_HIGH) {
    level = 'high'
  } else if (share >= CONTEXT_PRESSURE_MEDIUM) {
    level = 'medium'
  }
  const number =
    percent === 0 && share > 0
      ? UI_TEXT.contextMeterUnderOne
      : formatNumber(Math.min(100, Math.max(0, percent)))
  const label = fill(UI_TEXT.contextMeterLabel, { percent: formatPercent(percent) })
  const detail = fill(UI_TEXT.contextDetail, {
    used: formatTokenWindow(context.usedTokens),
    window: formatTokenWindow(context.windowTokens),
    pressure: context.pressure,
  })
  const over = share > 1 ? ` · ${UI_TEXT.contextMeterOver}` : ''
  return (
    <button
      type="button"
      className={`context-meter context-meter-${level} chat-control`}
      aria-label={`${label} · ${detail}${over}`}
      title={`${label} · ${detail}${over} · ${UI_TEXT.contextCompactTitle}`}
      onClick={onCompact}
    >
      <svg viewBox="0 0 22 22" aria-hidden="true" className="context-meter-ring">
        <circle className="context-meter-track" cx="11" cy="11" r="9.75" />
        <circle
          className="context-meter-arc"
          cx="11"
          cy="11"
          r="9.75"
          pathLength="100"
          strokeDasharray={`${String(arc)} 100`}
          transform="rotate(-90 11 11)"
        />
        <text x="11" y="11" className={arc === 100 ? 'context-meter-number-full' : undefined}>
          {number}
        </text>
      </svg>
    </button>
  )
}

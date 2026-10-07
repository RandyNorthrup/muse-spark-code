import { UI_TEXT } from './constants'
import { fill, formatNumber } from './l10n/text'
import type { BackendKind } from './protocol'

/** The backend's name as the palette, the usage dialog and an export show it. */
export function backendLabel(kind: BackendKind): string {
  // Built per call, so the name is the installed table's (PLAN.md D33).
  const labels: Readonly<Record<BackendKind, string>> = {
    museCode: UI_TEXT.backendMuseCode,
    modelApi: UI_TEXT.backendModelApi,
  }
  return labels[kind]
}

const TOKENS_PER_MILLION = 1_000_000
const TOKENS_PER_THOUSAND = 1000
// Thousands are shown to one decimal: 12.3K.
const TOKENS_PER_TENTH_THOUSAND = 100
const TENTHS_PER_UNIT = 10

/** "1M" / "200K" / "12.3K" / "512" for a token count, in the display language's digits. */
export function formatTokenWindow(tokens: number): string {
  if (tokens < TOKENS_PER_THOUSAND) {
    return formatNumber(tokens)
  }
  const thousands = Math.round(tokens / TOKENS_PER_TENTH_THOUSAND) / TENTHS_PER_UNIT
  // 999,950 and up round to a thousand thousands: that is "1M", not "1,000K".
  return thousands < TOKENS_PER_THOUSAND
    ? `${formatNumber(thousands)}K`
    : `${formatNumber(Math.round(tokens / TOKENS_PER_MILLION))}M`
}

/** "200K context": a model's context window. */
export function contextWindowLabel(tokens: number): string {
  return fill(UI_TEXT.modelContextWindow, { tokens: formatTokenWindow(tokens) })
}

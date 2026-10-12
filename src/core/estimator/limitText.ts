// Canonical note records travel through forecasts; only surface adapters render them.
import * as z from 'zod/mini'
import { fill, formatDateTime, formatPercent, UI_TEXT } from '../../shared/l10n/text'
const noteSchema = /* @__PURE__ */ (() =>
  z.strictObject({
    code: z.enum(['unread', 'refill', 'demand', 'ci', 'default', 'configured']),
    source: z.string(),
    reset: z.optional(z.iso.datetime()),
    value: z.optional(z.number().check(z.nonnegative(), z.maximum(100))),
  }))()
type Note = z.infer<typeof noteSchema>
export function limitNote(
  code: Note['code'],
  source: string,
  reset?: string,
  value?: number,
): string {
  return JSON.stringify({
    code,
    source,
    ...(reset !== undefined && { reset }),
    ...(value !== undefined && { value }),
  })
}
export function renderLimitNote(value: string): string {
  if (value.startsWith('estimate-no-account-reader:'))
    return fill(UI_TEXT.estimateNoAccountReader, {
      source: value.slice('estimate-no-account-reader:'.length),
    })
  let input: unknown
  try {
    input = JSON.parse(value)
  } catch {
    return value
  }
  const parsed = noteSchema.safeParse(input)
  if (!parsed.success) return value
  const note = parsed.data
  const source =
    note.value === undefined ? note.source : `${note.source}: ${formatPercent(note.value)}`
  switch (note.code) {
    case 'unread': {
      return fill(UI_TEXT.estimateLimitsUnread, { source })
    }
    case 'refill': {
      return fill(UI_TEXT.estimateRefillUnknown, { source })
    }
    case 'demand': {
      return fill(UI_TEXT.estimatePercentDemandUnknown, {
        source,
        reset:
          note.reset === undefined
            ? UI_TEXT.estimateResetUnknown
            : formatDateTime(Date.parse(note.reset)),
      })
    }
    case 'ci': {
      return UI_TEXT.estimateCiUnread
    }
    case 'default': {
      return fill(UI_TEXT.estimateSettingsDefault, { source })
    }
    case 'configured': {
      return fill(UI_TEXT.estimateSettingsConfigured, { source })
    }
  }
}

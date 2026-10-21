// A typed vault expiry (an item's own, an OAuth or session login's, a
// grant's) reads the same way everywhere: two shapes only, never the
// engine's loose guesses ("1" as 2001-01-01, "12/1" in a locale's order),
// and never a moment that has already passed. A function, not a
// module-level read: UI_TEXT is read when the shown language is installed.
import { UI_TEXT } from './constants'

/**
YYYY-MM-DD, or YYYY-MM-DDTHH:MM with optional :SS, .fff and a zone (Z or
±HH:MM). The fourth group is the time part, absent for a date alone.
*/
const EXPIRY_SHAPE =
  /^(\d{4})-(\d{2})-(\d{2})(T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/u

/**
The instant a typed expiry names, or null when it is neither shape or not a
real calendar day (2026-02-30). A date alone is the start of that day in the
person's own time zone. A date and time is that time in the person's zone,
or in the zone it names: once the shape and the day are proven it is
ECMAScript's own date-time string, which the language reads exactly that
way (local time without a zone), never the engine's guesswork.
*/
function expiryInstant(typed: string): number | null {
  const shape = EXPIRY_SHAPE.exec(typed.trim())
  if (shape === null) return null
  const [whole, year, month, day, time] = shape
  const start = new Date(Number(year), Number(month) - 1, Number(day))
  const isRealDay =
    start.getFullYear() === Number(year) &&
    start.getMonth() === Number(month) - 1 &&
    start.getDate() === Number(day)
  if (!isRealDay) return null
  return time === undefined ? start.getTime() : Date.parse(whole)
}

/** A typed expiry's instant, or the sentence that asks for it again. */
export type VaultExpiryReading =
  { readonly at: number; readonly refusal: null } | { readonly at: null; readonly refusal: string }

/**
Reads a non-empty typed expiry against the clock. `kept` is the stored
expiry an edit pre-fills, or null where nothing is stored.
*/
export function readVaultExpiry(
  typed: string,
  now: number,
  kept: number | null,
): VaultExpiryReading {
  const at = expiryInstant(typed)
  if (at === null) return { at: null, refusal: UI_TEXT.vault.expiresInvalid }
  // The one exception to "already passed": an edit that keeps the item's
  // stored expiry unchanged, so a person editing another field of an
  // expired item is not made to change or clear its date first.
  const isPassed = at !== kept && at <= now
  return isPassed ? { at: null, refusal: UI_TEXT.vault.expiresPassed } : { at, refusal: null }
}

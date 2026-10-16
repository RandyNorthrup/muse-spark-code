// The person's own per-turn tool-round limit (lane LIMITSFIX, F8, D113): one
// reading of the number for every surface (the VS Code setting, the panel, the
// terminal's exec and serve flags, the editor protocol's session option, the
// stored session and sub-agents). Off is no limit; otherwise any whole number
// from 1 up. No fixed list and no upper bound: a limit the person sets is
// theirs, not one we invented.

export type TurnLimitReading =
  { readonly isValid: true; readonly rounds: number | undefined } | { readonly isValid: false }

const WHOLE_NUMBER = /^[1-9]\d*$/

/** `off`, or a whole number of rounds from 1 up, as text from a flag or a select. */
export function readTurnLimit(text: string): TurnLimitReading {
  if (text === 'off') return { isValid: true, rounds: undefined }
  if (!WHOLE_NUMBER.test(text)) return { isValid: false }
  const rounds = Number(text)
  return Number.isSafeInteger(rounds) ? { isValid: true, rounds } : { isValid: false }
}

/** A whole number from 1 up; anything else is not a limit. */
export function isTurnLimitRounds(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1
}

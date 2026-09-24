// Quoting one value as one argument for the two shells the extension types
// into (M31): Windows PowerShell (the job helper's scripts, M27, and the
// Windows terminals) and `/bin/sh` (the terminals elsewhere).
//
// PowerShell treats the typographic single quotes U+2018 to U+201B as quote
// characters too, so inside a single-quoted string each of them, like `'`,
// is doubled; a value such as `C:\Users\O’Brien` otherwise ends the string
// early (about_Quoting_Rules). `/bin/sh` has no escape inside single quotes,
// so a `'` closes the string, is written escaped, and reopens it.

const POWERSHELL_SINGLE_QUOTES = /['\u{2018}-\u{201B}]/gu
const POSIX_SINGLE_QUOTE = "'"
const POSIX_ESCAPED_QUOTE = String.raw`'\''`

/** A PowerShell single-quoted string holding exactly `text`. */
export function powerShellQuoted(text: string): string {
  return `'${text.replaceAll(POWERSHELL_SINGLE_QUOTES, (quote) => `${quote}${quote}`)}'`
}

/** A `/bin/sh` single-quoted word holding exactly `text`. */
export function posixQuoted(text: string): string {
  // A function, so nothing in the replacement is read as a `$` pattern.
  return `'${text.replaceAll(POSIX_SINGLE_QUOTE, () => POSIX_ESCAPED_QUOTE)}'`
}

/** One argument for the terminal shell the extension pins on this platform. */
export function terminalArgument(text: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? powerShellQuoted(text) : posixQuoted(text)
}

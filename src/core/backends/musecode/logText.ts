// What the log says about text the Muse Code CLI wrote (the review of PR
// #49): its MSP error messages and its stderr are free text that can name a
// path under the user's profile or an account, and the log channel's
// redactor catches only key-shaped strings. So an MSP failure is named by its
// kind and code, and stderr by the lines 1.4.0-R4302.1 was captured writing
// (docs/certification/sign-in-detection.md), in fixed words; anything else
// by its length alone.

import { MspError } from '@muse-code/sdk'
import { wireWordForLog } from '../../logging'
import { DeadlineError } from '../../timeouts'

/** A failure as the log names it: never the CLI's message. */
export function failureForLog(error: unknown): string {
  if (error instanceof MspError) {
    return `${wireWordForLog(error.kind)} (MSP error ${String(error.code)})`
  }
  // The extension's own words, naming the method that went unanswered.
  if (error instanceof DeadlineError) {
    return error.message
  }
  return error instanceof Error ? error.name : 'an unknown failure'
}

// The stderr lines captured from `muse serve` 1.4.0-R4302.1 (Windows and
// Linux, 2026-09-27; scratchpad/m140cred), each named in fixed words.
const CAPTURED_STDERR: readonly {
  readonly pattern: RegExp
  readonly logged: (match: RegExpExecArray) => string
}[] = [
  {
    pattern: /unsupported auth schema version (\d{1,9})/u,
    logged: (match) =>
      `unsupported auth schema version ${match[1] ?? '?'} (the credential file's path is not logged)`,
  },
  {
    pattern: /keychain item for meta is unreadable/u,
    logged: () => 'the Keychain item for meta is unreadable',
  },
  {
    pattern: /startup model-catalog fetch failed/u,
    logged: () => 'the startup model-catalog fetch failed',
  },
]

/** One line the CLI wrote to stderr, as the log names it. */
function stderrLineForLog(line: string): string {
  for (const captured of CAPTURED_STDERR) {
    const match = captured.pattern.exec(line)
    if (match !== null) {
      return captured.logged(match)
    }
  }
  return `a line of ${String(line.length)} characters (not logged: it may name a path or an account)`
}

/** What the CLI wrote to stderr, as the log names it: each line in fixed words. */
export function stderrForLog(chunk: string): string {
  return chunk
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '')
    .map((line) => stderrLineForLog(line))
    .join('; ')
}

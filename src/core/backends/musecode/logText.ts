// What the log says about text the Muse Code CLI wrote (the review of PR
// #49): its MSP error messages and its stderr are free text that can name a
// path under the user's profile or an account, and the log channel's
// redactor catches only key-shaped strings. So an MSP failure is named by its
// kind and code, and stderr by the lines 1.4.0-R4302.1 was captured writing
// (docs/certification/sign-in-detection.md), in fixed words; anything else
// by its length alone.

import { wireWordForLog } from '../../logging'
import { DeadlineError } from '../../timeouts'

/** SDK errors cross independently bundled code; constructor identity cannot. */
export function isMspFailure(
  error: unknown,
): error is Error & { readonly kind: string; readonly code: number } {
  return (
    error instanceof Error &&
    error.name === 'MspError' &&
    'kind' in error &&
    typeof error.kind === 'string' &&
    'code' in error &&
    typeof error.code === 'number' &&
    Number.isSafeInteger(error.code)
  )
}

/** A failure as the log names it: never the CLI's message. */
export function failureForLog(error: unknown): string {
  if (isMspFailure(error)) {
    return `${wireWordForLog(error.kind)} (MSP error ${String(error.code)})`
  }
  // The extension's own words, naming the method that went unanswered.
  if (error instanceof DeadlineError) {
    return error.message
  }
  return error instanceof Error ? error.name : 'an unknown failure'
}

/**
The root fault behind wrappers that carry it as `cause` (a sharing
adapter's internal failure, a bundle loader's unavailable error): still a
name, never raw text, paths or prompt text.
*/
export function internalFaultForLog(error: unknown): string {
  let current = error
  while (current instanceof Error && current.cause instanceof Error) current = current.cause
  return failureForLog(current)
}

// The stderr lines captured from `muse serve` 1.4.0-R4302.1 (Windows and
// Linux, 2026-09-27; scratchpad/m140cred) and 1.4.10-R6427.1 (macOS,
// 2026-10-17, F94), each named in fixed words.
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
  // `muse serve` 1.4.10-R6427.1 exits 3 before `initialize` when the
  // credential file's `meta` entry lacks a field the CLI requires
  // (captured 2026-10-17, F94): the path is never logged, and the reason
  // only when it is one of the two captured schema diagnostics below. A
  // reason in any other shape — including one naming an account — is
  // logged by its length alone (Codex on PR #211).
  {
    // Greedy to the last ": ": a POSIX path may itself contain one, and
    // the reason (a backticked schema word, no colon) follows the path's.
    pattern: /malformed auth file at .*: (missing field `[A-Za-z0-9_]{1,64}`)/u,
    logged: (match) => `the credential file is malformed (${match[1] ?? 'no reason given'})`,
  },
  {
    pattern: /malformed auth file at .*: (providers\.meta\.api_key must be a string)/u,
    logged: (match) => `the credential file is malformed (${match[1] ?? 'no reason given'})`,
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

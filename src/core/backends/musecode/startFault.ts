// Why `muse serve` ended before it answered, said in our own fixed words
// (RLF-SMALLFIX2). The CLI's stderr is free text that can name a path or an
// account, so it is never forwarded: only lines captured from a real
// `muse serve` (1.4.14-R7309.1, macOS, 2026-10-31, a throwaway home whose
// muse/auth.json was malformed, a folder, unreadable by mode 000, or of schema
// version 99; no model attempt) choose one of our sentences, and the exit
// status chooses the others.

import { SHELL_EXIT_CANNOT_RUN, UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { MuseStartError } from '../../../shared/museStartError'

/** What the CLI was captured writing as it refused to start. */
export interface StderrStartFault {
  readonly fault: 'authFile' | 'authSchema'
  /** The schema version the file declares, digits only. */
  readonly version?: string
}

/** How `muse serve` ended on its own: a status code, or a signal name. */
export interface MuseExit {
  readonly code: number | null
  readonly signal: string | null
}

/** The ProtocolError the SDK raises when the host ends before it answers `initialize`. */
const PROTOCOL_ERROR = 'ProtocolError'

/** What one stderr chunk says about why the CLI refuses to start, if it is a captured line. */
export function stderrStartFault(chunk: string): StderrStartFault | undefined {
  const version = /unsupported auth schema version (\d{1,9})/u.exec(chunk)?.[1]
  if (version !== undefined) return { fault: 'authSchema', version }
  return /(?:malformed|failed to read) auth file at /u.test(chunk)
    ? { fault: 'authFile' }
    : undefined
}

/** A close's result as an exit, if it is one (the SDK's `{ code, signal }`). */
export function museExitOf(value: unknown): MuseExit | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const code: unknown = 'code' in value ? value.code : undefined
  const signal: unknown = 'signal' in value ? value.signal : undefined
  const isCode = code === null || typeof code === 'number'
  const isSignal = signal === null || typeof signal === 'string'
  return isCode && isSignal ? { code, signal } : undefined
}

/**
The sentence for a start that failed because the host ended, or the failure
itself when that is not what happened: a stop the caller asked for, a host
that answered and was then refused, and a close that our own signal ended are
not the host's own failing exit and are left untouched.
*/
export function museStartFailure(
  error: unknown,
  fault: StderrStartFault | undefined,
  exit: MuseExit | undefined,
  platform: NodeJS.Platform = process.platform,
): unknown {
  if (!(error instanceof Error) || error.name !== PROTOCOL_ERROR) return error
  const text = UI_TEXT.museStart
  const cause = { cause: error }
  if (fault?.fault === 'authFile') return new MuseStartError('authFile', text.authFile, cause)
  if (fault?.fault === 'authSchema')
    return new MuseStartError(
      'authSchema',
      fill(text.authSchema, { version: fault.version ?? '?' }),
      cause,
    )
  // Status 0 is a host that closed after our own close; a signal is our kill.
  if (exit === undefined || exit.code === null || exit.code === 0 || exit.signal !== null)
    return error
  const code = String(exit.code)
  return platform !== 'win32' && SHELL_EXIT_CANNOT_RUN.has(exit.code)
    ? new MuseStartError('cannotRun', fill(text.cannotRun, { code }), cause)
    : new MuseStartError('exited', fill(text.exited, { code }), cause)
}

// What the log keeps of text the Muse Code CLI wrote (the review of PR #49):
// protocol words in their shape, MSP failures by kind and code, and stderr
// by the lines 1.4.0-R4302.1 was captured writing, in fixed words.

import { MspError } from '@muse-code/sdk'
import { describe, expect, it } from 'vitest'
import {
  failureForLog,
  internalFaultForLog,
  stderrForLog,
} from '../../src/core/backends/musecode/logText'
import { wireWordForLog } from '../../src/core/logging'
import { DeadlineError } from '../../src/core/timeouts'

// Synthetic: free text naming a path under a profile and an e-mail address.
const PERSONAL = String.raw`failed for someone@example.com at C:\Users\someone\.config\muse\auth.json`

describe('wireWordForLog', () => {
  it('keeps a protocol word and replaces anything else', () => {
    expect(wireWordForLog('accountLogin')).toBe('accountLogin')
    expect(wireWordForLog('session_not-loaded2')).toBe('session_not-loaded2')
    expect(wireWordForLog('someone@example.com')).toBe('an unrecognized value')
    expect(wireWordForLog(String.raw`C:\Users\someone`)).toBe('an unrecognized value')
    expect(wireWordForLog('/home/someone')).toBe('an unrecognized value')
    expect(wireWordForLog('two words')).toBe('an unrecognized value')
    expect(wireWordForLog('')).toBe('an unrecognized value')
    expect(wireWordForLog('x'.repeat(65))).toBe('an unrecognized value')
  })
})

describe('failureForLog', () => {
  it('recognizes the SDK error from a separate bundle without its local prototype', () => {
    const error = new MspError({
      code: -32_000,
      message: PERSONAL,
      data: { kind: 'commandRejected' },
    })
    Object.setPrototypeOf(error, Error.prototype)
    expect(error).not.toBeInstanceOf(MspError)
    expect(failureForLog(error)).toBe('commandRejected (MSP error -32000)')
  })

  it('names an MSP error by its kind and code, never its message', () => {
    const refused = new MspError({
      code: -32_000,
      message: PERSONAL,
      data: { kind: 'commandRejected' },
    })
    expect(failureForLog(refused)).toBe('commandRejected (MSP error -32000)')
    const odd = new MspError({ code: -32_000, message: PERSONAL, data: { kind: PERSONAL } })
    expect(failureForLog(odd)).toBe('an unrecognized value (MSP error -32000)')
  })

  it('keeps the extension’s own deadline words, and names anything else by its type', () => {
    expect(failureForLog(new DeadlineError('Muse Code did not answer task/stopAll in time'))).toBe(
      'Muse Code did not answer task/stopAll in time',
    )
    expect(failureForLog(new Error(PERSONAL))).toBe('Error')
    expect(failureForLog(new TypeError(PERSONAL))).toBe('TypeError')
    expect(failureForLog(PERSONAL)).toBe('an unknown failure')
  })
})

describe('internalFaultForLog', () => {
  it('names the root only at cause-aware sites while legacy readers name the outer error', () => {
    const root = new TypeError(PERSONAL)
    const wrapped = new Error('sanitized boundary', {
      cause: new Error('another wrapper', { cause: root }),
    })
    expect(internalFaultForLog(wrapped)).toBe('TypeError')
    expect(failureForLog(wrapped)).toBe('Error')
    expect(internalFaultForLog(wrapped)).not.toContain(PERSONAL)
  })
})

describe('stderrForLog', () => {
  // As captured from `muse serve` 1.4.0-R4302.1 (probe-v2-serve-win.json,
  // probe-v2-serve-linux.json, envkey-stderr.txt), a profile path put back.
  it.each([
    [
      String.raw`compose serve model client: unsupported auth schema version 2 at C:\Users\someone\cfg\muse\auth.json`,
      "unsupported auth schema version 2 (the credential file's path is not logged)",
    ],
    [
      'compose serve model client: keychain item for meta is unreadable (internal error -2147483648)',
      'the Keychain item for meta is unreadable',
    ],
    [
      'tbh serve: startup model-catalog fetch failed (failed to fetch model catalog: transport error: error sending request for url (https://api.meta.ai/muse-code/models)); no cached default — composing the logged-out fallback',
      'the startup model-catalog fetch failed',
    ],
    // As captured from `muse serve` 1.4.10-R6427.1 on 2026-10-17 (F94):
    // a meta entry without the fields the CLI requires exits 3 before
    // `initialize` with this line (throwaway homes, dummy values).
    [
      'compose serve model client: malformed auth file at C:\\Users\\someone\\cfg\\muse\\auth.json: missing field `obtained_via`',
      'the credential file is malformed (missing field `obtained_via`)',
    ],
    [
      'compose serve model client: malformed auth file at /home/someone/.config/muse/auth.json: providers.meta.api_key must be a string',
      'the credential file is malformed (providers.meta.api_key must be a string)',
    ],
    // A POSIX path may itself contain ": ": the reason still names the
    // file's fault, never a fragment of the path.
    [
      'compose serve model client: malformed auth file at /home/a: b/.config/muse/auth.json: missing field `obtained_via`',
      'the credential file is malformed (missing field `obtained_via`)',
    ],
  ])('names the captured line %s in fixed words', (line, logged) => {
    expect(stderrForLog(`${line}\n`)).toBe(logged)
  })

  it('logs any other line by its length alone, one entry per line', () => {
    const logged = stderrForLog(`${PERSONAL}\r\n\nsecond\n`)
    expect(logged).toBe(
      `a line of ${String(PERSONAL.length)} characters (not logged: it may name a path or an account); a line of 6 characters (not logged: it may name a path or an account)`,
    )
    expect(logged).not.toContain('someone')
  })

  it('never copies a malformed-auth reason outside the captured diagnostics', () => {
    const line =
      'compose serve model client: malformed auth file at /home/someone/.config/muse/auth.json: account someone123 needs attention'
    const logged = stderrForLog(`${line}\n`)
    expect(logged).toBe(
      `a line of ${String(line.length)} characters (not logged: it may name a path or an account)`,
    )
    expect(logged).not.toContain('someone123')
  })
})

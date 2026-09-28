// What the log keeps of text the Muse Code CLI wrote (the review of PR #49):
// protocol words in their shape, MSP failures by kind and code, and stderr
// by the lines 1.4.0-R4302.1 was captured writing, in fixed words.

import { MspError } from '@muse-code/sdk'
import { describe, expect, it } from 'vitest'
import { failureForLog, stderrForLog } from '../../src/core/backends/musecode/logText'
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
})

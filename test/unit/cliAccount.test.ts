import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountState } from '../../src/host/auth/accountHost'
import {
  CliAccount,
  cliSignInFromAccount,
  isCliSignedIn,
  readCredentialFile,
} from '../../src/host/auth/cliAccount'
import {
  MUSE_CREDENTIAL_FILE_MAX_BYTES,
  MUSE_USER_ACTION_ANSWER_REUSE_MS,
} from '../../src/shared/constants'
import {
  capturedInlineVerdict,
  DEVICE_LOGIN_FILE,
  LOGOUT_SHELL,
  SHIPPED_PLATFORMS,
  SLACK_CONNECTOR_ONLY,
} from './helpers/credentialShapes'
import { FakeLogOutputChannel } from './helpers/fakes'

// Not captured here: macOS's pointer as a third party observed it (aonia
// §2.3). Synthetic: a file cut short, which only the CLI can place.
const MAC_POINTER =
  '{"schema_version":2,"providers":{"meta":{"mechanism":"oauth","storage":"keychain"}}}'
const MALFORMED = '{"schema_version": 1, "providers": '

const SIGNED_IN: AccountState = { state: 'accountLogin', credentialRequired: true }
const LOGGED_OUT: AccountState = { state: 'loggedOut', credentialRequired: true }

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

function configHome(): { readonly file: string; readonly write: (text: string) => void } {
  const home = mkdtempSync(path.join(tmpdir(), 'muse-cred-'))
  homes.push(home)
  const file = path.join(home, 'muse', 'auth.json')
  mkdirSync(path.dirname(file), { recursive: true })
  return {
    file,
    write: (text) => {
      writeFileSync(file, text)
    },
  }
}

/** A later modification time, as a new write would leave. */
function touchLater(file: string, seconds: number): void {
  const at = new Date(Date.now() + seconds * 1000)
  utimesSync(file, at, at)
}

function account(platform: NodeJS.Platform, file: string, answers: (AccountState | undefined)[]) {
  const probe = vi.fn(() => Promise.resolve(answers.shift()))
  const log = new FakeLogOutputChannel()
  const checker = new CliAccount({ platform, credentialFilePath: () => file, probe, log })
  return { checker, probe, log }
}

/** A Linux checker over the file, asking the given probe. */
function linuxChecker(file: string, probe: () => Promise<AccountState | undefined>) {
  return new CliAccount({
    platform: 'linux',
    credentialFilePath: () => file,
    probe,
    log: new FakeLogOutputChannel(),
  })
}

/**
 * An ambiguous file on Linux whose first CLI question waits until the test
 * answers it (`stale`), and whose next is answered signed out.
 */
function staleThenLoggedOut() {
  const home = configHome()
  home.write(MALFORMED)
  const stale = Promise.withResolvers<AccountState | undefined>()
  const answers = [stale.promise, Promise.resolve(LOGGED_OUT)]
  const probe = vi.fn(() => answers.shift() ?? Promise.resolve(undefined))
  return { home, stale, probe, checker: linuxChecker(home.file, probe) }
}

/** An ambiguous file on Linux whose CLI question waits until the test answers it. */
function heldQuestion() {
  const home = configHome()
  home.write(MALFORMED)
  const answer = Promise.withResolvers<AccountState | undefined>()
  const probe = vi.fn(() => answer.promise)
  return { home, answer, probe, checker: linuxChecker(home.file, probe) }
}

describe('readCredentialFile', () => {
  it('is nothing when there is no file', () => {
    const home = configHome()
    expect(readCredentialFile(home.file, 'win32')).toBeUndefined()
    expect(readCredentialFile(path.join(home.file, 'deeper'), 'win32')).toBeUndefined()
  })

  it('reads the structure and signs it by size and modification time', () => {
    const home = configHome()
    home.write(LOGOUT_SHELL)
    const reading = readCredentialFile(home.file, 'linux')
    expect(reading?.verdict).toBe('empty')
    expect(reading?.signature).toMatch(/^44:\d+(\.\d+)?$/)
  })

  // The real file read as each OS reads it, macOS's branch included, on any
  // runner (the review of PR #49: an e2e expectation failed in macOS CI only).
  it.each(SHIPPED_PLATFORMS)('reads a browser sign-in file as %s does', (platform) => {
    const home = configHome()
    home.write(DEVICE_LOGIN_FILE)
    expect(readCredentialFile(home.file, platform)?.verdict).toBe(capturedInlineVerdict(platform))
  })

  it('does not read a folder or an oversized file', () => {
    const home = configHome()
    mkdirSync(home.file)
    expect(readCredentialFile(home.file, 'linux')).toEqual({
      signature: 'unreadable',
      verdict: 'unrecognized',
    })
    const other = configHome()
    other.write(' '.repeat(MUSE_CREDENTIAL_FILE_MAX_BYTES + 1))
    expect(readCredentialFile(other.file, 'linux')?.verdict).toBe('unrecognized')
  })
})

describe('cliSignInFromAccount', () => {
  it('maps the CLI’s answer, never guessing past it', () => {
    expect(cliSignInFromAccount(undefined)).toBe('unknown')
    expect(cliSignInFromAccount(SIGNED_IN)).toBe('signedIn')
    expect(cliSignInFromAccount({ state: 'apiKey', credentialRequired: true })).toBe('signedIn')
    expect(cliSignInFromAccount(LOGGED_OUT)).toBe('signedOut')
    // Never captured: its meaning is not guessed at (the review of PR #49).
    expect(cliSignInFromAccount({ state: 'loggedOut', credentialRequired: false })).toBe('unknown')
    // META_API_KEY hides the stored lane; a future state is not guessed at.
    expect(cliSignInFromAccount({ state: 'envKey', credentialRequired: true })).toBe('unknown')
    expect(cliSignInFromAccount({ state: 'somethingNew', credentialRequired: true })).toBe(
      'unknown',
    )
  })

  it('counts unknown as signed in for the estimate', () => {
    expect(isCliSignedIn('signedIn')).toBe(true)
    expect(isCliSignedIn('unknown')).toBe(true)
    expect(isCliSignedIn('signedOut')).toBe(false)
    expect(isCliSignedIn('unsupportedHere')).toBe(false)
  })
})

describe('CliAccount', () => {
  it('reads no file and the file a sign-out leaves as signed out, starting no process', async () => {
    const home = configHome()
    const t = account('win32', home.file, [])
    await expect(t.checker.signIn(true)).resolves.toBe('signedOut')
    expect(readCredentialFile(home.file, 'win32')).toBeUndefined()
    home.write(LOGOUT_SHELL)
    await expect(t.checker.signIn(true)).resolves.toBe('signedOut')
    expect(readCredentialFile(home.file, 'win32')?.verdict).toBe('empty')
    expect(t.probe).not.toHaveBeenCalled()
  })

  it('reads a stored sign-in as signed in without asking', async () => {
    const home = configHome()
    home.write(DEVICE_LOGIN_FILE)
    const t = account('linux', home.file, [])
    await expect(t.checker.signIn(false)).resolves.toBe('signedIn')
    expect(t.probe).not.toHaveBeenCalled()
  })

  // Uncaptured on macOS: a version-1 file holding the credential, and an
  // empty version-2 file. Asked like a pointer, on a user action only; the
  // passive estimate is unknown (the review of PR #49).
  it.each([
    ['a browser sign-in file', DEVICE_LOGIN_FILE],
    ['an empty version-2 file', '{"schema_version":2,"providers":{}}'],
  ])('asks the CLI about %s on macOS, only on a user action', async (_name, contents) => {
    const home = configHome()
    home.write(contents)
    const t = account('darwin', home.file, [LOGGED_OUT])
    await expect(t.checker.signIn(false)).resolves.toBe('unknown')
    expect(t.probe).not.toHaveBeenCalled()
    await expect(t.checker.signIn(true)).resolves.toBe('signedOut')
    expect(t.probe).toHaveBeenCalledOnce()
  })

  it('still reads the file a sign-out leaves as signed out on macOS, starting no process', async () => {
    const home = configHome()
    home.write(LOGOUT_SHELL)
    const t = account('darwin', home.file, [])
    await expect(t.checker.signIn(true)).resolves.toBe('signedOut')
    expect(t.probe).not.toHaveBeenCalled()
  })

  it('names a macOS pointer on Windows without starting a host that would exit', async () => {
    const home = configHome()
    home.write(MAC_POINTER)
    const t = account('win32', home.file, [])
    await expect(t.checker.signIn(true)).resolves.toBe('unsupportedHere')
    expect(t.probe).not.toHaveBeenCalled()
  })

  it('asks about a macOS Keychain pointer only on a user action', async () => {
    const home = configHome()
    home.write(MAC_POINTER)
    const t = account('darwin', home.file, [SIGNED_IN])
    await expect(t.checker.signIn(false)).resolves.toBe('unknown')
    expect(t.probe).not.toHaveBeenCalled()
    await expect(t.checker.signIn(true)).resolves.toBe('signedIn')
    expect(t.probe).toHaveBeenCalledOnce()
    // The answer stands, passive or not, until the file changes.
    await expect(t.checker.signIn(false)).resolves.toBe('signedIn')
    await expect(t.checker.signIn(true)).resolves.toBe('signedIn')
    expect(t.probe).toHaveBeenCalledOnce()
    expect(t.log.info).toHaveBeenCalledWith(
      'Muse Code sign-in confirmed by account/read: accountLogin (signedIn)',
    )
  })

  // A Keychain-only sign-in or sign-out elsewhere leaves the file as it was:
  // on macOS a later user action (Diagnostics, Check again, Cancel, a
  // sign-in or sign-out) asks afresh; the same click reuses its answer
  // (Codex on 2a324d48). Off macOS the file speaks for the sign-in.
  it.each([
    ['darwin', MAC_POINTER, 2, 'signedOut'],
    ['linux', MALFORMED, 1, 'signedIn'],
  ] as const)(
    'on %s, asks a later user action afresh only on macOS, the file unchanged',
    async (platform, contents, asks, later) => {
      const home = configHome()
      home.write(contents)
      let clock = 0
      const answers: AccountState[] = [SIGNED_IN, LOGGED_OUT]
      const probe = vi.fn(() => Promise.resolve(answers.shift()))
      const checker = new CliAccount({
        platform,
        credentialFilePath: () => home.file,
        probe,
        log: new FakeLogOutputChannel(),
        now: () => clock,
      })
      await expect(checker.signIn(true)).resolves.toBe('signedIn')
      clock += MUSE_USER_ACTION_ANSWER_REUSE_MS - 1
      await expect(checker.signIn(true)).resolves.toBe('signedIn')
      expect(probe).toHaveBeenCalledOnce()
      clock += 2
      await expect(checker.signIn(true)).resolves.toBe(later)
      expect(probe).toHaveBeenCalledTimes(asks)
    },
  )

  it('asks about a malformed file off macOS at once, and keeps the answer until it changes', async () => {
    const home = configHome()
    home.write(MALFORMED)
    const t = account('win32', home.file, [LOGGED_OUT, SIGNED_IN])
    await expect(t.checker.signIn(false)).resolves.toBe('signedOut')
    await expect(t.checker.signIn(false)).resolves.toBe('signedOut')
    expect(t.probe).toHaveBeenCalledOnce()
    // Same size, new modification time: asked again.
    touchLater(home.file, 60)
    await expect(t.checker.signIn(false)).resolves.toBe('signedIn')
    expect(t.probe).toHaveBeenCalledTimes(2)
  })

  it('asks again when the size changes', async () => {
    const home = configHome()
    home.write(MALFORMED)
    const t = account('linux', home.file, [LOGGED_OUT, SIGNED_IN])
    await t.checker.signIn(false)
    home.write(`${MALFORMED} `)
    await expect(t.checker.signIn(false)).resolves.toBe('signedIn')
    expect(t.probe).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed answer for passive looks, and asks again on a user action', async () => {
    const home = configHome()
    home.write(MALFORMED)
    const t = account('linux', home.file, [undefined, LOGGED_OUT])
    await expect(t.checker.signIn(false)).resolves.toBe('unknown')
    await expect(t.checker.signIn(false)).resolves.toBe('unknown')
    expect(t.probe).toHaveBeenCalledOnce()
    await expect(t.checker.signIn(true)).resolves.toBe('signedOut')
    expect(t.probe).toHaveBeenCalledTimes(2)
    expect(t.log.info).toHaveBeenCalledWith(
      'Muse Code sign-in confirmed by account/read: no answer (unknown)',
    )
  })

  it('shares one question among callers asking at once', async () => {
    const { answer, probe, checker } = heldQuestion()
    const first = checker.signIn(false)
    const second = checker.signIn(true)
    answer.resolve(SIGNED_IN)
    await expect(Promise.all([first, second])).resolves.toEqual(['signedIn', 'signedIn'])
    expect(probe).toHaveBeenCalledOnce()
  })

  it('looks again when the file is rewritten while the CLI answers (the review of PR #49)', async () => {
    const { home, answer, checker } = heldQuestion()
    const pending = checker.signIn(true)
    // A sign-out rewrites the file while the old question is out.
    home.write(LOGOUT_SHELL)
    answer.resolve(SIGNED_IN)
    await expect(pending).resolves.toBe('signedOut')
  })

  // The late answer reaches no caller: the one that waited on it looks again
  // and gets the newer answer, so it cannot publish an older state over a
  // newer one (the review of PR #49).
  it('asks afresh after an unanswered probe is abandoned, and gives its late answer to no one (the review of PR #49)', async () => {
    const { stale, probe, checker } = staleThenLoggedOut()
    const abandoned = checker.signIn(true)
    checker.abandonProbe()
    await expect(checker.signIn(true)).resolves.toBe('signedOut')
    expect(probe).toHaveBeenCalledTimes(2)
    stale.resolve(SIGNED_IN)
    await expect(abandoned).resolves.toBe('signedOut')
    await expect(checker.signIn(false)).resolves.toBe('signedOut')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  // Check again forgets a probe others are waiting on: every one of them
  // gets the answer Check again got (the review of PR #49).
  it('gives the callers of a forgotten probe the newer answer, the one that joined it too', async () => {
    const { stale, probe, checker } = staleThenLoggedOut()
    const started = checker.signIn(true)
    const joined = checker.signIn(false)
    checker.forgetAnswers()
    await expect(checker.signIn(true)).resolves.toBe('signedOut')
    stale.resolve(SIGNED_IN)
    await expect(Promise.all([started, joined])).resolves.toEqual(['signedOut', 'signedOut'])
    expect(probe).toHaveBeenCalledTimes(2)
  })

  // A probe about an older version of the file answers after one about the
  // newer version was remembered: the older answer replaces nothing, and its
  // caller gets the newer one (the review of PR #49).
  it('keeps the newer file version’s answer when an older probe answers late', async () => {
    const { home, stale, probe, checker } = staleThenLoggedOut()
    const first = checker.signIn(true)
    home.write(`${MALFORMED} `)
    await expect(checker.signIn(true)).resolves.toBe('signedOut')
    stale.resolve(SIGNED_IN)
    await expect(first).resolves.toBe('signedOut')
    await expect(checker.signIn(false)).resolves.toBe('signedOut')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  // The state vocabulary is open: a state not shaped like a protocol word is
  // not logged (the review of PR #49).
  it('logs the CLI’s state only in the shape of a protocol word', async () => {
    const home = configHome()
    home.write(MALFORMED)
    const t = account('linux', home.file, [
      { state: 'someone@example.com', credentialRequired: true },
    ])
    await expect(t.checker.signIn(true)).resolves.toBe('unknown')
    expect(t.log.info).toHaveBeenCalledWith(
      'Muse Code sign-in confirmed by account/read: an unrecognized value (unknown)',
    )
  })

  // Cancel abandons a probe but keeps what the CLI already said; a sign-out,
  // a new sign-in or Check again forgets it (the review of PR #49).
  it('keeps a remembered answer when a probe is abandoned, and asks afresh once forgotten', async () => {
    const home = configHome()
    home.write(MALFORMED)
    const t = account('linux', home.file, [SIGNED_IN, LOGGED_OUT])
    await expect(t.checker.signIn(true)).resolves.toBe('signedIn')
    t.checker.abandonProbe()
    await expect(t.checker.signIn(true)).resolves.toBe('signedIn')
    expect(t.probe).toHaveBeenCalledOnce()
    t.checker.forgetAnswers()
    await expect(t.checker.signIn(true)).resolves.toBe('signedOut')
    expect(t.probe).toHaveBeenCalledTimes(2)
  })

  // The bundled Slack connector's own entry says nothing about the Muse
  // sign-in (the review of PR #49): the CLI is asked.
  it('asks the CLI about a file naming another provider alone', async () => {
    const home = configHome()
    home.write(SLACK_CONNECTOR_ONLY)
    const t = account('win32', home.file, [LOGGED_OUT])
    await expect(t.checker.signIn(false)).resolves.toBe('signedOut')
    expect(t.probe).toHaveBeenCalledOnce()
  })
})

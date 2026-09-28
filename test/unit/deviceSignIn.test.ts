import { describe, expect, it, vi } from 'vitest'
import type { AccountSession } from '../../src/host/auth/accountHost'
import {
  CREDENTIAL_POLL_TIMEOUT_MS,
  MUSE_LOGIN_CANCEL_TIMEOUT_MS,
} from '../../src/shared/constants'
import { parseDeviceCode, runDeviceSignIn } from '../../src/host/auth/deviceSignIn'
import {
  CAPTURED_CANCEL_AFTER_ENDING,
  CAPTURED_CANCEL_ANSWER,
  CAPTURED_CANCELLED_ENDING,
  CAPTURED_CODE_LIFETIME_MS,
  CAPTURED_DENIED_ENDING,
  CAPTURED_EXPIRED_ENDING,
  CAPTURED_FAILED_ENDING,
  CAPTURED_GRANTED_ENDING,
  CAPTURED_LOGGED_OUT,
  CAPTURED_LOGIN_START,
  CAPTURED_SIGNED_IN,
  endingNamed,
} from './helpers/accountLoginCapture'
import { FakeLogOutputChannel } from './helpers/fakes'

// As captured (1.4.0-R4302.1, 2026-09-27): the user code is its shape.
const DEVICE_URL = 'https://auth.meta.com/oauth/device/?code=AAAA-AAAA'
const DEVICE_CODE = 'AAAA-AAAA'
const log = new FakeLogOutputChannel()

// `account/read` once the browser approved, as captured (a stand-in label,
// an e-mail address in real life, which the parser drops).
const SIGNED_IN = CAPTURED_SIGNED_IN
const LABEL = String(CAPTURED_SIGNED_IN['label'])

type AccountAnswer = Record<string, unknown> | undefined
type Notify = Parameters<AccountSession['connection']['onNotification']>[0]

/** A promise that never settles: a CLI that stopped answering. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined)
}

/**
 * A sign-in host replaying the captured frames. `account` answers
 * `account/read` (undefined: a CLI that refuses it). `account/loginCancel`
 * sends the captured `cancelled` ending before its answer, as captured, and
 * answers `{cancelled: false}` once the flow has ended.
 */
function session(account: () => AccountAnswer = () => undefined) {
  let notify: Notify | undefined
  let hasEnded = false
  const complete = (frame: Parameters<Notify>[0]) => {
    hasEnded = true
    notify?.(frame)
  }
  const request = vi.fn((method: string): Promise<Record<string, unknown>> => {
    if (method === 'account/loginStart') {
      return Promise.resolve(CAPTURED_LOGIN_START)
    }
    if (method === 'account/read') {
      const answer = account()
      return answer === undefined
        ? Promise.reject(new Error('no handler for account/read'))
        : Promise.resolve(answer)
    }
    if (hasEnded) {
      return Promise.resolve(CAPTURED_CANCEL_AFTER_ENDING)
    }
    complete(CAPTURED_CANCELLED_ENDING)
    return Promise.resolve(CAPTURED_CANCEL_ANSWER)
  })
  const onNotification = vi.fn((handler: Notify) => {
    notify = handler
  })
  const close = vi.fn(() => Promise.resolve())
  // The host's output ends: it exited or died.
  const hostExit = Promise.withResolvers<undefined>()
  const exit = () => {
    hostExit.resolve(undefined)
  }
  const deviceSession: AccountSession = {
    connection: { request, onNotification, closed: hostExit.promise },
    close,
  }
  return { request, onNotification, close, deviceSession, complete, exit }
}

/** Leaves `method` unanswered on `t`'s host, as a CLI that stopped answering it. */
function unanswered(t: ReturnType<typeof session>, method: string): void {
  const answer = t.request.getMockImplementation()
  t.request.mockImplementation((asked) =>
    asked === method ? never() : (answer?.(asked) ?? Promise.resolve({})),
  )
}

/** A wait that lets queued timers run, as a real poll interval does. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * A host answering `account/read` with `before`, then the captured signed-in
 * answer, and sending the captured `granted` just after the first signed-in
 * answer: the captured order (undefined in `before`: a read refused).
 */
function capturedGrantedOrder(before: AccountAnswer[]) {
  let reads = 0
  let isGrantedSent = false
  const t = session(() => {
    reads += 1
    return reads <= before.length ? before[reads - 1] : SIGNED_IN
  })
  const answer = t.request.getMockImplementation()
  t.request.mockImplementation((method) => {
    const answered = answer?.(method) ?? Promise.resolve({})
    if (method === 'account/read' && reads === before.length + 1) {
      setTimeout(() => {
        isGrantedSent = true
        t.complete(CAPTURED_GRANTED_ENDING)
      }, 0)
    }
    return answered
  })
  return { ...t, reads: () => reads, isGrantedSent: () => isGrantedSent }
}

describe('Muse Code device sign-in', () => {
  it('accepts the captured code shape only from Meta auth', () => {
    expect(parseDeviceCode(CAPTURED_LOGIN_START)).toEqual({ url: DEVICE_URL, code: DEVICE_CODE })
    expect(() =>
      parseDeviceCode({ ...CAPTURED_LOGIN_START, verificationUrl: 'https://example.com/' }),
    ).toThrow()
    expect(() => parseDeviceCode({ verificationUrl: DEVICE_URL })).toThrow()
  })

  it('shows the code, observes a new credential, and closes the temporary host', async () => {
    const t = session()
    let modified: number | undefined
    let clock = 0
    const onCode = vi.fn()
    await expect(
      runDeviceSignIn({
        connect: () => Promise.resolve(t.deviceSession),
        credentialFileModifiedAt: () => modified,
        sleep: () => {
          modified = 2
          return Promise.resolve()
        },
        now: () => {
          clock += 1000
          return clock
        },
        signal: new AbortController().signal,
        onCode,
        log,
      }),
    ).resolves.toBe('signedIn')
    expect(onCode).toHaveBeenCalledWith(DEVICE_URL, DEVICE_CODE)
    expect(t.request).toHaveBeenCalledWith('account/loginStart', { type: 'deviceCode' })
    expect(t.close).toHaveBeenCalledOnce()
  })

  // A stop decides the flow: a file written as Cancel lands is not a sign-in
  // on its own (an unrelated sign-out rewrites the file too). A real sign-in
  // is still seen afterwards from the file's structure (the review of PR #49).
  it.each([
    ['with no credential write', false],
    ['racing a credential write in the same poll', true],
  ])(
    'sends loginCancel after user cancellation %s and closes the host',
    async (_name, isWritten) => {
      const t = session()
      const abort = new AbortController()
      let modified: number | undefined
      await expect(
        runDeviceSignIn({
          connect: () => Promise.resolve(t.deviceSession),
          credentialFileModifiedAt: () => modified,
          sleep: () => {
            modified = isWritten ? 2 : undefined
            abort.abort()
            return Promise.resolve()
          },
          now: () => 0,
          signal: abort.signal,
          onCode: vi.fn(),
          log,
        }),
      ).resolves.toBe('cancelled')
      expect(t.request).toHaveBeenCalledWith('account/loginCancel', {})
      expect(t.close).toHaveBeenCalledOnce()
    },
  )

  it('reports a credential write at the timeout boundary', async () => {
    const t = session()
    let modified: number | undefined
    let clock = 0
    await expect(
      runDeviceSignIn({
        connect: () => Promise.resolve(t.deviceSession),
        credentialFileModifiedAt: () => modified,
        sleep: () => {
          modified = 2
          clock = CREDENTIAL_POLL_TIMEOUT_MS
          return Promise.resolve()
        },
        now: () => clock,
        signal: new AbortController().signal,
        onCode: vi.fn(),
        log,
      }),
    ).resolves.toBe('signedIn')
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
  })

  // The account before the flow (D26), then the flow's start: neither holds
  // up a cancel.
  it.each([
    ['loginStart', 'account/loginStart', { type: 'deviceCode' }],
    ['the first account/read', 'account/read', {}],
  ])('closes promptly when cancelled before %s answers', async (_name, stuck, params) => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    unanswered(t, stuck)
    const abort = new AbortController()
    const pending = run(t, { signal: abort.signal })
    await vi.waitFor(() => {
      expect(t.request).toHaveBeenCalledWith(stuck, params)
    })
    abort.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
  })

  it('ends on the host’s ending while loginStart is unanswered, with no code shown', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    unanswered(t, 'account/loginStart')
    const onCode = vi.fn()
    const pending = runDeviceSignIn({
      connect: () => Promise.resolve(t.deviceSession),
      credentialFileModifiedAt: () => undefined,
      sleep: () => Promise.resolve(),
      now: () => 0,
      signal: new AbortController().signal,
      onCode,
      log,
    })
    await vi.waitFor(() => {
      expect(t.request).toHaveBeenCalledWith('account/loginStart', { type: 'deviceCode' })
    })
    t.complete(CAPTURED_EXPIRED_ENDING)
    await expect(pending).resolves.toBe('expired')
    expect(onCode).not.toHaveBeenCalled()
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
  })

  it('reports cancellation while the temporary host is still connecting', async () => {
    const abort = new AbortController()
    const close = vi.fn()
    const connect = vi.fn(
      () =>
        new Promise<AccountSession>((_resolve, reject) => {
          abort.signal.addEventListener(
            'abort',
            () => {
              close()
              reject(new Error('handshake cancelled'))
            },
            { once: true },
          )
        }),
    )
    const pending = runDeviceSignIn({
      connect,
      credentialFileModifiedAt: () => undefined,
      sleep: () => Promise.resolve(),
      now: () => 0,
      signal: abort.signal,
      onCode: vi.fn(),
      log,
    })
    expect(connect).toHaveBeenCalledOnce()
    abort.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not connect after an earlier cancellation or hide an unrelated connection failure', async () => {
    const abort = new AbortController()
    abort.abort()
    const connect = vi.fn(() => Promise.resolve(session().deviceSession))
    const deps = {
      connect,
      credentialFileModifiedAt: () => undefined,
      sleep: () => Promise.resolve(),
      now: () => 0,
      signal: abort.signal,
      onCode: vi.fn(),
      log,
    }
    await expect(runDeviceSignIn(deps)).resolves.toBe('cancelled')
    expect(connect).not.toHaveBeenCalled()

    const failure = new Error('handshake failed')
    await expect(
      runDeviceSignIn({
        ...deps,
        signal: new AbortController().signal,
        connect: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure)
  })

  it('treats the captured cancellation ending as terminal', async () => {
    const t = session()
    let isNotified = false
    const sleep = () => {
      if (!isNotified) {
        isNotified = true
        t.complete(CAPTURED_CANCELLED_ENDING)
      }
      return Promise.resolve()
    }
    await expect(run(t, { sleep, modified: () => undefined })).resolves.toBe('cancelled')
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
  })

  it('cancels the CLI request and closes its host on timeout', async () => {
    const t = session()
    await expect(run(t, { step: CREDENTIAL_POLL_TIMEOUT_MS / 2 })).resolves.toBe('timedOut')
    expect(t.request).toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
  })
})

interface Flow {
  /** Each poll's wait: where a test changes the host or the file. */
  readonly sleep?: () => Promise<void>
  readonly modified?: () => number | undefined
  /** How far the clock moves at each look; the default never runs out. */
  readonly step?: number
  readonly signal?: AbortSignal
  readonly log?: FakeLogOutputChannel
}

/** A flow on `t`'s host. */
function run(t: ReturnType<typeof session>, flow: Flow = {}) {
  let clock = 0
  return runDeviceSignIn({
    connect: () => Promise.resolve(t.deviceSession),
    credentialFileModifiedAt: flow.modified ?? (() => 1),
    sleep: flow.sleep ?? (() => Promise.resolve()),
    now: () => {
      clock += flow.step ?? 1
      return clock
    },
    signal: flow.signal ?? new AbortController().signal,
    onCode: vi.fn(),
    log: flow.log ?? log,
  })
}

/** A clock that runs out after one poll. */
const ONE_POLL = CREDENTIAL_POLL_TIMEOUT_MS / 2

// PLAN.md D26 (2026-09-27): `account/read` on the open host and the
// credential file decide a sign-in; the host's captured endings end the flow.
describe('Muse Code device sign-in: how it ends', () => {
  it('notices a sign-in by polling account/read', async () => {
    let account: AccountAnswer = CAPTURED_LOGGED_OUT
    const t = session(() => account)
    const sleep = () => {
      account = SIGNED_IN
      return Promise.resolve()
    }
    await expect(run(t, { sleep })).resolves.toBe('signedIn')
    expect(t.request).toHaveBeenCalledWith('account/read', {})
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
  })

  // Not the captured order: here `granted` comes before `account/read` shows
  // the sign-in. Its word neither ends the flow nor signs in on its own.
  it('waits for account/read after a granted that comes before it', async () => {
    const accounts: AccountAnswer[] = [
      CAPTURED_LOGGED_OUT,
      CAPTURED_LOGGED_OUT,
      CAPTURED_LOGGED_OUT,
    ]
    const t = session(() => accounts.shift() ?? SIGNED_IN)
    let polls = 0
    const sleep = () => {
      polls += 1
      t.complete(CAPTURED_GRANTED_ENDING)
      return Promise.resolve()
    }
    await expect(run(t, { sleep })).resolves.toBe('signedIn')
    expect(polls).toBe(2)
  })

  // The captured order (account-login-granted.json): `account/read` says
  // `accountLogin`, and `granted` follows 205 ms later. With a first answer
  // to compare, the poll that sees the sign-in ends the flow.
  it('signs in on the poll that sees the account, before the captured granted follows', async () => {
    const t = capturedGrantedOrder([CAPTURED_LOGGED_OUT, CAPTURED_LOGGED_OUT])
    await expect(run(t, { sleep: nextTurn })).resolves.toBe('signedIn')
    expect(t.reads()).toBe(3)
    expect(t.isGrantedSent()).toBe(false)
  })

  // With no first answer there is nothing to compare, and a Keychain sign-in
  // may leave the file as it was: `granted`, borne out by `account/read`
  // saying `accountLogin`, is the sign-in (the review of PR #49).
  it('signs in on the captured granted and account/read when the first account/read went unanswered', async () => {
    const t = capturedGrantedOrder([undefined])
    await expect(run(t, { sleep: nextTurn, modified: () => 1, step: ONE_POLL })).resolves.toBe(
      'signedIn',
    )
    expect(t.isGrantedSent()).toBe(true)
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
  })

  // The logout hold kept the old sign-in, and a macOS re-sign-in to the same
  // account replaced only the Keychain item: no change of state or file can
  // show it, so the captured `granted`, borne out by `accountLogin`, does
  // (Codex on 328efb52).
  it('signs in on granted and accountLogin when the account was already signed in', async () => {
    const t = session(() => SIGNED_IN)
    const sleep = () => {
      t.complete(CAPTURED_GRANTED_ENDING)
      return Promise.resolve()
    }
    await expect(run(t, { sleep, modified: () => 1, step: ONE_POLL })).resolves.toBe('signedIn')
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
  })

  // `granted` alone never signs in, with no first answer and the file as it
  // was: not when `account/read` cannot say, nor when it names another lane
  // (META_API_KEY's `envKey`).
  it.each([
    ['account/read cannot say', undefined],
    ['account/read says envKey', { state: 'envKey', credentialRequired: true }],
  ])('takes no sign-in from granted alone when %s', async (_name, later) => {
    let reads = 0
    const t = session(() => (++reads === 1 ? undefined : later))
    const sleep = () => {
      t.complete(CAPTURED_GRANTED_ENDING)
      return Promise.resolve()
    }
    await expect(run(t, { sleep, modified: () => 1, step: ONE_POLL })).resolves.toBe('timedOut')
  })

  it('keeps waiting after a granted the account never shows', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const sleep = () => {
      t.complete(CAPTURED_GRANTED_ENDING)
      return Promise.resolve()
    }
    await expect(run(t, { sleep, step: ONE_POLL })).resolves.toBe('timedOut')
    expect(t.request).toHaveBeenCalledWith('account/loginCancel', {})
  })

  // With no first answer there is nothing to compare: an account signed in
  // before the flow is no new sign-in, and only a new file counts (the
  // review of PR #49).
  it.each([
    ['takes no sign-in from before the flow for a new one', 1, 'timedOut'],
    ['counts a file written since the flow began', 2, 'signedIn'],
  ] as const)(
    'when the first account/read goes unanswered, %s',
    async (_name, modifiedAfterStart, outcome) => {
      let reads = 0
      const t = session(() => (++reads === 1 ? undefined : SIGNED_IN))
      let modified = 1
      const sleep = () => {
        modified = modifiedAfterStart
        return Promise.resolve()
      }
      await expect(run(t, { sleep, modified: () => modified, step: ONE_POLL })).resolves.toBe(
        outcome,
      )
    },
  )

  // The second answer was never captured: signed out stays signed out (the review of PR #49).
  it.each([
    ['the captured signed-out answer', CAPTURED_LOGGED_OUT],
    [
      'an uncaptured credentialRequired false',
      { state: 'loggedOut', credentialRequired: false } as const,
    ],
  ])('does not take a file a sign-out rewrote for a sign-in under %s', async (_name, answer) => {
    const t = session(() => answer)
    let modified = 1
    const sleep = () => {
      modified += 1
      return Promise.resolve()
    }
    await expect(run(t, { sleep, modified: () => modified, step: ONE_POLL })).resolves.toBe(
      'timedOut',
    )
  })

  // The same evidence stands when a later `account/read` cannot answer: the
  // file alone then speaks only for a write no answer contradicted (the
  // review of PR #49).
  it('keeps the signed-out answer about a write when account/read then cannot say', async () => {
    let modified = 1
    let reads = 0
    const t = session(() => {
      reads += 1
      if (reads === 1) {
        // A sign-out elsewhere rewrites the file as the flow starts.
        modified = 2
      }
      return reads <= 2 ? CAPTURED_LOGGED_OUT : undefined
    })
    await expect(run(t, { modified: () => modified, step: ONE_POLL })).resolves.toBe('timedOut')
  })

  it('counts a new file while META_API_KEY masks the login', async () => {
    const t = session(() => ({ state: 'envKey', credentialRequired: true }))
    let modified = 1
    const sleep = () => {
      modified = 2
      return Promise.resolve()
    }
    await expect(run(t, { sleep, modified: () => modified })).resolves.toBe('signedIn')
  })

  // A shorter limit cancelled codes the browser could still approve, and
  // Muse Code's own `expired` never arrived.
  it('waits past the captured code lifetime, so Muse Code ends an unapproved code itself', () => {
    expect(CAPTURED_CODE_LIFETIME_MS).toBeGreaterThan(10 * 60 * 1000)
    expect(CREDENTIAL_POLL_TIMEOUT_MS).toBeGreaterThan(CAPTURED_CODE_LIFETIME_MS)
  })

  it('ends at once on the captured expired ending, logs it in fixed words, and sends no loginCancel', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const logged = new FakeLogOutputChannel()
    const sleep = () => {
      t.complete(CAPTURED_EXPIRED_ENDING)
      return Promise.resolve()
    }
    await expect(run(t, { sleep, log: logged })).resolves.toBe('expired')
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
    expect(logged.info).toHaveBeenCalledWith(
      'Muse Code sign-in ended: expired: the code expired before it was approved',
    )
  })

  // The words are captured, the message is the CLI's free text: whatever it
  // holds, the log keeps fixed words (the review of PR #49).
  it.each(['expired', 'denied'])(
    'logs the captured %s in fixed words, never the message sent with it',
    async (outcome) => {
      const t = session(() => CAPTURED_LOGGED_OUT)
      const log = new FakeLogOutputChannel()
      const sleep = () => {
        t.complete({
          ...endingNamed(outcome),
          params: {
            outcome,
            message: String.raw`login failed for someone@example.com at C:\Users\someone\auth.json`,
          },
        })
        return Promise.resolve()
      }
      await expect(run(t, { sleep, log })).resolves.toBe(outcome)
      expect(allLogged(log)).not.toContain('someone')
    },
  )

  // Captured live: Deny clicked, and an approval whose file could not be
  // written. Each has a meaning of its own (the review of PR #49).
  it.each([
    ['denied', CAPTURED_DENIED_ENDING, 'the sign-in was denied in the browser'],
    ['failed', CAPTURED_FAILED_ENDING, 'saving the credential failed'],
  ] as const)(
    'ends at once on the captured %s, and logs no path',
    async (outcome, frame, logged) => {
      const t = session(() => CAPTURED_LOGGED_OUT)
      const log = new FakeLogOutputChannel()
      const sleep = () => {
        t.complete(frame)
        return Promise.resolve()
      }
      await expect(run(t, { sleep, log })).resolves.toBe(outcome)
      expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
      expect(t.close).toHaveBeenCalledOnce()
      expect(log.info).toHaveBeenCalledWith(`Muse Code sign-in ended: ${outcome}: ${logged}`)
      // The captured `failed` message names the credential file's path.
      expect(allLogged(log)).not.toContain('<throwaway>')
    },
  )

  // Rule 13: an ending no capture covers is shown as the CLI named it, and
  // its message, whatever it holds, is not logged.
  it('ends at once on a word no capture covers, as the CLI named it', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const log = new FakeLogOutputChannel()
    const sleep = () => {
      t.complete({
        ...endingNamed('somethingNew'),
        params: { outcome: 'somethingNew', message: String.raw`at C:\Users\someone\x` },
      })
      return Promise.resolve()
    }
    await expect(run(t, { sleep, log })).resolves.toEqual({ endedAs: 'somethingNew' })
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(log.info).toHaveBeenCalledWith(
      'Muse Code sign-in ended: somethingNew (an ending no capture covers; its message is not logged)',
    )
    expect(allLogged(log)).not.toContain('someone')
  })

  // The word itself is the CLI's: one not shaped like a protocol word is
  // shown in the panel, not logged (the review of PR #49).
  it('logs an uncovered ending word only in the shape of one', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const log = new FakeLogOutputChannel()
    const word = 'someone@example.com'
    const sleep = () => {
      t.complete(endingNamed(word))
      return Promise.resolve()
    }
    await expect(run(t, { sleep, log })).resolves.toEqual({ endedAs: word })
    expect(allLogged(log)).not.toContain('someone')
  })

  it('cuts a long outcome word before it is shown', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const sleep = () => {
      t.complete(endingNamed('x'.repeat(100)))
      return Promise.resolve()
    }
    await expect(run(t, { sleep })).resolves.toEqual({ endedAs: `${'x'.repeat(40)}…` })
  })

  it('keeps the first ending', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const sleep = () => {
      t.complete(CAPTURED_EXPIRED_ENDING)
      t.complete(endingNamed('somethingNew'))
      return Promise.resolve()
    }
    await expect(run(t, { sleep })).resolves.toBe('expired')
  })

  it.each([
    ['no outcome', { ...CAPTURED_EXPIRED_ENDING, params: { result: 'denied' } }],
    ['an empty outcome', endingNamed('')],
  ])('keeps waiting on an ending with %s', async (_name, frame) => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const sleep = () => {
      t.complete(frame)
      return Promise.resolve()
    }
    await expect(run(t, { sleep, step: ONE_POLL })).resolves.toBe('timedOut')
  })

  it('never logs the account’s label', async () => {
    const logged = new FakeLogOutputChannel()
    const accounts: AccountAnswer[] = [CAPTURED_LOGGED_OUT]
    const t = session(() => accounts.shift() ?? SIGNED_IN)
    await expect(run(t, { log: logged })).resolves.toBe('signedIn')
    expect(allLogged(logged)).not.toContain(LABEL)
  })
})

function allLogged(log: FakeLogOutputChannel): string {
  return [...log.info.mock.calls, ...log.warn.mock.calls].flat().join('\n')
}

// A host that exits mid-flow fails the sign-in at once instead of being
// polled until the backstop (the review of PR #49).
describe('Muse Code device sign-in: a host that exits', () => {
  it('fails at once when the host exits while the flow polls', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const sleep = vi.fn(() => never<undefined>())
    const pending = run(t, { sleep })
    await vi.waitFor(() => {
      expect(sleep).toHaveBeenCalled()
    })
    t.exit()
    await expect(pending).rejects.toThrow('exited')
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
  })

  // An exit is no decision: the host wrote the credential file, then went
  // (the review of PR #49).
  it('signs in when the host exits after the credential file changed', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const logged = new FakeLogOutputChannel()
    let modified = 1
    const sleep = vi.fn(() => {
      modified = 2
      unanswered(t, 'account/read')
      t.exit()
      return never<undefined>()
    })
    await expect(run(t, { sleep, modified: () => modified, log: logged })).resolves.toBe('signedIn')
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
    expect(logged.warn).toHaveBeenCalledWith(
      'The Muse Code sign-in host exited after writing the credential file',
    )
  })

  // Another Muse process's sign-out rewrote the file, and `account/read`
  // said signed out about that write; then the host exits. The signed-out
  // answer stands (the review of PR #49).
  it('keeps the signed-out answer about a write when the host then exits', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    let modified = 1
    let waits = 0
    const sleep = vi.fn(() => {
      waits += 1
      if (waits === 1) {
        modified = 2
        return Promise.resolve()
      }
      unanswered(t, 'account/read')
      t.exit()
      return never<undefined>()
    })
    await expect(run(t, { sleep, modified: () => modified })).rejects.toThrow('exited')
  })

  it('fails at once when the host exits before loginStart answers', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    unanswered(t, 'account/loginStart')
    const pending = run(t)
    await vi.waitFor(() => {
      expect(t.request).toHaveBeenCalledWith('account/loginStart', { type: 'deviceCode' })
    })
    t.exit()
    await expect(pending).rejects.toThrow('exited')
  })

  it('reports Cancel, not a failure, when the host exits after it', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    unanswered(t, 'account/loginStart')
    const abort = new AbortController()
    const pending = run(t, { signal: abort.signal })
    await vi.waitFor(() => {
      expect(t.request).toHaveBeenCalledWith('account/loginStart', { type: 'deviceCode' })
    })
    abort.abort()
    t.exit()
    await expect(pending).resolves.toBe('cancelled')
  })
})

/**
 * A host that answers the first `account/read` (the account before the
 * flow) and then stops answering it, as a wedged CLI would (PR #49 P2).
 */
function wedgedSession() {
  let reads = 0
  const t = session(() => CAPTURED_LOGGED_OUT)
  const answer = t.request.getMockImplementation()
  t.request.mockImplementation((method) => {
    if (method === 'account/read') {
      reads += 1
      if (reads > 1) {
        return never()
      }
    }
    return answer?.(method) ?? Promise.resolve({})
  })
  const polling = async () => {
    await vi.waitFor(() => {
      expect(reads).toBe(2)
    })
  }
  return { t, polling }
}

// PR #49 P2: an unanswered `account/read` holds up neither Cancel nor the
// host's ending, and an unanswered `loginCancel` does not hold up the close.
describe('Muse Code device sign-in: a CLI that stops answering', () => {
  it('ends on the host’s ending, not a sign-in, when the file changes while a poll is unanswered', async () => {
    const { t, polling } = wedgedSession()
    let modified = 1
    const pending = run(t, { modified: () => modified })
    await polling()
    // An unrelated sign-out rewrites the file as the code expires.
    modified = 2
    t.complete(CAPTURED_EXPIRED_ENDING)
    await expect(pending).resolves.toBe('expired')
  })

  it('notices Cancel at once while a poll is unanswered', async () => {
    const { t, polling } = wedgedSession()
    const abort = new AbortController()
    const pending = run(t, { signal: abort.signal })
    await polling()
    abort.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(t.request).toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
  })

  it.each([
    ['the captured expired ending', CAPTURED_EXPIRED_ENDING, 'expired'],
    ['the captured denied ending', CAPTURED_DENIED_ENDING, 'denied'],
    ['an ending no capture covers', endingNamed('somethingNew'), { endedAs: 'somethingNew' }],
  ])('ends at once on %s while a poll is unanswered', async (_name, frame, outcome) => {
    const { t, polling } = wedgedSession()
    const pending = run(t)
    await polling()
    t.complete(frame)
    await expect(pending).resolves.toEqual(outcome)
    expect(t.request).not.toHaveBeenCalledWith('account/loginCancel', {})
    expect(t.close).toHaveBeenCalledOnce()
  })

  it('notices Cancel during the wait between polls', async () => {
    const t = session(() => CAPTURED_LOGGED_OUT)
    const abort = new AbortController()
    const sleep = vi.fn(() => never<undefined>())
    const pending = run(t, { signal: abort.signal, sleep })
    await vi.waitFor(() => {
      expect(sleep).toHaveBeenCalled()
    })
    abort.abort()
    await expect(pending).resolves.toBe('cancelled')
  })

  it.each([
    ['Cancel', 'cancelled'],
    ['the timeout', 'timedOut'],
  ] as const)(
    'closes the host after %s even when loginCancel is never answered',
    async (name, outcome) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const isCancel = name === 'Cancel'
        // Cancel while a poll is unanswered; or every poll answered and the
        // clock run out.
        const { t, polling } = isCancel
          ? wedgedSession()
          : { t: session(() => CAPTURED_LOGGED_OUT), polling: () => Promise.resolve() }
        unanswered(t, 'account/loginCancel')
        const logged = new FakeLogOutputChannel()
        const abort = new AbortController()
        const pending = run(t, {
          signal: abort.signal,
          log: logged,
          ...(!isCancel && { step: ONE_POLL }),
        })
        await polling()
        if (isCancel) {
          abort.abort()
        }
        await vi.waitFor(() => {
          expect(t.request).toHaveBeenCalledWith('account/loginCancel', {})
        })
        await vi.advanceTimersByTimeAsync(MUSE_LOGIN_CANCEL_TIMEOUT_MS)
        await expect(pending).resolves.toBe(outcome)
        expect(t.close).toHaveBeenCalledOnce()
        expect(logged.warn).toHaveBeenCalledWith(
          'Muse Code did not confirm the sign-in cancel; closing its host',
        )
      } finally {
        vi.useRealTimers()
      }
    },
  )
})

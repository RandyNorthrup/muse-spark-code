import { describe, expect, it, vi } from 'vitest'
import {
  AccountHosts,
  type AccountSession,
  isStoredSignIn,
  logOutAccount,
  probeAccount,
  readAccountState,
} from '../../src/host/auth/accountHost'
import { CAPTURED_SIGNED_IN } from './helpers/accountLoginCapture'
import { FakeLogOutputChannel } from './helpers/fakes'

// `account/read` and `account/logout` as captured (1.3.0 and 1.4.0-R4302.1,
// isolated homes, 2026-09-27); the label was redacted there and is an
// e-mail address in real life.
const LOGGED_OUT = { state: 'loggedOut', credentialRequired: true }
const STORED_KEY = { state: 'apiKey', label: 'person@example.com', credentialRequired: true }

type Answer = Record<string, unknown> | Error

function host(answers: Record<string, Answer | (() => Answer)>) {
  const request = vi.fn((method: string) => {
    const entry = answers[method]
    const answer = typeof entry === 'function' ? entry() : entry
    if (answer === undefined) {
      return Promise.reject(new Error(`no handler for ${method}`))
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  })
  const close = vi.fn(() => Promise.resolve())
  const session: AccountSession = {
    connection: { request, onNotification: vi.fn(), closed: new Promise(() => undefined) },
    close,
  }
  return { request, close, session, connect: () => Promise.resolve(session) }
}

/** A signal nothing aborts: the window stays open. */
const OPEN = new AbortController().signal

function allLogged(log: FakeLogOutputChannel): string {
  return [...log.info.mock.calls, ...log.warn.mock.calls].flat().join('\n')
}

describe('readAccountState', () => {
  it('keeps the state and drops the label', async () => {
    const t = host({ 'account/read': STORED_KEY })
    await expect(readAccountState(t.session.connection)).resolves.toEqual({
      state: 'apiKey',
      credentialRequired: true,
    })
  })

  // As captured once the browser approved: `avatarUrl` is not in the schema.
  it('drops the captured label and avatarUrl of a browser sign-in', async () => {
    const t = host({ 'account/read': CAPTURED_SIGNED_IN })
    await expect(readAccountState(t.session.connection)).resolves.toEqual({
      state: 'accountLogin',
      credentialRequired: true,
    })
  })

  it('says nothing for an unknown method or an unexpected shape', async () => {
    await expect(readAccountState(host({}).session.connection)).resolves.toBeUndefined()
    await expect(
      readAccountState(host({ 'account/read': { state: 'loggedOut' } }).session.connection),
    ).resolves.toBeUndefined()
  })
})

describe('isStoredSignIn', () => {
  it('is a login or a stored key, not an environment key or none', () => {
    expect(isStoredSignIn({ state: 'accountLogin', credentialRequired: true })).toBe(true)
    expect(isStoredSignIn({ state: 'apiKey', credentialRequired: true })).toBe(true)
    expect(isStoredSignIn({ state: 'envKey', credentialRequired: true })).toBe(false)
    expect(isStoredSignIn(LOGGED_OUT)).toBe(false)
  })
})

describe('probeAccount', () => {
  it('asks one host and closes it', async () => {
    const t = host({ 'account/read': LOGGED_OUT })
    const log = new FakeLogOutputChannel()
    await expect(probeAccount(t.connect, log, OPEN)).resolves.toEqual(LOGGED_OUT)
    expect(t.close).toHaveBeenCalledOnce()
  })

  it('says nothing when the host cannot start, naming only the error', async () => {
    const log = new FakeLogOutputChannel()
    const failure = new Error(String.raw`failed at C:\Users\someone\.config\muse\auth.json`)
    await expect(probeAccount(() => Promise.reject(failure), log, OPEN)).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith('The Muse Code account host could not start: Error')
    expect(allLogged(log)).not.toContain('auth.json')
  })

  it('reports a host that does not close cleanly and keeps the answer', async () => {
    const t = host({ 'account/read': LOGGED_OUT })
    t.close.mockRejectedValue(new Error('still draining'))
    const log = new FakeLogOutputChannel()
    await expect(probeAccount(t.connect, log, OPEN)).resolves.toEqual(LOGGED_OUT)
    expect(log.warn).toHaveBeenCalledWith('The Muse Code account host did not close cleanly: Error')
  })
})

describe('logOutAccount', () => {
  it('signs out and confirms with account/read', async () => {
    let state: Answer = STORED_KEY
    const t = host({
      'account/logout': () => {
        state = LOGGED_OUT
        return LOGGED_OUT
      },
      'account/read': () => state,
    })
    const log = new FakeLogOutputChannel()
    await expect(logOutAccount(t.connect, log, OPEN)).resolves.toBe('confirmed')
    expect(t.request.mock.calls.map(([method]) => method)).toEqual([
      'account/logout',
      'account/read',
    ])
    expect(t.close).toHaveBeenCalledOnce()
    expect(allLogged(log)).not.toContain('person@example.com')
  })

  it.each([
    ['the host cannot start', undefined],
    ['account/logout is refused', { 'account/logout': new Error('experimentalRequired') }],
    ['account/logout answers another shape', { 'account/logout': { ok: true } }],
    ['a stored sign-in remains', { 'account/logout': LOGGED_OUT, 'account/read': STORED_KEY }],
    ['account/read cannot confirm', { 'account/logout': LOGGED_OUT }],
    // Only the captured signed-out answer confirms (the review of PR #49).
    [
      'META_API_KEY hides the stored lane',
      {
        'account/logout': { state: 'envKey', credentialRequired: true },
        'account/read': { state: 'envKey', credentialRequired: true },
      },
    ],
    [
      'account/read answers the uncaptured credentialRequired false',
      {
        'account/logout': LOGGED_OUT,
        'account/read': { state: 'loggedOut', credentialRequired: false },
      },
    ],
  ])('is false when %s', async (_name, answers) => {
    const log = new FakeLogOutputChannel()
    if (answers === undefined) {
      await expect(
        logOutAccount(() => Promise.reject(new Error('no CLI')), log, OPEN),
      ).resolves.toBe('unconfirmed')
      return
    }
    const t = host(answers)
    await expect(logOutAccount(t.connect, log, OPEN)).resolves.toBe('unconfirmed')
    expect(t.close).toHaveBeenCalledOnce()
    expect(log.warn).toHaveBeenCalled()
  })

  // The state vocabulary is open: a state not shaped like a protocol word
  // is not logged (the review of PR #49).
  it('logs an unconfirming state only in the shape of a protocol word', async () => {
    const log = new FakeLogOutputChannel()
    const t = host({
      'account/logout': LOGGED_OUT,
      'account/read': { state: String.raw`at C:\Users\someone`, credentialRequired: true },
    })
    await expect(logOutAccount(t.connect, log, OPEN)).resolves.toBe('unconfirmed')
    expect(log.warn).toHaveBeenCalledWith(
      'Muse Code did not confirm account/logout (an unrecognized value)',
    )
    expect(allLogged(log)).not.toContain('someone')
  })
})

// The window closing ends every account host still open (the review of PR #49).
describe('AccountHosts', () => {
  it('closes a probe still waiting when the window closes, and starts none afterwards', async () => {
    const t = host({})
    t.request.mockImplementation(() => new Promise(() => undefined))
    const connect = vi.fn((signal: AbortSignal) =>
      signal.aborted ? Promise.reject(new Error('cancelled')) : t.connect(),
    )
    const hosts = new AccountHosts(connect, new FakeLogOutputChannel())
    const probing = hosts.probe()
    const loggingOut = hosts.logOut()
    await vi.waitFor(() => {
      expect(t.request).toHaveBeenCalledTimes(2)
    })
    hosts.close()
    await expect(probing).resolves.toBeUndefined()
    await expect(loggingOut).resolves.toBe('unconfirmed')
    expect(t.close).toHaveBeenCalledTimes(2)
    await expect(hosts.probe()).resolves.toBeUndefined()
    expect(t.request).toHaveBeenCalledTimes(2)
  })
})

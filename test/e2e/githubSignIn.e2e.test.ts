// M123 lane A (PLAN.md D104): the runtime's GitHub sign-in against lane 0's
// fakes. The device-flow client and its source talk to the loopback
// github.com on a test clock; the `gh` source runs the fake `gh` as a real
// child; the CLI's `auth github` prints the code and never a token. No
// live GitHub call.

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  DeviceFlowFailure,
  refreshDeviceFlowToken,
  signInWithDeviceFlow,
  type DeviceCodePrompt,
  type DeviceFlowDeps,
} from '../../src/core/git/deviceFlow'
import { GitHubTokenSourceError } from '../../src/core/git/tokenSource'
import { redactSecrets } from '../../src/core/redact'
import { authGitHub } from '../../src/runtime/authCommands'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { deviceFlowSource, type DeviceFlowSource } from '../../src/runtime/github/deviceFlowSource'
import { ghLoginSource } from '../../src/runtime/github/ghLoginSource'
import {
  GH_AUTH_TOKEN_ARGS,
  GITHUB_AUTHORIZED_APP_URL,
  GITHUB_DEVICE_FLOW_SECRET_KEY,
  GITHUB_DEVICE_FLOW_GENERATION_KEY,
  GITHUB_DEVICE_FLOW_REFUSED_KEY,
  GITHUB_DEVICE_POLL_INTERVAL_S,
  GITHUB_DEVICE_SLOW_DOWN_STEP_S,
  GITHUB_DEVICE_VERIFICATION_URL,
  GITHUB_TOKEN_REFRESH_MARGIN_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import type { DeviceFlowError } from '../unit/helpers/github/deviceFlow'
import { memorySecrets } from '../unit/helpers/fakes'
import { fakeGhInvocation, fakeGhState } from '../unit/helpers/github/fakes'
import {
  FAKE_OAUTH_CLIENT_ID,
  startFakeGitHub,
  type FakeGitHubServer,
  type FakeGitHubServerOptions,
} from './fakeGitHub'

const SECOND = 1000
const START = 1_800_000_000_000
const TOKEN_PATH = '/login/oauth/access_token'
const CODE_PATH = '/login/device/code'
const byText = (left: string, right: string) => left.localeCompare(right)

interface Rig {
  readonly server: FakeGitHubServer
  readonly deps: DeviceFlowDeps
  /** Each wait the client asked for, in ms. */
  readonly sleeps: number[]
  readonly prompts: DeviceCodePrompt[]
  readonly present: (prompt: DeviceCodePrompt) => Promise<void>
  /** Runs before the client's `index`th wait ends (0-based). */
  onSleep: (index: number) => void
  clock: number
}

const servers: FakeGitHubServer[] = []

async function rig(options: FakeGitHubServerOptions = {}): Promise<Rig> {
  const state: { clock: number } = { clock: START }
  const server = await startFakeGitHub({ now: () => state.clock, ...options })
  servers.push(server)
  const sleeps: number[] = []
  const prompts: DeviceCodePrompt[] = []
  const result: Rig = {
    server,
    sleeps,
    prompts,
    present: (prompt) => {
      prompts.push(prompt)
      return Promise.resolve()
    },
    onSleep: () => undefined,
    get clock() {
      return state.clock
    },
    set clock(value: number) {
      state.clock = value
    },
    deps: {
      fetch: globalThis.fetch.bind(globalThis),
      now: () => state.clock,
      sleep: (ms, signal) => {
        signal.throwIfAborted()
        sleeps.push(ms)
        state.clock += ms
        result.onSleep(sleeps.length - 1)
        signal.throwIfAborted()
        return Promise.resolve()
      },
      clientId: FAKE_OAUTH_CLIENT_ID,
      deviceCodeUrl: server.deviceCodeUrl,
      tokenUrl: server.tokenUrl,
    },
  }
  return result
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

async function failureOf(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error: unknown) {
    if (error instanceof DeviceFlowFailure || error instanceof GitHubTokenSourceError) {
      return error.reason
    }
    throw error
  }
  throw new Error('the sign-in finished')
}

const tokenPolls = (server: FakeGitHubServer) =>
  server.deviceRequests.filter((request) => request.path === TOKEN_PATH)
const refreshes = (server: FakeGitHubServer) =>
  server.deviceRequests.filter((request) => request.params['grant_type'] === 'refresh_token')
/** The stored pair's own id (a random id, no secret). */
const storedIdOf = (store: { readonly values: ReadonlyMap<string, string> }) =>
  z
    .looseObject({ id: z.string() })
    .parse(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY) ?? 'null')).id

function signIn(test: Rig, signal = new AbortController().signal) {
  return signInWithDeviceFlow(test.deps, ['repo'], test.present, signal)
}

describe('the device-flow client (D104 source b)', () => {
  it('shows GitHub’s code and address, polls at the interval, and returns the token', async () => {
    const test = await rig()
    test.onSleep = (index) => {
      if (index === 1) test.server.approve()
    }
    const tokens = await signIn(test)
    expect(tokens.accessToken).toBe(test.server.issuedTokens[0])
    expect(tokens.scope).toBe('repo')
    expect(tokens.refreshToken).toBeUndefined()
    expect(test.prompts).toEqual([
      {
        userCode: expect.stringMatching(/^[A-Z0-9-]+$/u),
        verificationUri: GITHUB_DEVICE_VERIFICATION_URL,
        expiresAt: START + 900 * SECOND,
      },
    ])
    const polls = tokenPolls(test.server)
    expect(polls).toHaveLength(2)
    expect(polls[1]!.at - polls[0]!.at).toBeGreaterThanOrEqual(
      GITHUB_DEVICE_POLL_INTERVAL_S * SECOND,
    )
    expect(polls[0]!.at - START).toBeGreaterThanOrEqual(GITHUB_DEVICE_POLL_INTERVAL_S * SECOND)
  })

  it('sends the client id, the scope and the grant, and never a client secret', async () => {
    const test = await rig()
    test.onSleep = () => {
      test.server.approve()
    }
    await signIn(test)
    const [code, poll] = test.server.deviceRequests
    expect(code).toMatchObject({
      path: CODE_PATH,
      params: { client_id: FAKE_OAUTH_CLIENT_ID, scope: 'repo' },
    })
    expect(Object.keys(poll!.params).toSorted(byText)).toEqual([
      'client_id',
      'device_code',
      'grant_type',
    ])
    for (const request of test.server.deviceRequests) {
      expect(Object.keys(request.params).some((key) => key.includes('secret'))).toBe(false)
    }
  })

  it('waits five seconds longer after slow_down, and is never faster than the interval', async () => {
    const test = await rig()
    test.onSleep = (index) => {
      test.server.playError(index === 0 ? 'slow_down' : undefined)
      if (index === 1) test.server.approve()
    }
    await signIn(test)
    const slowed = (GITHUB_DEVICE_POLL_INTERVAL_S + GITHUB_DEVICE_SLOW_DOWN_STEP_S) * SECOND
    expect(test.sleeps).toEqual([GITHUB_DEVICE_POLL_INTERVAL_S * SECOND, slowed])
    const polls = tokenPolls(test.server)
    expect(polls[1]!.at - polls[0]!.at).toBeGreaterThanOrEqual(slowed)
  })

  it('polls at the interval the device code names', async () => {
    const test = await rig({ intervalS: 7 })
    test.onSleep = (index) => {
      if (index === 1) test.server.approve()
    }
    await signIn(test)
    expect(test.sleeps).toEqual([7 * SECOND, 7 * SECOND])
  })

  it('keeps polling while authorization is pending, and stops before the code expires', async () => {
    const test = await rig({ expiresInS: 60 })
    expect(await failureOf(signIn(test))).toBe('expired')
    const polls = tokenPolls(test.server)
    expect(polls.length).toBeGreaterThan(1)
    expect(polls.every((poll) => poll.at < START + 60 * SECOND)).toBe(true)
  })

  it.each([
    ['expired_token', 'expired'],
    ['access_denied', 'denied'],
    ['incorrect_device_code', 'incorrectDeviceCode'],
    ['device_flow_disabled', 'disabled'],
    ['unsupported_grant_type', 'unsupportedGrant'],
    ['incorrect_client_credentials', 'incorrectClient'],
  ] as const)('stops on %s', async (error: DeviceFlowError, reason) => {
    const test = await rig()
    test.server.playError(error)
    expect(await failureOf(signIn(test))).toBe(reason)
    expect(tokenPolls(test.server)).toHaveLength(1)
  })

  it('names a denial from the user’s own click', async () => {
    const test = await rig()
    test.onSleep = () => {
      test.server.deny()
    }
    expect(await failureOf(signIn(test))).toBe('denied')
  })

  it('refuses a device code when the app has the device flow off', async () => {
    const test = await rig()
    test.server.disableDeviceFlow()
    expect(await failureOf(signIn(test))).toBe('disabled')
    expect(test.prompts).toEqual([])
  })

  it('refuses a verification address other than GitHub’s, before showing anything', async () => {
    const test = await rig({ verificationUri: 'https://github.com.example.net/login/device' })
    expect(await failureOf(signIn(test))).toBe('verificationAddress')
    expect(test.prompts).toEqual([])
    expect(tokenPolls(test.server)).toEqual([])
  })

  it('refuses a user code that could carry terminal control text', async () => {
    const reply = {
      device_code: 'device',
      user_code: '\u{1B}[2JWDJB-MJHT',
      verification_uri: GITHUB_DEVICE_VERIFICATION_URL,
      expires_in: 900,
      interval: 5,
    }
    const test = await rig()
    const deps = { ...test.deps, fetch: () => Promise.resolve(Response.json(reply)) }
    const work = signInWithDeviceFlow(deps, ['repo'], test.present, new AbortController().signal)
    expect(await failureOf(work)).toBe('userCode')
    expect(test.prompts).toEqual([])
  })

  it('stops polling on Cancel', async () => {
    const test = await rig()
    const controller = new AbortController()
    test.onSleep = (index) => {
      if (index === 1) controller.abort()
    }
    await expect(signIn(test, controller.signal)).rejects.toThrow()
    expect(tokenPolls(test.server)).toHaveLength(1)
  })

  it('names a lost network', async () => {
    const test = await rig()
    test.server.failNetwork(true)
    expect(await failureOf(signIn(test))).toBe('network')
  })

  it('refuses to start without a client id, and asks for no scope beyond the allowlist', async () => {
    const test = await rig()
    const noClient = signInWithDeviceFlow(
      { ...test.deps, clientId: '' },
      ['repo'],
      test.present,
      new AbortController().signal,
    )
    expect(await failureOf(noClient)).toBe('clientIdUnset')
    const overScoped = signInWithDeviceFlow(
      test.deps,
      ['repo', 'workflow'],
      test.present,
      new AbortController().signal,
    )
    expect(await failureOf(overScoped)).toBe('scopeRefused')
    expect(test.server.deviceRequests).toEqual([])
  })

  it('keeps the refresh token of an expiring grant, rotates both, and refuses a spent one', async () => {
    const test = await rig({ expiringTokens: true })
    test.onSleep = () => {
      test.server.approve()
    }
    const first = await signIn(test)
    expect(first.refreshToken).toBeDefined()
    expect(first.expiresAt).toBe(test.clock + 28_800 * SECOND)
    const signal = new AbortController().signal
    const second = await refreshDeviceFlowToken(test.deps, first.refreshToken!, signal)
    expect(second.accessToken).not.toBe(first.accessToken)
    expect(second.refreshToken).not.toBe(first.refreshToken)
    const refresh = test.server.deviceRequests.at(-1)!
    expect(Object.keys(refresh.params).toSorted(byText)).toEqual([
      'client_id',
      'grant_type',
      'refresh_token',
    ])
    expect(await failureOf(refreshDeviceFlowToken(test.deps, first.refreshToken!, signal))).toBe(
      'refreshRefused',
    )
  })
})

function sourceFor(test: Rig, store = memorySecrets(), flow: DeviceFlowDeps = test.deps) {
  const opened: string[] = []
  const source = deviceFlowSource({
    store,
    flow,
    present: test.present,
    openExternal: (url) => {
      opened.push(url)
      return Promise.resolve()
    },
    fetch: test.deps.fetch,
  })
  return { source, store, opened }
}

/** A source signed in through the fake: the user approves at the first wait. */
async function signedIn(options: FakeGitHubServerOptions = {}) {
  const test = await rig(options)
  test.onSleep = () => {
    test.server.approve()
  }
  const parts = sourceFor(test)
  const first = await parts.source.credential('ask', new AbortController().signal)
  if (first === undefined) throw new Error('the fake sign-in gave no credential')
  return { test, first, ...parts }
}

describe('the device-flow source', () => {
  const signal = new AbortController().signal

  it('asks nobody while silent, and signs in once however many ask at the same time', async () => {
    const test = await rig()
    const { source, store } = sourceFor(test)
    expect(await source.credential('silent', signal)).toBeUndefined()
    expect(test.server.deviceRequests).toEqual([])
    test.onSleep = () => {
      test.server.approve()
    }
    const [one, two] = await Promise.all([
      source.credential('ask', signal),
      source.credential('ask', signal),
    ])
    expect(one?.bearer).toBe(test.server.issuedTokens[0])
    expect(two?.bearer).toBe(one?.bearer)
    expect(test.server.deviceRequests.filter((r) => r.path === CODE_PATH)).toHaveLength(1)
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      v: 3,
      id: expect.any(String),
      generation: null,
      accessToken: one?.bearer,
    })
    const again = await source.credential('silent', signal)
    expect(again?.bearer).toBe(one?.bearer)
    expect(redactSecrets(`token ${one!.bearer}`)).not.toContain(one!.bearer)
  })

  it('refreshes a token about to expire, and drops the pair when GitHub refuses it', async () => {
    const { test, source, store, first } = await signedIn({ expiringTokens: true })
    test.clock = first.expiresAt! - GITHUB_TOKEN_REFRESH_MARGIN_MS
    const second = await source.credential('silent', signal)
    expect(second?.bearer).not.toBe(first.bearer)
    expect(second?.bearer).toBe(test.server.issuedTokens.at(-2))
    // A pair GitHub no longer takes: restore the spent one and try again.
    const spent = JSON.stringify({
      ...JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!),
      refreshToken: test.server.issuedTokens[1],
    })
    store.values.set(GITHUB_DEVICE_FLOW_SECRET_KEY, spent)
    test.clock = second!.expiresAt!
    expect(await source.credential('silent', signal)).toBeUndefined()
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
  })

  it('keeps the pair when a refresh meets a lost network', async () => {
    const { test, source, store, first } = await signedIn({ expiringTokens: true })
    test.clock = first.expiresAt!
    test.server.failNetwork(true)
    await expect(source.credential('silent', signal)).rejects.toThrow('network')
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(true)
  })

  it('drops the token on a 401 for it, and only for it', async () => {
    const { source, store, first: credential } = await signedIn()
    await source.rejected({ ...credential, bearer: 'some-other-token' })
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(true)
    await source.rejected(credential)
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
  })

  it('signs out by deleting the token and opening the app’s page on GitHub', async () => {
    const { source, store, opened } = await signedIn()
    await source.signOut()
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    // Only the new generation is left, and it holds no secret.
    expect(store.values.size).toBe(1)
    expect(store.values.has(GITHUB_DEVICE_FLOW_GENERATION_KEY)).toBe(true)
    expect(opened).toEqual([GITHUB_AUTHORIZED_APP_URL])
    expect(new URL(GITHUB_AUTHORIZED_APP_URL).origin).toBe('https://github.com')
    expect(await source.isSignedIn()).toBe(false)
  })

  it('treats an unreadable stored item as signed out', async () => {
    const test = await rig()
    const { source, store } = sourceFor(test)
    store.values.set(GITHUB_DEVICE_FLOW_SECRET_KEY, '{"v":1,"accessToken":""}')
    expect(await source.credential('silent', signal)).toBeUndefined()
    expect(await source.isSignedIn()).toBe(false)
  })
})

// RVM123A: a second window sharing the store, callers that cancel, an
// outage answered in JSON, and a wait that ends late.
describe('the device-flow source across windows, cancels and outages', () => {
  const signal = new AbortController().signal

  it('does not store a sign-in that finishes after another window signed out', async () => {
    const test = await rig()
    const { source: other, store } = sourceFor(test)
    const { source } = sourceFor(test, store, {
      ...test.deps,
      sleep: async (ms, wait) => {
        await test.deps.sleep(ms, wait)
        test.server.approve()
        await other.signOut()
      },
    })
    expect(await source.credential('ask', signal)).toBeUndefined()
    expect(test.server.issuedTokens).toHaveLength(1)
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    expect(await source.isSignedIn()).toBe(false)
    expect(await other.isSignedIn()).toBe(false)
  })

  it('does not store a refresh that finishes after another window signed out', async () => {
    const { test, store, first } = await signedIn({ expiringTokens: true })
    const { source: other } = sourceFor(test, store)
    const { source } = sourceFor(test, store, {
      ...test.deps,
      fetch: async (...request) => {
        const answer = await test.deps.fetch(...request)
        await other.signOut()
        return answer
      },
    })
    test.clock = first.expiresAt!
    expect(await source.credential('silent', signal)).toBeUndefined()
    expect(refreshes(test.server)).toHaveLength(1)
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
  })

  it('refreshes once for concurrent callers of one source', async () => {
    const { test, source, first } = await signedIn({ expiringTokens: true })
    test.clock = first.expiresAt!
    const [one, two] = await Promise.all([
      source.credential('silent', signal),
      source.credential('silent', signal),
    ])
    expect(refreshes(test.server)).toHaveLength(1)
    expect(one?.bearer).toBe(two?.bearer)
    expect(one?.bearer).not.toBe(first.bearer)
  })

  it('keeps the pair another window rotated in when its own refresh is refused', async () => {
    const { test, store, first } = await signedIn({ expiringTokens: true })
    const aServed = Promise.withResolvers<undefined>()
    const bServed = Promise.withResolvers<undefined>()
    const releaseA = Promise.withResolvers<undefined>()
    const releaseB = Promise.withResolvers<undefined>()
    const a = sourceFor(test, store, {
      ...test.deps,
      fetch: async (...request) => {
        const answer = await test.deps.fetch(...request)
        aServed.resolve(undefined)
        await releaseA.promise
        return answer
      },
    }).source
    const b = sourceFor(test, store, {
      ...test.deps,
      fetch: async (...request) => {
        await aServed.promise
        const answer = await test.deps.fetch(...request)
        bServed.resolve(undefined)
        await releaseB.promise
        return answer
      },
    }).source
    test.clock = first.expiresAt!
    const fromA = a.credential('silent', signal)
    const fromB = b.credential('silent', signal)
    await bServed.promise
    releaseA.resolve(undefined)
    const rotated = await fromA
    expect(rotated?.bearer).not.toBe(first.bearer)
    releaseB.resolve(undefined)
    const kept = await fromB
    expect(kept?.bearer).toBe(rotated?.bearer)
    expect(refreshes(test.server)).toHaveLength(2)
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      accessToken: rotated?.bearer,
    })
  })

  it('keeps the successful rotation when the refused refresh finishes first (RVM123A3 P2)', async () => {
    const { test, store, first } = await signedIn({ expiringTokens: true })
    const spent = storedIdOf(store)
    const aServed = Promise.withResolvers<undefined>()
    const bServed = Promise.withResolvers<undefined>()
    const releaseA = Promise.withResolvers<undefined>()
    const releaseB = Promise.withResolvers<undefined>()
    const a = sourceFor(test, store, {
      ...test.deps,
      fetch: async (...request) => {
        const answer = await test.deps.fetch(...request)
        aServed.resolve(undefined)
        await releaseA.promise
        return answer
      },
    }).source
    const b = sourceFor(test, store, {
      ...test.deps,
      fetch: async (...request) => {
        // A spends the refresh token first, so the server rotates for A
        // and refuses B as a duplicate spend.
        await aServed.promise
        const answer = await test.deps.fetch(...request)
        bServed.resolve(undefined)
        await releaseB.promise
        return answer
      },
    }).source
    test.clock = first.expiresAt!
    const fromA = a.credential('silent', signal)
    const fromB = b.credential('silent', signal)
    await bServed.promise
    // B's refusal lands first: it notes and deletes the spent pair and
    // leaves the generation alone; A's successful reply is still held back.
    releaseB.resolve(undefined)
    expect(await fromB).toBeUndefined()
    expect(store.values.get(GITHUB_DEVICE_FLOW_REFUSED_KEY)).toBe(spent)
    expect(store.values.has(GITHUB_DEVICE_FLOW_GENERATION_KEY)).toBe(false)
    releaseA.resolve(undefined)
    const rotated = await fromA
    expect(rotated?.bearer).not.toBe(first.bearer)
    expect(refreshes(test.server)).toHaveLength(2)
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      accessToken: rotated?.bearer,
    })
    expect(await a.isSignedIn()).toBe(true)
    const retry = await b.credential('silent', signal)
    expect(retry?.bearer).toBe(rotated?.bearer)
  })

  it('ends only a joined caller’s wait when that caller cancels', async () => {
    const test = await rig()
    const { source } = sourceFor(test)
    const joined = new AbortController()
    test.onSleep = () => {
      joined.abort()
      test.server.approve()
    }
    const [first, second] = await Promise.allSettled([
      source.credential('ask', new AbortController().signal),
      source.credential('ask', joined.signal),
    ])
    expect(first.status === 'fulfilled' && first.value?.bearer).toBe(test.server.issuedTokens[0])
    expect(second.status).toBe('rejected')
    expect(test.server.deviceRequests.filter((r) => r.path === CODE_PATH)).toHaveLength(1)
  })

  it('keeps signing in for a joined caller when the first caller cancels', async () => {
    const test = await rig()
    const { source } = sourceFor(test)
    const starter = new AbortController()
    test.onSleep = () => {
      starter.abort()
      test.server.approve()
    }
    const [first, second] = await Promise.allSettled([
      source.credential('ask', starter.signal),
      source.credential('ask', new AbortController().signal),
    ])
    expect(first.status).toBe('rejected')
    expect(second.status === 'fulfilled' && second.value?.bearer).toBe(test.server.issuedTokens[0])
  })

  it('stops polling once every caller has cancelled', async () => {
    const test = await rig()
    const waits: AbortSignal[] = []
    const { source } = sourceFor(test, memorySecrets(), {
      ...test.deps,
      sleep: (ms, wait) => {
        waits.push(wait)
        return test.deps.sleep(ms, wait)
      },
    })
    const one = new AbortController()
    const two = new AbortController()
    test.onSleep = (index) => {
      if (index === 1) {
        one.abort()
      } else if (index === 2) {
        two.abort()
      }
    }
    const results = await Promise.allSettled([
      source.credential('ask', one.signal),
      source.credential('ask', two.signal),
    ])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(waits.at(-1)?.aborted).toBe(true)
    expect(tokenPolls(test.server)).toHaveLength(2)
  })

  it.each([
    [
      'a 503 with a JSON body',
      () => Response.json({ message: 'Service Unavailable' }, { status: 503 }),
    ],
    ['a JSON temporarily_unavailable', () => Response.json({ error: 'temporarily_unavailable' })],
  ])('keeps the pair, and serves the live token, on %s', async (_name, outage) => {
    const { test, store, first } = await signedIn({ expiringTokens: true })
    const { source } = sourceFor(test, store, {
      ...test.deps,
      fetch: () => Promise.resolve(outage()),
    })
    test.clock = first.expiresAt! - 30 * SECOND
    const live = await source.credential('silent', signal)
    expect(live?.bearer).toBe(first.bearer)
    test.clock = first.expiresAt!
    await expect(source.credential('silent', signal)).rejects.toBeInstanceOf(DeviceFlowFailure)
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      accessToken: first.bearer,
    })
  })

  it('names a 5xx reply a network failure, whatever its body', async () => {
    const test = await rig()
    const deps = {
      ...test.deps,
      fetch: () => Promise.resolve(Response.json({ error: 'bad_refresh_token' }, { status: 502 })),
    }
    expect(await failureOf(refreshDeviceFlowToken(deps, 'refresh', signal))).toBe('network')
  })

  it('does not poll when a wait ends after the code expired', async () => {
    const test = await rig({ expiresInS: 60 })
    const deps: DeviceFlowDeps = {
      ...test.deps,
      sleep: (_ms, wait) => {
        test.clock += 120 * SECOND
        wait.throwIfAborted()
        return Promise.resolve()
      },
    }
    const work = signInWithDeviceFlow(deps, ['repo'], test.present, signal)
    expect(await failureOf(work)).toBe('expired')
    expect(tokenPolls(test.server)).toEqual([])
  })

  it('sends no poll when Cancel lands as a wait ends', async () => {
    const test = await rig()
    const controller = new AbortController()
    const sent: string[] = []
    const deps: DeviceFlowDeps = {
      ...test.deps,
      fetch: (input, init) => {
        sent.push(typeof input === 'string' ? input : 'not a string')
        return test.deps.fetch(input, init)
      },
      sleep: () => {
        controller.abort()
        return Promise.resolve()
      },
    }
    const work = signInWithDeviceFlow(deps, ['repo'], test.present, controller.signal)
    await expect(work).rejects.toThrow()
    expect(sent).toEqual([test.server.deviceCodeUrl])
  })

  it('takes a sign-in back when another window signs out as it is stored', async () => {
    const test = await rig()
    const shared = memorySecrets()
    const { source: other } = sourceFor(test, shared)
    const store = {
      ...shared,
      store: async (key: string, value: string) => {
        // The other window's whole sign-out lands between this window's
        // check of the mark and its write.
        if (key === GITHUB_DEVICE_FLOW_SECRET_KEY) await other.signOut()
        await shared.store(key, value)
      },
    }
    test.onSleep = () => {
      test.server.approve()
    }
    const { source } = sourceFor(test, store)
    expect(await source.credential('ask', signal)).toBeUndefined()
    expect(shared.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
  })
})

/** A stored pair issued under `generation`. */
const pairIn = (generation: string | null, accessToken: string) =>
  JSON.stringify({
    v: 3,
    id: `pair-${accessToken}`,
    generation,
    accessToken,
    refreshToken: null,
    expiresAt: null,
    refreshExpiresAt: null,
  })

/** Each write and delete, in order, by item: every item by its own name. */
const ITEM_NAMES: Readonly<Record<string, string>> = {
  [GITHUB_DEVICE_FLOW_SECRET_KEY]: 'pair',
  [GITHUB_DEVICE_FLOW_GENERATION_KEY]: 'generation',
  [GITHUB_DEVICE_FLOW_REFUSED_KEY]: 'refused',
}
const itemName = (key: string) => ITEM_NAMES[key] ?? key
function recorded(base = memorySecrets()) {
  const ops: string[] = []
  return {
    ...base,
    ops,
    store: async (key: string, value: string) => {
      ops.push(`store ${itemName(key)}`)
      await base.store(key, value)
    },
    delete: async (key: string) => {
      ops.push(`delete ${itemName(key)}`)
      await base.delete(key)
    },
  }
}

// RVM123A2 and the redesign (PLAN.md M123, the sign-in generation): one test
// per transition, and the reviewer's probes for a sign-in and a refresh.
describe('the sign-in generation', () => {
  const signal = new AbortController().signal
  const kinds = ['sign-in', 'refresh'] as const
  /** Window A's sign-in or refresh with its token reply held; B shares the store. */
  async function heldCompletion(kind: (typeof kinds)[number]) {
    const served = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    let isHeld = false
    const hold = (test: Rig): DeviceFlowDeps => ({
      ...test.deps,
      fetch: async (input, init) => {
        const answer = await test.deps.fetch(input, init)
        if (!isHeld && typeof input === 'string' && input.endsWith(TOKEN_PATH)) {
          isHeld = true
          served.resolve(undefined)
          await released.promise
        }
        return answer
      },
    })
    let parts
    if (kind === 'sign-in') {
      const test = await rig({ expiringTokens: true })
      test.onSleep = () => {
        test.server.approve()
      }
      const store = memorySecrets()
      const self = sourceFor(test, store, hold(test)).source
      parts = { test, store, self, work: self.credential('ask', signal) }
    } else {
      const { test, store, first } = await signedIn({ expiringTokens: true })
      test.clock = first.expiresAt!
      const self = sourceFor(test, store, hold(test)).source
      parts = { test, store, self, work: self.credential('silent', signal) }
    }
    await served.promise
    return {
      ...parts,
      other: sourceFor(parts.test, parts.store).source,
      release: () => {
        released.resolve(undefined)
      },
    }
  }

  it('reads a pair only under the generation it was issued in', async () => {
    const test = await rig()
    const { source, store } = sourceFor(test)
    store.values.set(GITHUB_DEVICE_FLOW_SECRET_KEY, pairIn(null, 'gho_firstGeneration0001'))
    const first = await source.credential('silent', signal)
    expect(first?.bearer).toBe('gho_firstGeneration0001')
    store.values.set(GITHUB_DEVICE_FLOW_GENERATION_KEY, 'second')
    expect(await source.credential('silent', signal)).toBeUndefined()
    expect(await source.isSignedIn()).toBe(false)
    store.values.set(GITHUB_DEVICE_FLOW_SECRET_KEY, pairIn('second', 'gho_secondGeneration0002'))
    const second = await source.credential('silent', signal)
    expect(second?.bearer).toBe('gho_secondGeneration0002')
  })

  it('notes and deletes only the refused pair on a 401, and renews the generation before deleting on Sign out', async () => {
    const test = await rig()
    test.onSleep = () => {
      test.server.approve()
    }
    const store = recorded()
    const { source } = sourceFor(test, store)
    const first = await source.credential('ask', signal)
    const refused = storedIdOf(store)
    store.ops.length = 0
    await source.rejected(first!)
    // A refusal never writes the generation (PLAN.md M123, one logout barrier).
    expect(store.ops).toEqual(['store refused', 'delete pair'])
    expect(store.values.get(GITHUB_DEVICE_FLOW_REFUSED_KEY)).toBe(refused)
    expect(store.values.has(GITHUB_DEVICE_FLOW_GENERATION_KEY)).toBe(false)
    const second = await source.credential('ask', signal)
    expect(second?.bearer).not.toBe(first?.bearer)
    store.ops.length = 0
    await source.signOut()
    expect(store.ops).toEqual(['store generation', 'delete pair'])
  })

  it('publishes after its own Sign out only once that Sign out has waited its turn', async () => {
    const test = await rig()
    test.onSleep = () => {
      test.server.approve()
    }
    const store = recorded()
    const late: { source?: DeviceFlowSource; signingOut?: Promise<void> } = {}
    const { source } = sourceFor(test, {
      ...store,
      store: async (key: string, value: string) => {
        if (key === GITHUB_DEVICE_FLOW_SECRET_KEY && late.signingOut === undefined) {
          // This window's own Sign out arrives between the check and the write.
          late.signingOut = late.source!.signOut()
          await new Promise((resolve) => setImmediate(resolve))
        }
        await store.store(key, value)
      },
    })
    late.source = source
    await source.credential('ask', signal)
    await late.signingOut
    expect(store.ops).toEqual(['store pair', 'store generation', 'delete pair'])
    expect(await source.credential('silent', signal)).toBeUndefined()
  })

  it('uses the pair another window stored over its own in the same generation', async () => {
    const test = await rig()
    test.onSleep = () => {
      test.server.approve()
    }
    const shared = memorySecrets()
    const { source } = sourceFor(test, {
      ...shared,
      store: async (key: string, value: string) => {
        await shared.store(key, value)
        if (key === GITHUB_DEVICE_FLOW_SECRET_KEY) {
          await shared.store(key, pairIn(null, 'gho_otherWindowPair0001'))
        }
      },
    })
    const adopted = await source.credential('ask', signal)
    expect(adopted?.bearer).toBe('gho_otherWindowPair0001')
  })

  it.each(kinds)(
    'never serves a %s that completes after another window signed out',
    async (kind) => {
      const { store, work, other, release } = await heldCompletion(kind)
      await other.signOut()
      release()
      expect(await work).toBeUndefined()
      expect(await other.credential('silent', signal)).toBeUndefined()
      expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    },
  )

  it.each(kinds)(
    'never serves a %s that completes after the same window signed out (RVM123A P1, one source)',
    async (kind) => {
      const { store, work, self, release } = await heldCompletion(kind)
      await self.signOut()
      release()
      expect(await work).toBeUndefined()
      expect(await self.credential('silent', signal)).toBeUndefined()
      expect(await self.isSignedIn()).toBe(false)
      expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    },
  )

  it.each(kinds)(
    'serves nobody a stale %s written past a sign-out while its read-back is pending',
    async (kind) => {
      let test: Rig
      let shared: ReturnType<typeof memorySecrets>
      if (kind === 'sign-in') {
        test = await rig({ expiringTokens: true })
        test.onSleep = () => {
          test.server.approve()
        }
        shared = memorySecrets()
      } else {
        const parts = await signedIn({ expiringTokens: true })
        test = parts.test
        shared = parts.store
        test.clock = parts.first.expiresAt!
      }
      const other = sourceFor(test, shared).source
      const readingBack = Promise.withResolvers<undefined>()
      const readBack = Promise.withResolvers<undefined>()
      let isWritten = false
      const { source } = sourceFor(test, {
        ...shared,
        get: async (key: string) => {
          if (isWritten && key === GITHUB_DEVICE_FLOW_GENERATION_KEY) {
            readingBack.resolve(undefined)
            await readBack.promise
          }
          return await shared.get(key)
        },
        store: async (key: string, value: string) => {
          if (key === GITHUB_DEVICE_FLOW_SECRET_KEY && !isWritten) {
            // The other window's whole Sign out lands between this one's
            // check and its write: the stale pair is in the store.
            await other.signOut()
            await shared.store(key, value)
            isWritten = true
            return
          }
          await shared.store(key, value)
        },
      })
      const work = source.credential(kind === 'sign-in' ? 'ask' : 'silent', signal)
      await readingBack.promise
      expect(shared.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(true)
      expect(await other.credential('silent', signal)).toBeUndefined()
      expect(await other.isSignedIn()).toBe(false)
      readBack.resolve(undefined)
      expect(await work).toBeUndefined()
      expect(shared.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    },
  )

  it.each(kinds)(
    'keeps the sign-in made after a sign-out when a pre-logout %s completes',
    async (kind) => {
      const { test, store, work, other, release } = await heldCompletion(kind)
      await other.signOut()
      test.onSleep = () => {
        test.server.approve()
      }
      const fresh = await other.credential('ask', signal)
      expect(fresh).toBeDefined()
      release()
      expect(await work).toBeUndefined()
      const kept = await other.credential('silent', signal)
      expect(kept?.bearer).toBe(fresh?.bearer)
      expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
        accessToken: fresh?.bearer,
      })
    },
  )

  it.each([
    [
      'a 503 with a JSON body',
      () => Response.json({ message: 'Service Unavailable' }, { status: 503 }),
    ],
    ['a malformed reply', () => Response.json({ unexpected: true })],
  ])('serves no cached token after a sign-out when the refresh meets %s', async (_name, outage) => {
    const { test, store, first } = await signedIn({ expiringTokens: true })
    const other = sourceFor(test, store).source
    const { source } = sourceFor(test, store, {
      ...test.deps,
      fetch: async () => {
        await other.signOut()
        return outage()
      },
    })
    test.clock = first.expiresAt! - 30 * SECOND
    expect(await source.credential('silent', signal)).toBeUndefined()
    expect(await source.isSignedIn()).toBe(false)
  })

  it('cancels a caller waiting on the final generation read instead of serving it (RVM123A3 P2)', async () => {
    const { test, store } = await signedIn()
    const held = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let generations = 0
    let finals = 0
    const gated = {
      ...store,
      get: async (key: string) => {
        if (key === GITHUB_DEVICE_FLOW_GENERATION_KEY) {
          generations += 1
          if (generations > 1) {
            // The shared run's own read goes through; each caller's final
            // Serve read waits here.
            finals += 1
            if (finals === 2) held.resolve(undefined)
            await release.promise
          }
        }
        return await store.get(key)
      },
    }
    const { source } = sourceFor(test, gated)
    const leaving = new AbortController()
    const staying = new AbortController()
    const first = source.credential('silent', leaving.signal)
    const second = source.credential('silent', staying.signal)
    await held.promise
    leaving.abort()
    release.resolve(undefined)
    await expect(first).rejects.toThrow()
    const kept = await second
    expect(kept?.bearer).toBeDefined()
    expect(await source.isSignedIn()).toBe(true)
  })

  it('cancels the CLI login waiting on the final generation read (RVM123A3 P2)', async () => {
    const { test, store } = await signedIn()
    const reading = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let generations = 0
    const gated = {
      ...store,
      get: async (key: string) => {
        if (key === GITHUB_DEVICE_FLOW_GENERATION_KEY) {
          generations += 1
          if (generations > 1) {
            reading.resolve(undefined)
            await release.promise
          }
        }
        return await store.get(key)
      },
    }
    const { source } = sourceFor(test, gated)
    const controller = new AbortController()
    const out: string[] = []
    const login = authGitHub('login', {
      source,
      storeName: 'the test store',
      signal: controller.signal,
      print: (line) => {
        out.push(line)
      },
      printError: (line) => {
        out.push(line)
      },
    })
    await reading.promise
    controller.abort()
    release.resolve(undefined)
    expect(await login).toBe(1)
    expect(out).toEqual([UI_TEXT.githubSignIn.cancelled])
  })
})

/** A window's flow whose first token reply (a sign-in's or a refresh's) GitHub has given, held. */
function heldReply(test: Rig) {
  const served = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  let isHeld = false
  const flow: DeviceFlowDeps = {
    ...test.deps,
    fetch: async (input, init) => {
      const answer = await test.deps.fetch(input, init)
      if (!isHeld && typeof input === 'string' && input.endsWith(TOKEN_PATH)) {
        isHeld = true
        served.resolve(undefined)
        await released.promise
      }
      return answer
    },
  }
  return {
    flow,
    served: served.promise,
    release: () => {
      released.resolve(undefined)
    },
  }
}

/** A store whose Sign out fails at `crash`: the generation write lost, or landed and then failing, or the delete. */
function crashing(
  base: ReturnType<typeof memorySecrets>,
  crash: 'generation lost' | 'generation write' | 'delete',
) {
  return {
    ...base,
    store: async (key: string, value: string) => {
      if (key === GITHUB_DEVICE_FLOW_GENERATION_KEY && crash !== 'delete') {
        if (crash === 'generation write') await base.store(key, value)
        throw new Error('the credential store failed')
      }
      await base.store(key, value)
    },
    delete: async (key: string) => {
      if (crash === 'delete') throw new Error('the credential store failed')
      await base.delete(key)
    },
  }
}

const outage503: typeof fetch = () =>
  Promise.resolve(Response.json({ message: 'Service Unavailable' }, { status: 503 }))

/** Resolves when the hold is reached. */
async function reaches(hold: Promise<undefined>): Promise<'held'> {
  await hold
  return 'held'
}
/** Resolves when `work` settles, either way. */
async function settles(work: Promise<unknown>): Promise<'finished'> {
  await Promise.allSettled([work])
  return 'finished'
}

// RVM123A4 and the redesign (PLAN.md M123, one logout barrier): only Sign
// out writes the generation; every operation reads it once when it begins
// and stores or serves only under it. Two windows are two sources over one
// store, and held awaits put each Sign out where the reviewer put it.
describe('one logout barrier', () => {
  const signal = new AbortController().signal
  const answers = ['answered after', 'answered before'] as const

  /**
   * `base` with one read of `key` held once `armed`, after `skip` more pass:
   * answered after the hold (it sees what is stored by then), or answered
   * before it and delivered late.
   */
  function holdingReads(
    base: ReturnType<typeof memorySecrets>,
    key: string,
    answer: (typeof answers)[number],
    skip = 0,
  ) {
    const reached = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const state = { armed: false, seen: 0 }
    return {
      state,
      reached: reached.promise,
      release: () => {
        released.resolve(undefined)
      },
      store: {
        ...base,
        get: async (asked: string) => {
          if (asked !== key || !state.armed) return await base.get(asked)
          state.seen += 1
          if (state.seen !== skip + 1) return await base.get(asked)
          const early = answer === 'answered before' ? await base.get(asked) : undefined
          reached.resolve(undefined)
          await released.promise
          return answer === 'answered before' ? early : await base.get(asked)
        },
      },
    }
  }

  // The publish's first generation read (its check), and its second (the
  // reviewed source's re-read after the sign-out count, RVM123A4's point;
  // the read-back here).
  const publishReads = answers.flatMap((answer) =>
    (
      [
        ['first', 0],
        ['second', 1],
      ] as const
    ).map(([which, skip]) => [which, answer, skip] as const),
  )
  it.each(publishReads)(
    'stores and serves nothing from a rotation held past a refusal and a Sign out (RVM123A4 P1, the publish’s %s generation read %s)',
    async (_which, answer, skip) => {
      const { test, store, first } = await signedIn({ expiringTokens: true })
      test.clock = first.expiresAt!
      const held = heldReply(test)
      const reads = holdingReads(store, GITHUB_DEVICE_FLOW_GENERATION_KEY, answer, skip)
      const fromA = sourceFor(test, reads.store, held.flow).source.credential('silent', signal)
      await held.served
      // B spends the same refresh token after A did: refused, B drops the pair.
      const b = sourceFor(test, store).source
      expect(await b.credential('silent', signal)).toBeUndefined()
      // A's publish reads the generation, and B's whole Sign out lands there.
      reads.state.armed = true
      held.release()
      await reads.reached
      await b.signOut()
      reads.release()
      expect(await fromA).toBeUndefined()
      const late = sourceFor(test, store).source
      expect(await late.credential('silent', signal)).toBeUndefined()
      expect(await late.isSignedIn()).toBe(false)
      expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
      expect(refreshes(test.server)).toHaveLength(2)
    },
  )

  it.each(answers)(
    'stores and serves nothing from a Read whose generation read spans a Sign out (RVM123A4 P1, %s)',
    async (answer) => {
      const { test, store, first } = await signedIn({ expiringTokens: true })
      test.clock = first.expiresAt!
      const reads = holdingReads(store, GITHUB_DEVICE_FLOW_GENERATION_KEY, answer)
      reads.state.armed = true
      const fromA = sourceFor(test, reads.store).source.credential('silent', signal)
      await reads.reached
      await sourceFor(test, store).source.signOut()
      reads.release()
      expect(await fromA).toBeUndefined()
      const late = sourceFor(test, store).source
      expect(await late.credential('silent', signal)).toBeUndefined()
      expect(await late.isSignedIn()).toBe(false)
      expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
      // Answered before the Sign out, A refreshed (GitHub rotated) and stored nothing.
      expect(refreshes(test.server)).toHaveLength(answer === 'answered before' ? 1 : 0)
    },
  )

  it.each(['generation write', 'delete'] as const)(
    'holds the barrier when Sign out fails at its %s, after the generation landed (RVM123A4 P1)',
    async (crash) => {
      const { test, store, first } = await signedIn({ expiringTokens: true })
      test.clock = first.expiresAt!
      const held = heldReply(test)
      const fromA = sourceFor(test, store, held.flow).source.credential('silent', signal)
      await held.served
      const b = sourceFor(test, crashing(store, crash)).source
      await expect(b.signOut()).rejects.toThrow('the credential store failed')
      held.release()
      expect(await fromA).toBeUndefined()
      const late = sourceFor(test, store).source
      expect(await late.credential('silent', signal)).toBeUndefined()
      expect(await late.isSignedIn()).toBe(false)
      // The earlier pair is still stored, and nobody reads it: it names the first generation.
      expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
        accessToken: first.bearer,
        generation: null,
      })
      // The next sign-in replaces it, under the new generation.
      const again = await late.credential('ask', signal)
      expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
        accessToken: again?.bearer,
        generation: store.values.get(GITHUB_DEVICE_FLOW_GENERATION_KEY),
      })
    },
  )

  it('changes nothing when Sign out fails before its generation write lands', async () => {
    const { test, store, first } = await signedIn({ expiringTokens: true })
    test.clock = first.expiresAt!
    const held = heldReply(test)
    const fromA = sourceFor(test, store, held.flow).source.credential('silent', signal)
    await held.served
    const b = sourceFor(test, crashing(store, 'generation lost')).source
    await expect(b.signOut()).rejects.toThrow('the credential store failed')
    held.release()
    const rotated = await fromA
    expect(rotated?.bearer).toBe(test.server.issuedTokens[2])
    const later = await sourceFor(test, store).source.credential('silent', signal)
    expect(later?.bearer).toBe(rotated?.bearer)
  })

  it('stores a sign-in that completes after another window signed in and was refused, under the generation it read (RVM123A4 P2)', async () => {
    const test = await rig({ expiringTokens: true })
    test.onSleep = () => {
      test.server.approve()
    }
    const store = memorySecrets()
    const held = heldReply(test)
    const fromA = sourceFor(test, store, held.flow).source.credential('ask', signal)
    await held.served
    const b = sourceFor(test, store).source
    const fromB = await b.credential('ask', signal)
    expect(fromB?.bearer).toBe(test.server.issuedTokens[2])
    await b.rejected(fromB!)
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    held.release()
    const signedInA = await fromA
    expect(signedInA?.bearer).toBe(test.server.issuedTokens[0])
    // Under the generation A read when it began; no refusal made one to move it into.
    expect(store.values.has(GITHUB_DEVICE_FLOW_GENERATION_KEY)).toBe(false)
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      accessToken: signedInA?.bearer,
      generation: null,
    })
    const later = await b.credential('silent', signal)
    expect(later?.bearer).toBe(signedInA?.bearer)
  })

  /** A's refresh, rotated by GitHub and held; meanwhile B's duplicate is refused and B signs in. */
  async function rotationHeldWhileAnotherSignsIn() {
    const { test, store, first } = await signedIn({ expiringTokens: true })
    test.clock = first.expiresAt!
    const held = heldReply(test)
    const fromA = sourceFor(test, store, held.flow).source.credential('silent', signal)
    await held.served
    const b = sourceFor(test, store).source
    const fromB = await b.credential('ask', signal)
    return { test, store, fromA, b, fromB, release: held.release }
  }

  it('never lets a held rotation overwrite a sign-in made after its duplicate was refused', async () => {
    const { test, store, fromA, fromB, release } = await rotationHeldWhileAnotherSignsIn()
    const rotatedForA = test.server.issuedTokens[2]!
    expect(fromB?.bearer).toBe(test.server.issuedTokens[4])
    release()
    // A writes nothing over B's newer pair, and uses it.
    const served = await fromA
    expect(served?.bearer).toBe(fromB?.bearer)
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      accessToken: fromB?.bearer,
    })
    expect(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)).not.toContain(rotatedForA)
  })

  it('never fills the slot another pair’s refusal emptied with a held rotation', async () => {
    const { store, fromA, b, fromB, release } = await rotationHeldWhileAnotherSignsIn()
    await b.rejected(fromB!)
    release()
    expect(await fromA).toBeUndefined()
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    expect(await b.credential('silent', signal)).toBeUndefined()
  })

  it('stores a sign-in that completes after another window rotated its own pair', async () => {
    const test = await rig({ expiringTokens: true })
    test.onSleep = () => {
      test.server.approve()
    }
    const store = memorySecrets()
    const held = heldReply(test)
    const fromA = sourceFor(test, store, held.flow).source.credential('ask', signal)
    await held.served
    const b = sourceFor(test, store).source
    const signedInB = await b.credential('ask', signal)
    test.clock = signedInB!.expiresAt! - GITHUB_TOKEN_REFRESH_MARGIN_MS
    const rotatedB = await b.credential('silent', signal)
    expect(rotatedB?.bearer).toBe(test.server.issuedTokens[4])
    held.release()
    const signedInA = await fromA
    expect(signedInA?.bearer).toBe(test.server.issuedTokens[0])
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      accessToken: signedInA?.bearer,
    })
  })

  /** B read the pair, and its refresh goes out (to be refused) only when released; A then wins GitHub's rotation. */
  async function loserHeldWhileTheWinnerRotates() {
    const { test, store, first } = await signedIn({ expiringTokens: true })
    test.clock = first.expiresAt!
    const reached = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const fromB = sourceFor(test, store, {
      ...test.deps,
      fetch: async (input, init) => {
        reached.resolve(undefined)
        await released.promise
        return await test.deps.fetch(input, init)
      },
    }).source.credential('silent', signal)
    await reached.promise
    const a = sourceFor(test, store).source
    const winner = await a.credential('silent', signal)
    return {
      store,
      a,
      winner,
      fromB,
      release: () => {
        released.resolve(undefined)
      },
    }
  }

  it('gives a refused refresh whose reply comes after the winner and a Sign out nothing', async () => {
    const { store, a, winner, fromB, release } = await loserHeldWhileTheWinnerRotates()
    expect(winner).toBeDefined()
    await a.signOut()
    release()
    expect(await fromB).toBeUndefined()
    expect(store.values.has(GITHUB_DEVICE_FLOW_SECRET_KEY)).toBe(false)
    expect(await a.credential('silent', signal)).toBeUndefined()
  })

  it('keeps a sign-in made after that Sign out when the refused reply comes', async () => {
    const { store, a, fromB, release } = await loserHeldWhileTheWinnerRotates()
    await a.signOut()
    const fresh = await a.credential('ask', signal)
    expect(fresh).toBeDefined()
    release()
    expect(await fromB).toBeUndefined()
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      accessToken: fresh?.bearer,
      generation: store.values.get(GITHUB_DEVICE_FLOW_GENERATION_KEY),
    })
    const later = await a.credential('silent', signal)
    expect(later?.bearer).toBe(fresh?.bearer)
  })

  it('serves nothing begun before the window’s own Sign out, though its final read was answered first', async () => {
    const { test, store } = await signedIn()
    // The Read's own generation read passes; Serve's is answered, then delivered late.
    const reads = holdingReads(store, GITHUB_DEVICE_FLOW_GENERATION_KEY, 'answered before', 1)
    reads.state.armed = true
    const { source } = sourceFor(test, reads.store)
    const work = source.credential('silent', signal)
    await reads.reached
    await source.signOut()
    reads.release()
    expect(await work).toBeUndefined()
    expect(await source.credential('silent', signal)).toBeUndefined()
  })

  it('starts its own sign-in for a caller after the window’s Sign out, rather than joining one begun before it', async () => {
    const test = await rig()
    test.onSleep = () => {
      test.server.approve()
    }
    const reached = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    let waits = 0
    const { source, store } = sourceFor(test, memorySecrets(), {
      ...test.deps,
      sleep: async (ms, wait) => {
        waits += 1
        if (waits === 1) {
          reached.resolve(undefined)
          await released.promise
        }
        await test.deps.sleep(ms, wait)
      },
    })
    const before = source.credential('ask', signal)
    await reached.promise
    await source.signOut()
    const after = source.credential('ask', signal)
    released.resolve(undefined)
    const [early, late] = await Promise.all([before, after])
    expect(early).toBeUndefined()
    expect(late?.bearer).toBeDefined()
    expect(test.server.deviceRequests.filter((r) => r.path === CODE_PATH)).toHaveLength(2)
    expect(JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!)).toMatchObject({
      accessToken: late?.bearer,
      generation: store.values.get(GITHUB_DEVICE_FLOW_GENERATION_KEY),
    })
  })
})

// Cancel at every await (RVM123A3/RVM123A4's matrix): each store call,
// request, reply body, prompt and wait of a call is held in turn; the caller
// cancels while it is held and must reject at once, with no credential.
describe('cancelling at every await', () => {
  const PATHS = [
    'a stored token',
    'a refresh',
    'a refused refresh',
    'an outage',
    'a sign-in',
  ] as const
  type Path = (typeof PATHS)[number]
  const AWAITS: Readonly<Record<Path, readonly string[]>> = {
    'a stored token': ['get pair', 'get generation', 'get generation'],
    'a refresh': [
      'get pair',
      'get generation',
      'request',
      'reply',
      'get pair',
      'get generation',
      'store pair',
      'get pair',
      'get generation',
      'get generation',
    ],
    'a refused refresh': [
      'get pair',
      'get generation',
      'request',
      'reply',
      'get pair',
      'store refused',
      'delete pair',
    ],
    'an outage': ['get pair', 'get generation', 'request', 'get generation'],
    'a sign-in': [
      'get pair',
      'get generation',
      'get generation',
      'request',
      'reply',
      'present',
      'wait',
      'request',
      'reply',
      'get generation',
      'store pair',
      'get pair',
      'get generation',
      'get generation',
    ],
  }

  async function prepared(path: Path) {
    if (path === 'a sign-in') {
      const test = await rig({ expiringTokens: true })
      test.onSleep = () => {
        test.server.approve()
      }
      return { test, store: memorySecrets(), mode: 'ask' as const, network: test.deps.fetch }
    }
    const { test, store, first } = await signedIn({ expiringTokens: path !== 'a stored token' })
    if (first.expiresAt !== undefined) {
      test.clock = first.expiresAt - (path === 'an outage' ? 30 * SECOND : 0)
    }
    if (path === 'a refused refresh') {
      const spent = {
        ...JSON.parse(store.values.get(GITHUB_DEVICE_FLOW_SECRET_KEY)!),
        refreshToken: 'ghr_spentRefreshToken0001',
      }
      store.values.set(GITHUB_DEVICE_FLOW_SECRET_KEY, JSON.stringify(spent))
    }
    return {
      test,
      store,
      mode: 'silent' as const,
      network: path === 'an outage' ? outage503 : test.deps.fetch,
    }
  }

  /** One source over `path`, each await traced and the `hold`th held (-1 holds none). */
  async function gated(path: Path, hold: number) {
    const { test, store, mode, network } = await prepared(path)
    const trace: string[] = []
    const reached = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const gate = async (label: string): Promise<void> => {
      trace.push(label)
      if (trace.length - 1 !== hold) return
      reached.resolve(undefined)
      await released.promise
    }
    const source = deviceFlowSource({
      store: {
        get: async (key) => {
          await gate(`get ${itemName(key)}`)
          return await store.get(key)
        },
        store: async (key, value) => {
          await gate(`store ${itemName(key)}`)
          await store.store(key, value)
        },
        delete: async (key) => {
          await gate(`delete ${itemName(key)}`)
          await store.delete(key)
        },
      },
      flow: {
        ...test.deps,
        fetch: async (input, init) => {
          await gate('request')
          const answer = await network(input, init)
          const body = new Uint8Array(await answer.arrayBuffer())
          // Pulled only when read (no read-ahead): the hold is the body's read.
          return new Response(
            new ReadableStream(
              {
                async pull(stream) {
                  await gate('reply')
                  stream.enqueue(body)
                  stream.close()
                },
              },
              { highWaterMark: 0 },
            ),
            { status: answer.status, headers: answer.headers },
          )
        },
        sleep: async (ms, wait) => {
          await gate('wait')
          await test.deps.sleep(ms, wait)
        },
      },
      present: async (prompt) => {
        await gate('present')
        await test.present(prompt)
      },
      openExternal: () => Promise.resolve(),
      fetch: test.deps.fetch,
    })
    return {
      source,
      mode,
      trace,
      controller: new AbortController(),
      reached: reached.promise,
      release: () => {
        released.resolve(undefined)
      },
    }
  }

  it.each(PATHS)('awaits in this order over %s', async (path) => {
    const call = await gated(path, -1)
    await call.source.credential(call.mode, call.controller.signal)
    expect(call.trace).toEqual(AWAITS[path])
  })

  const holds = PATHS.flatMap((path) =>
    AWAITS[path].map((label, hold) => [path, hold, label] as const),
  )
  it.each(holds)(
    'rejects at once a caller that cancels over %s at await %i (%s)',
    async (path, hold, label) => {
      const call = await gated(path, hold)
      const work = call.source.credential(call.mode, call.controller.signal)
      expect(await Promise.race([reaches(call.reached), settles(work)])).toBe('held')
      expect(call.trace.at(-1)).toBe(label)
      const reason = new Error(`cancelled at ${label}`)
      call.controller.abort(reason)
      // Still held: the caller leaves without waiting for it.
      await expect(work).rejects.toBe(reason)
      call.release()
    },
  )

  it.each(AWAITS['a sign-in'].map((label, hold) => [hold, label] as const))(
    'reports Cancelled from the CLI login at await %i (%s) of a sign-in',
    async (hold, label) => {
      const call = await gated('a sign-in', hold)
      const out: string[] = []
      const login = authGitHub('login', {
        source: call.source,
        storeName: 'the test store',
        signal: call.controller.signal,
        print: (line) => {
          out.push(line)
        },
        printError: (line) => {
          out.push(line)
        },
      })
      expect(await Promise.race([reaches(call.reached), settles(login)])).toBe('held')
      expect(call.trace.at(-1)).toBe(label)
      call.controller.abort()
      expect(await login).toBe(1)
      expect(out).toEqual([UI_TEXT.githubSignIn.cancelled])
      call.release()
    },
  )
})

const run = promisify(execFile)
const ghRecord = z.strictObject({ args: z.array(z.string()), environment: z.array(z.string()) })

function ghSource(
  setting: { globalValue?: unknown; workspaceValue?: unknown } | undefined,
  state: string,
  record: string,
) {
  return ghLoginSource({
    setting: () => setting,
    gh: fakeGhInvocation,
    run,
    environment: () => ({
      ...process.env,
      FAKE_GH_STATE: state,
      FAKE_GH_RECORD: record,
      GH_TOKEN: 'canary-env-gh-token',
      GITHUB_TOKEN: 'canary-env-github-token',
    }),
    fetch: globalThis.fetch.bind(globalThis),
  })
}
/** What the fake `gh` recorded: its arguments and its variables' names. */
function records(file: string): z.infer<typeof ghRecord>[] {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => ghRecord.parse(JSON.parse(line)))
    : []
}

describe('the gh source (D104 source c)', () => {
  let folder: string
  const signal = new AbortController().signal
  // No `gho_` prefix: only the registration, not a pattern, can redact it.
  const GH_CANARY = 'canary-gh-login-token-0001'

  beforeAll(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'm123a-gh-'))
  })
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  it('is off by default and refuses a repository’s value', async () => {
    const record = path.join(folder, 'off.jsonl')
    const state = fakeGhState({ octocat: GH_CANARY }, 'octocat')
    expect(await ghSource(undefined, state, record).credential('ask', signal)).toBeUndefined()
    expect(
      await ghSource({ workspaceValue: true }, state, record).credential('ask', signal),
    ).toBeUndefined()
    expect(records(record)).toEqual([])
  })

  it('reads the active account’s token with gh auth token and none of our variables', async () => {
    const record = path.join(folder, 'on.jsonl')
    const state = fakeGhState({ octocat: GH_CANARY, other: 'gho_otherAccount0002' }, 'octocat')
    const credential = await ghSource({ globalValue: true }, state, record).credential(
      'silent',
      signal,
    )
    expect(credential).toMatchObject({ source: 'ghLogin', bearer: GH_CANARY })
    const [call] = records(record)
    expect(call?.args).toEqual([...GH_AUTH_TOKEN_ARGS])
    expect(call?.environment).not.toContain('GH_TOKEN')
    expect(call?.environment).not.toContain('GITHUB_TOKEN')
    expect(redactSecrets(`token ${GH_CANARY}`)).not.toContain(GH_CANARY)
  })

  it('has nothing while gh is signed out or missing', async () => {
    const record = path.join(folder, 'out.jsonl')
    const signedOut = ghSource({ globalValue: true }, fakeGhState({}), record)
    expect(await signedOut.credential('ask', signal)).toBeUndefined()
    const missing = ghLoginSource({
      setting: () => ({ globalValue: true }),
      gh: () => undefined,
      run,
      environment: () => process.env,
      fetch: globalThis.fetch.bind(globalThis),
    })
    expect(await missing.credential('ask', signal)).toBeUndefined()
  })
})

async function cli(source: DeviceFlowSource, action: 'login' | 'logout' | 'status') {
  const out: string[] = []
  const code = await authGitHub(action, {
    source,
    storeName: 'the test store',
    signal: new AbortController().signal,
    print: (line) => {
      out.push(line)
    },
    printError: (line) => {
      out.push(line)
    },
  })
  return { code, out }
}

describe('auth github (the CLI)', () => {
  it('parses exactly login, logout and status', () => {
    for (const action of ['login', 'logout', 'status'] as const) {
      expect(parseCommandLine(['auth', 'github', action])).toEqual({
        command: 'authGitHub',
        action,
      })
    }
    for (const argv of [
      ['auth', 'github'],
      ['auth', 'github', 'login', '--token', 'x'],
      ['auth', 'github', 'token'],
    ]) {
      expect(parseCommandLine(argv)).toEqual({
        command: 'invalid',
        reason: UI_TEXT.githubSignIn.usage,
        exitCode: 2,
      })
    }
  })

  it('prints the code and GitHub’s address, stores the token, and never prints it', async () => {
    const test = await rig({ expiringTokens: true })
    const printed: string[] = []
    const { source, store } = sourceFor(test)
    const cliSource = deviceFlowSource({
      store,
      flow: test.deps,
      present: (prompt) => {
        printed.push(`${prompt.verificationUri} ${prompt.userCode}`)
        return Promise.resolve()
      },
      openExternal: (url) => {
        printed.push(url)
        return Promise.resolve()
      },
      fetch: test.deps.fetch,
    })
    test.onSleep = () => {
      test.server.approve()
    }
    const login = await cli(cliSource, 'login')
    expect(login.code).toBe(0)
    expect(printed[0]).toContain(GITHUB_DEVICE_VERIFICATION_URL)
    const signedIn = await cli(source, 'status')
    expect(signedIn.code).toBe(0)
    const logout = await cli(cliSource, 'logout')
    expect(logout.code).toBe(0)
    expect(printed.at(-1)).toBe(GITHUB_AUTHORIZED_APP_URL)
    const status = await cli(source, 'status')
    expect(status).toEqual({ code: 1, out: [UI_TEXT.githubSignIn.notSignedIn] })
    const everything = [...printed, ...login.out, ...logout.out, ...status.out].join('\n')
    expect(test.server.issuedTokens.length).toBeGreaterThan(0)
    for (const token of test.server.issuedTokens) expect(everything).not.toContain(token)
  })

  it('names a failure in fixed words', async () => {
    const test = await rig()
    test.server.playError('access_denied')
    const { source } = sourceFor(test)
    expect(await cli(source, 'login')).toEqual({
      code: 1,
      out: [UI_TEXT.githubSignIn.failures.denied],
    })
  })
})

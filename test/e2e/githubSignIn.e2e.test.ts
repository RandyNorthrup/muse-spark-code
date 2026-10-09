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
      v: 2,
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
    v: 2,
    generation,
    accessToken,
    refreshToken: null,
    expiresAt: null,
    refreshExpiresAt: null,
  })

/** Each write and delete, in order, by item. */
const itemName = (key: string) => (key === GITHUB_DEVICE_FLOW_SECRET_KEY ? 'pair' : 'generation')
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
      parts = {
        test,
        store,
        work: sourceFor(test, store, hold(test)).source.credential('ask', signal),
      }
    } else {
      const { test, store, first } = await signedIn({ expiringTokens: true })
      test.clock = first.expiresAt!
      parts = {
        test,
        store,
        work: sourceFor(test, store, hold(test)).source.credential('silent', signal),
      }
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

  it('retires the generation before deleting, on a 401 and on Sign out', async () => {
    const test = await rig()
    test.onSleep = () => {
      test.server.approve()
    }
    const store = recorded()
    const { source } = sourceFor(test, store)
    const first = await source.credential('ask', signal)
    store.ops.length = 0
    await source.rejected(first!)
    expect(store.ops).toEqual(['store generation', 'delete pair'])
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

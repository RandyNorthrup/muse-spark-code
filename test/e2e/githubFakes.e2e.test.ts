// M123 lane 0 (PLAN.md D104): the fakes every other lane builds on, proved
// against the code that will use them. The fake github.com replays every
// M71 capture through the real REST client, plays the device flow's every
// documented answer on a test clock, and the fake `gh` and the fixture
// repositories behave as the scenarios need.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { GitHubClient, GitHubError } from '../../src/core/git/github'
import { missingScopes } from '../../src/core/git/tokenSource'
import {
  GH_AUTH_TOKEN_ARGS,
  GITHUB_DEVICE_GRANT_TYPE,
  GITHUB_DEVICE_SLOW_DOWN_STEP_S,
  GITHUB_DEVICE_VERIFICATION_URL,
  GITHUB_SCOPES_HEADER,
  PULL_REQUEST_LINKS_KEPT,
} from '../../src/shared/constants'
import { DEVICE_FLOW_ERRORS } from '../unit/helpers/github/deviceFlow'
import {
  fakeGhInvocation,
  fakeGhState,
  fakePullRequestLinkStore,
  fakeRuntimeGitDeps,
} from '../unit/helpers/github/fakes'
import {
  createFixtureRepositories,
  type FixtureRepositories,
} from '../unit/helpers/github/repositories'
import * as captures from '../unit/helpers/githubCapture'
import { FAKE_GITHUB_TOKEN } from '../unit/helpers/fakeGitHub'
import {
  FAKE_OAUTH_CLIENT_ID,
  startFakeGitHub,
  type FakeGitHubServer,
  type FakeGitHubServerOptions,
} from './fakeGitHub'

const REPOSITORY = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const REPO_PATH = '/repos/RandyNorthrup/muse-spark-code'
const SECOND = 1000
const CODE_PARAMS = { client_id: FAKE_OAUTH_CLIENT_ID, scope: 'repo' }
const REFRESH_PARAMS = { client_id: FAKE_OAUTH_CLIENT_ID, grant_type: 'refresh_token' }
// The OAuth fields the tests read; the rest are matched whole.
const oauthReply = z.looseObject({
  device_code: z.optional(z.string()),
  user_code: z.optional(z.string()),
  access_token: z.optional(z.string()),
  refresh_token: z.optional(z.string()),
})
const quiet = () => undefined
const log = { trace: quiet, info: quiet, warn: quiet, error: quiet }

const servers: FakeGitHubServer[] = []

async function serve(options: FakeGitHubServerOptions = {}): Promise<FakeGitHubServer> {
  const server = await startFakeGitHub(options)
  servers.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

function client(server: FakeGitHubServer): GitHubClient {
  return new GitHubClient({
    fetch,
    userAgent: 'muse-spark-code/test',
    log,
    baseUrl: server.apiBaseUrl,
  })
}

function sendForm(url: string, params: Record<string, string>, isJson: boolean) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(isJson && { accept: 'application/json' }),
    },
    body: new URLSearchParams(params).toString(),
  })
}

async function post(url: string, params: Record<string, string>) {
  const response = await sendForm(url, params, true)
  return oauthReply.parse(await response.json())
}

async function deviceCodeOf(server: FakeGitHubServer): Promise<string> {
  const reply = await post(server.deviceCodeUrl, CODE_PARAMS)
  return String(reply.device_code)
}

function poll(server: FakeGitHubServer, deviceCode: string, extra: Record<string, string> = {}) {
  return post(server.tokenUrl, {
    client_id: FAKE_OAUTH_CLIENT_ID,
    device_code: deviceCode,
    grant_type: GITHUB_DEVICE_GRANT_TYPE,
    ...extra,
  })
}

/** The GitHubError a call ends with; anything else fails the test. */
async function refusalOf(call: Promise<unknown>): Promise<GitHubError> {
  try {
    await call
  } catch (error: unknown) {
    if (error instanceof GitHubError) {
      return error
    }
    throw error
  }
  throw new Error('expected a GitHubError')
}

async function scopesOf(server: FakeGitHubServer, token: string) {
  const response = await fetch(`${server.apiBaseUrl}/user`, {
    headers: { authorization: `Bearer ${token}` },
  })
  return { status: response.status, header: response.headers.get(GITHUB_SCOPES_HEADER) }
}

function runGh(state: string | undefined, args: readonly string[] = GH_AUTH_TOKEN_ARGS) {
  const gh = fakeGhInvocation()
  return spawnSync(gh.command, [...gh.args, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(state !== undefined && { FAKE_GH_STATE: state }) },
  })
}

function link(number: number) {
  return {
    repository: 'RandyNorthrup/muse-spark-code',
    number,
    url: `https://github.com/RandyNorthrup/muse-spark-code/pull/${String(number)}`,
    title: 't',
    linkedAt: number,
  }
}

describe('the fake GitHub REST API', () => {
  it('replays the served captures through the real client', async () => {
    const github = client(await serve())
    expect(await github.currentUser(FAKE_GITHUB_TOKEN)).toEqual({
      login: captures.CAPTURED_USER.login,
      id: captures.CAPTURED_USER.id,
    })
    const fork = await github.repositoryFacts(FAKE_GITHUB_TOKEN, {
      owner: 'Piangpi1997',
      name: 'muse-spark-code',
    })
    expect(fork.parent?.repository).toEqual(REPOSITORY)
    const forkPull = await github.pullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, 51)
    expect(forkPull.headRepository).toBe(captures.CAPTURED_PULL_FORK.head.repo.full_name)
    const own = await github.openPullRequestFor(FAKE_GITHUB_TOKEN, REPOSITORY, 'RandyNorthrup', 'x')
    expect(own?.number).toBe(captures.CAPTURED_PULL_LIST[0]?.number)
    const created = await github.createPullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, {
      title: 't',
      body: 'b',
      head: 'feature',
      base: 'main',
      isDraft: true,
    })
    expect(created.number).toBe(captures.CAPTURED_PULL_OWN.number)
    const checks = await github.checks(
      FAKE_GITHUB_TOKEN,
      REPOSITORY,
      captures.CAPTURED_PULL_OWN.head.sha,
    )
    expect(checks.running).toBeGreaterThan(0)
  })

  it('replays the other captures where a test puts them', async () => {
    const server = await serve()
    const github = client(server)
    const sha = captures.CAPTURED_PULL_OWN.head.sha
    server.rest.answer('GET', `${REPO_PATH}/pulls/56`, {
      status: 200,
      body: captures.CAPTURED_PULL_MERGED,
    })
    const merged = await github.pullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, 56)
    expect(merged.isMerged).toBe(true)
    for (const [runs, statuses, key] of [
      [captures.CAPTURED_CHECKS_FAILED, captures.CAPTURED_STATUS_FAILED, 'failed'],
      [captures.CAPTURED_CHECKS_CANCELLED, captures.CAPTURED_STATUS_NONE, 'cancelled'],
      [captures.CAPTURED_CHECKS_NONE, captures.CAPTURED_STATUS_NONE, undefined],
    ] as const) {
      server.rest.answer('GET', `${REPO_PATH}/commits/${sha}/check-runs`, {
        status: 200,
        body: runs,
      })
      server.rest.answer('GET', `${REPO_PATH}/commits/${sha}/status`, {
        status: 200,
        body: statuses,
      })
      const summary = await github.checks(FAKE_GITHUB_TOKEN, REPOSITORY, sha)
      if (key !== undefined) {
        expect(summary[key]).toBeGreaterThan(0)
      }
    }
    for (const body of [captures.CAPTURED_INVALID_HEAD, captures.CAPTURED_ALREADY_EXISTS]) {
      server.rest.answer('POST', `${REPO_PATH}/pulls`, { status: 422, body })
      const refused = await refusalOf(
        github.createPullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, {
          title: 't',
          body: 'b',
          head: 'h',
          base: 'main',
          isDraft: false,
        }),
      )
      expect(refused.kind).toBe('invalid')
      expect(refused.message).toContain(body.message)
    }
    const missing = await refusalOf(github.pullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, 9999))
    expect(missing.kind).toBe('notFound')
  })

  it('names each token’s scopes, and answers an unknown token with 401', async () => {
    const server = await serve()
    server.grantToken('canary-no-repo', 'read:org')
    const repo = await scopesOf(server, FAKE_GITHUB_TOKEN)
    expect(missingScopes(repo.header, ['repo'])).toEqual([])
    const noRepo = await scopesOf(server, 'canary-no-repo')
    expect(missingScopes(noRepo.header, ['repo'])).toEqual(['repo'])
    const unknown = await scopesOf(server, 'canary-unknown')
    expect(unknown.status).toBe(401)
    const refused = await refusalOf(client(server).currentUser('canary-unknown'))
    expect(refused.kind).toBe('signIn')
  })
})

describe('the fake device-flow server', () => {
  let clock = 0
  const now = () => clock

  it('issues a 900 s code at a 5 s interval, pending until approved, then a token once', async () => {
    clock = 0
    const server = await serve({ now })
    const code = await post(server.deviceCodeUrl, CODE_PARAMS)
    expect(code).toMatchObject({
      verification_uri: GITHUB_DEVICE_VERIFICATION_URL,
      expires_in: 900,
      interval: 5,
    })
    const deviceCode = String(code.device_code)
    expect(await poll(server, deviceCode)).toMatchObject({ error: 'authorization_pending' })
    clock += 5 * SECOND
    server.approve(String(code.user_code))
    const token = await poll(server, deviceCode)
    expect(token).toMatchObject({ token_type: 'bearer', scope: 'repo' })
    expect(server.issuedTokens).toEqual([token.access_token])
    clock += 5 * SECOND
    expect(await poll(server, deviceCode)).toMatchObject({ error: 'incorrect_device_code' })
  })

  it('answers a poll inside the interval with slow_down and five more seconds', async () => {
    clock = 0
    const server = await serve({ now })
    const deviceCode = await deviceCodeOf(server)
    await poll(server, deviceCode)
    clock += 4 * SECOND
    expect(await poll(server, deviceCode)).toMatchObject({
      error: 'slow_down',
      interval: 5 + GITHUB_DEVICE_SLOW_DOWN_STEP_S,
    })
    clock += 9 * SECOND
    expect(await poll(server, deviceCode)).toMatchObject({ error: 'slow_down', interval: 15 })
    clock += 15 * SECOND
    expect(await poll(server, deviceCode)).toMatchObject({ error: 'authorization_pending' })
  })

  it('expires the code, and plays access_denied', async () => {
    clock = 0
    const server = await serve({ now })
    const expired = await deviceCodeOf(server)
    clock += 900 * SECOND
    expect(await poll(server, expired)).toMatchObject({ error: 'expired_token' })
    const denied = await post(server.deviceCodeUrl, CODE_PARAMS)
    server.deny(String(denied.user_code))
    expect(await poll(server, String(denied.device_code))).toMatchObject({
      error: 'access_denied',
    })
  })

  it('refuses a wrong grant type, a wrong client and a disabled device flow', async () => {
    clock = 0
    const server = await serve({ now })
    const deviceCode = await deviceCodeOf(server)
    expect(await poll(server, deviceCode, { grant_type: 'password' })).toMatchObject({
      error: 'unsupported_grant_type',
    })
    expect(await poll(server, deviceCode, { client_id: 'someone-else' })).toMatchObject({
      error: 'incorrect_client_credentials',
    })
    expect(await post(server.deviceCodeUrl, { ...CODE_PARAMS, client_id: 'x' })).toMatchObject({
      error: 'incorrect_client_credentials',
    })
    server.disableDeviceFlow()
    expect(await post(server.deviceCodeUrl, CODE_PARAMS)).toMatchObject({
      error: 'device_flow_disabled',
    })
  })

  it('plays every documented error on demand', async () => {
    clock = 0
    const server = await serve({ now })
    const deviceCode = await deviceCodeOf(server)
    for (const error of DEVICE_FLOW_ERRORS) {
      server.playError(error)
      expect(await poll(server, deviceCode)).toMatchObject({ error })
    }
  })

  it('answers in GitHub’s form encoding without Accept: application/json', async () => {
    const server = await serve()
    const response = await sendForm(server.deviceCodeUrl, CODE_PARAMS, false)
    const form = new URLSearchParams(await response.text())
    expect(form.get('interval')).toBe('5')
  })

  it('names another verification address only when a test plays a phishing reply', async () => {
    const server = await serve({ verificationUri: 'https://github.com.example/login/device' })
    expect(await post(server.deviceCodeUrl, CODE_PARAMS)).toMatchObject({
      verification_uri: 'https://github.com.example/login/device',
    })
  })

  it('refreshes expiring tokens once each, rotating both', async () => {
    clock = 0
    const server = await serve({ now, expiringTokens: true })
    const deviceCode = await deviceCodeOf(server)
    server.approve()
    const first = await poll(server, deviceCode)
    expect(first).toMatchObject({ expires_in: 28_800, refresh_token_expires_in: 15_897_600 })
    const refreshToken = String(first.refresh_token)
    const second = await post(server.tokenUrl, { ...REFRESH_PARAMS, refresh_token: refreshToken })
    expect(second.access_token).not.toBe(first.access_token)
    expect(second.refresh_token).not.toBe(first.refresh_token)
    const reused = await post(server.tokenUrl, { ...REFRESH_PARAMS, refresh_token: refreshToken })
    expect(reused).toHaveProperty('error')
  })

  it('drops connections while the network is lost', async () => {
    const server = await serve()
    server.failNetwork(true)
    await expect(post(server.deviceCodeUrl, CODE_PARAMS)).rejects.toThrow()
    server.failNetwork(false)
    expect(await post(server.deviceCodeUrl, CODE_PARAMS)).toHaveProperty('user_code')
  })
})

describe('the fake gh', () => {
  it('prints the active account’s token, and exits 1 signed out', () => {
    const several = fakeGhState({ one: 'canary-gh-one', two: 'canary-gh-two' }, 'two')
    expect(runGh(several).stdout).toBe('canary-gh-two\n')
    const signedOut = runGh(fakeGhState({}))
    expect(signedOut.status).toBe(1)
    expect(signedOut.stdout).toBe('')
    expect(runGh(undefined).status).toBe(1)
  })

  it('refuses any command line but `auth token --hostname github.com`', () => {
    const state = fakeGhState({ one: 'canary-gh-one' }, 'one')
    expect(runGh(state, ['auth', 'token']).status).toBe(2)
    expect(runGh(state, ['api', 'user']).status).toBe(2)
  })

  it('records its arguments and variable names, never their values', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'fake-gh-'))
    try {
      const record = path.join(folder, 'record.jsonl')
      const gh = fakeGhInvocation()
      spawnSync(gh.command, [...gh.args, ...GH_AUTH_TOKEN_ARGS], {
        env: {
          ...process.env,
          FAKE_GH_STATE: fakeGhState({ one: 'canary-gh-recorded' }, 'one'),
          FAKE_GH_RECORD: record,
        },
      })
      const text = readFileSync(record, 'utf8')
      expect(text).toContain('FAKE_GH_STATE')
      expect(text).not.toContain('canary-gh-recorded')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('the fixture repositories', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'm123-repos-'))
  const built: FixtureRepositories[] = []
  const repos = (): FixtureRepositories => {
    const [first] = built
    if (first === undefined) {
      throw new Error('the fixture repositories were not built')
    }
    return first
  }
  const git = (cwd: string, ...args: string[]) =>
    spawnSync('git', args, { cwd, env: repos().environment, encoding: 'utf8' })

  beforeAll(() => {
    built.push(createFixtureRepositories(root))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('name github.com remotes whose traffic stays local', () => {
    expect(git(repos().fork, 'config', 'remote.origin.url').stdout.trim()).toBe(
      'https://github.com/Piangpi1997/muse-spark-code.git',
    )
    expect(git(repos().fork, 'config', 'remote.upstream.url').stdout.trim()).toBe(
      'https://github.com/RandyNorthrup/muse-spark-code.git',
    )
    expect(git(repos().fork, 'ls-remote', 'upstream', 'main').status).toBe(0)
  })

  it('give the push plan its cases: ahead, behind and detached', () => {
    const counts = (cwd: string) =>
      git(cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}').stdout.trim()
    expect(counts(repos().own)).toBe('1\t0')
    expect(counts(repos().behind)).toBe('0\t1')
    expect(git(repos().detached, 'symbolic-ref', '-q', 'HEAD').status).not.toBe(0)
  })

  it('refuse a commit through the failing hook and the unreadable signer', () => {
    for (const cwd of [repos().failingHook, repos().signer]) {
      expect(git(cwd, 'commit', '--allow-empty', '-m', 'try').status, cwd).not.toBe(0)
    }
    expect(git(repos().signer, 'config', 'gpg.format').stdout.trim()).toBe('ssh')
    expect(
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'ok'], {
        cwd: repos().own,
        env: repos().environment,
      }),
    ).toBeDefined()
  })
})

describe('the runtime link store and deps', () => {
  it('keeps the newest PULL_REQUEST_LINKS_KEPT links of each repository root', async () => {
    const store = fakePullRequestLinkStore()
    for (let number = 1; number <= PULL_REQUEST_LINKS_KEPT + 1; number += 1) {
      await store.set('/repo', `session-${String(number)}`, link(number))
    }
    await store.set('/other', 'session-1', link(7))
    expect(await store.get('/repo', 'session-1')).toBeUndefined()
    expect(await store.get('/repo', 'session-2')).toEqual(link(2))
    expect(await store.get('/other', 'session-1')).toEqual(link(7))
  })

  it('records each editor call the adapter makes', async () => {
    const { deps, calls } = fakeRuntimeGitDeps('/repo')
    await deps.openInTerminal(['git', 'push'], '/repo')
    await deps.openFolder('/data/pr-worktrees/pr-51')
    await deps.openExternal(GITHUB_DEVICE_VERIFICATION_URL)
    const confirmation = {
      remote: 'origin',
      remoteUrl: 'https://github.com/o/r.git',
      branch: 'feature',
      target: 'feature',
      commits: 1,
    }
    // The fake's push modal answers yes, and its remote pick is dismissed.
    expect(await deps.confirmPush(confirmation)).toBe(true)
    expect(await deps.pickRemote(['alpha', 'beta'])).toBeUndefined()
    expect(calls).toEqual({
      terminals: [{ command: ['git', 'push'], cwd: '/repo' }],
      folders: ['/data/pr-worktrees/pr-51'],
      externals: [GITHUB_DEVICE_VERIFICATION_URL],
      confirmations: [confirmation],
      remotePicks: [['alpha', 'beta']],
    })
  })
})

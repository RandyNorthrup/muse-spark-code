// The editor's GitHub session by lease in the runtime panel (M123, PLAN.md
// D104 §2): the conversation controller's own pull request form and strip,
// served by the native route over MHP `auth/githubLease` and
// `github/request`. The editor answers the lease and each REST call as an
// editor with a GitHub account would; every REST body is M71's recorded
// capture for that call (test/unit/helpers/githubCapture.ts), and the test
// asserts the exact request the real client builds before it is sent. No
// prompt is sent, no network is touched, and the credential store fails the
// suite if it is ever read.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { processGitRunner } from '../../src/host/git'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import {
  CAPTURED_CHECKS_RUNNING,
  CAPTURED_PULL_LIST,
  CAPTURED_PULL_OWN,
  CAPTURED_REPOSITORY,
  CAPTURED_STATUS_NONE,
  CAPTURED_USER,
} from './helpers/githubCapture'
import type { ChatSurface } from './helpers/panelEditor'
import { connectedPanel } from './helpers/panelConversation'
import { createPanelRun, type PanelRun } from './helpers/panelRun'
import { testGit } from './helpers/nativeGitHarness'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()
const runs: PanelRun[] = []
const REPOSITORY_URL = 'https://github.com/RandyNorthrup/muse-spark-code.git'
const API = 'https://api.github.com'
/** The lease id the editor answers with, in the shape the contract parses. */
const LEASE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

beforeAll(() => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
})

afterAll(async () => {
  for (const run of runs) await run.dispose()
})

/** A workspace that is a repository of its own with one commit, and the git that made it. */
function repositoryRun() {
  const run = createPanelRun('muse-panel-lease-')
  runs.push(run)
  run.prepare()
  const git = testGit(run.folder)
  git.run(run.workspace, 'init', '-q', '-b', 'main')
  for (const [key, value] of [
    ['user.name', 'Panel Suite'],
    ['user.email', 'panel@example.invalid'],
    ['commit.gpgsign', 'false'],
  ] as const)
    git.run(run.workspace, 'config', key, value)
  writeFileSync(path.join(run.workspace, 'base.txt'), 'base\n')
  git.run(run.workspace, 'add', 'base.txt')
  git.run(run.workspace, 'commit', '-q', '-m', 'Base')
  git.run(run.workspace, 'remote', 'add', 'origin', REPOSITORY_URL)
  return { run, git }
}

/** What the person is shown next that is a notice of this level. */
async function noticeOf(chat: ChatSurface, level: 'info' | 'warning' | 'error') {
  return await chat.shown('notice', (payload) => payload['level'] === level)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

interface LeaseAsk {
  readonly workspaceUri: unknown
  readonly ownerId: unknown
  readonly mode: unknown
}

interface RestCall {
  readonly leaseId: unknown
  readonly ownerId: unknown
  readonly method: unknown
  readonly url: unknown
}

describe("the editor's GitHub lease", () => {
  it('opens the pull request form over the lease, and links the open one instead of a second', async () => {
    const { run } = repositoryRun()
    const leaseAsks: LeaseAsk[] = []
    const restCalls: RestCall[] = []
    const { host, editor, exit } = await connectedPanel(run, {
      runGit: processGitRunner(),
      offers: ['auth'],
    })
    host.serve('auth/githubLease', (params) => {
      leaseAsks.push(params as LeaseAsk)
      return { leaseId: LEASE_ID }
    })
    host.serve('github/request', (params) => {
      const call = params as RestCall
      restCalls.push(call)
      const bodies: Record<string, unknown> = {
        [`${API}/user`]: CAPTURED_USER,
        [`${API}/repos/RandyNorthrup/muse-spark-code`]: CAPTURED_REPOSITORY,
        [`${API}/repos/RandyNorthrup/muse-spark-code/pulls?head=RandyNorthrup%3Amain&state=open&per_page=1`]:
          CAPTURED_PULL_LIST,
        [`${API}/repos/RandyNorthrup/muse-spark-code/pulls/56`]: CAPTURED_PULL_OWN,
        [`${API}/repos/RandyNorthrup/muse-spark-code/commits/e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5/check-runs?per_page=100&page=1`]:
          CAPTURED_CHECKS_RUNNING,
        [`${API}/repos/RandyNorthrup/muse-spark-code/commits/e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5/status?per_page=100&page=1`]:
          CAPTURED_STATUS_NONE,
      }
      const body = bodies[String(call.url)]
      if (body === undefined) throw new Error(`unexpected GitHub request: ${String(call.url)}`)
      return { status: 200, body: JSON.stringify(body) }
    })
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'openPullRequest' })
    // The open pull request for the branch is linked instead of a second one.
    expect(await noticeOf(chat, 'info')).toMatchObject({
      text: fill(UI_TEXT.gitPullRequestExists, { number: 56 }),
    })
    const state = await chat.shown(
      'gitState',
      (payload) =>
        (payload['state'] as Record<string, unknown>)['pullRequest'] !== undefined &&
        ((payload['state'] as Record<string, unknown>)['pullRequest'] as Record<string, unknown>)[
          'checks'
        ] !== undefined,
    )
    expect(state['state']).toMatchObject({
      pullRequest: {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 56,
        title: 'README: how this extension is built',
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56',
        state: 'open',
        isDraft: false,
        isMerged: false,
        checks: {
          passed: 5,
          failed: 0,
          running: 1,
          skipped: 0,
          cancelled: 0,
          failedNames: [],
          other: [],
        },
      },
      github: { account: { source: 'editorLease', login: 'RandyNorthrup' } },
    })
    // The exact requests the real client built: the sign-in's account read,
    // the form's facts, the open one for the branch, then its state and checks.
    expect(restCalls).toEqual([
      {
        leaseId: LEASE_ID,
        ownerId: expect.stringMatching(UUID_PATTERN),
        method: 'GET',
        url: `${API}/user`,
      },
      {
        leaseId: LEASE_ID,
        ownerId: expect.stringMatching(UUID_PATTERN),
        method: 'GET',
        url: `${API}/repos/RandyNorthrup/muse-spark-code`,
      },
      {
        leaseId: LEASE_ID,
        ownerId: expect.stringMatching(UUID_PATTERN),
        method: 'GET',
        url: `${API}/repos/RandyNorthrup/muse-spark-code/pulls?head=RandyNorthrup%3Amain&state=open&per_page=1`,
      },
      {
        leaseId: LEASE_ID,
        ownerId: expect.stringMatching(UUID_PATTERN),
        method: 'GET',
        url: `${API}/repos/RandyNorthrup/muse-spark-code/pulls/56`,
      },
      {
        leaseId: LEASE_ID,
        ownerId: expect.stringMatching(UUID_PATTERN),
        method: 'GET',
        url: `${API}/repos/RandyNorthrup/muse-spark-code/commits/e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5/check-runs?per_page=100&page=1`,
      },
      {
        leaseId: LEASE_ID,
        ownerId: expect.stringMatching(UUID_PATTERN),
        method: 'GET',
        url: `${API}/repos/RandyNorthrup/muse-spark-code/commits/e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5/status?per_page=100&page=1`,
      },
    ])
    // One owner for the connection's leases: every REST call carries the lease ask's owner.
    expect(new Set(restCalls.map((call) => call.ownerId))).toEqual(new Set([leaseAsks[0]?.ownerId]))
    // Asked silently: nothing was shown to sign in.
    expect(leaseAsks).toHaveLength(3)
    const [first, second, third] = leaseAsks
    expect(first).toEqual({
      workspaceUri: pathToFileURL(run.workspace).href,
      ownerId: expect.stringMatching(UUID_PATTERN),
      mode: 'silent',
    })
    expect(second?.ownerId).toBe(first?.ownerId)
    expect(second?.mode).toBe('silent')
    expect(third?.ownerId).toBe(first?.ownerId)
    expect(third?.mode).toBe('silent')
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('a 401 over the lease asks the user to sign in again, and the next call borrows a fresh lease', async () => {
    const { run } = repositoryRun()
    const leaseAsks: LeaseAsk[] = []
    let didRefuse = false
    const { host, editor, exit } = await connectedPanel(run, {
      runGit: processGitRunner(),
      offers: ['auth'],
    })
    host.serve('auth/githubLease', (params) => {
      leaseAsks.push(params as LeaseAsk)
      return { leaseId: LEASE_ID }
    })
    host.serve('github/request', (params) => {
      const call = params as RestCall
      if (!didRefuse && String(call.url).endsWith('/repos/RandyNorthrup/muse-spark-code')) {
        didRefuse = true
        return { status: 401, body: '' }
      }
      const bodies: Record<string, unknown> = {
        [`${API}/user`]: CAPTURED_USER,
        [`${API}/repos/RandyNorthrup/muse-spark-code`]: CAPTURED_REPOSITORY,
        [`${API}/repos/RandyNorthrup/muse-spark-code/pulls?head=RandyNorthrup%3Amain&state=open&per_page=1`]:
          [],
      }
      const body = bodies[String(call.url)]
      if (body === undefined) throw new Error(`unexpected GitHub request: ${String(call.url)}`)
      return { status: 200, body: JSON.stringify(body) }
    })
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'openPullRequest' })
    expect(await noticeOf(chat, 'warning')).toMatchObject({
      text: fill(UI_TEXT.gitHubAnswered, { status: '401' }),
    })
    expect(leaseAsks).toHaveLength(2)
    // The refused lease is dropped: the retry asks the editor again and the form opens.
    chat.say({ type: 'gitAction', action: 'openPullRequest' })
    expect(await chat.shown('gitPullRequestForm')).toMatchObject({
      form: {
        repository: 'RandyNorthrup/muse-spark-code',
        remote: 'origin',
        remoteUrl: REPOSITORY_URL,
        head: 'main',
        base: 'main',
        push: 'needed',
      },
    })
    expect(leaseAsks).toHaveLength(4)
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('a refused lease falls through without asking the device flow or the network', async () => {
    const { run } = repositoryRun()
    const leaseAsks: LeaseAsk[] = []
    const restCalls: RestCall[] = []
    const { host, editor, exit } = await connectedPanel(run, {
      runGit: processGitRunner(),
      offers: ['auth'],
    })
    host.serve('auth/githubLease', (params) => {
      leaseAsks.push(params as LeaseAsk)
      return { leaseId: null }
    })
    host.serve('github/request', (params) => {
      restCalls.push(params as RestCall)
      return { status: 200, body: '{}' }
    })
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'openPullRequest' })
    // Said once, in words: nothing is signed in, and no code was shown.
    expect(await noticeOf(chat, 'info')).toMatchObject({ text: UI_TEXT.gitHubSignInDeclined })
    // Silently, then as the asked first source: the device flow stays unread (the
    // suite's credential store fails it if it is read) and no REST call goes out.
    expect(leaseAsks.map((ask) => ask.mode)).toEqual(['silent', 'ask'])
    expect(restCalls).toEqual([])
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('with no auth from the editor there is no lease to borrow', async () => {
    const { run } = repositoryRun()
    const leaseAsks: LeaseAsk[] = []
    const restCalls: RestCall[] = []
    const { host, editor, exit } = await connectedPanel(run, { runGit: processGitRunner() })
    // Served but not offered: the runtime asks only for what the host offered.
    host.serve('auth/githubLease', (params) => {
      leaseAsks.push(params as LeaseAsk)
      return { leaseId: LEASE_ID }
    })
    host.serve('github/request', (params) => {
      restCalls.push(params as RestCall)
      return { status: 200, body: '{}' }
    })
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'openPullRequest' })
    // The device flow is asked instead (its network fails honestly here), and no lease is attempted.
    expect(await noticeOf(chat, 'warning')).toMatchObject({
      text: UI_TEXT.githubSignIn.cancelled,
    })
    expect(leaseAsks).toEqual([])
    expect(restCalls).toEqual([])
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })
})

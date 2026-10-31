// The editor's GitHub session by lease in the runtime panel (M123, PLAN.md
// D104 §2): the conversation controller's own pull request form and strip,
// served by the native route over MHP `auth/githubLease` and
// `github/request`. The editor answers the lease and each REST call as an
// editor with a GitHub account would; every REST body is M71's recorded
// capture for that call (test/unit/helpers/githubCapture.ts), and the test
// asserts the exact request the real client builds before it is sent. No
// prompt is sent, no network is touched, and the credential store fails the
// suite if it is ever read.
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { processGitRunner } from '../../src/host/git'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import type { MhpCapability } from '../../src/shared/hostApi/capabilities'
import {
  CAPTURED_CHECKS_RUNNING,
  CAPTURED_PULL_LIST,
  CAPTURED_PULL_OWN,
  CAPTURED_REPOSITORY,
  CAPTURED_STATUS_NONE,
  CAPTURED_USER,
} from './helpers/githubCapture'
import type { MhpWire } from './helpers/mhpHost'
import type { ChatSurface, PanelEditor } from './helpers/panelEditor'
import { connectedPanel } from './helpers/panelConversation'
import type { PanelRun } from './helpers/panelRun'
import { repositoryRun } from './helpers/panelGitRepo'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()
const runs: PanelRun[] = []
const REPOSITORY_URL = 'https://github.com/RandyNorthrup/muse-spark-code.git'
const API = 'https://api.github.com'
/** The lease id the editor answers with, in the shape the contract parses. */
const LEASE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

beforeAll(() => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
})

afterAll(async () => {
  for (const run of runs) await run.dispose()
})

/** What the person is shown next that is a notice of this level. */
async function noticeOf(chat: ChatSurface, level: 'info' | 'warning' | 'error') {
  return await chat.shown('notice', (payload) => payload['level'] === level)
}

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

interface RestAnswer {
  readonly status: number
  readonly body: string
}

interface LeasePanel {
  readonly host: MhpWire
  readonly editor: PanelEditor
  readonly exit: Promise<unknown>
  readonly leaseAsks: LeaseAsk[]
  readonly restCalls: RestCall[]
}

/** The panel with the editor's lease services answered as given, every call recorded. */
async function openLeasePanel(
  run: PanelRun,
  answers: {
    readonly offers?: readonly MhpCapability[]
    readonly lease: (ask: LeaseAsk) => { readonly leaseId: string | null }
    readonly request: (call: RestCall) => RestAnswer
  },
): Promise<LeasePanel> {
  const leaseAsks: LeaseAsk[] = []
  const restCalls: RestCall[] = []
  const { host, editor, exit } = await connectedPanel(run, {
    runGit: processGitRunner(),
    ...(answers.offers !== undefined && { offers: answers.offers }),
  })
  host.serve('auth/githubLease', (params) => {
    const ask = params as LeaseAsk
    leaseAsks.push(ask)
    return answers.lease(ask)
  })
  host.serve('github/request', (params) => {
    const call = params as RestCall
    restCalls.push(call)
    return answers.request(call)
  })
  return { host, editor, exit, leaseAsks, restCalls }
}

/** The next chat surface, asking for the pull request form. */
async function openPullRequestOn(editor: PanelEditor): Promise<ChatSurface> {
  const chat = await editor.nextSurface()
  chat.say({ type: 'gitAction', action: 'openPullRequest' })
  return chat
}

/** Ends the connection cleanly: shutdown answered, the process exits zero. */
async function expectShutdown(host: MhpWire, exit: Promise<unknown>): Promise<void> {
  parseMhpResult('shutdown', await host.request('shutdown', {}))
  expect(await exit).toBe(0)
}

/** The recorded captures served by exact request URL; anything else is a failure. */
function capturedRest(bodies: Record<string, unknown>) {
  return (call: RestCall): RestAnswer => {
    const body = bodies[String(call.url)]
    if (body === undefined) throw new Error(`unexpected GitHub request: ${String(call.url)}`)
    return { status: 200, body: JSON.stringify(body) }
  }
}

const PULLS_QUERY = 'pulls?head=RandyNorthrup%3Amain&state=open&per_page=1'
const CHECK_SHA = 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5'

describe("the editor's GitHub lease", () => {
  it('opens the pull request form over the lease, and links the open one instead of a second', async () => {
    const { run } = repositoryRun(runs, 'muse-panel-lease-', REPOSITORY_URL)
    const { host, editor, exit, leaseAsks, restCalls } = await openLeasePanel(run, {
      offers: ['auth'],
      lease: () => ({ leaseId: LEASE_ID }),
      request: capturedRest({
        [`${API}/user`]: CAPTURED_USER,
        [`${API}/repos/RandyNorthrup/muse-spark-code`]: CAPTURED_REPOSITORY,
        [`${API}/repos/RandyNorthrup/muse-spark-code/${PULLS_QUERY}`]: CAPTURED_PULL_LIST,
        [`${API}/repos/RandyNorthrup/muse-spark-code/pulls/56`]: CAPTURED_PULL_OWN,
        [`${API}/repos/RandyNorthrup/muse-spark-code/commits/${CHECK_SHA}/check-runs?per_page=100&page=1`]:
          CAPTURED_CHECKS_RUNNING,
        [`${API}/repos/RandyNorthrup/muse-spark-code/commits/${CHECK_SHA}/status?per_page=100&page=1`]:
          CAPTURED_STATUS_NONE,
      }),
    })
    const chat = await openPullRequestOn(editor)
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
    const ownerId = expect.stringMatching(UUID_PATTERN)
    expect(restCalls).toEqual(
      [
        `${API}/user`,
        `${API}/repos/RandyNorthrup/muse-spark-code`,
        `${API}/repos/RandyNorthrup/muse-spark-code/${PULLS_QUERY}`,
        `${API}/repos/RandyNorthrup/muse-spark-code/pulls/56`,
        `${API}/repos/RandyNorthrup/muse-spark-code/commits/${CHECK_SHA}/check-runs?per_page=100&page=1`,
        `${API}/repos/RandyNorthrup/muse-spark-code/commits/${CHECK_SHA}/status?per_page=100&page=1`,
      ].map((url) => ({ leaseId: LEASE_ID, ownerId, method: 'GET', url })),
    )
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
    await expectShutdown(host, exit)
  })

  it('a 401 over the lease asks the user to sign in again, and the next call borrows a fresh lease', async () => {
    const { run } = repositoryRun(runs, 'muse-panel-lease-', REPOSITORY_URL)
    let didRefuse = false
    const rest = capturedRest({
      [`${API}/user`]: CAPTURED_USER,
      [`${API}/repos/RandyNorthrup/muse-spark-code`]: CAPTURED_REPOSITORY,
      [`${API}/repos/RandyNorthrup/muse-spark-code/${PULLS_QUERY}`]: [],
    })
    const { host, editor, exit, leaseAsks } = await openLeasePanel(run, {
      offers: ['auth'],
      lease: () => ({ leaseId: LEASE_ID }),
      request: (call) => {
        if (!didRefuse && String(call.url).endsWith('/repos/RandyNorthrup/muse-spark-code')) {
          didRefuse = true
          return { status: 401, body: '' }
        }
        return rest(call)
      },
    })
    const chat = await openPullRequestOn(editor)
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
    await expectShutdown(host, exit)
  })

  it('a refused lease falls through without asking the device flow or the network', async () => {
    const { run } = repositoryRun(runs, 'muse-panel-lease-', REPOSITORY_URL)
    const { host, editor, exit, leaseAsks, restCalls } = await openLeasePanel(run, {
      offers: ['auth'],
      lease: () => ({ leaseId: null }),
      request: () => ({ status: 200, body: '{}' }),
    })
    const chat = await openPullRequestOn(editor)
    // Said once, in words: nothing is signed in, and no code was shown.
    expect(await noticeOf(chat, 'info')).toMatchObject({ text: UI_TEXT.gitHubSignInDeclined })
    // Silently, then as the asked first source: the device flow stays unread (the
    // suite's credential store fails it if it is read) and no REST call goes out.
    expect(leaseAsks.map((ask) => ask.mode)).toEqual(['silent', 'ask'])
    expect(restCalls).toEqual([])
    await expectShutdown(host, exit)
  })

  it('with no auth from the editor there is no lease to borrow', async () => {
    const { run } = repositoryRun(runs, 'muse-panel-lease-', REPOSITORY_URL)
    // Served but not offered: the runtime asks only for what the host offered.
    const { host, editor, exit, leaseAsks, restCalls } = await openLeasePanel(run, {
      lease: () => ({ leaseId: LEASE_ID }),
      request: () => ({ status: 200, body: '{}' }),
    })
    const chat = await openPullRequestOn(editor)
    // The device flow is asked instead (its network fails honestly here), and no lease is attempted.
    expect(await noticeOf(chat, 'warning')).toMatchObject({
      text: UI_TEXT.githubSignIn.cancelled,
    })
    expect(leaseAsks).toEqual([])
    expect(restCalls).toEqual([])
    await expectShutdown(host, exit)
  })
})

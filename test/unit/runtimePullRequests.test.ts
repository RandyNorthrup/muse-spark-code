// Pull requests in the runtime (M123 lane P): draft, open (draft and
// ready, fork onto its parent), link and read status, on the REST fake.
// Nothing posts without an explicit confirm; the bearer travels only in
// the Authorization header.

import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  RuntimePullRequests,
  type CreatePullRequestInput,
  type PreparePullRequestInput,
  type PullRequestDestination,
  type RuntimePullRequestDeps,
} from '../../src/runtime/panel/pullRequests/pullRequests'
import type { PullRequestLinkStore } from '../../src/core/git/runtimeGit'
import { fakeGitHub } from './helpers/fakeGitHub'
import { CAPTURED_PULL_OWN } from './helpers/githubCapture'
import { fakeRuntimeGitDeps, fakeTokenSource } from './helpers/github/fakes'
import { recordingLogger } from './helpers/recordingLogger'

const CANARY = 'm123p-canary-bearer'
const OWN = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const FORK = { owner: 'Piangpi1997', name: 'muse-spark-code' }
const OWN_URL = 'https://github.com/RandyNorthrup/muse-spark-code.git'
const FORK_URL = 'https://github.com/Piangpi1997/muse-spark-code.git'
const PULLS_PATH = '/repos/RandyNorthrup/muse-spark-code/pulls'
const OWN_BRANCH = 'docs/how-its-built'
const FORK_BRANCH = 'android-termux-p0-tests'
/** A linked pull request as the status read is handed it. */
const LINKED = {
  repository: 'RandyNorthrup/muse-spark-code',
  number: 56,
  title: 'A pull request',
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56',
} as const

interface SetupOptions {
  readonly signedIn?: boolean
  readonly trusted?: boolean
  readonly confirm?: boolean
  readonly links?: PullRequestLinkStore
}

function setup(options: SetupOptions = {}) {
  const github = fakeGitHub()
  const { deps, calls } = fakeRuntimeGitDeps(
    '/repo',
    options.links === undefined ? {} : { links: options.links },
  )
  const log = recordingLogger()
  const confirms: { readonly message: string; readonly detail: string; readonly action: string }[] =
    []
  const source = fakeTokenSource('deviceFlow', {
    bearer: CANARY,
    isSignedIn: options.signedIn ?? true,
    fetch: github.fetch,
  })
  const service = new RuntimePullRequests({
    ...deps,
    tokenSources: [source],
    platform: 'linux',
    now: () => 1000,
    confirm: (message, detail, action) => {
      confirms.push({ message, detail, action })
      return Promise.resolve(options.confirm ?? true)
    },
    baseUrl: 'https://api.github.test',
    log,
    isTrusted: () => options.trusted ?? true,
  } satisfies RuntimePullRequestDeps)
  return { github, service, confirms, calls, log, source, root: '/repo', links: deps.links }
}

/** `prepare`'s input: `head` on the own repository's `origin`, unless `extra` says otherwise. */
function branch(
  head = OWN_BRANCH,
  extra: Partial<PreparePullRequestInput> = {},
): PreparePullRequestInput {
  return { repository: OWN, head, remote: 'origin', remoteUrl: OWN_URL, ...extra }
}

/** The fork's branch on the fork's own remote. */
function forkBranch(extra: Partial<PreparePullRequestInput> = {}): PreparePullRequestInput {
  return branch(FORK_BRANCH, { repository: FORK, remoteUrl: FORK_URL, ...extra })
}

/** A set-up service whose branch has no open pull request yet, prepared for `input`. */
async function prepared(options: SetupOptions = {}, input = branch()) {
  const context = setup(options)
  context.github.answer('GET', PULLS_PATH, { status: 200, body: [] })
  const result = await context.service.prepare(input)
  if (!result.ok) {
    throw new Error('prepare failed')
  }
  return { ...context, prepared: result, destination: result.destination }
}

/** A draft for `destination`, linked to the session. */
function draft(destination: PullRequestDestination): CreatePullRequestInput {
  return {
    destination,
    title: 'A draft',
    body: 'What and why.',
    base: 'main',
    isDraft: true,
    sessionId: 'session',
  }
}

/** A ready, unlinked pull request for `destination`. */
function ready(
  destination: PullRequestDestination,
  title: string,
  body: string,
): CreatePullRequestInput {
  return { destination, title, body, base: 'main', isDraft: false }
}

function posts(github: ReturnType<typeof fakeGitHub>) {
  return github.requests.filter((request) => request.method === 'POST')
}

describe('runtime pull requests (M123 lane P)', () => {
  it('drafts onto the same repository, naming the default base', async () => {
    const { github, prepared: result } = await prepared(
      {},
      branch(OWN_BRANCH, { sessionId: 'session' }),
    )
    expect(result.existing).toBeUndefined()
    expect(result.destination.repository).toEqual(OWN)
    expect(result.destination.apiHead).toBe('docs/how-its-built')
    expect(result.destination.headRepository).toBeUndefined()
    expect(result.destination.defaultBase).toBe('main')
    expect(result.destination.remoteUrl).toBe(OWN_URL)
    expect(posts(github)).toHaveLength(0)
  })

  it('drafts a fork onto its parent, naming owner:branch', async () => {
    const { destination } = await prepared({}, forkBranch({ sessionId: 'session' }))
    expect(destination.repository).toEqual(OWN)
    expect(destination.apiHead).toBe('Piangpi1997:android-termux-p0-tests')
    expect(destination.headRepository).toBe('Piangpi1997/muse-spark-code')
  })

  it('links an open pull request for the branch instead of a second one', async () => {
    const { service, links, root } = setup()
    const result = await service.prepare(branch(OWN_BRANCH, { sessionId: 'session' }))
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.existing?.number).toBe(CAPTURED_PULL_OWN.number)
    const stored = await links.get(root, 'session')
    expect(stored?.number).toBe(CAPTURED_PULL_OWN.number)
    expect(stored?.linkedAt).toBe(1000)
  })

  it('refuses a remote that is not on github.com before any request', async () => {
    const { github, service } = setup()
    const result = await service.prepare(
      branch('feature', { remoteUrl: 'https://example.invalid/owner/repo.git' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('origin')
    }
    expect(github.requests).toHaveLength(0)
  })

  it('asks for sign-in when no source has a credential', async () => {
    const { github, service } = setup({ signedIn: false })
    expect(await service.prepare(branch('feature'))).toEqual({
      ok: false,
      reason: UI_TEXT.gitHubSignInDeclined,
      needsSignIn: true,
    })
    expect(github.requests).toHaveLength(0)
  })

  it('refuses to run in an untrusted project', async () => {
    const { service } = setup({ trusted: false })
    const result = await service.prepare(branch('feature'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(UI_TEXT.gitRestricted)
    }
  })

  it('opens a draft after the confirmation shows what goes out', async () => {
    const { github, service, confirms, links, root, destination } = await prepared()
    const created = await service.create(draft(destination))
    expect(created).toMatchObject({ ok: true, number: CAPTURED_PULL_OWN.number })
    const sent = posts(github)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.path).toBe(PULLS_PATH)
    expect(sent[0]?.body).toEqual({
      title: 'A draft',
      body: 'What and why.',
      head: 'docs/how-its-built',
      base: 'main',
      draft: true,
    })
    expect(sent[0]?.authorization).toBe(`Bearer ${CANARY}`)
    expect(sent[0]?.apiVersion).toBe('2022-11-28')
    expect(confirms).toHaveLength(1)
    expect(confirms[0]?.detail).toContain('A draft')
    expect(confirms[0]?.detail).toContain('RandyNorthrup/muse-spark-code')
    const stored = await links.get(root, 'session')
    expect(stored?.number).toBe(CAPTURED_PULL_OWN.number)
  })

  it('names the repository in the confirmation in the installed language (RVINTM123)', async () => {
    const { service, confirms, destination } = await prepared()
    setUiText({ ...EN, openPullRequestRepository: 'Dépôt marqué : {repository}' }, 'fr')
    try {
      await service.create(draft(destination))
    } finally {
      setUiText(EN, 'en')
    }
    expect(confirms[0]?.detail).toContain('Dépôt marqué : RandyNorthrup/muse-spark-code')
    expect(confirms[0]?.detail).not.toContain('Repository:')
  })

  it('opens a fork ready on the parent with owner:branch', async () => {
    const { github, service, destination } = await prepared({}, forkBranch())
    const created = await service.create(ready(destination, 'Ready', 'From a fork.'))
    expect(created.ok).toBe(true)
    const sent = posts(github)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.path).toBe(PULLS_PATH)
    expect(sent[0]?.body).toMatchObject({
      head: 'Piangpi1997:android-termux-p0-tests',
      draft: false,
    })
  })

  it('keeps the created pull request when the link store fails', async () => {
    const rejecting: PullRequestLinkStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error('link store unavailable')),
    }
    const { github, service, log, destination } = await prepared({ links: rejecting })
    const created = await service.create(draft(destination))
    // The POST succeeded, so the pull request goes back, not a failure
    // inviting a duplicate: exactly one POST, with its number and URL.
    expect(created).toMatchObject({ ok: true, number: CAPTURED_PULL_OWN.number })
    expect(posts(github)).toHaveLength(1)
    expect(log.lines.some((line) => line.includes('link could not be kept'))).toBe(true)
  })

  it('posts nothing without an explicit confirm', async () => {
    const { github, service, destination } = await prepared({ confirm: false })
    const created = await service.create(ready(destination, 'Never sent', 'Declined.'))
    expect(created.ok).toBe(false)
    expect(posts(github)).toHaveLength(0)
  })

  it('masks credential-shaped strings instead of sending them', async () => {
    const { github, service, destination } = await prepared()
    const pasted = `ghp_${'0'.repeat(36)}`
    const created = await service.create(
      ready(destination, 'A title', `A pasted token ${pasted} stays here.`),
    )
    expect(created.ok).toBe(false)
    if (!created.ok) {
      expect(created.reason).toBe(UI_TEXT.gitCredentialMasked)
      expect(created.masked?.body).not.toContain('ghp_')
    }
    expect(posts(github)).toHaveLength(0)
  })

  it('refuses an empty title, an overlong body and a bad base', async () => {
    const { github, service, destination } = await prepared()
    const base = ready(destination, 'Title', 'Body.')
    const emptyTitle = await service.create({ ...base, title: ' '.repeat(3) })
    expect(emptyTitle.ok).toBe(false)
    const overlong = await service.create({ ...base, title: 'Title', body: 'x'.repeat(65_537) })
    expect(overlong.ok).toBe(false)
    const badBase = await service.create({ ...base, base: '--bad' })
    expect(badBase.ok).toBe(false)
    expect(posts(github)).toHaveLength(0)
  })

  it('drops the credential on a 401 and asks to sign in again', async () => {
    const { github, service, source } = setup()
    github.answer('GET', '/repos/RandyNorthrup/muse-spark-code', { status: 401, body: {} })
    const result = await service.prepare(branch('feature'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.needsSignIn).toBe(true)
    }
    expect(source.rejectedBearers).toEqual([CANARY])
  })

  it('reads a pull request’s state and checks', async () => {
    const { service } = setup()
    const result = await service.status(
      { ...LINKED, number: CAPTURED_PULL_OWN.number, title: CAPTURED_PULL_OWN.title },
      'silent',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.view.state).toBe('open')
    expect(result.view.isDraft).toBe(false)
    expect(result.view.isMerged).toBe(false)
    expect(result.view.title).toBe(CAPTURED_PULL_OWN.title)
    expect(result.view.checkedAt).toBe(1000)
    expect(result.view.checks).toMatchObject({
      passed: expect.any(Number),
      failed: expect.any(Number),
      running: expect.any(Number),
    })
  })

  it('offers sign-in when the status cannot be read silently', async () => {
    const { service } = setup({ signedIn: false })
    const result = await service.status(LINKED, 'silent')
    expect(result).toEqual({ ok: true, view: { ...LINKED, needsSignIn: true } })
  })

  it('keeps the bearer out of every result, log and refusal', async () => {
    const context = await prepared({}, branch(OWN_BRANCH, { sessionId: 'session' }))
    const { github, service, log, destination } = context
    const created = await service.create(draft(destination))
    const status = await service.status(LINKED, 'silent')
    const refused = await service.create(ready(destination, ' '.repeat(3), ''))
    for (const value of [context.prepared, created, status, refused, log.lines]) {
      expect(JSON.stringify(value)).not.toContain(CANARY)
    }
    // The header carries it, and only the header does.
    for (const request of github.requests) {
      expect(request.authorization).toBe(`Bearer ${CANARY}`)
      expect(JSON.stringify({ ...request, authorization: undefined })).not.toContain(CANARY)
    }
  })
})

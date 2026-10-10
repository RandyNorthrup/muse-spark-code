// Pull requests in the runtime (M123 lane P): draft, open (draft and
// ready, fork onto its parent), link and read status, on the REST fake.
// Nothing posts without an explicit confirm; the bearer travels only in
// the Authorization header.

import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  RuntimePullRequests,
  type RuntimePullRequestDeps,
} from '../../src/runtime/panel/pullRequests/pullRequests'
import type { CoreLogger } from '../../src/core/logging'
import type { PullRequestLinkStore } from '../../src/core/git/runtimeGit'
import { fakeGitHub } from './helpers/fakeGitHub'
import { CAPTURED_PULL_OWN } from './helpers/githubCapture'
import { fakeRuntimeGitDeps, fakeTokenSource } from './helpers/github/fakes'

const CANARY = 'm123p-canary-bearer'
const OWN = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const FORK = { owner: 'Piangpi1997', name: 'muse-spark-code' }
const OWN_URL = 'https://github.com/RandyNorthrup/muse-spark-code.git'
const FORK_URL = 'https://github.com/Piangpi1997/muse-spark-code.git'
const PULLS_PATH = '/repos/RandyNorthrup/muse-spark-code/pulls'

function recordingLogger(): CoreLogger & { readonly lines: string[] } {
  const lines: string[] = []
  const record = (line: string) => {
    lines.push(line)
  }
  return { lines, trace: record, info: record, warn: record, error: record }
}

function setup(
  options: {
    readonly signedIn?: boolean
    readonly trusted?: boolean
    readonly confirm?: boolean
    readonly links?: PullRequestLinkStore
  } = {},
) {
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

describe('runtime pull requests (M123 lane P)', () => {
  it('drafts onto the same repository, naming the default base', async () => {
    const { github, service } = setup()
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'docs/how-its-built',
      remote: 'origin',
      remoteUrl: OWN_URL,
      sessionId: 'session',
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    expect(prepared.existing).toBeUndefined()
    expect(prepared.destination.repository).toEqual(OWN)
    expect(prepared.destination.apiHead).toBe('docs/how-its-built')
    expect(prepared.destination.headRepository).toBeUndefined()
    expect(prepared.destination.defaultBase).toBe('main')
    expect(prepared.destination.remoteUrl).toBe(OWN_URL)
    expect(github.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('drafts a fork onto its parent, naming owner:branch', async () => {
    const { github, service } = setup()
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: FORK,
      head: 'android-termux-p0-tests',
      remote: 'origin',
      remoteUrl: FORK_URL,
      sessionId: 'session',
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    expect(prepared.destination.repository).toEqual(OWN)
    expect(prepared.destination.apiHead).toBe('Piangpi1997:android-termux-p0-tests')
    expect(prepared.destination.headRepository).toBe('Piangpi1997/muse-spark-code')
  })

  it('links an open pull request for the branch instead of a second one', async () => {
    const { service, links, root } = setup()
    const prepared = await service.prepare({
      repository: OWN,
      head: 'docs/how-its-built',
      remote: 'origin',
      remoteUrl: OWN_URL,
      sessionId: 'session',
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    expect(prepared.existing?.number).toBe(CAPTURED_PULL_OWN.number)
    const stored = await links.get(root, 'session')
    expect(stored?.number).toBe(CAPTURED_PULL_OWN.number)
    expect(stored?.linkedAt).toBe(1000)
  })

  it('refuses a remote that is not on github.com before any request', async () => {
    const { github, service } = setup()
    const prepared = await service.prepare({
      repository: OWN,
      head: 'feature',
      remote: 'origin',
      remoteUrl: 'https://example.invalid/owner/repo.git',
    })
    expect(prepared.ok).toBe(false)
    if (!prepared.ok) {
      expect(prepared.reason).toContain('origin')
    }
    expect(github.requests).toHaveLength(0)
  })

  it('asks for sign-in when no source has a credential', async () => {
    const { github, service } = setup({ signedIn: false })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'feature',
      remote: 'origin',
      remoteUrl: OWN_URL,
    })
    expect(prepared).toEqual({
      ok: false,
      reason: UI_TEXT.gitHubSignInDeclined,
      needsSignIn: true,
    })
    expect(github.requests).toHaveLength(0)
  })

  it('refuses to run in an untrusted project', async () => {
    const { service } = setup({ trusted: false })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'feature',
      remote: 'origin',
      remoteUrl: OWN_URL,
    })
    expect(prepared.ok).toBe(false)
    if (!prepared.ok) {
      expect(prepared.reason).toBe(UI_TEXT.gitRestricted)
    }
  })

  it('opens a draft after the confirmation shows what goes out', async () => {
    const { github, service, confirms, links, root } = setup()
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'docs/how-its-built',
      remote: 'origin',
      remoteUrl: OWN_URL,
    })
    if (!prepared.ok) {
      throw new Error('prepare failed')
    }
    const created = await service.create({
      destination: prepared.destination,
      title: 'A draft',
      body: 'What and why.',
      base: 'main',
      isDraft: true,
      sessionId: 'session',
    })
    expect(created).toMatchObject({ ok: true, number: CAPTURED_PULL_OWN.number })
    const posts = github.requests.filter((request) => request.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.path).toBe(PULLS_PATH)
    expect(posts[0]?.body).toEqual({
      title: 'A draft',
      body: 'What and why.',
      head: 'docs/how-its-built',
      base: 'main',
      draft: true,
    })
    expect(posts[0]?.authorization).toBe(`Bearer ${CANARY}`)
    expect(posts[0]?.apiVersion).toBe('2022-11-28')
    expect(confirms).toHaveLength(1)
    expect(confirms[0]?.detail).toContain('A draft')
    expect(confirms[0]?.detail).toContain('RandyNorthrup/muse-spark-code')
    const stored = await links.get(root, 'session')
    expect(stored?.number).toBe(CAPTURED_PULL_OWN.number)
  })

  it('opens a fork ready on the parent with owner:branch', async () => {
    const { github, service } = setup()
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: FORK,
      head: 'android-termux-p0-tests',
      remote: 'origin',
      remoteUrl: FORK_URL,
    })
    if (!prepared.ok) {
      throw new Error('prepare failed')
    }
    const created = await service.create({
      destination: prepared.destination,
      title: 'Ready',
      body: 'From a fork.',
      base: 'main',
      isDraft: false,
    })
    expect(created.ok).toBe(true)
    const posts = github.requests.filter((request) => request.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.path).toBe(PULLS_PATH)
    expect(posts[0]?.body).toMatchObject({
      head: 'Piangpi1997:android-termux-p0-tests',
      draft: false,
    })
  })

  it('keeps the created pull request when the link store fails', async () => {
    const rejecting: PullRequestLinkStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error('link store unavailable')),
    }
    const { github, service, log } = setup({ links: rejecting })
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'docs/how-its-built',
      remote: 'origin',
      remoteUrl: OWN_URL,
    })
    if (!prepared.ok) {
      throw new Error('prepare failed')
    }
    const created = await service.create({
      destination: prepared.destination,
      title: 'A draft',
      body: 'What and why.',
      base: 'main',
      isDraft: true,
      sessionId: 'session',
    })
    // The POST succeeded, so the pull request goes back, not a failure
    // inviting a duplicate: exactly one POST, with its number and URL.
    expect(created).toMatchObject({ ok: true, number: CAPTURED_PULL_OWN.number })
    expect(github.requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    expect(log.lines.some((line) => line.includes('link could not be kept'))).toBe(true)
  })

  it('posts nothing without an explicit confirm', async () => {
    const { github, service } = setup({ confirm: false })
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'docs/how-its-built',
      remote: 'origin',
      remoteUrl: OWN_URL,
    })
    if (!prepared.ok) {
      throw new Error('prepare failed')
    }
    const created = await service.create({
      destination: prepared.destination,
      title: 'Never sent',
      body: 'Declined.',
      base: 'main',
      isDraft: false,
    })
    expect(created.ok).toBe(false)
    expect(github.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('masks credential-shaped strings instead of sending them', async () => {
    const { github, service } = setup()
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'docs/how-its-built',
      remote: 'origin',
      remoteUrl: OWN_URL,
    })
    if (!prepared.ok) {
      throw new Error('prepare failed')
    }
    const pasted = `ghp_${'0'.repeat(36)}`
    const created = await service.create({
      destination: prepared.destination,
      title: 'A title',
      body: `A pasted token ${pasted} stays here.`,
      base: 'main',
      isDraft: false,
    })
    expect(created.ok).toBe(false)
    if (!created.ok) {
      expect(created.reason).toBe(UI_TEXT.gitCredentialMasked)
      expect(created.masked?.body).not.toContain('ghp_')
    }
    expect(github.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('refuses an empty title, an overlong body and a bad base', async () => {
    const { github, service } = setup()
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'docs/how-its-built',
      remote: 'origin',
      remoteUrl: OWN_URL,
    })
    if (!prepared.ok) {
      throw new Error('prepare failed')
    }
    const base = {
      destination: prepared.destination,
      title: 'Title',
      body: 'Body.',
      base: 'main',
      isDraft: false,
    } as const
    const emptyTitle = await service.create({ ...base, title: ' '.repeat(3) })
    expect(emptyTitle.ok).toBe(false)
    const overlong = await service.create({ ...base, title: 'Title', body: 'x'.repeat(65_537) })
    expect(overlong.ok).toBe(false)
    const badBase = await service.create({ ...base, base: '--bad' })
    expect(badBase.ok).toBe(false)
    expect(github.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('drops the credential on a 401 and asks to sign in again', async () => {
    const { github, service, source } = setup()
    github.answer('GET', '/repos/RandyNorthrup/muse-spark-code', { status: 401, body: {} })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'feature',
      remote: 'origin',
      remoteUrl: OWN_URL,
    })
    expect(prepared.ok).toBe(false)
    if (!prepared.ok) {
      expect(prepared.needsSignIn).toBe(true)
    }
    expect(source.rejectedBearers).toEqual([CANARY])
  })

  it('reads a pull request’s state and checks', async () => {
    const { service } = setup()
    const result = await service.status(
      {
        repository: 'RandyNorthrup/muse-spark-code',
        number: CAPTURED_PULL_OWN.number,
        title: CAPTURED_PULL_OWN.title,
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56',
      },
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
    const result = await service.status(
      {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 56,
        title: 'A pull request',
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56',
      },
      'silent',
    )
    expect(result).toEqual({
      ok: true,
      view: {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 56,
        title: 'A pull request',
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56',
        needsSignIn: true,
      },
    })
  })

  it('keeps the bearer out of every result, log and refusal', async () => {
    const { github, service, log } = setup()
    github.answer('GET', PULLS_PATH, { status: 200, body: [] })
    const prepared = await service.prepare({
      repository: OWN,
      head: 'docs/how-its-built',
      remote: 'origin',
      remoteUrl: OWN_URL,
      sessionId: 'session',
    })
    if (!prepared.ok) {
      throw new Error('prepare failed')
    }
    const created = await service.create({
      destination: prepared.destination,
      title: 'A draft',
      body: 'What and why.',
      base: 'main',
      isDraft: true,
      sessionId: 'session',
    })
    const status = await service.status(
      {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 56,
        title: 'A pull request',
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56',
      },
      'silent',
    )
    const refused = await service.create({
      destination: prepared.destination,
      title: ' '.repeat(3),
      body: '',
      base: 'main',
      isDraft: false,
    })
    for (const value of [prepared, created, status, refused, log.lines]) {
      expect(JSON.stringify(value)).not.toContain(CANARY)
    }
    // The header carries it, and only the header does.
    for (const request of github.requests) {
      expect(request.authorization).toBe(`Bearer ${CANARY}`)
      expect(JSON.stringify({ ...request, authorization: undefined })).not.toContain(CANARY)
    }
  })
})

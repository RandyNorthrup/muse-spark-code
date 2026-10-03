import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { EN } from '../../src/shared/l10n/en'
import { GITHUB_CHECKS_PAGE_SIZE } from '../../src/shared/constants'
import { setUiText } from '../../src/shared/l10n/text'
import { loadUiTable } from '../../src/host/l10n'
import { FakeLogOutputChannel } from './helpers/fakes'
import { GitHubClient, GitHubError } from '../../src/core/git/github'
import {
  CAPTURED_ALREADY_EXISTS,
  CAPTURED_CHECKS_CANCELLED,
  CAPTURED_CHECKS_FAILED,
  CAPTURED_CHECKS_NONE,
  CAPTURED_INVALID_HEAD,
  CAPTURED_PULL_MERGED,
  CAPTURED_PULL_OWN,
  CAPTURED_STATUS_FAILED,
} from './helpers/githubCapture'
import { FAKE_GITHUB_BASE, FAKE_GITHUB_TOKEN, fakeGitHub } from './helpers/fakeGitHub'
import type { CoreLogger } from '../../src/core/logging'

const REPOSITORY = { owner: 'RandyNorthrup', name: 'muse-spark-code' }

function recordingLogger(): CoreLogger & { readonly lines: string[] } {
  const lines: string[] = []
  const record = (line: string) => {
    lines.push(line)
  }
  return { lines, trace: record, info: record, warn: record, error: record }
}
const OWN_SHA = CAPTURED_PULL_OWN.head.sha

function client(github = fakeGitHub()) {
  const log = recordingLogger()
  return {
    github,
    log,
    client: new GitHubClient({
      fetch: github.fetch,
      userAgent: 'muse-spark-code/test',
      log,
      baseUrl: FAKE_GITHUB_BASE,
    }),
  }
}

describe('GitHubClient against the captured responses (M71)', () => {
  it('localizes authored HTTP, schema and commit-ID failures using the installed German table', async () => {
    const loaded = await loadUiTable({
      language: 'de',
      readExtensionFile: () => readFile(new URL('../../l10n/ui.de.json', import.meta.url), 'utf8'),
      log: new FakeLogOutputChannel(),
    })
    expect(loaded.locale).toBe('de')
    try {
      const t = client()
      const nonJson = new GitHubClient({
        fetch: () => Promise.resolve(new Response('<html>proxy</html>', { status: 502 })),
        userAgent: 'muse-spark-code/test',
        log: t.log,
      })
      await expect(nonJson.currentUser(FAKE_GITHUB_TOKEN)).rejects.toThrow(
        'GitHub antwortete mit 502',
      )
      t.github.answer('GET', '/user', { status: 200, body: { login: 'x' } })
      await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).rejects.toThrow(
        'GitHub hat eine Antwort in einem unerwarteten Format zurückgegeben.',
      )
      await expect(t.client.checks(FAKE_GITHUB_TOKEN, REPOSITORY, 'bad')).rejects.toThrow(
        'Keine Commit-ID: bad',
      )
      t.github.answer('GET', '/user', { status: 401, body: { message: 'GitHub own words' } })
      await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).rejects.toThrow('GitHub own words')
    } finally {
      setUiText(EN, 'en')
    }
  })
  it('masks the exact authentication token when an error body echoes it', async () => {
    const t = client()
    t.github.answer('GET', '/user', {
      status: 401,
      body: { message: `Bad credentials ${FAKE_GITHUB_TOKEN}` },
    })
    await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).rejects.toThrow(
      'Bad credentials [redacted]',
    )
    expect(t.log.lines.join('\n')).not.toContain(FAKE_GITHUB_TOKEN)
  })

  it('sends the token, the API version and a user agent, and never logs the token', async () => {
    const t = client()
    await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).resolves.toEqual({
      login: 'RandyNorthrup',
      id: 122_551_425,
    })
    expect(t.github.requests[0]).toMatchObject({
      method: 'GET',
      path: '/user',
      authorization: `Bearer ${FAKE_GITHUB_TOKEN}`,
      apiVersion: '2022-11-28',
      userAgent: 'muse-spark-code/test',
    })
    expect(JSON.stringify(t.log.lines)).not.toContain(FAKE_GITHUB_TOKEN)
  })

  it('reads a default branch, and the parent of a fork', async () => {
    const t = client()
    await expect(t.client.repositoryFacts(FAKE_GITHUB_TOKEN, REPOSITORY)).resolves.toEqual({
      defaultBranch: 'main',
      parent: undefined,
    })
    await expect(
      t.client.repositoryFacts(FAKE_GITHUB_TOKEN, {
        owner: 'Piangpi1997',
        name: 'muse-spark-code',
      }),
    ).resolves.toEqual({
      defaultBranch: 'main',
      parent: { repository: REPOSITORY, defaultBranch: 'main' },
    })
  })

  it("reads a fork's pull request by another account", async () => {
    const t = client()
    await expect(t.client.pullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, 51)).resolves.toEqual({
      number: 51,
      url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
      state: 'open',
      title: 'test: lock Android/Termux P0 behavior for launch and voice',
      isDraft: false,
      isMerged: false,
      author: { login: 'Piangpi1997', id: 203_822_472 },
      headRef: 'android-termux-p0-tests',
      headSha: '29fe2d8a111e5424c69c3ad0e7328b53a98646af',
      headRepository: 'Piangpi1997/muse-spark-code',
      baseRef: 'main',
      baseRepository: 'RandyNorthrup/muse-spark-code',
    })
  })

  it('reads merged from merged_at, which the list form carries too', async () => {
    const t = client()
    t.github.answer('GET', '/repos/RandyNorthrup/muse-spark-code/pulls/49', {
      status: 200,
      body: CAPTURED_PULL_MERGED,
    })
    await expect(t.client.pullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, 49)).resolves.toMatchObject({
      state: 'closed',
      isMerged: true,
    })
    const open = await t.client.openPullRequestFor(
      FAKE_GITHUB_TOKEN,
      REPOSITORY,
      'RandyNorthrup',
      'docs/how-its-built',
    )
    expect(open).toMatchObject({ number: 56, isMerged: false })
    expect(t.github.requests.at(-1)?.path).toBe(
      '/repos/RandyNorthrup/muse-spark-code/pulls?head=RandyNorthrup%3Adocs%2Fhow-its-built&state=open&per_page=1',
    )
  })

  it('finds no open pull request in an empty list', async () => {
    const t = client()
    t.github.answer('GET', '/repos/RandyNorthrup/muse-spark-code/pulls', { status: 200, body: [] })
    await expect(
      t.client.openPullRequestFor(FAKE_GITHUB_TOKEN, REPOSITORY, 'RandyNorthrup', 'x'),
    ).resolves.toBeUndefined()
  })

  it('creates a pull request with exactly the fields given, draft included', async () => {
    const t = client()
    const created = await t.client.createPullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, {
      title: 'Title',
      body: 'Body',
      head: 'docs/how-its-built',
      base: 'main',
      isDraft: true,
    })
    expect(created.number).toBe(56)
    expect(t.github.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: '/repos/RandyNorthrup/muse-spark-code/pulls',
      body: { title: 'Title', body: 'Body', head: 'docs/how-its-built', base: 'main', draft: true },
    })
  })

  it("says GitHub's own words when it refuses a pull request", async () => {
    const t = client()
    t.github.answer('POST', '/repos/RandyNorthrup/muse-spark-code/pulls', {
      status: 422,
      body: CAPTURED_ALREADY_EXISTS,
    })
    const request = { title: 't', body: '', head: 'h', base: 'main', isDraft: false }
    await expect(
      t.client.createPullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, request),
    ).rejects.toMatchObject({
      kind: 'invalid',
      status: 422,
      message:
        'Validation Failed: A pull request already exists for RandyNorthrup:docs/how-its-built.',
    })
    t.github.answer('POST', '/repos/RandyNorthrup/muse-spark-code/pulls', {
      status: 422,
      body: CAPTURED_INVALID_HEAD,
    })
    await expect(
      t.client.createPullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, request),
    ).rejects.toThrow('Validation Failed: head invalid')
  })

  it('tells a missing pull request, a sign-in, a rate limit and a network failure apart', async () => {
    const t = client()
    await expect(
      t.client.pullRequest(FAKE_GITHUB_TOKEN, REPOSITORY, 999_999),
    ).rejects.toMatchObject({ kind: 'notFound', message: 'Not Found' })
    t.github.answer('GET', '/user', { status: 401, body: { message: 'Bad credentials' } })
    await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).rejects.toMatchObject({ kind: 'signIn' })
    t.github.answer('GET', '/user', {
      status: 403,
      body: { message: 'API rate limit exceeded' },
      headers: { 'x-ratelimit-remaining': '0' },
    })
    await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).rejects.toMatchObject({
      kind: 'rateLimited',
    })
    t.github.failNetwork(new TypeError('fetch failed'))
    await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).rejects.toBeInstanceOf(GitHubError)
    await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('refuses a reply in a shape the capture did not show', async () => {
    const t = client()
    t.github.answer('GET', '/user', { status: 200, body: { login: 'x' } })
    await expect(t.client.currentUser(FAKE_GITHUB_TOKEN)).rejects.toMatchObject({
      kind: 'response',
    })
  })
})

describe('checks (M71)', () => {
  it('counts a running run and passed ones; no statuses reads as none', async () => {
    const t = client()
    await expect(t.client.checks(FAKE_GITHUB_TOKEN, REPOSITORY, OWN_SHA)).resolves.toEqual({
      passed: 5,
      failed: 0,
      running: 1,
      skipped: 0,
      cancelled: 0,
      failedNames: [],
      other: [],
      notRead: 0,
    })
  })

  it('counts failed, skipped and cancelled runs and failed statuses, naming the failures', async () => {
    const t = client()
    const commit = `/repos/RandyNorthrup/muse-spark-code/commits/${OWN_SHA}`
    t.github.answer('GET', `${commit}/check-runs`, { status: 200, body: CAPTURED_CHECKS_FAILED })
    t.github.answer('GET', `${commit}/status`, { status: 200, body: CAPTURED_STATUS_FAILED })
    await expect(t.client.checks(FAKE_GITHUB_TOKEN, REPOSITORY, OWN_SHA)).resolves.toEqual({
      passed: 7,
      failed: 2,
      running: 0,
      skipped: 1,
      cancelled: 0,
      failedNames: ['build / quality (macos-latest)', 'TypeScript Localization Update'],
      other: [],
      notRead: 0,
    })
    t.github.answer('GET', `${commit}/check-runs`, { status: 200, body: CAPTURED_CHECKS_CANCELLED })
    await expect(t.client.checks(FAKE_GITHUB_TOKEN, REPOSITORY, OWN_SHA)).resolves.toMatchObject({
      cancelled: 1,
    })
  })

  it('shows a state the capture did not show as it came, and counts runs not read', async () => {
    const t = client()
    const commit = `/repos/RandyNorthrup/muse-spark-code/commits/${OWN_SHA}`
    t.github.answer('GET', `${commit}/check-runs`, {
      status: 200,
      body: {
        total_count: 150,
        check_runs: [
          { name: 'lint', status: 'queued', conclusion: null },
          { name: 'e2e', status: 'completed', conclusion: 'timed_out' },
        ],
      },
    })
    t.github.answer('GET', `${commit}/status`, {
      status: 200,
      body: { state: 'pending', total_count: 1, statuses: [{ state: 'pending', context: 'ci/x' }] },
    })
    await expect(t.client.checks(FAKE_GITHUB_TOKEN, REPOSITORY, OWN_SHA)).resolves.toMatchObject({
      passed: 0,
      other: ['lint: queued', 'e2e: timed_out', 'ci/x: pending'],
      notRead: 148,
    })
  })

  it('asks for a full page of commit statuses and counts the statuses beyond it as not read', async () => {
    const t = client()
    const commit = `/repos/RandyNorthrup/muse-spark-code/commits/${OWN_SHA}`
    t.github.answer('GET', `${commit}/check-runs`, { status: 200, body: CAPTURED_CHECKS_NONE })
    t.github.answer('GET', `${commit}/status`, {
      status: 200,
      body: {
        state: 'success',
        total_count: 130,
        statuses: [{ state: 'success', context: 'ci/a' }],
      },
    })
    await expect(t.client.checks(FAKE_GITHUB_TOKEN, REPOSITORY, OWN_SHA)).resolves.toMatchObject({
      passed: 1,
      notRead: 129,
    })
    expect(t.github.requests.map((request) => request.path)).toContain(
      `${commit}/status?per_page=${String(GITHUB_CHECKS_PAGE_SIZE)}`,
    )
  })

  it('reads a pull request with no runs as no checks', async () => {
    const t = client()
    const commit = `/repos/RandyNorthrup/muse-spark-code/commits/${OWN_SHA}`
    t.github.answer('GET', `${commit}/check-runs`, { status: 200, body: CAPTURED_CHECKS_NONE })
    const summary = await t.client.checks(FAKE_GITHUB_TOKEN, REPOSITORY, OWN_SHA)
    expect(summary.passed + summary.failed + summary.running + summary.other.length).toBe(0)
  })

  it('refuses a commit id that is not one before asking GitHub', async () => {
    const t = client()
    await expect(t.client.checks(FAKE_GITHUB_TOKEN, REPOSITORY, '../../user')).rejects.toThrow(
      'Not a commit ID',
    )
    expect(t.github.requests).toHaveLength(0)
  })
})

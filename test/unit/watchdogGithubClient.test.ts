// M115w WQ: the watchdog's GitHub calls over the real client. The injected
// fetch serves the 2026-10-22 captures byte for byte (test/fixtures/m115w/)
// and records every request; the tests prove parsing and request formation,
// never live traffic. POST and PATCH answers reuse the captured GET objects
// per GitHub's documented create-response equivalence (noted in
// src/core/git/github.ts); what the tests pin there is the request GitHub
// would receive.
import { describe, expect, it } from 'vitest'
import { GitHubClient, GitHubError } from '../../src/core/git/github'
import { serveGithub, watchdogCaptured, watchdogLogger } from './helpers/watchdog/servedGithub'

const logged: string[] = []
const quiet = watchdogLogger(logged)

const REPOSITORY = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const BASE = 'https://api.github.com/repos/RandyNorthrup/muse-spark-code'

describe('watchdog GitHub client', () => {
  it('reads one issue with its captured fields', async () => {
    const { fetch, calls } = serveGithub({
      [`GET ${BASE}/issues/146`]: { status: 200, body: watchdogCaptured('github-issue') },
    })
    const client = new GitHubClient({ fetch, userAgent: 'muse-spark-code/test', log: quiet })
    const issue = await client.issue('token', REPOSITORY, 146)
    expect(issue.number).toBe(146)
    expect(issue.commentCount).toBe(1)
    expect(issue.isPullRequest).toBe(false)
    expect(issue.closedAt).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.authorized).toBe(true)
  })

  it('lists the page newest-first and marks pull requests', async () => {
    const page = watchdogCaptured('github-issues-page1')
    if (!Array.isArray(page)) throw new TypeError('the capture lists issues')
    const { fetch, calls } = serveGithub({ [`GET ${BASE}/issues`]: { status: 200, body: page } })
    const client = new GitHubClient({ fetch, userAgent: 'muse-spark-code/test', log: quiet })
    const issues = await client.listIssues('token', REPOSITORY)
    expect(issues).toHaveLength(page.length)
    expect(issues.every((item) => item.isPullRequest)).toBe(true)
    expect(issues[0]?.closedAt).toBe('2026-10-22T06:48:21Z')
    expect(calls[0]?.url).toContain('sort=updated')
  })

  it('reads comments, labels and search from their captures', async () => {
    const { fetch } = serveGithub({
      [`GET ${BASE}/issues/146/comments`]: {
        status: 200,
        body: watchdogCaptured('github-issue-comments'),
      },
      [`GET ${BASE}/labels`]: { status: 200, body: watchdogCaptured('github-labels') },
      ['GET https://api.github.com/search/issues']: {
        status: 200,
        body: watchdogCaptured('github-search-issues'),
      },
    })
    const client = new GitHubClient({ fetch, userAgent: 'muse-spark-code/test', log: quiet })
    const [comment] = await client.issueComments('token', REPOSITORY, 146)
    expect(comment?.author.login).toBe('RandyNorthrup')
    const labels = await client.issueLabels('token', REPOSITORY)
    expect(labels.map((label) => label.name)).toContain('accessibility')
    const search = await client.searchIssues(
      'token',
      'repo:RandyNorthrup/muse-spark-code type:issue',
    )
    expect(search.totalCount).toBe(5)
    expect(search.incompleteResults).toBe(false)
  })

  it('reads releases, tags and commit search from their captures', async () => {
    const { fetch } = serveGithub({
      [`GET ${BASE}/releases`]: { status: 200, body: watchdogCaptured('github-releases') },
      [`GET ${BASE}/tags`]: { status: 200, body: watchdogCaptured('github-tags') },
      ['GET https://api.github.com/search/commits']: {
        status: 200,
        body: watchdogCaptured('github-search-commits'),
      },
    })
    const client = new GitHubClient({ fetch, userAgent: 'muse-spark-code/test', log: quiet })
    const [release] = await client.listReleases('token', REPOSITORY)
    expect(release?.tag).toBe('v0.19.0')
    expect(release?.isDraft).toBe(false)
    const [tag] = await client.listTags('token', REPOSITORY)
    expect(tag?.name).toBe('v0.19.0')
    expect(tag?.sha).toBe('4e09cab6ea724dd138bbb71304bdef39d5253992')
    const commits = await client.searchCommits('token', 'repo:RandyNorthrup/muse-spark-code 146')
    expect(commits.totalCount).toBe(commits.commits.length)
    expect(commits.commits[0]?.author).toBe('RandyNorthrup')
  })

  it('forms the comment, label and close mutations GitHub expects', async () => {
    const comments = watchdogCaptured('github-issue-comments')
    if (!Array.isArray(comments) || comments.length === 0)
      throw new TypeError('the capture holds comments')
    const { fetch, calls } = serveGithub({
      [`GET ${BASE}/issues/146/comments`]: { status: 200, body: comments },
      [`POST ${BASE}/issues/146/comments`]: { status: 201, body: comments[0] },
      [`POST ${BASE}/issues/146/labels`]: { status: 200, body: watchdogCaptured('github-labels') },
      [`PATCH ${BASE}/issues/146`]: { status: 200, body: watchdogCaptured('github-issue') },
    })
    const client = new GitHubClient({ fetch, userAgent: 'muse-spark-code/test', log: quiet })
    const [existing] = await client.issueComments('token', REPOSITORY, 146)
    const posted = await client.postIssueComment('token', REPOSITORY, 146, 'hello')
    expect(posted.id).toBe(existing?.id)
    const names = await client.addIssueLabels('token', REPOSITORY, 146, ['triage'])
    expect(names).toContain('accessibility')
    const closed = await client.closeIssue('token', REPOSITORY, 146)
    expect(closed.number).toBe(146)
    const mutations = calls.filter((call) => call.method !== 'GET')
    expect(mutations.map((call) => [call.method, call.body])).toEqual([
      ['POST', { body: 'hello' }],
      ['POST', { labels: ['triage'] }],
      ['PATCH', { state: 'closed' }],
    ])
    expect(calls.every((call) => call.authorized)).toBe(true)
  })

  it('refuses a missing issue and a misshapen answer out loud', async () => {
    const { fetch } = serveGithub({
      [`GET ${BASE}/issues/999999`]: { status: 404, body: { message: 'Not Found' } },
      [`GET ${BASE}/issues/147`]: { status: 200, body: { number: 'not-a-number' } },
    })
    const client = new GitHubClient({ fetch, userAgent: 'muse-spark-code/test', log: quiet })
    logged.length = 0
    let missing: unknown
    try {
      await client.issue('token', REPOSITORY, 999_999)
    } catch (error: unknown) {
      missing = error
    }
    if (!(missing instanceof GitHubError)) throw new TypeError('a missing issue must refuse')
    expect(missing.kind).toBe('notFound')
    let malformed: unknown
    try {
      await client.issue('token', REPOSITORY, 147)
    } catch (error: unknown) {
      malformed = error
    }
    if (!(malformed instanceof GitHubError)) throw new TypeError('a misshapen answer must refuse')
    expect(malformed.kind).toBe('response')
    expect(logged).toContain('GitHub GET answered 404 (notFound)')
  })
})

// Lane RLSCHED M115w issue captures (2026-10-22, unauthenticated GETs
// against the public RandyNorthrup/muse-spark-code repository, API version
// 2022-11-28; temp/m115w-capture.cjs): every fixture body in
// test/fixtures/m115w/github-issues/ must match its receipt's SHA-256 and
// byte count, proving the copy is byte-exact. `.prettierignore` keeps
// formatters from rewriting the bodies.
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ISSUES = path.join(__dirname, '..', 'fixtures', 'm115w', 'github-issues')

function byName(left: string, right: string): number {
  return Number(left > right) - Number(left < right)
}

const CAPTURES = [
  'github-issue',
  'github-issue-comments',
  'github-issues-page1',
  'github-labels',
  'github-search-issues',
  'github-releases',
  'github-tags',
  'github-search-commits',
  'github-repository',
]

describe('watchdog issue capture fixtures', () => {
  it('holds exactly the nine captured folders', async () => {
    const entries = await readdir(ISSUES, { withFileTypes: true })
    expect(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted(byName),
    ).toEqual(CAPTURES.toSorted(byName))
  })

  it('captured the watched issue, its comment and the search row for it', async () => {
    const issue = JSON.parse(
      await readFile(path.join(ISSUES, 'github-issue', 'response.body.json'), 'utf8'),
    ) as { number: number; comments: number }
    const comments = JSON.parse(
      await readFile(path.join(ISSUES, 'github-issue-comments', 'response.body.json'), 'utf8'),
    ) as unknown[]
    const search = JSON.parse(
      await readFile(path.join(ISSUES, 'github-search-issues', 'response.body.json'), 'utf8'),
    ) as { items: { number: number }[] }
    expect(issue.number).toBe(146)
    expect(comments).toHaveLength(issue.comments)
    expect(search.items.map((item) => item.number)).toContain(issue.number)
  })

  it('captured the release, tag and commit rows the triage reads', async () => {
    const releases = JSON.parse(
      await readFile(path.join(ISSUES, 'github-releases', 'response.body.json'), 'utf8'),
    ) as { tag_name: string }[]
    const tags = JSON.parse(
      await readFile(path.join(ISSUES, 'github-tags', 'response.body.json'), 'utf8'),
    ) as { name: string }[]
    const commits = JSON.parse(
      await readFile(path.join(ISSUES, 'github-search-commits', 'response.body.json'), 'utf8'),
    ) as { total_count: number; items: { sha: string }[] }
    const repository = JSON.parse(
      await readFile(path.join(ISSUES, 'github-repository', 'response.body.json'), 'utf8'),
    ) as { default_branch: string; full_name: string }
    expect(releases[0]?.tag_name).toBe(tags[0]?.name)
    expect(commits.items).toHaveLength(commits.total_count)
    expect(repository.full_name).toBe('RandyNorthrup/muse-spark-code')
    expect(repository.default_branch).toBe('main')
  })

  it.each(CAPTURES)('matches the receipt hash for %s', async (capture) => {
    const folder = path.join(ISSUES, capture)
    const receipt = JSON.parse(await readFile(path.join(folder, 'receipt.json'), 'utf8')) as {
      httpStatus: number
      credentialsSent: string
      body: { file: string; bytes: number; sha256: string }
    }
    expect(receipt.httpStatus).toBe(200)
    expect(receipt.credentialsSent).toBe('none')
    expect(receipt.body.file).toBe('response.body.json')
    const body = await readFile(path.join(folder, receipt.body.file))
    expect(body.byteLength).toBe(receipt.body.bytes)
    expect(createHash('sha256').update(body).digest('hex')).toBe(receipt.body.sha256)
  })
})

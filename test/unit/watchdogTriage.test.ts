// M115w WT: the triage step over the real client and the real store.
// The charter composes with its fills resolved; the duplicate, commit
// and plan matchers prove themselves on the captured rows; the evidence
// collector reads the served captures end to end; findings apply to an
// acknowledged record and anything else-shaped refuses. One commit
// message is a marked synthetic modification of its captured body.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitHubClient } from '../../src/core/git/github'
import { createWatchdogStore } from '../../src/core/watchdog/store'
import {
  candidateDuplicates,
  collectTriageEvidence,
  compareVersions,
  formatTriageEvidence,
  issueCommits,
  parseTriageFindings,
  plansTrackingIssue,
  triageCharter,
  triageWatchdogIssue,
} from '../../src/core/watchdog/triage'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { watchdogIssueSchema } from '../../src/shared/watchdog'
import { serveGithub, watchdogCaptured, watchdogLogger } from './helpers/watchdog/servedGithub'

const REPOSITORY = 'RandyNorthrup/muse-spark-code'
const NAMED = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const BASE = 'https://api.github.com/repos/RandyNorthrup/muse-spark-code'

const folders: string[] = []
afterEach(async () => {
  while (folders.length > 0) {
    const folder = folders.pop()
    if (folder !== undefined) await rm(folder, { recursive: true, force: true })
  }
})

function triageClient(routes: Record<string, { status: number; body: unknown }>) {
  const served = serveGithub(routes)
  return {
    calls: served.calls,
    client: new GitHubClient({
      fetch: served.fetch,
      userAgent: 'muse-spark-code/test',
      log: watchdogLogger([]),
    }),
  }
}

describe('watchdog triage', () => {
  it('composes the charter with every fill resolved', () => {
    const charter = triageCharter()
    expect(charter).toContain('You are the triage agent of the Muse Spark issue watchdog.')
    expect(charter).toContain('triageFindings v1 JSON only')
    expect(charter).toContain('# Triage method')
    expect(charter).not.toMatch(/\{[a-z]+\}/)
  })

  it('matches the captured same-title pair as duplicates, and nothing else', async () => {
    const { client } = triageClient({
      ['GET https://api.github.com/search/issues']: {
        status: 200,
        body: watchdogCaptured('github-search-issues'),
      },
    })
    const search = await client.searchIssues('token', `repo:${REPOSITORY} type:issue`)
    const four = search.issues.find((item) => item.number === 4)
    const oneFourtySix = search.issues.find((item) => item.number === 146)
    if (four === undefined || oneFourtySix === undefined)
      throw new TypeError('the capture holds issues 4 and 146')
    // Issues 3 and 4 share their captured title; 146's near-title
    // (0.16.0 against 157's 0.18.2) is not the same title.
    expect(candidateDuplicates(four, search.issues).map((item) => item.number)).toEqual([3])
    expect(candidateDuplicates(oneFourtySix, search.issues)).toEqual([])
  })

  it('keeps only the commits that name the issue', async () => {
    const { client } = triageClient({
      ['GET https://api.github.com/search/commits']: {
        status: 200,
        body: watchdogCaptured('github-search-commits'),
      },
    })
    const search = await client.searchCommits('token', `repo:${REPOSITORY} 146`)
    expect(search.totalCount).toBe(4)
    // The captured rows say `146 passed` and `WB-146`: broad search, no
    // `#146` citation, so nothing counts yet.
    expect(issueCommits(search.commits, 146)).toEqual([])
    const [first] = search.commits
    if (first === undefined) throw new TypeError('the capture holds commits')
    // Synthetic: the captured message plus a citation, marked as such.
    const cited = { ...first, message: `${first.message}\n\nFixes #146.` }
    expect(issueCommits([cited], 146)).toEqual([cited])
  })

  it('orders the captured tags as versions and refuses what has no reading', () => {
    expect(compareVersions('v0.19.0', '0.16.0')).toBe(1)
    expect(compareVersions('v0.18.2', 'v0.19.0')).toBe(-1)
    expect(compareVersions('v0.19.0', 'v0.19.0')).toBe(0)
    expect(compareVersions('v0.19', 'v0.19.0')).toBe(0)
    expect(compareVersions('nightly', 'v0.19.0')).toBeUndefined()
  })

  it('finds the issue in the plans that cite it', () => {
    // Synthetic plan texts, marked as such: the matcher's logic is what
    // is proven, over the citation shapes GitHub itself uses.
    expect(
      plansTrackingIssue(
        [
          { relativePath: '.agents/plans/chat.md', text: 'Fixes #4 alongside the input work.' },
          { relativePath: '.agents/plans/other.md', text: 'See issues/4 for the history.' },
          { relativePath: '.agents/plans/unrelated.md', text: 'Mentions #40 and issues/40 only.' },
        ],
        4,
      ),
    ).toEqual(['.agents/plans/chat.md', '.agents/plans/other.md'])
  })

  it('collects and formats the evidence from the served captures', async () => {
    const { client, calls } = triageClient({
      [`GET ${BASE}`]: { status: 200, body: watchdogCaptured('github-repository') },
      [`GET ${BASE}/releases`]: { status: 200, body: watchdogCaptured('github-releases') },
      [`GET ${BASE}/tags`]: { status: 200, body: watchdogCaptured('github-tags') },
      ['GET https://api.github.com/search/commits']: {
        status: 200,
        body: watchdogCaptured('github-search-commits'),
      },
      ['GET https://api.github.com/search/issues']: {
        status: 200,
        body: watchdogCaptured('github-search-issues'),
      },
    })
    const search = await client.searchIssues('token', `repo:${REPOSITORY} type:issue`)
    const four = search.issues.find((item) => item.number === 4)
    if (four === undefined) throw new TypeError('the capture holds issue 4')
    const evidence = await collectTriageEvidence(
      { client, token: 'token' },
      NAMED,
      four,
      search.issues,
      [],
    )
    expect(evidence.defaultBranch).toBe('main')
    expect(evidence.duplicates.map((item) => item.number)).toEqual([3])
    expect(evidence.releases[0]?.tag).toBe('v0.19.0')
    expect(evidence.tags.map((tag) => tag.name)).toContain('v0.18.2')
    expect(evidence.commits).toEqual([])
    expect(evidence.commitsIncomplete).toBe(false)
    expect(evidence.planRefs).toEqual([])
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(5)
    const pack = formatTriageEvidence(evidence)
    expect(pack).toContain('## Possible duplicates')
    expect(pack).toContain('- #3 Chat input is single-line only')
    expect(pack).toContain('## Releases, newest first')
    expect(pack).toContain('- v0.19.0 (2026-10-22T04:05:46Z)')
    expect(pack).toContain('```markdown')
  })

  it('applies proven findings and refuses anything else-shaped', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'watchdog-triage-'))
    folders.push(folder)
    const store = createWatchdogStore(createNodeScheduleFs(folder))
    await store.exclusive(REPOSITORY, (data) => ({
      data: {
        policy: data.policy,
        issues: [
          watchdogIssueSchema.parse({
            repository: REPOSITORY,
            issueNumber: 4,
            issueId: 4,
            state: 'acknowledged',
            runId: 'run-1',
            seenAtMs: 1,
            labelsApplied: ['triage'],
            lastTitle: 't',
            lastCommentCount: 0,
            lastIssueUpdatedAt: '2026-10-22T00:00:00Z',
            updatedAtMs: 1,
          }),
        ],
      },
      result: undefined,
    }))
    const deps = { store, now: () => 1_700_000_000_000 }
    // Refusals first: the record is still acknowledged, so the answer is
    // what refuses, and the record is untouched afterwards.
    await expect(triageWatchdogIssue(deps, REPOSITORY, 4, 'not findings')).rejects.toThrow(
      UI_TEXT.watchdog.triage.unreadable,
    )
    await expect(
      triageWatchdogIssue(
        deps,
        REPOSITORY,
        4,
        JSON.stringify({ version: 1, verdict: 'duplicate', summary: 'x', questions: [] }),
      ),
    ).rejects.toThrow(UI_TEXT.watchdog.triage.unreadable)
    const applied = await triageWatchdogIssue(
      deps,
      REPOSITORY,
      4,
      JSON.stringify({
        version: 1,
        verdict: 'duplicate',
        summary: 'Same title as #3.',
        questions: [],
        duplicateOf: 3,
      }),
    )
    expect(applied.state).toBe('triaged')
    expect(applied.findings.duplicateOf).toBe(3)
    await expect(triageWatchdogIssue(deps, REPOSITORY, 9, '{}')).rejects.toThrow(
      'watchdog cannot triage issue 9 before its acknowledgement',
    )
  })

  it('reads the triage answer as findings, or refuses it out loud', () => {
    expect(
      parseTriageFindings(
        JSON.stringify({
          version: 1,
          verdict: 'needsInfo',
          summary: 'No steps.',
          questions: ['What did you do?'],
        }),
      ).verdict,
    ).toBe('needsInfo')
    expect(() => parseTriageFindings('{oops')).toThrow(UI_TEXT.watchdog.triage.unreadable)
  })
})

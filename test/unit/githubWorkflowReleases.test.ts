// The GitHub Actions workflow-runs and releases reader (M113 lane
// C-M113-6): the github source's `additional` port, built from the lead's
// N-captures handoff.
//
// Wire provenance (AGENTS.md rule 14):
// test/fixtures/m113/stores/github-workflow-release-runs/response.body.json
// (`release.yml` runs), github-releases-page1/response.body.json (bare
// release array) and github-tags-page1/response.body.json (tag to commit)
// are the live answers, byte-exact beside their receipts
// (test/unit/storeCaptures.test.ts). The port reads only the fields the
// captures evidence; refused shapes below are synthetic modifications of
// captured bodies, marked as such and never claimed as captures.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { REPORT_NETWORK_MAX_BYTES, REPORT_NETWORK_MAX_PAGES } from '../../src/shared/constants'
import { githubReportSource } from '../../src/core/reporting/sources/github'
import { githubWorkflowReleasesPort } from '../../src/core/reporting/sources/githubWorkflowReleases'
import { networkContext, networkRig } from './helpers/reportNetwork'

const TAGS: unknown = JSON.parse(
  readFileSync(
    new URL('../fixtures/m113/stores/github-tags-page1/response.body.json', import.meta.url),
    'utf8',
  ),
)
const RELEASES_PAGE_1: unknown = JSON.parse(
  readFileSync(
    new URL('../fixtures/m113/stores/github-releases-page1/response.body.json', import.meta.url),
    'utf8',
  ),
)
const RELEASE_RUNS: unknown = JSON.parse(
  readFileSync(
    new URL(
      '../fixtures/m113/stores/github-workflow-release-runs/response.body.json',
      import.meta.url,
    ),
    'utf8',
  ),
)

const BASE = 'https://api.github.com/repos/RandyNorthrup/muse-spark-code'
const options = {
  remote: 'https://github.com/RandyNorthrup/muse-spark-code.git',
  headSha: '82d50d5e456d17205623064b0a70caf8a6e34471',
  defaultBranch: 'main',
  releaseTag: 'v0.17.0',
}

function capturedTransport() {
  return vi.fn((request: { url: string }) => {
    if (request.url.includes('/pulls?')) return Promise.resolve(Response.json([]))
    if (request.url.includes('/check-runs?'))
      return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }))
    if (request.url.includes('/tags?')) return Promise.resolve(Response.json(TAGS))
    if (request.url.includes('/releases?')) return Promise.resolve(Response.json(RELEASES_PAGE_1))
    if (request.url.includes('/actions/workflows/release.yml/runs?'))
      return Promise.resolve(Response.json(RELEASE_RUNS))
    throw new Error(`unexpected request ${request.url}`)
  })
}

describe('github workflow and releases port', () => {
  it('reads tag commits, final releases and release-tag runs from the captures', async () => {
    const transport = capturedTransport()
    // Production bounds: the full github read (pulls, three check scopes,
    // tags, releases, runs) fits the shipped page and byte budget.
    const rig = networkRig({
      transport,
      maxBytes: REPORT_NETWORK_MAX_BYTES,
      maxPages: REPORT_NETWORK_MAX_PAGES,
    })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: githubWorkflowReleasesPort(),
    }).read(networkContext())
    expect(result.record.status).toBe('ok')
    expect(result.data?.releases).toHaveLength(2)
    // The source orders releases by version independently of page order.
    expect(result.data?.releases[0]).toMatchObject({
      version: 'v0.16.0',
      commit: '4da4ef666cf7a70e8b261283a9168c63b8b45a76',
      at: '2026-10-08T06:17:46Z',
    })
    expect(result.data?.releases[1]).toMatchObject({
      version: 'v0.17.0',
      commit: '82d50d5e456d17205623064b0a70caf8a6e34471',
      at: '2026-10-10T07:42:19Z',
    })
    expect(result.data?.releases[1]?.assets).toHaveLength(16)
    // The source sorts asset names independently of wire order.
    expect(result.data?.releases[1]?.assets[0]).toBe('SHA256SUMS')
    expect(result.data?.releases[1]?.assets).toContain('exec-event-output-schema-v1.schema.json')
    // Runs sort by ref key independently of wire order.
    expect(result.data?.runs).toEqual([
      {
        ref: { kind: 'release-tag', name: 'v0.16.0' },
        sha: '4da4ef666cf7a70e8b261283a9168c63b8b45a76',
        workflow: 'Release',
        conclusion: 'success',
        url: 'https://github.com/RandyNorthrup/muse-spark-code/actions/runs/37736641658',
      },
      {
        ref: { kind: 'release-tag', name: 'v0.17.0' },
        sha: '82d50d5e456d17205623064b0a70caf8a6e34471',
        workflow: 'Release',
        conclusion: 'success',
        url: 'https://github.com/RandyNorthrup/muse-spark-code/actions/runs/38035245475',
      },
    ])
    const urls = transport.mock.calls.map((call) => call[0].url)
    expect(urls).toContain(`${BASE}/tags?per_page=100&page=1`)
    expect(urls).toContain(`${BASE}/releases?per_page=30&page=1`)
    expect(urls).toContain(`${BASE}/actions/workflows/release.yml/runs?per_page=100&page=1`)
    // Tags, one short releases page and one short runs page: no page 2.
    expect(urls.filter((url) => url.includes('page=2'))).toEqual([])
  })

  it('refuses honestly past the shared page bound instead of truncating', async () => {
    const transport = capturedTransport()
    // pulls (1) plus three check scopes (3) plus tags (1) leave room for
    // one releases page: the runs page refuses as page-bound.
    const rig = networkRig({ transport, maxBytes: REPORT_NETWORK_MAX_BYTES, maxPages: 6 })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: githubWorkflowReleasesPort(),
    }).read(networkContext())
    // Pulls and checks survive; the refused workflow/releases read leaves
    // empty facts with the bound named, never truncated rows.
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('page-bound')
    expect(result.data?.releases).toEqual([])
    expect(result.data?.runs).toEqual([])
  })

  it.each<[string, string, { runs?: object[] }, { releases?: object[] }]>([
    [
      'a null run conclusion',
      'run-conclusion-required',
      {
        runs: [
          { ...(RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs[0], conclusion: null },
        ],
      },
      {},
    ],
    [
      'a run on an untagged branch',
      'run-release-tag-required',
      {
        runs: [
          {
            ...(RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs[0],
            head_branch: 'main',
          },
        ],
      },
      {},
    ],
    [
      'a draft release',
      'release-draft-refused',
      {},
      { releases: [{ ...(RELEASES_PAGE_1 as object[])[0], draft: true }] },
    ],
    [
      'a prerelease',
      'release-prerelease-refused',
      {},
      { releases: [{ ...(RELEASES_PAGE_1 as object[])[0], prerelease: true }] },
    ],
    [
      'a release whose tag names no commit',
      'release-commit-required',
      {},
      { releases: [{ ...(RELEASES_PAGE_1 as object[])[0], tag_name: 'v9.9.9' }] },
    ],
  ])(
    'refuses %s with its own reason instead of a guessed row',
    async (_label, reason, runPatch, releasePatch) => {
      // Synthetic modifications of captured bodies, never claimed as
      // captures: the refused shapes were not observed on the wire.
      const runsBody = {
        ...(RELEASE_RUNS as object),
        workflow_runs: runPatch.runs ?? (RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs,
      }
      const releasesBody = releasePatch.releases ?? RELEASES_PAGE_1
      const transport = vi.fn((request: { url: string }) => {
        if (request.url.includes('/pulls?')) return Promise.resolve(Response.json([]))
        if (request.url.includes('/check-runs?'))
          return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }))
        if (request.url.includes('/tags?')) return Promise.resolve(Response.json(TAGS))
        return Promise.resolve(
          Response.json(request.url.includes('/releases?') ? releasesBody : runsBody),
        )
      })
      const rig = networkRig({ transport, maxBytes: REPORT_NETWORK_MAX_BYTES })
      const result = await githubReportSource({
        ...options,
        reader: rig.reader,
        additional: githubWorkflowReleasesPort(),
      }).read(networkContext())
      expect(result.record.status).toBe('partial')
      expect(result.record.reason).toContain(reason)
      expect(result.data?.releases).toEqual([])
      expect(result.data?.runs).toEqual([])
    },
  )
})

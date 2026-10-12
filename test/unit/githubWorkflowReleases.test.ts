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
import { describe, expect, it } from 'vitest'
import { REPORT_NETWORK_MAX_BYTES, REPORT_NETWORK_MAX_PAGES } from '../../src/shared/constants'
import { githubReportSource } from '../../src/core/reporting/sources/github'
import { githubWorkflowReleasesPort } from '../../src/core/reporting/sources/githubWorkflowReleases'
import {
  githubCaptureTransport,
  githubReleaseCase,
  networkContext,
  networkRig,
  readGithubReleases,
} from './helpers/reportNetwork'

const {
  tags: TAGS,
  releasesPage1: RELEASES_PAGE_1,
  releaseRuns: RELEASE_RUNS,
  base: BASE,
  options,
} = githubReleaseCase('v0.17.0')

function capturedTransport() {
  return githubCaptureTransport({ tags: TAGS, releases: RELEASES_PAGE_1, runs: RELEASE_RUNS })
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
    const result = await readGithubReleases({ transport, options, maxPages: 6 })
    // Pulls, checks and the parsed releases survive; only the refused runs
    // read stays empty, with the bound named and never truncated rows.
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('page-bound')
    expect(result.data?.releases.map((release) => release.version)).toEqual(['v0.16.0', 'v0.17.0'])
    expect(result.data?.runs).toEqual([])
  })

  it('keeps parsed releases when the release-workflow read 404s', async () => {
    // Another repository names its own workflow file (the port reads only
    // `release.yml`): the 404 keeps the releases read before it.
    const transport = githubCaptureTransport({
      tags: TAGS,
      onUnknown: (request) =>
        request.url.includes('/releases?')
          ? Promise.resolve(Response.json(RELEASES_PAGE_1))
          : Promise.resolve(new Response('not found', { status: 404 })),
    })
    const result = await readGithubReleases({ transport, options })
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('http-404')
    expect(result.data?.releases.map((release) => release.version)).toEqual(['v0.16.0', 'v0.17.0'])
    expect(result.data?.runs).toEqual([])
  })

  it('parses the second captured releases page', async () => {
    // The page-2 capture (`per_page=2`) is served as the production
    // single short page: v0.15.0 joins its tag commit while v0.14.5 names
    // no captured tag, so that row stays partial with its reason and the
    // parsed row stays.
    const page2: unknown = JSON.parse(
      readFileSync(
        new URL(
          '../fixtures/m113/stores/github-releases-page2/response.body.json',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const transport = githubCaptureTransport({
      tags: TAGS,
      releases: page2,
      runs: RELEASE_RUNS,
    })
    const result = await readGithubReleases({ transport, options })
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('release-commit-required')
    expect(result.data?.releases).toEqual([
      {
        version: 'v0.15.0',
        commit: 'a715a834bd67560e422eda51bfb3cde5c4603e1a',
        at: '2026-10-07T21:08:04Z',
        assets: [
          'SHA256SUMS',
          'exec-event-v1.schema.json',
          'exec-result-v1.schema.json',
          'muse-spark-code-0.15.0.vsix',
          'muse-spark-code-acp-0.15.0.tgz',
          'muse-spark-code-acp.cdx.json',
          'muse-spark-code.cdx.json',
          'share-v1.schema.json',
        ],
      },
    ])
  })

  // RVCM1136B P2: one bad record spliced into the full captured bodies
  // keeps the other rows with the refusal named — THAT row is partial,
  // never the whole read. Synthetic modifications of captured bodies, never
  // claimed as captures: the refused shapes were not observed on the wire.
  it.each<{
    label: string
    reason: string
    runs: object[] | null
    releases: object[] | null
    versions: string[]
    runNames: string[]
  }>([
    {
      label: 'a null run conclusion',
      reason: 'run-conclusion-required',
      runs: [
        (RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs[0]!,
        {
          ...(RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs[1],
          conclusion: null,
        },
      ],
      releases: null,
      versions: ['v0.16.0', 'v0.17.0'],
      runNames: ['v0.17.0'],
    },
    {
      label: 'a run on an untagged branch',
      reason: 'run-release-tag-required',
      runs: [
        (RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs[0]!,
        {
          ...(RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs[1],
          head_branch: 'main',
        },
      ],
      releases: null,
      versions: ['v0.16.0', 'v0.17.0'],
      runNames: ['v0.17.0'],
    },
    {
      label: 'an unparseable run',
      reason: 'run-response-invalid',
      runs: [
        (RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs[0]!,
        { ...(RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs[1], head_sha: null },
      ],
      releases: null,
      versions: ['v0.16.0', 'v0.17.0'],
      runNames: ['v0.17.0'],
    },
    {
      label: 'a draft release',
      reason: 'release-draft-refused',
      runs: null,
      releases: [
        (RELEASES_PAGE_1 as object[])[0]!,
        { ...(RELEASES_PAGE_1 as object[])[1], draft: true },
      ],
      versions: ['v0.17.0'],
      runNames: ['v0.16.0', 'v0.17.0'],
    },
    {
      label: 'a prerelease',
      reason: 'release-prerelease-refused',
      runs: null,
      releases: [
        { ...(RELEASES_PAGE_1 as object[])[0], prerelease: true },
        (RELEASES_PAGE_1 as object[])[1]!,
      ],
      versions: ['v0.16.0'],
      runNames: ['v0.16.0', 'v0.17.0'],
    },
    {
      label: 'a release whose tag names no commit',
      reason: 'release-commit-required',
      runs: null,
      releases: [
        (RELEASES_PAGE_1 as object[])[0]!,
        { ...(RELEASES_PAGE_1 as object[])[1], tag_name: 'v9.9.9' },
      ],
      versions: ['v0.17.0'],
      runNames: ['v0.16.0', 'v0.17.0'],
    },
    {
      label: 'an unparseable release',
      reason: 'release-response-invalid',
      runs: null,
      releases: [
        (RELEASES_PAGE_1 as object[])[0]!,
        { ...(RELEASES_PAGE_1 as object[])[1], tag_name: 42 },
      ],
      versions: ['v0.17.0'],
      runNames: ['v0.16.0', 'v0.17.0'],
    },
  ])(
    '$label keeps the other rows with its own reason instead of a guessed row',
    async ({ reason, runs, releases, versions, runNames }) => {
      const runsBody = {
        ...(RELEASE_RUNS as object),
        workflow_runs: runs ?? (RELEASE_RUNS as { workflow_runs: object[] }).workflow_runs,
      }
      const releasesBody = releases ?? RELEASES_PAGE_1
      const transport = githubCaptureTransport({
        tags: TAGS,
        releases: releasesBody,
        runs: runsBody,
        onUnknown: () => Promise.resolve(Response.json(runsBody)),
      })
      const result = await readGithubReleases({ transport, options })
      expect(result.record.status).toBe('partial')
      expect(result.record.reason).toContain(reason)
      expect(result.data?.releases.map((release) => release.version)).toEqual(versions)
      expect(
        result.data?.runs
          .filter((run) => run.ref.kind === 'release-tag')
          .map((run) => run.ref.name),
      ).toEqual(runNames)
    },
  )
})

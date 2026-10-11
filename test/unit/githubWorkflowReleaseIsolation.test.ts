// RVCM1136D: every request inside the workflow/release read is isolated.
// For each request in the read's own sequence (each tag page, each release
// page, each run page), failing it in each way — HTTP error, invalid JSON,
// oversize body, timeout, refused host — keeps every other request's rows
// and names exactly the failed request in the partial reason. The request
// list below is the gate: a new request added to the read without a case
// fails `covers exactly the read's own request list`.
//
// Wire provenance (AGENTS.md rule 14): the page-2 bodies are the captured
// fixtures; the full page-1 bodies are synthetic fillers (marked as such,
// never claimed as captures) shaped like the captures so pagination
// advances past page 1 at the production page sizes.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  GITHUB_RELEASES_PAGE_SIZE,
  GITHUB_TAGS_PAGE_SIZE,
  GITHUB_WORKFLOW_RUNS_PAGE_SIZE,
  REPORT_NETWORK_MAX_BYTES,
  REPORT_NETWORK_MAX_PAGES,
} from '../../src/shared/constants'
import {
  githubReportSource,
  type ReportGitHubAdditionalPort,
} from '../../src/core/reporting/sources/github'
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
const HEAD_SHA = '82d50d5e456d17205623064b0a70caf8a6e34471'
const options = {
  remote: 'https://github.com/RandyNorthrup/muse-spark-code.git',
  headSha: HEAD_SHA,
  defaultBranch: 'main',
  releaseTag: 'v0.17.0',
}

// Synthetic full first pages (NOT captures): one filler element per
// production page slot so pagination advances to the captured short page.
function synthSha(index: number): string {
  return createHash('sha256')
    .update(`synth-tag-${String(index)}`)
    .digest('hex')
}
const SYNTH_TAG_NAMES = Array.from(
  { length: GITHUB_TAGS_PAGE_SIZE },
  (_, index) => `synth-tag-${String(index).padStart(3, '0')}`,
)
const TAGS_PAGE_1 = SYNTH_TAG_NAMES.map((name, index) => ({
  name,
  commit: { sha: synthSha(index) },
}))
const RELEASES_PAGE_1_SYNTH = SYNTH_TAG_NAMES.slice(0, GITHUB_RELEASES_PAGE_SIZE).map(
  (name, index) => ({
    tag_name: name,
    target_commitish: 'main',
    draft: false,
    prerelease: false,
    published_at: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    assets: [
      { name: `synth-asset-${String(index)}-a` },
      { name: `synth-asset-${String(index)}-b` },
    ],
  }),
)
const RUNS_PAGE_1_SYNTH = {
  total_count: GITHUB_WORKFLOW_RUNS_PAGE_SIZE,
  workflow_runs: SYNTH_TAG_NAMES.map((name, index) => ({
    name: 'Release',
    head_branch: name,
    head_sha: synthSha(index),
    conclusion: 'success',
    html_url: `https://github.com/RandyNorthrup/muse-spark-code/actions/runs/${String(90_000_000_000 + index)}`,
  })),
}

const URLS = {
  pulls: `${BASE}/pulls?state=all&per_page=100&page=1`,
  checksHead: `${BASE}/commits/${HEAD_SHA}/check-runs?per_page=100&page=1`,
  checksBranch: `${BASE}/commits/main/check-runs?per_page=100&page=1`,
  checksTag: `${BASE}/commits/v0.17.0/check-runs?per_page=100&page=1`,
  tags1: `${BASE}/tags?per_page=100&page=1`,
  tags2: `${BASE}/tags?per_page=100&page=2`,
  releases1: `${BASE}/releases?per_page=30&page=1`,
  releases2: `${BASE}/releases?per_page=30&page=2`,
  runs1: `${BASE}/actions/workflows/release.yml/runs?per_page=100&page=1`,
  runs2: `${BASE}/actions/workflows/release.yml/runs?per_page=100&page=2`,
} as const
const EXPECTED_URLS = Object.values(URLS).toSorted(compareStrings)
const HEALTHY: Record<string, unknown> = {
  [URLS.tags1]: TAGS_PAGE_1,
  [URLS.tags2]: TAGS,
  [URLS.releases1]: RELEASES_PAGE_1_SYNTH,
  [URLS.releases2]: RELEASES_PAGE_1,
  [URLS.runs1]: RUNS_PAGE_1_SYNTH,
  [URLS.runs2]: RELEASE_RUNS,
}

const CAPTURED_VERSIONS = ['v0.16.0', 'v0.17.0']
function compareStrings(a: string, b: string): number {
  return Number(a > b) - Number(a < b)
}
const SYNTH_VERSIONS = SYNTH_TAG_NAMES.slice(0, GITHUB_RELEASES_PAGE_SIZE).toSorted(compareStrings)
const SYNTH_RUN_NAMES = [...SYNTH_TAG_NAMES].toSorted(compareStrings)
const ALL_VERSIONS = [...SYNTH_VERSIONS, ...CAPTURED_VERSIONS].toSorted(compareStrings)
const ALL_RUN_NAMES = [...SYNTH_RUN_NAMES, ...CAPTURED_VERSIONS].toSorted(compareStrings)

interface IsolationCase {
  readonly target: string
  readonly label: string
  readonly reason: string
  readonly versions: string[]
  readonly runNames: string[]
  readonly invalidCode: string
}

const CASES: IsolationCase[] = [
  {
    target: URLS.tags1,
    label: 'tags-page-1',
    reason: 'tags-page-1',
    versions: CAPTURED_VERSIONS,
    runNames: CAPTURED_VERSIONS,
    invalidCode: 'tag-response-invalid',
  },
  {
    target: URLS.tags2,
    label: 'tags-page-2',
    reason: 'tags-page-2',
    versions: SYNTH_VERSIONS,
    runNames: SYNTH_RUN_NAMES,
    invalidCode: 'tag-response-invalid',
  },
  {
    target: URLS.releases1,
    label: 'releases-page-1',
    reason: 'releases-page-1',
    versions: CAPTURED_VERSIONS,
    runNames: ALL_RUN_NAMES,
    invalidCode: 'release-response-invalid',
  },
  {
    target: URLS.releases2,
    label: 'releases-page-2',
    reason: 'releases-page-2',
    versions: SYNTH_VERSIONS,
    runNames: ALL_RUN_NAMES,
    invalidCode: 'release-response-invalid',
  },
  {
    target: URLS.runs1,
    label: 'runs-page-1',
    reason: 'runs-page-1',
    versions: ALL_VERSIONS,
    runNames: CAPTURED_VERSIONS,
    invalidCode: 'run-response-invalid',
  },
  {
    target: URLS.runs2,
    label: 'runs-page-2',
    reason: 'runs-page-2',
    versions: ALL_VERSIONS,
    runNames: SYNTH_RUN_NAMES,
    invalidCode: 'run-response-invalid',
  },
]

function healthyTransport(fail?: { url: string; respond: () => Promise<Response> }) {
  return vi.fn((request: { url: string }) => {
    if (request.url === fail?.url) return fail.respond()
    const healthy = HEALTHY[request.url]
    if (healthy !== undefined) return Promise.resolve(Response.json(healthy))
    if (request.url.includes('/pulls?')) return Promise.resolve(Response.json([]))
    if (request.url.includes('/check-runs?'))
      return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }))
    // Past-end probes after a failed page read empty, exactly as the API
    // answers past the last page; the baseline gate below pins that a
    // healthy read never sends them.
    if (request.url.includes('/actions/workflows/'))
      return Promise.resolve(Response.json({ total_count: 0, workflow_runs: [] }))
    if (request.url.includes('/tags?') || request.url.includes('/releases?'))
      return Promise.resolve(Response.json([]))
    throw new Error(`unexpected request ${request.url}`)
  })
}

async function readWith(transport: ReturnType<typeof healthyTransport>, refuse?: string) {
  // Headroom for one past-end probe after a failed page; the baseline
  // gate pins that a healthy read stays within the production budget.
  const rig = networkRig({
    transport,
    maxBytes: REPORT_NETWORK_MAX_BYTES,
    maxPages: REPORT_NETWORK_MAX_PAGES + 2,
  })
  if (refuse !== undefined)
    vi.mocked(rig.deps.policy.allowEgress).mockImplementation((href: string) =>
      Promise.resolve(href !== refuse),
    )
  return {
    rig,
    result: await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: githubWorkflowReleasesPort(),
    }).read(networkContext()),
  }
}

describe('workflow and release request isolation', () => {
  it('covers exactly the read\u{2019}s own request list', async () => {
    // A new request added to the read (an asset read, a third page)
    // without a case below fails here: the observed set stops matching.
    const transport = healthyTransport()
    const { result } = await readWith(transport)
    expect(result.record.status).toBe('ok')
    expect(
      [...new Set(transport.mock.calls.map((call) => call[0].url))].toSorted(compareStrings),
    ).toEqual(EXPECTED_URLS)
  })

  // One property over the whole class: for each request in the sequence,
  // fail it in each of the five ways and assert every surviving
  // request's rows stay while the partial reason names exactly the failed
  // request (which page, which failure). Pagination continues past a
  // failed page, so only rows whose own page — or whose tag page — failed
  // are lost; both are recorded in CASES, never silently dropped: the
  // reason still names the failed page.
  it.each(
    CASES.flatMap((found) =>
      (
        [
          {
            way: 'http-error',
            code: 'http-500',
            respond: () => Promise.resolve(new Response('boom', { status: 500 })),
          },
          {
            way: 'invalid-json',
            code: found.invalidCode,
            respond: () => Promise.resolve(new Response('not json{', { status: 200 })),
          },
          {
            way: 'oversize-body',
            code: 'body-bound',
            respond: () =>
              Promise.resolve(
                new Response('x'.repeat(REPORT_NETWORK_MAX_BYTES + 1), { status: 200 }),
              ),
          },
          {
            way: 'timeout',
            code: 'source-failed',
            respond: () => Promise.reject(new Error('synthetic socket timeout')),
          },
          { way: 'refused-host', code: 'egress-refused', respond: null },
        ] satisfies {
          way: string
          code: string
          respond: (() => Promise<Response>) | null
        }[]
      ).map((failure) => ({
        name: `${found.label} (${failure.way})`,
        found,
        failure,
      })),
    ),
  )('a failed $name keeps the other rows and names exactly it', async ({ found, failure }) => {
    const fail =
      failure.respond === null ? undefined : { url: found.target, respond: failure.respond }
    const transport = healthyTransport(fail)
    const { result } = await readWith(
      transport,
      failure.respond === null ? found.target : undefined,
    )
    expect(result.record.status).toBe('partial')
    expect(result.record.reason?.split('; ') ?? []).toEqual([`${found.reason}: ${failure.code}`])
    expect(
      (result.data?.releases.map((release) => release.version) ?? []).toSorted(compareStrings),
    ).toEqual(found.versions)
    expect((result.data?.runs.map((run) => run.ref.name) ?? []).toSorted(compareStrings)).toEqual(
      found.runNames,
    )
    if (failure.way === 'refused-host')
      expect(transport.mock.calls.map((call) => call[0].url)).not.toContain(found.target)
  })
})

function tagTransport(tags: unknown) {
  return vi.fn((request: { url: string }) => {
    if (request.url.includes('/pulls?')) return Promise.resolve(Response.json([]))
    if (request.url.includes('/check-runs?'))
      return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }))
    if (request.url.includes('/tags?')) return Promise.resolve(Response.json(tags))
    if (request.url.includes('/releases?')) return Promise.resolve(Response.json(RELEASES_PAGE_1))
    if (request.url.includes('/actions/workflows/release.yml/runs?'))
      return Promise.resolve(Response.json(RELEASE_RUNS))
    throw new Error(`unexpected request ${request.url}`)
  })
}

describe('unparseable tag elements', () => {
  it('a corrupt tag keeps its own reason and is never blamed on another record', async () => {
    // The review's scenario verbatim: the first tag element has no commit
    // object, so v0.17.0 cannot join. Synthetic modification of the
    // captured tags body, never claimed as a capture.
    const tags = TAGS as { name: string; commit: { sha: string } }[]
    const corrupt = { name: tags[0]?.name ?? 'v0.17.0' }
    const transport = tagTransport([corrupt, tags[1], tags[2]])
    const rig = networkRig({ transport, maxBytes: REPORT_NETWORK_MAX_BYTES })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: githubWorkflowReleasesPort(),
    }).read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('tag-response-invalid')
    expect(result.record.reason).not.toContain('release-commit-required')
    expect(result.record.reason).not.toContain('run-release-tag-required')
    expect(result.data?.releases.map((release) => release.version)).toEqual(['v0.16.0'])
    expect(result.data?.runs.map((run) => run.ref.name)).toEqual(['v0.16.0'])
  })

  it('a corrupt extra tag beside joined tags is partial, never ok', async () => {
    const transport = tagTransport([...(TAGS as object[]), { bogus: true }])
    const rig = networkRig({ transport, maxBytes: REPORT_NETWORK_MAX_BYTES })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: githubWorkflowReleasesPort(),
    }).read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('tag-response-invalid')
    expect(result.data?.releases.map((release) => release.version)).toEqual(['v0.16.0', 'v0.17.0'])
    expect(result.data?.runs.map((run) => run.ref.name)).toEqual(['v0.16.0', 'v0.17.0'])
  })
})

describe('strict-assembly rows', () => {
  it('a row failing the strict fact shape is skipped while the other rows stay', async () => {
    // The port's loose shapes accept these; the strict fact shapes do
    // not (`at` must be an offset datetime, run `url` a URL). Synthetic
    // rows, never claimed as captures.
    const stub: ReportGitHubAdditionalPort = {
      read: () =>
        Promise.resolve({
          runs: [
            {
              ref: { kind: 'release-tag', name: 'v0.17.0' },
              sha: HEAD_SHA,
              workflow: 'Release',
              conclusion: 'success',
              url: 'https://github.com/RandyNorthrup/muse-spark-code/actions/runs/1',
            },
            {
              ref: { kind: 'release-tag', name: 'v0.16.0' },
              sha: HEAD_SHA,
              workflow: 'Release',
              conclusion: 'success',
              url: 'not a url',
            },
          ],
          releases: [
            {
              version: 'v0.17.0',
              commit: HEAD_SHA,
              at: '2026-10-10T07:42:19Z',
              assets: ['SHA256SUMS'],
            },
            { version: 'v0.16.0', commit: HEAD_SHA, at: 'yesterday', assets: [] },
          ],
          reasons: [],
        }),
    }
    const transport = vi.fn((request: { url: string }) => {
      if (request.url.includes('/pulls?')) return Promise.resolve(Response.json([]))
      if (request.url.includes('/check-runs?'))
        return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }))
      throw new Error(`unexpected request ${request.url}`)
    })
    const rig = networkRig({ transport, maxBytes: REPORT_NETWORK_MAX_BYTES })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: stub,
    }).read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('release-response-invalid')
    expect(result.record.reason).toContain('run-response-invalid')
    expect(result.record.reason).not.toContain('workflow-releases-unavailable')
    expect(result.data?.releases.map((release) => release.version)).toEqual(['v0.17.0'])
    expect(result.data?.runs.map((run) => run.ref.name)).toEqual(['v0.17.0'])
  })
})

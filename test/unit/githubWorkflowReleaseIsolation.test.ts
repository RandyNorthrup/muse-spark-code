// RVCM1136E: fault injection over every source-read boundary, at the
// production request cap. A failed page ends its endpoint; admitted rows
// and reasons survive all other failures. Observed requests must match
// executable cases exactly; the AST inventory also counts repeated calls.
//
// Wire provenance (AGENTS.md rule 14): the page-2 bodies are the captured
// fixtures; the full page-1 bodies are synthetic fillers (marked as such,
// never claimed as captures) shaped like the captures so pagination
// advances past page 1 at the production page sizes.
import * as z from 'zod/mini'
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  GITHUB_RELEASES_PAGE_SIZE,
  GITHUB_TAGS_PAGE_SIZE,
  GITHUB_WORKFLOW_RUNS_PAGE_SIZE,
  REPORT_NETWORK_MAX_BYTES,
  REPORT_NETWORK_MAX_PAGES,
  REPORT_MAX_ROWS,
} from '../../src/shared/constants'
import {
  githubReportSource,
  type ReportGitHubAdditionalPort,
} from '../../src/core/reporting/sources/github'
import { githubWorkflowReleasesPort } from '../../src/core/reporting/sources/githubWorkflowReleases'
import { CAPTURED_PULL_LIST } from './helpers/githubCapture'
import {
  githubCaptureTransport,
  githubEmptyReads,
  githubReleaseCase,
  networkContext,
  networkRig,
  readGithubReleases,
  recordingTransport,
  type TransportRecorder,
} from './helpers/reportKindNetwork'

const {
  tags: TAGS,
  releasesPage1: RELEASES_PAGE_1,
  releaseRuns: RELEASE_RUNS,
  base: BASE,
  headSha: HEAD_SHA,
  options,
} = githubReleaseCase()

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
  checksHead2: `${BASE}/commits/${HEAD_SHA}/check-runs?per_page=100&page=2`,
  tags1: `${BASE}/tags?per_page=100&page=1`,
  tags2: `${BASE}/tags?per_page=100&page=2`,
  releases1: `${BASE}/releases?per_page=30&page=1`,
  releases2: `${BASE}/releases?per_page=30&page=2`,
  runs1: `${BASE}/actions/workflows/release.yml/runs?per_page=100&page=1`,
  runs2: `${BASE}/actions/workflows/release.yml/runs?per_page=100&page=2`,
} as const
const HEAD_CHECKS = SYNTH_TAG_NAMES.map((name, index) => ({
  name,
  head_sha: HEAD_SHA,
  conclusion: 'success',
  html_url: `https://github.com/RandyNorthrup/muse-spark-code/actions/runs/${String(index + 1)}`,
}))
const HEAD_TAIL = {
  ...HEAD_CHECKS[0],
  name: 'tail-check',
  html_url: 'https://github.com/RandyNorthrup/muse-spark-code/actions/runs/200',
}
const HEALTHY: Record<string, unknown> = {
  [URLS.pulls]: CAPTURED_PULL_LIST,
  [URLS.checksHead]: { total_count: 101, check_runs: HEAD_CHECKS },
  [URLS.checksHead2]: { total_count: 101, check_runs: [HEAD_TAIL] },
  [URLS.checksBranch]: { total_count: 1, check_runs: [HEAD_CHECKS[0]] },
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
  ...[
    { target: URLS.pulls, label: 'pulls-page-1', invalidCode: 'pull-response-invalid' },
    { target: URLS.checksHead, label: 'head-page-1', invalidCode: 'check-response-invalid' },
    { target: URLS.checksHead2, label: 'head-page-2', invalidCode: 'check-response-invalid' },
    {
      target: URLS.checksBranch,
      label: 'default-branch-page-1',
      invalidCode: 'check-response-invalid',
    },
  ].map((item) => ({
    ...item,
    reason: item.label,
    versions: ALL_VERSIONS,
    runNames: ALL_RUN_NAMES,
  })),
  {
    target: URLS.tags1,
    label: 'tags-page-1',
    reason: 'tags-page-1',
    versions: [],
    runNames: [],
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
    versions: [],
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
    runNames: [],
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
  return recordingTransport((request) => {
    if (request.url === fail?.url) return fail.respond()
    const healthy = HEALTHY[request.url]
    if (healthy !== undefined) return Promise.resolve(Response.json(healthy))
    const empty = githubEmptyReads(request)
    if (empty !== undefined) return empty
    // Bound tests may reach past-end pages; failed pages must never probe them.
    if (request.url.includes('/actions/workflows/'))
      return Promise.resolve(Response.json({ total_count: 0, workflow_runs: [] }))
    if (request.url.includes('/tags?') || request.url.includes('/releases?'))
      return Promise.resolve(Response.json([]))
    throw new Error(`unexpected request ${request.url}`)
  })
}

async function readWith(transport: TransportRecorder, refuse?: string) {
  const rig = networkRig({
    transport: transport.transport,
    maxBytes: REPORT_NETWORK_MAX_BYTES,
    maxPages: REPORT_NETWORK_MAX_PAGES,
  })
  if (refuse !== undefined) rig.setEgress((href) => Promise.resolve(href !== refuse))
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
      [...new Set(transport.calls.map((call) => call.request.url))].toSorted(compareStrings),
    ).toEqual(CASES.map((item) => item.target).toSorted(compareStrings))
    expect(new Set(CASES.map((item) => item.target)).size).toBe(CASES.length)
    expect(transport.calls).toHaveLength(CASES.length)
  })

  // Fault every dispatched request, including body read/decode and shape
  // failures. The failed endpoint stops, so unknown later pages are never
  // admitted; every other endpoint keeps its production request allowance.
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
          {
            way: 'null-body',
            code: 'body-missing',
            respond: () => Promise.resolve(new Response(null)),
          },
          {
            way: 'wrong-envelope',
            code: found.invalidCode,
            respond: () => Promise.resolve(Response.json(null)),
          },
          {
            way: 'invalid-utf8',
            code: found.invalidCode,
            respond: () => Promise.resolve(new Response(new Uint8Array([0xc3, 0x28]))),
          },
          {
            way: 'stream-error',
            code: found.invalidCode,
            respond: () =>
              Promise.resolve(
                new Response(
                  new ReadableStream({
                    start(controller) {
                      controller.error(new TypeError('synthetic stream failure'))
                    },
                  }),
                ),
              ),
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
    expect(
      (
        result.data?.runs
          .filter((run) => run.ref.kind === 'release-tag')
          .map((run) => run.ref.name) ?? []
      ).toSorted(compareStrings),
    ).toEqual(found.runNames)
    expect(result.data?.pullRequests).toHaveLength(
      found.target === URLS.pulls ? 0 : CAPTURED_PULL_LIST.length,
    )
    const headRows = found.target === URLS.checksHead2 ? HEAD_CHECKS.length : HEAD_CHECKS.length + 1
    expect(result.data?.runs.filter((run) => run.ref.kind === 'head')).toHaveLength(
      found.target === URLS.checksHead ? 0 : headRows,
    )
    expect(result.data?.runs.filter((run) => run.ref.kind === 'default-branch')).toHaveLength(
      found.target === URLS.checksBranch ? 0 : 1,
    )
    if (failure.way === 'refused-host')
      expect(transport.calls.map((call) => call.request.url)).not.toContain(found.target)
  })
})

function tagTransport(tags: unknown) {
  return githubCaptureTransport({ tags, releases: RELEASES_PAGE_1, runs: RELEASE_RUNS })
}

describe('unparseable tag elements', () => {
  it('a corrupt tag keeps its own reason and is never blamed on another record', async () => {
    // The review's scenario verbatim: the first tag element has no commit
    // object, so v0.17.0 cannot join. Synthetic modification of the
    // captured tags body, never claimed as a capture.
    const tags = z
      .array(z.object({ name: z.string(), commit: z.object({ sha: z.string() }) }))
      .parse(TAGS)
    const corrupt = { name: tags[0]?.name ?? 'v0.17.0' }
    const transport = tagTransport([corrupt, tags[1], tags[2]])
    const result = await readGithubReleases({ transport: transport.transport, options })
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('tag-response-invalid')
    expect(result.record.reason).not.toContain('release-commit-required')
    expect(result.record.reason).not.toContain('run-release-tag-required')
    expect(result.data?.releases.map((release) => release.version)).toEqual(['v0.16.0'])
    expect(result.data?.runs.map((run) => run.ref.name)).toEqual(['v0.16.0'])
  })

  it('a corrupt extra tag beside joined tags is partial, never ok', async () => {
    const transport = tagTransport([...z.array(z.unknown()).parse(TAGS), { bogus: true }])
    const result = await readGithubReleases({ transport: transport.transport, options })
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
    const transport = recordingTransport((request) => {
      if (request.url.includes('/pulls?')) return Promise.resolve(Response.json([]))
      if (request.url.includes('/check-runs?'))
        return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }))
      throw new Error(`unexpected request ${request.url}`)
    })
    const rig = networkRig({ transport: transport.transport, maxBytes: REPORT_NETWORK_MAX_BYTES })
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

// Enumerate validation/admission boundaries from the owned source, rather than
// the review. The executable cases below cover these names; adding another
// reader, parser or admission boundary requires a new case in this inventory.
const BOUNDARY_CASES = [
  'Array.isArray',
  'Array.isArray',
  'Array.isArray',
  'z.maxLength',
  'z.maxLength',
  'z.maxLength',
  'query',
  'query',
  'query',
  'options.reader.allowed',
  'options.reader.allowed',
  'options.reader.read',
  'options.additional.read',
  'schema.safeParse',
  'pullSchema.safeParse',
  'checkSchema.safeParse',
  'checkCountSchema.safeParse',
  'checksSchema.safeParse',
  'pageRowsSchema.safeParse',
  'additionalPortEnvelopeSchema.safeParse',
  'additionalReasonsSchema.safeParse',
  'element.safeParse',
  'z.looseObject({ name: z.string() }).safeParse',
  'z.array(z.unknown()).safeParse',
  'z.looseObject({ workflow_runs: z.array(z.unknown()) }).safeParse',
]

function validationInventory(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source)
      if (
        name === 'query' ||
        name === 'Array.isArray' ||
        name === 'z.maxLength' ||
        name.startsWith('options.reader.') ||
        name.endsWith('.read') ||
        name.endsWith('.allowed') ||
        /\.(?:safeParse|parse)$/.test(name)
      )
        names.push(name)
    }
    ts.forEachChild(node, visit)
  }
  // Posting and gh transport are outside this source read's boundary.
  for (const statement of source.statements) {
    if (file.endsWith('/github.ts') && statement.getText(source).startsWith('const exec =')) break
    visit(statement)
  }
  return [...names]
}

const GOOD_RELEASE = {
  version: 'v0.17.0',
  commit: HEAD_SHA,
  at: '2026-10-10T07:42:19Z',
  assets: [],
}
const GOOD_RUN = {
  ref: { kind: 'release-tag', name: 'v0.17.0' },
  sha: HEAD_SHA,
  workflow: 'Release',
  conclusion: 'success',
  url: 'https://github.com/RandyNorthrup/muse-spark-code/actions/runs/1',
}
async function readAdditional(value: unknown, isThrowing = false) {
  const transport = healthyTransport()
  const rig = networkRig({
    transport: transport.transport,
    maxBytes: REPORT_NETWORK_MAX_BYTES,
    maxPages: REPORT_NETWORK_MAX_PAGES,
  })
  const additional: ReportGitHubAdditionalPort = {
    read: () =>
      isThrowing
        ? Promise.reject(value instanceof Error ? value : new Error('adapter read failed'))
        : Promise.resolve(value),
  }
  const source = githubReportSource({ ...options, reader: rig.reader, additional })
  const result = await source.read(networkContext())
  expect(result.data?.pullRequests).toHaveLength(CAPTURED_PULL_LIST.length)
  expect(result.data?.runs.filter((run) => run.ref.kind === 'head')).toHaveLength(
    HEAD_CHECKS.length + 1,
  )
  return result
}

function pageBody(found: IsolationCase) {
  const body = HEALTHY[found.target]
  const object = z
    .looseObject({
      check_runs: z.optional(z.array(z.unknown())),
      workflow_runs: z.optional(z.array(z.unknown())),
    })
    .safeParse(body)
  const envelopeRows = object.success
    ? (object.data.check_runs ?? object.data.workflow_runs ?? [])
    : []
  const rows = Array.isArray(body) ? z.array(z.unknown()).parse(body) : envelopeRows
  const wrap = (items: unknown[]) =>
    Array.isArray(body)
      ? items
      : {
          ...(object.success && object.data),
          [found.target.includes('/check-runs?') ? 'check_runs' : 'workflow_runs']: items,
        }
  return { rows, wrap }
}

function readDamagedPage(found: IsolationCase, rows: unknown[]) {
  const { wrap } = pageBody(found)
  return readWith(
    healthyTransport({
      url: found.target,
      respond: () => Promise.resolve(Response.json(wrap(rows))),
    }),
  )
}

describe('all source read boundaries preserve admitted facts', () => {
  it('inventories every reader and validation call from the code', () => {
    const observed = [
      ...validationInventory('../../src/core/reporting/sources/github.ts'),
      ...validationInventory('../../src/core/reporting/sources/githubWorkflowReleases.ts'),
    ]
    const callableCases = BOUNDARY_CASES.filter((name) => name.includes('.') || name === 'query')
    expect([...observed].toSorted(compareStrings)).toEqual(callableCases.toSorted(compareStrings))
  })

  it.each([undefined, null, new TypeError('adapter read failed')])(
    'names an absent or failed adapter (%s)',
    async (value) => {
      const result = await readAdditional(value, value instanceof Error)
      expect(result.record.status).toBe('partial')
      expect(result.record.reason).toContain('workflow-releases-unavailable')
    },
  )

  it.each([
    { field: 'runs', reason: 'workflow-runs-unavailable' },
    { field: 'releases', reason: 'releases-unavailable' },
    { field: 'reasons', reason: 'workflow-release-reason-invalid' },
  ])('isolates the $field adapter facet including null/undefined', async ({ field, reason }) => {
    for (const absent of [undefined, null, 'invalid']) {
      const result = await readAdditional({
        runs: [GOOD_RUN],
        releases: [GOOD_RELEASE],
        reasons: ['already-recorded'],
        [field]: absent,
      })
      expect(result.record.status).toBe('partial')
      expect(result.record.reason).toContain(reason)
      if (field !== 'reasons') expect(result.record.reason).toContain('already-recorded')
      if (field !== 'runs') expect(result.data?.runs).toContainEqual(GOOD_RUN)
      if (field !== 'releases') expect(result.data?.releases).toEqual([GOOD_RELEASE])
    }
  })

  it('retains a valid empty adapter facet beside failed readers', async () => {
    const rig = networkRig({
      transport: recordingTransport(() => Promise.resolve(Response.json({ invented: true })))
        .transport,
    })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: {
        read: () => Promise.resolve({ runs: [], releases: [], reasons: ['already-recorded'] }),
      },
    }).read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('already-recorded')
    expect(result.record.reason).toContain('pulls-page-1: pull-response-invalid')
    expect(result.record.reason).toContain('head-page-1: check-response-invalid')
    expect(result.data).toEqual({ pullRequests: [], runs: [], releases: [] })
  })

  it('retains valid reason records beside an invalid one', async () => {
    const result = await readAdditional({
      runs: [GOOD_RUN],
      releases: [GOOD_RELEASE],
      reasons: ['already-recorded', null],
    })
    expect(result.record.reason).toContain('already-recorded')
    expect(result.record.reason).toContain('workflow-release-reason-invalid')
    expect(result.data?.releases).toEqual([GOOD_RELEASE])
  })

  it.each(['runs', 'releases'])(
    'enforces the $field row bound on admission before final validation',
    async (field) => {
      const rows =
        field === 'runs'
          ? Array.from({ length: REPORT_MAX_ROWS + 1 }, (_, index) => ({
              ...GOOD_RUN,
              url: `${GOOD_RUN.url}${String(index)}`,
            }))
          : Array.from({ length: REPORT_MAX_ROWS + 1 }, (_, index) => ({
              ...GOOD_RELEASE,
              version: `v${String(index)}`,
            }))
      const result = await readAdditional({
        runs: [GOOD_RUN],
        releases: [GOOD_RELEASE],
        reasons: ['already-recorded'],
        [field]: rows,
      })
      expect(result.record.status).toBe('partial')
      expect(result.record.reason).toContain(`${field}-row-bound`)
      expect(result.record.reason).toContain('already-recorded')
      expect(field === 'runs' ? result.data?.runs : result.data?.releases).toHaveLength(
        REPORT_MAX_ROWS,
      )
      if (field === 'runs') expect(result.data?.runs).not.toContainEqual(rows.at(-1))
      else expect(result.data?.releases).not.toContainEqual(rows.at(-1))
      if (field === 'runs') expect(result.data?.releases).toEqual([GOOD_RELEASE])
    },
  )

  it('keeps distinct facts whose identity text contains separators', async () => {
    const first = {
      ...GOOD_RUN,
      ref: { kind: 'release-tag', name: 'tag' },
      workflow: 'release/Build',
    }
    const second = {
      ...GOOD_RUN,
      ref: { kind: 'release-tag', name: 'tag/release' },
      workflow: 'Build',
    }
    const result = await readAdditional({
      runs: [first, second],
      releases: [GOOD_RELEASE],
      reasons: [],
    })
    expect(result.record.status).toBe('ok')
    expect(result.data?.runs).toContainEqual(first)
    expect(result.data?.runs).toContainEqual(second)
    expect(result.data?.releases).toEqual([GOOD_RELEASE])
  })

  it('names conflicting facts without discarding the accepted rows or reasons', async () => {
    const result = await readAdditional({
      runs: [GOOD_RUN],
      releases: [GOOD_RELEASE, { ...GOOD_RELEASE, commit: 'different' }],
      reasons: ['already-recorded'],
    })
    expect(result.record.reason).toContain('github-conflicting-fact')
    expect(result.record.reason).toContain('already-recorded')
    expect(result.data?.releases).toEqual([GOOD_RELEASE])
    expect(result.data?.runs).toContainEqual(GOOD_RUN)
  })

  let baseline: Awaited<ReturnType<typeof readWith>>
  beforeAll(async () => {
    baseline = await readWith(healthyTransport())
  })
  it.each(
    CASES.flatMap((found) =>
      pageBody(found).rows.map((_, index) => ({ found, index, label: found.label })),
    ),
  )('isolates record $index at $label', async ({ found, index }) => {
    const { rows } = pageBody(found)
    const damaged = rows.map((row, offset) => (offset === index ? null : row))
    const { result } = await readDamagedPage(found, damaged)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(found.invalidCode)
    if (found.target.includes('/tags?'))
      expect(result.record.reason?.split('; ')).toEqual(['tag-response-invalid'])
    const failed = z
      .looseObject({
        name: z.optional(z.string()),
        tag_name: z.optional(z.string()),
        head_branch: z.optional(z.string()),
        html_url: z.optional(z.string()),
        number: z.optional(z.number()),
      })
      .parse(rows[index])
    const isLostTag = found.target.includes('/tags?')
    expect(result.data?.releases).toEqual(
      baseline.result.data?.releases.filter(
        (row) =>
          !(isLostTag
            ? row.version === failed.name
            : found.target.includes('/releases?') && row.version === failed.tag_name),
      ),
    )
    expect(result.data?.pullRequests).toEqual(
      baseline.result.data?.pullRequests.filter(
        (row) => !(found.target.includes('/pulls?') && row.number === failed.number),
      ),
    )
    expect(result.data?.runs).toEqual(
      baseline.result.data?.runs.filter(
        (row) =>
          !(isLostTag && row.ref.kind === 'release-tag' && row.ref.name === failed.name) &&
          !(
            found.target.includes('/check-runs?') &&
            row.ref.kind === (found.label.startsWith('head') ? 'head' : 'default-branch') &&
            row.url === failed.html_url
          ) &&
          !(
            found.target.includes('/actions/workflows/') &&
            row.ref.kind === 'release-tag' &&
            row.url === failed.html_url
          ),
      ),
    )
  })
  it.each(
    CASES.filter((found) => found.target.includes('/releases?')).flatMap((found) =>
      pageBody(found).rows.flatMap((value, index) => {
        const release = z
          .looseObject({ tag_name: z.string(), assets: z.array(z.unknown()) })
          .parse(value)
        return release.assets.map((_, assetIndex) => ({
          found,
          release,
          index,
          assetIndex,
          label: found.label,
        }))
      }),
    ),
  )(
    'isolates asset $assetIndex in record $index at $label',
    async ({ found, release, index, assetIndex }) => {
      const { rows } = pageBody(found)
      const assets = release.assets.map((asset, offset) =>
        offset === assetIndex ? { invalid: true } : asset,
      )
      const damaged = rows.map((row, offset) => (offset === index ? { ...release, assets } : row))
      const { result } = await readDamagedPage(found, damaged)
      expect(result.record.reason).toBe('release-response-invalid')
      expect(result.data?.releases).toEqual(
        baseline.result.data?.releases.filter((row) => row.version !== release.tag_name),
      )
      expect(result.data?.runs).toEqual(baseline.result.data?.runs)
      expect(result.data?.pullRequests).toEqual(baseline.result.data?.pullRequests)
    },
  )

  it.each(CASES)('enforces the page row bound at $label', async (found) => {
    const { rows, wrap } = pageBody(found)
    const pageSize = found.target.includes('/releases?')
      ? GITHUB_RELEASES_PAGE_SIZE
      : GITHUB_WORKFLOW_RUNS_PAGE_SIZE
    const over = Array.from({ length: pageSize + 1 }, (_, index) => rows[index % rows.length])
    const { result } = await readWith(
      healthyTransport({
        url: found.target,
        respond: () => Promise.resolve(Response.json(wrap(over))),
      }),
    )
    expect(result.record.reason?.split('; ')).toEqual([`${found.label}: page-row-bound`])
    expect(result.data?.releases.map((row) => row.version).toSorted(compareStrings)).toEqual(
      found.target === URLS.tags1 || found.target === URLS.releases1
        ? SYNTH_VERSIONS
        : ALL_VERSIONS,
    )
    expect(
      result.data?.runs
        .filter((row) => row.ref.kind === 'release-tag')
        .map((row) => row.ref.name)
        .toSorted(compareStrings),
    ).toEqual(
      found.target === URLS.tags1 || found.target === URLS.runs1 ? SYNTH_RUN_NAMES : ALL_RUN_NAMES,
    )
    expect(result.data?.pullRequests).toHaveLength(CAPTURED_PULL_LIST.length)
    expect(result.data?.runs.filter((row) => row.ref.kind === 'head')).toHaveLength(
      found.target === URLS.checksHead ? 100 : 101,
    )
  })

  // NOTE (MSM113FIX): the former 'isolates a query exception' cases are
  // gone. They swapped the reader's query for a throwing stand-in, which is
  // unrepresentable through the real reader. The identical observable (that
  // page's invalidCode, every other row kept) is still proven for every
  // endpoint by the stream-error fault cases above, which drive the real
  // transport with an errored body stream.
})

describe('storage, metadata and request allowance boundaries', () => {
  it.each(
    CASES.flatMap((found) =>
      ['read', 'write'].map((stage) => ({ found, stage, label: found.label })),
    ),
  )('isolates cache $stage at $label', async ({ found, stage }) => {
    const transport = healthyTransport()
    const rig = networkRig({
      transport: transport.transport,
      maxBytes: REPORT_NETWORK_MAX_BYTES,
      maxPages: REPORT_NETWORK_MAX_PAGES,
    })
    rig.setEgress((url) => {
      if (url === found.target) {
        if (stage === 'read') {
          const read = rig.storage.read
          let isArmed = true
          rig.storage.read = (signal) => {
            if (!isArmed) return read(signal)
            isArmed = false
            return Promise.reject(new TypeError('cache read failed'))
          }
        } else {
          const write = rig.storage.write
          let isArmed = true
          rig.storage.write = (entries, signal) => {
            if (!isArmed) return write(entries, signal)
            isArmed = false
            return Promise.reject(new TypeError('cache write failed'))
          }
        }
      }
      return Promise.resolve(true)
    })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: githubWorkflowReleasesPort(),
    }).read(networkContext())
    expect(result.record.reason).toContain(`${found.label}: ${found.invalidCode}`)
    expect(result.data?.releases.map((row) => row.version).toSorted(compareStrings)).toEqual(
      found.versions,
    )
    expect(
      result.data?.runs
        .filter((row) => row.ref.kind === 'release-tag')
        .map((row) => row.ref.name)
        .toSorted(compareStrings),
    ).toEqual(found.runNames)
  })
  it('preserves every earlier reason when a later body stream fails', async () => {
    const transport = healthyTransport({
      url: URLS.runs2,
      respond: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('body failed'))
              },
            }),
          ),
        ),
    })
    const healthy = transport.implementation
    transport.implementation = (request, etag, signal) =>
      request.url === URLS.releases2
        ? Promise.resolve(new Response(null, { status: 500 }))
        : healthy(request, etag, signal)
    const { result } = await readWith(transport)
    expect(result.record.reason?.split('; ')).toEqual([
      'releases-page-2: http-500',
      'runs-page-2: run-response-invalid',
    ])
    expect(result.data?.releases.map((row) => row.version).toSorted(compareStrings)).toEqual(
      SYNTH_VERSIONS,
    )
    expect(
      result.data?.runs
        .filter((row) => row.ref.kind === 'release-tag')
        .map((row) => row.ref.name)
        .toSorted(compareStrings),
    ).toEqual(SYNTH_RUN_NAMES)
  })
  it.each(CASES.map((found, index) => ({ found, cap: index + 1, label: found.label })))(
    'enforces the request bound after $label at admission',
    async ({ cap }) => {
      const transport = healthyTransport()
      const rig = networkRig({
        transport: transport.transport,
        maxBytes: REPORT_NETWORK_MAX_BYTES,
        maxPages: cap,
      })
      const result = await githubReportSource({
        ...options,
        reader: rig.reader,
        additional: githubWorkflowReleasesPort(),
      }).read(networkContext())
      expect(transport.calls).toHaveLength(cap)
      if (cap < REPORT_NETWORK_MAX_PAGES) expect(result.record.reason).toContain('page-bound')
      expect(result.data?.pullRequests).toHaveLength(CAPTURED_PULL_LIST.length)
      if (cap >= 8) expect(result.data?.releases).toHaveLength(32)
      if (cap >= 9)
        expect(result.data?.runs.filter((row) => row.ref.kind === 'release-tag')).toHaveLength(
          cap === 10 ? 102 : 100,
        )
    },
  )
  it('preserves check records when their pagination count is invalid', async () => {
    const { result } = await readWith(
      healthyTransport({
        url: URLS.checksHead2,
        respond: () =>
          Promise.resolve(Response.json({ total_count: null, check_runs: [HEAD_TAIL] })),
      }),
    )
    expect(result.record.reason).toContain('head-page-2: check-response-invalid')
    expect(result.data?.runs.filter((row) => row.ref.kind === 'head')).toHaveLength(101)
    expect(result.data?.releases).toHaveLength(32)
  })
})

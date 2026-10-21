// RVCM1136B P1 class guard: EVERY adapter bound by createReportingNetwork
// (the three store channels plus the workflow/release port) must survive the
// production transport and reader. The only boundary replaced is the public
// fetch, injected with the committed captures; no hand-built reader factory.
//
// - Stores run on the real CLI composition (no surface transport at all, so
//   the `gh` fallback is never addressed by a store read).
// - GitHub runs on the real editor policy through the shared network rig
//   with a capture-serving GitHub lane shaped like the credential-owning
//   fetch (GitHub URLs only; anything else throws, so a misrouted request
//   fails here). The origin remote comes from a real scratch git repo; only
//   reportGitIo's governed exec is out of scope (governance is admission's
//   own suites), never the git facts.
//
// A bound adapter the production transport refuses (method, host, content
// type, headers, body, size) comes back as an unavailable row and fails its
// table entry. Wire provenance (AGENTS.md rule 14): every body below is a
// committed capture, byte-exact beside its receipt (storeCaptures.test.ts).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_NETWORK_MAX_BYTES, REPORT_NETWORK_MAX_PAGES } from '../../src/shared/constants'
import { createReportingNetwork } from '../../src/runtime/reporting/network'
import type { ReportStoreProject } from '../../src/core/reporting/sources/storeProject'
import { githubReportSource } from '../../src/core/reporting/sources/github'
import { githubWorkflowReleasesPort } from '../../src/core/reporting/sources/githubWorkflowReleases'
import { networkContext, networkRig, recordingTransport } from './helpers/reportKindNetwork'

function capture(leaf: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/m113/stores/${leaf}/response.body.json`, import.meta.url),
      'utf8',
    ),
  )
}

const MARKETPLACE_ANSWER = capture('marketplace-extensionquery')
const OPENVsx_ANSWER = capture('openvsx-extension')
const NPM_ANSWER = capture('npm-latest')
const TAGS = capture('github-tags-page1')
const RELEASES_PAGE_1 = capture('github-releases-page1')
const RELEASE_RUNS = capture('github-workflow-release-runs')
const MARKETPLACE_REQUEST_FILE: { body: string } = JSON.parse(
  readFileSync(
    new URL('../fixtures/m113/stores/marketplace-extensionquery/request.json', import.meta.url),
    'utf8',
  ),
)
const MARKETPLACE_REQUEST_BODY = MARKETPLACE_REQUEST_FILE.body

const project: ReportStoreProject = {
  name: 'muse-spark-code',
  publisher: 'RandyNorthrup',
  engines: { vscode: '^1.99.0' },
  private: false,
  releaseVersion: '0.17.0',
}

interface SeenFetch {
  readonly url: string
  readonly init: {
    readonly method?: string
    readonly headers?: HeadersInit
    readonly body?: unknown
  }
}

const roots: string[] = []
const seenFetch: SeenFetch[] = []
const state: {
  storeStatus: string | undefined
  storeReason: string | null | undefined
  storeRows: { channel: string; version: string | null; status: string }[]
  githubStatus: string | undefined
  releases: { version: string; commit: string }[]
  runs: { name: string; conclusion: string | null }[]
} = {
  storeStatus: undefined,
  storeReason: undefined,
  storeRows: [],
  githubStatus: undefined,
  releases: [],
  runs: [],
}

async function scratch(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'report-production-transport-'))
  roots.push(root)
  return root
}

function policy(surface: 'editor' | 'terminal') {
  return {
    surface,
    mode: 'always' as const,
    githubSignedIn: true,
    allowEgress: () => Promise.resolve(true),
  }
}

// Only the public fetch is injected: every committed capture, keyed by
// the exact request the production transport must be able to send.
const fetchPublic: typeof fetch = (input, init = {}) => {
  let url: string
  if (typeof input === 'string') url = input
  else if (input instanceof URL) url = input.href
  else url = input.url
  seenFetch.push({ url, init })
  const headers = new Headers(init.headers)
  if (headers.has('authorization') || headers.has('cookie'))
    return Promise.reject(new Error(`credential leaked to ${url}`))
  if (url.startsWith('https://marketplace.visualstudio.com/'))
    return init.method !== 'POST' || init.body !== MARKETPLACE_REQUEST_BODY
      ? Promise.reject(new Error('marketplace request is not the captured form'))
      : Promise.resolve(Response.json(MARKETPLACE_ANSWER))
  if (url.startsWith('https://open-vsx.org/')) return Promise.resolve(Response.json(OPENVsx_ANSWER))
  return url.startsWith('https://registry.npmjs.org/')
    ? Promise.resolve(Response.json(NPM_ANSWER))
    : Promise.reject(new Error(`unexpected public fetch ${url}`))
}

beforeAll(async () => {
  // Stores on the CLI composition: no surface transport.
  const storeRoot = await scratch()
  const stores = createReportingNetwork(
    {
      workspaceRoot: storeRoot,
      storageRoot: path.join(storeRoot, 'data'),
      l10n: { table: EN, locale: 'en' },
      policy: policy('terminal'),
      fetchPublic,
    },
    {
      head: '82d50d5e456d17205623064b0a70caf8a6e34471',
      defaultBranch: 'main',
      commits: [],
      tags: [],
      branches: [],
      worktrees: [],
    },
    project,
  )
  const storeResult = await stores.stores.read(networkContext())
  state.storeStatus = storeResult.record.status
  state.storeReason = storeResult.record.reason
  state.storeRows = (storeResult.data ?? []).map((row) => ({
    channel: row.channel,
    version: row.version,
    status: row.status,
  }))

  // GitHub on the real editor policy: the injected lane serves the GitHub
  // captures and refuses anything off api.github.com, like the real
  // credential-owning fetch. The origin remote is read from a real scratch
  // repo with the real git binary.
  const gitRoot = await scratch()
  execFileSync('git', ['init'], { cwd: gitRoot, stdio: 'ignore' })
  execFileSync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/RandyNorthrup/muse-spark-code.git'],
    {
      cwd: gitRoot,
      stdio: 'ignore',
    },
  )
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: gitRoot,
    encoding: 'utf8',
  }).trim()
  const githubLane = recordingTransport((request) => {
    if (!request.url.startsWith('https://api.github.com/'))
      return Promise.reject(new Error(`github lane addressed ${request.url}`))
    if (request.url.includes('/pulls?')) return Promise.resolve(Response.json([]))
    if (request.url.includes('/check-runs?'))
      return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }))
    if (request.url.includes('/tags?')) return Promise.resolve(Response.json(TAGS))
    if (request.url.includes('/releases?')) return Promise.resolve(Response.json(RELEASES_PAGE_1))
    return request.url.includes('/actions/workflows/release.yml/runs?')
      ? Promise.resolve(Response.json(RELEASE_RUNS))
      : Promise.reject(new Error(`unexpected github request ${request.url}`))
  })
  const rig = networkRig({
    transport: githubLane.transport,
    maxBytes: REPORT_NETWORK_MAX_BYTES,
    maxPages: REPORT_NETWORK_MAX_PAGES,
    policy: policy('editor'),
  })
  const githubResult = await githubReportSource({
    remote,
    headSha: '82d50d5e456d17205623064b0a70caf8a6e34471',
    defaultBranch: 'main',
    reader: rig.reader,
    additional: githubWorkflowReleasesPort(),
  }).read(networkContext())
  state.githubStatus = githubResult.record.status
  state.releases = (githubResult.data?.releases ?? []).map((release) => ({
    version: release.version,
    commit: release.commit,
  }))
  state.runs = (githubResult.data?.runs ?? [])
    .filter((run) => run.ref.kind === 'release-tag')
    .map((run) => ({ name: run.ref.name, conclusion: run.conclusion }))
})

afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('production report transport (RVCM1136B P1)', () => {
  it.each<[string, string]>([
    ['Marketplace', '0.17.0'],
    ['Open VSX', '0.17.0'],
    ['npm', '0.17.0'],
  ])('%s parses its captured row through the production transport', (channel, version) => {
    // A refusal names its cause: a bare status says nothing about why.
    expect(state.storeStatus, `stores: ${String(state.storeReason)}`).toBe('ok')
    expect(state.storeRows.find((row) => row.channel === channel)).toEqual({
      channel,
      version,
      status: 'current',
    })
  })

  it('sends the captured marketplace query form with no credential', () => {
    const marketplace = seenFetch.filter((seen) =>
      seen.url.startsWith('https://marketplace.visualstudio.com/'),
    )
    expect(marketplace).toHaveLength(1)
    expect(marketplace[0]).toMatchObject({
      init: { method: 'POST', body: MARKETPLACE_REQUEST_BODY },
    })
  })

  it('reads release tags to commits through the production transport', () => {
    expect(state.githubStatus).toBe('ok')
    expect(state.releases).toEqual([
      { version: 'v0.16.0', commit: '4da4ef666cf7a70e8b261283a9168c63b8b45a76' },
      { version: 'v0.17.0', commit: '82d50d5e456d17205623064b0a70caf8a6e34471' },
    ])
  })

  it('reads release-workflow runs as release-tag facts through the production transport', () => {
    expect(state.githubStatus).toBe('ok')
    expect(state.runs).toEqual([
      { name: 'v0.16.0', conclusion: 'success' },
      { name: 'v0.17.0', conclusion: 'success' },
    ])
  })
})

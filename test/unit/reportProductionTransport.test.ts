// RVCM1136B P1 class guard: EVERY adapter bound by createReportingNetwork
// (the three store channels plus the workflow/release port) must survive the
// production transport and reader. The only boundary replaced is fetch,
// faked with the committed captures; no hand-built reader factory.
//
// - Stores run on the real CLI composition (no surface transport at all, so
//   the `gh` fallback is never addressed by a store read).
// - GitHub runs on the real editor composition with a capture-serving GitHub
//   lane shaped like the credential-owning fetch (GitHub URLs only; anything
//   else throws, so a misrouted request fails here).
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { createReportingNetwork } from '../../src/runtime/reporting/network'
import type { ReportStoreProject } from '../../src/core/reporting/sources/storeProject'
import { networkContext } from './helpers/reportKindNetwork'

// reportGitIo shells out through the resource launcher: the failure under
// test is routing, not process governance, so the direct bounded execFile
// fixture stands in, as in storeProject.test.ts.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/kindLaunch')
  return withFixtureCommand(await original())
})

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
  storeRows: { channel: string; version: string | null; status: string }[]
  githubStatus: string | undefined
  releases: { version: string; commit: string }[]
  runs: { name: string; conclusion: string | null }[]
} = { storeStatus: undefined, storeRows: [], githubStatus: undefined, releases: [], runs: [] }

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

beforeAll(async () => {
  // Only fetch is faked: every committed capture, keyed by the exact
  // request the production transport must be able to send.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: SeenFetch['init'] = {}) => {
      seenFetch.push({ url, init })
      const headers = new Headers(init.headers)
      if (headers.has('authorization') || headers.has('cookie'))
        return Promise.reject(new Error(`credential leaked to ${url}`))
      if (url.startsWith('https://marketplace.visualstudio.com/'))
        return init.method !== 'POST' || init.body !== MARKETPLACE_REQUEST_BODY
          ? Promise.reject(new Error('marketplace request is not the captured form'))
          : Promise.resolve(Response.json(MARKETPLACE_ANSWER))
      if (url.startsWith('https://open-vsx.org/'))
        return Promise.resolve(Response.json(OPENVsx_ANSWER))
      return url.startsWith('https://registry.npmjs.org/')
        ? Promise.resolve(Response.json(NPM_ANSWER))
        : Promise.reject(new Error(`unexpected public fetch ${url}`))
    }),
  )

  // Stores on the CLI composition: no surface transport.
  const storeRoot = await scratch()
  const stores = createReportingNetwork(
    {
      workspaceRoot: storeRoot,
      storageRoot: path.join(storeRoot, 'data'),
      l10n: { table: EN, locale: 'en' },
      policy: policy('terminal'),
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
  state.storeRows = (storeResult.data ?? []).map((row) => ({
    channel: row.channel,
    version: row.version,
    status: row.status,
  }))

  // GitHub on the editor composition: the injected lane serves the GitHub
  // captures and refuses anything off api.github.com, like the real
  // credential-owning fetch.
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
  const githubLane = vi.fn((request: { url: string }) => {
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
  const github = createReportingNetwork(
    {
      workspaceRoot: gitRoot,
      storageRoot: path.join(gitRoot, 'data'),
      l10n: { table: EN, locale: 'en' },
      policy: policy('editor'),
      transport: githubLane,
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
  const githubResult = await github.github.read(networkContext())
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
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('production report transport (RVCM1136B P1)', () => {
  it.each<[string, string]>([
    ['Marketplace', '0.17.0'],
    ['Open VSX', '0.17.0'],
    ['npm', '0.17.0'],
  ])('%s parses its captured row through the production transport', (channel, version) => {
    expect(state.storeStatus).toBe('ok')
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

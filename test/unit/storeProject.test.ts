// Workspace project binding for the stores source (M113 lane C-M113-6): the
// manifest parser, the network binding with and without a project, and the
// engine path from a workspace package.json to a live npm channel row.
//
// The registry bytes below reuse M97 lane R's verbatim capture shape
// (`version` read from a version document); only the version string differs,
// so no wire field is guessed.
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import {
  readStoreProject,
  reportStoreProject,
  type ReportStoreProject,
} from '../../src/core/reporting/sources/storeProject'
import { createReportingNetwork, routeReportTransport } from '../../src/runtime/reporting/network'
import { ReportNetworkFailure } from '../../src/core/reporting/sources/cache'
import { networkContext } from './helpers/reportNetwork'

// Report storage's own-process identity probe runs directly, as in
// reportEngine.test.ts.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureCommand(await original())
})

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function scratch(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'report-store-project-'))
  roots.push(root)
  return root
}

const project: ReportStoreProject = {
  name: 'fixture-pkg',
  publisher: 'fixture',
  engines: { vscode: '^1.99.0' },
  private: false,
  releaseVersion: '0.14.2',
}

function stubRegistry(version: string) {
  // RVCM1136B P1: the production transport now sends the bound gallery
  // channels down the public fetch too, so the fake answers them honestly
  // (404: this fixture was never published there) beside the npm document.
  const seen: string[] = []
  const fetch = vi.fn((url: string, _init?: { method?: string; body?: unknown }) => {
    seen.push(url)
    return Promise.resolve(
      url.startsWith('https://registry.npmjs.org/')
        ? Response.json({ version, url })
        : new Response('not published', { status: 404 }),
    )
  })
  vi.stubGlobal('fetch', fetch)
  return { seen, fetch }
}

const GALLERY_URLS = [
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1',
  'https://open-vsx.org/api/fixture/fixture-pkg',
]

describe('reportStoreProject', () => {
  it('reads a full extension manifest', () => {
    expect(
      reportStoreProject({
        name: 'fixture-pkg',
        version: '0.14.2',
        publisher: 'fixture',
        engines: { vscode: '^1.99.0' },
        private: false,
        scripts: {},
      }),
    ).toEqual(project)
  })

  it('reads a name and version alone as an npm-only project', () => {
    expect(reportStoreProject({ name: 'fixture-pkg', version: '0.14.2' })).toEqual({
      name: 'fixture-pkg',
      releaseVersion: '0.14.2',
    })
  })

  it.each([
    undefined,
    null,
    42,
    'fixture-pkg',
    [],
    { name: '', version: '0.14.2' },
    {
      name: 'fixture-pkg',
    },
    { name: 'fixture-pkg', version: '' },
    { name: 'fixture-pkg', version: 14 },
  ])('leaves %p unbound instead of guessing', (manifest) => {
    expect(reportStoreProject(manifest)).toBeUndefined()
  })
})

describe('reporting network store binding', () => {
  // RVCM1136 P1: these tests drive the production composition —
  // `createReportingNetwork`, the factory the engine actually binds — up to a
  // fake HTTP boundary (stubbed fetch / a github-only surface transport), so
  // "bound but unreachable" cannot pass again. No hand-built reader factory.
  it('reads the npm channel live with a project, honestly missing the rest', async () => {
    const root = await scratch()
    const { seen } = stubRegistry('0.14.1')
    const bound = createReportingNetwork(
      {
        workspaceRoot: root,
        storageRoot: path.join(root, 'data'),
        l10n: { table: EN, locale: 'en' },
        policy: {
          surface: 'editor',
          mode: 'always',
          githubSignedIn: false,
          allowEgress: () => Promise.resolve(true),
        },
        transport: (request) =>
          request.url.startsWith('https://api.github.com/')
            ? Promise.resolve(Response.json({ value: 'github' }))
            : Promise.reject(new Error('refused')),
      },
      null,
      project,
    )
    const result = await bound.stores.read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.data?.map((row) => [row.channel, row.status, row.version])).toEqual([
      ['Marketplace', 'unavailable', null],
      ['Open VSX', 'unavailable', null],
      ['npm', 'lagging', '0.14.1'],
    ])
    // RVCM1136B P1: every bound channel reaches the public fetch now; the
    // galleries stay unavailable because the fake 404s them, not because the
    // transport refuses them.
    expect(result.data?.slice(0, 2).map((row) => row.reason)).toEqual(['http-404', 'http-404'])
    expect(seen).toEqual([...GALLERY_URLS, 'https://registry.npmjs.org/fixture-pkg/latest'])
  })

  it('fetches npm on the real CLI composition: no surface transport at all', async () => {
    // The CLI/ACP pass no transport, so the factory used to fall back to the
    // `gh` lane, which refuses the registry origin before `gh` ever runs.
    const root = await scratch()
    const { seen, fetch } = stubRegistry('0.14.1')
    const bound = createReportingNetwork(
      {
        workspaceRoot: root,
        storageRoot: path.join(root, 'data'),
        l10n: { table: EN, locale: 'en' },
        policy: {
          surface: 'terminal',
          mode: 'always',
          githubSignedIn: false,
          allowEgress: () => Promise.resolve(true),
        },
      },
      null,
      project,
    )
    const result = await bound.stores.read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.data?.map((row) => [row.channel, row.status, row.version])).toEqual([
      ['Marketplace', 'unavailable', null],
      ['Open VSX', 'unavailable', null],
      ['npm', 'lagging', '0.14.1'],
    ])
    expect(seen).toEqual([...GALLERY_URLS, 'https://registry.npmjs.org/fixture-pkg/latest'])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('fetches npm under whenSignedIn without a GitHub login', async () => {
    // The review's exact scenario: default network mode, editor surface, no
    // sign-in. npm is public, so the channel still resolves.
    const root = await scratch()
    const { seen } = stubRegistry('0.14.2')
    const bound = createReportingNetwork(
      {
        workspaceRoot: root,
        storageRoot: path.join(root, 'data'),
        l10n: { table: EN, locale: 'en' },
        policy: {
          surface: 'editor',
          mode: 'whenSignedIn',
          githubSignedIn: false,
          allowEgress: () => Promise.resolve(true),
        },
        transport: () => Promise.reject(new Error('refused')),
      },
      null,
      project,
    )
    const result = await bound.stores.read(networkContext())
    expect(result.data?.find((row) => row.channel === 'npm')).toMatchObject({
      status: 'current',
      version: '0.14.2',
    })
    expect(seen).toEqual([...GALLERY_URLS, 'https://registry.npmjs.org/fixture-pkg/latest'])
  })

  it('keeps GitHub on the surface lane and refuses any other host', async () => {
    // The GitHub sweep: its binding is unchanged, only addressed. Public
    // store hosts never reach the credential-owning lane; unknown hosts stay
    // refused.
    const github = vi.fn((_request: { url: string }, _etag: string | null) =>
      Promise.resolve(Response.json({ value: 'github' })),
    )
    const { fetch } = stubRegistry('0.14.1')
    const routed = routeReportTransport(github)
    const signal = new AbortController().signal
    const githubResponse = await routed(
      { url: 'https://api.github.com/repos/fixture/fixture/pulls?state=all' },
      '"etag"',
      signal,
    )
    expect(await githubResponse.json()).toEqual({ value: 'github' })
    expect(github).toHaveBeenCalledOnce()
    expect(github.mock.calls[0]?.slice(0, 2)).toEqual([
      { url: 'https://api.github.com/repos/fixture/fixture/pulls?state=all' },
      '"etag"',
    ])
    expect(fetch).not.toHaveBeenCalled()
    await routed({ url: 'https://registry.npmjs.org/fixture-pkg/latest' }, null, signal)
    expect(fetch).toHaveBeenCalledOnce()
    expect(github).toHaveBeenCalledOnce()
    // RVCM1136B P1: the galleries ride the same credential-free public
    // fetch, keeping the POST query form the capture evidences.
    await routed(
      {
        url: 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1',
        method: 'POST',
        body: '{"filters":[]}',
      },
      null,
      signal,
    )
    await routed({ url: 'https://open-vsx.org/api/fixture/fixture-pkg' }, null, signal)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(github).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{"filters":[]}' })
    await expect(
      routed({ url: 'https://example.com/package/latest' }, null, signal),
    ).rejects.toBeInstanceOf(ReportNetworkFailure)
    await expect(
      routed({ url: 'https://example.com/package/latest' }, null, signal),
    ).rejects.toThrow('gh-endpoint-refused')
  })

  it('stays unbound without a project, exactly as before', async () => {
    const root = await scratch()
    const transport = vi.fn((_request: { url: string }) =>
      Promise.resolve(Response.json({ version: '0.14.1', url: '' })),
    )
    const bound = createReportingNetwork(
      {
        workspaceRoot: root,
        storageRoot: path.join(root, 'data'),
        l10n: { table: EN, locale: 'en' },
        policy: {
          surface: 'editor',
          mode: 'always',
          githubSignedIn: false,
          allowEgress: () => Promise.resolve(true),
        },
        transport,
      },
      null,
    )
    const result = await bound.stores.read(networkContext())
    expect(result.record.status).toBe('unavailable')
    expect(result.data).toBeNull()
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('readStoreProject', () => {
  it('parses a declared manifest', async () => {
    await expect(
      readStoreProject(() =>
        Promise.resolve(
          JSON.stringify({ name: 'fixture-pkg', version: '0.14.2', publisher: 'fixture' }),
        ),
      ),
    ).resolves.toEqual({ name: 'fixture-pkg', publisher: 'fixture', releaseVersion: '0.14.2' })
  })

  it.each([
    ['a missing file', () => Promise.reject(new Error('missing'))],
    ['an unparsable file', () => Promise.resolve('not json {')],
    ['a manifest without identity', () => Promise.resolve(JSON.stringify({ scripts: {} }))],
  ])('leaves stores unbound on %s', async (_case, read) => {
    await expect(readStoreProject(read)).resolves.toBeUndefined()
  })
})

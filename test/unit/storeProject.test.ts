// Workspace project binding for the stores source (M113 lane C-M113-6): the
// manifest parser, the network binding with and without a project, and the
// engine path from a workspace package.json to an npm channel row.
//
// Wire provenance (AGENTS.md rule 14): the public fetch below serves only
// committed captures, byte-exact beside their receipts
// (`test/fixtures/m113/stores/<name>/`, captured 2026-10-11): the npm
// version document, the marketplace extensionquery answer and the Open VSX
// extension record, every one carrying version 0.17.0 for
// RandyNorthrup/muse-spark-code. The npm capture names muse-spark-code-acp;
// it is served here for the project's own latest document the way
// reportProductionTransport.test.ts serves it, since the adapter reads only
// `version`. A 404 body was never captured, so no gallery-404 shape is
// asserted beyond the reader's http-404 reason (openVsxStore.ts).
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readStoreProject,
  reportStoreProject,
  type ReportStoreProject,
} from '../../src/core/reporting/sources/storeProject'
import { routeReportTransport } from '../../src/runtime/reporting/network'
import { ReportNetworkFailure } from '../../src/core/reporting/sources/cache'
import {
  bindStoresNetwork,
  networkContext,
  readBoundChannelRows,
  recordingTransport,
} from './helpers/reportKindNetwork'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function scratch(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'report-store-project-'))
  roots.push(root)
  return root
}

// The project the captures were taken for: every captured row below carries
// its version 0.17.0.
const project: ReportStoreProject = {
  name: 'muse-spark-code',
  publisher: 'RandyNorthrup',
  engines: { vscode: '^1.99.0' },
  private: false,
  releaseVersion: '0.17.0',
}

function captureBody(leaf: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/m113/stores/${leaf}/response.body.json`, import.meta.url),
      'utf8',
    ),
  )
}

const NPM_CAPTURED = captureBody('npm-latest')
const MARKETPLACE_CAPTURED = captureBody('marketplace-extensionquery')
const OPEN_VSX_CAPTURED = captureBody('openvsx-extension')
const MARKETPLACE_REQUEST_FILE: { body: string } = JSON.parse(
  readFileSync(
    new URL('../fixtures/m113/stores/marketplace-extensionquery/request.json', import.meta.url),
    'utf8',
  ),
)
const MARKETPLACE_REQUEST_BODY = MARKETPLACE_REQUEST_FILE.body

interface PublicFetchCall {
  readonly url: string
  readonly init: RequestInit | undefined
}

// The public fetch answered from the committed captures, keyed by the exact
// request the production transport must be able to send. The marketplace
// only answers the captured POST query form: anything else is a request the
// capture does not evidence, so it fails here. An unlisted host is refused,
// like the production transport refuses it.
const CAPTURED_BY_HOST: readonly (readonly [string, unknown])[] = [
  ['https://open-vsx.org/', OPEN_VSX_CAPTURED],
  ['https://registry.npmjs.org/', NPM_CAPTURED],
]

function captureFetch() {
  const seen: string[] = []
  const calls: PublicFetchCall[] = []
  const fetchPublic: typeof fetch = (input, init = {}) => {
    let url: string
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    else url = input.url
    seen.push(url)
    calls.push({ url, init })
    if (url.startsWith('https://marketplace.visualstudio.com/')) {
      if (init.method !== 'POST' || init.body !== MARKETPLACE_REQUEST_BODY)
        throw new Error('marketplace request is not the captured form')
      return Promise.resolve(Response.json(MARKETPLACE_CAPTURED))
    }
    const found = CAPTURED_BY_HOST.find(([host]) => url.startsWith(host))
    if (found === undefined) throw new Error(`unexpected public fetch ${url}`)
    return Promise.resolve(Response.json(found[1]))
  }
  return { seen, calls, fetchPublic }
}

const GALLERY_URLS = [
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1',
  'https://open-vsx.org/api/RandyNorthrup/muse-spark-code',
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
    ).toEqual({
      name: 'fixture-pkg',
      publisher: 'fixture',
      engines: { vscode: '^1.99.0' },
      private: false,
      releaseVersion: '0.14.2',
    })
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
  // `createReportingNetwork`, the factory the engine actually binds — up to
  // an injected public fetch (plus a github-only surface transport), so
  // "bound but unreachable" cannot pass again. No hand-built reader factory.
  it('reads every captured channel row with a project, through the public fetch', async () => {
    const root = await scratch()
    const { seen, fetchPublic } = captureFetch()
    const bound = bindStoresNetwork({
      root,
      surface: 'editor',
      transport: (request) =>
        request.url.startsWith('https://api.github.com/')
          ? Promise.resolve(Response.json({ value: 'github' }))
          : Promise.reject(new Error('refused')),
      fetchPublic,
      project,
    })
    const result = await readBoundChannelRows(bound)
    // RVCM1136B P1: every bound channel reaches the public fetch now,
    // galleries included — the captured rows prove it, not a refusal.
    expect(result.data?.slice(0, 2).map((row) => row.reason)).toEqual([null, null])
    expect(seen).toEqual([...GALLERY_URLS, 'https://registry.npmjs.org/muse-spark-code/latest'])
  })

  it('fetches npm on the real CLI composition: no surface transport at all', async () => {
    // The CLI/ACP pass no transport, so the factory used to fall back to the
    // `gh` lane, which refuses the registry origin before `gh` ever runs.
    const root = await scratch()
    const { seen, calls, fetchPublic } = captureFetch()
    const bound = bindStoresNetwork({ root, surface: 'terminal', project, fetchPublic })
    await readBoundChannelRows(bound)
    expect(seen).toEqual([...GALLERY_URLS, 'https://registry.npmjs.org/muse-spark-code/latest'])
    expect(calls).toHaveLength(3)
  })

  it('fetches npm under whenSignedIn without a GitHub login', async () => {
    // The review's exact scenario: default network mode, editor surface, no
    // sign-in. npm is public, so the channel still resolves.
    const root = await scratch()
    const { seen, fetchPublic } = captureFetch()
    const bound = bindStoresNetwork({
      root,
      surface: 'editor',
      mode: 'whenSignedIn',
      transport: () => Promise.reject(new Error('refused')),
      fetchPublic,
      project,
    })
    const result = await bound.stores.read(networkContext())
    expect(result.data?.find((row) => row.channel === 'npm')).toMatchObject({
      status: 'current',
      version: '0.17.0',
    })
    expect(seen).toEqual([...GALLERY_URLS, 'https://registry.npmjs.org/muse-spark-code/latest'])
  })

  it('keeps GitHub on the surface lane and refuses any other host', async () => {
    // The GitHub sweep: its binding is unchanged, only addressed. Public
    // store hosts never reach the credential-owning lane; unknown hosts stay
    // refused.
    const github = recordingTransport(() => Promise.resolve(Response.json({ value: 'github' })))
    const { calls, fetchPublic } = captureFetch()
    const routed = routeReportTransport(github.transport, fetchPublic)
    const signal = new AbortController().signal
    const githubResponse = await routed(
      { url: 'https://api.github.com/repos/fixture/fixture/pulls?state=all' },
      '"etag"',
      signal,
    )
    expect(await githubResponse.json()).toEqual({ value: 'github' })
    expect(github.calls).toHaveLength(1)
    expect(github.calls[0]).toEqual({
      request: { url: 'https://api.github.com/repos/fixture/fixture/pulls?state=all' },
      etag: '"etag"',
    })
    expect(calls).toHaveLength(0)
    await routed({ url: 'https://registry.npmjs.org/fixture-pkg/latest' }, null, signal)
    expect(calls).toHaveLength(1)
    expect(github.calls).toHaveLength(1)
    // RVCM1136B P1: the galleries ride the same credential-free public
    // fetch, keeping the POST query form the capture evidences.
    await routed(
      {
        url: 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1',
        method: 'POST',
        body: MARKETPLACE_REQUEST_BODY,
      },
      null,
      signal,
    )
    await routed({ url: 'https://open-vsx.org/api/fixture/fixture-pkg' }, null, signal)
    expect(calls).toHaveLength(3)
    expect(github.calls).toHaveLength(1)
    expect(calls[1]?.init).toMatchObject({ method: 'POST', body: MARKETPLACE_REQUEST_BODY })
    await expect(
      routed({ url: 'https://example.com/package/latest' }, null, signal),
    ).rejects.toBeInstanceOf(ReportNetworkFailure)
    await expect(
      routed({ url: 'https://example.com/package/latest' }, null, signal),
    ).rejects.toThrow('gh-endpoint-refused')
  })

  it('stays unbound without a project, exactly as before', async () => {
    const root = await scratch()
    // The answer is never read (no project means no request); the capture
    // stands in only so no hand-built document sits in the file.
    const transport = recordingTransport(() => Promise.resolve(Response.json(NPM_CAPTURED)))
    const bound = bindStoresNetwork({ root, surface: 'editor', transport: transport.transport })
    const result = await bound.stores.read(networkContext())
    expect(result.record.status).toBe('unavailable')
    expect(result.data).toBeNull()
    expect(transport.calls).toHaveLength(0)
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

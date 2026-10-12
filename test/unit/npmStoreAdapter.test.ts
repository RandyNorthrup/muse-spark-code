// The npm channel adapter (M113 lane C-M113-6): the default npm adapter built
// from M97 lane R's verbatim capture, and the per-source acceptance behavior
// for every store/workflow/release path this lane can honestly exercise.
//
// Wire provenance: test/unit/fixtures/legalRegistry/npm-is-even-1.0.0.json is
// M97's live `GET https://registry.npmjs.org/is-even/1.0.0` response,
// verbatim (docs/certification/m97-r.md). It is served here as the fake
// registry's `/latest` document: `/latest` answers the same version-document
// shape, and only `version` is read. The C-M113-6 captures added real
// adapters for the sibling channels (marketplaceStoreAdapter,
// openVsxStoreAdapter) and the workflow/release port
// (githubWorkflowReleasesPort), each tested against its own fixture in its
// own file; uncaptured shapes stay refused, never guessed (AGENTS.md rule
// 14).
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { githubReportSource } from '../../src/core/reporting/sources/github'
import { CAPTURED_CHECKS_FAILED, CAPTURED_PULL_LIST } from './helpers/githubCapture'
import {
  encodeNpmPackageName,
  isNpmPackageName,
  npmStoreAdapter,
} from '../../src/core/reporting/sources/npmStore'
import { storesReportSource } from '../../src/core/reporting/sources/stores'
import {
  expectNpmPackageRequired,
  networkContext,
  networkRig,
  readStoresReport,
} from './helpers/reportNetwork'
import { REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'

const NPM_CAPTURED_DOC: unknown = JSON.parse(
  readFileSync(new URL('fixtures/legalRegistry/npm-is-even-1.0.0.json', import.meta.url), 'utf8'),
)
const NPM_URL = 'https://registry.npmjs.org/is-even/latest'
const npmOnly = { name: 'is-even', private: false }
const published = {
  name: 'fixture',
  publisher: 'fixture',
  engines: { vscode: '^1.99.0' },
  private: false,
}

function siblingAdapter(channel: 'Marketplace' | 'Open VSX', url: string) {
  return {
    channel,
    request: { url },
    schema: z.strictObject({ version: z.string(), url: z.url() }),
  }
}

function capturedNpm() {
  return vi.fn((_request: { url: string }) => Promise.resolve(Response.json(NPM_CAPTURED_DOC)))
}

describe('npm store adapter', () => {
  it('builds a credential-free GET for the package latest document', () => {
    expect(npmStoreAdapter('is-even')).toMatchObject({
      channel: 'npm',
      request: { url: NPM_URL },
    })
    expect(npmStoreAdapter('is-even').request).toEqual({ url: NPM_URL })
    expect(npmStoreAdapter('@types/node').request).toEqual({
      url: 'https://registry.npmjs.org/@types%2Fnode/latest',
    })
  })

  it('encodes scoped names in the registry captured form', () => {
    expect(encodeNpmPackageName('is-even')).toBe('is-even')
    expect(encodeNpmPackageName('@types/node')).toBe('@types%2Fnode')
  })

  it('encodes every @scope/name form with a bare @ and one encoded slash', () => {
    // Property over @scope/name forms (RVCM1136 P3): the scope and name keep
    // their own encoding; no character may shift the slash or borrow a scope.
    const scopes = ['types', 'a', 'my-scope', 's.cope', 's~cope', 's_cope', 'x%20y']
    const names = ['node', 'n', 'my-pkg', 'p.kg', 'p~kg', 'p_kg', 'a%b', 'x%2Fy']
    for (const scope of scopes)
      for (const name of names) {
        const encoded = encodeNpmPackageName(`@${scope}/${name}`)
        expect(encoded).toBe(`@${encodeURIComponent(scope)}%2F${encodeURIComponent(name)}`)
        expect(encoded.indexOf('%2F')).toBe(encoded.lastIndexOf('%2F'))
      }
  })

  it('never borrows a scope for a name without a leading @', () => {
    // RVCM1136 P3: `foo/bar` is not a scoped name; the encoder must not read
    // it as scope `foo` minus its first character.
    expect(encodeNpmPackageName('foo/bar')).toBe('foo%2Fbar')
    expect(encodeNpmPackageName('foo/bar')).not.toContain('@')
    expect(encodeNpmPackageName('@/bar')).toBe('@%2Fbar')
    expect(encodeNpmPackageName('plain')).toBe('plain')
  })

  it.each(['is-even', 'fixture-pkg', '@types/node', '@scope/name.test_~-', 'a'.repeat(214)])(
    'accepts %p as a requestable name',
    (name) => {
      expect(isNpmPackageName(name)).toBe(true)
      expect(npmStoreAdapter(name)).not.toHaveProperty('refused')
    },
  )

  it.each([
    '',
    ' '.repeat(3),
    'has space',
    'My Package',
    'MyPackage',
    'foo/bar',
    '.leading',
    '_leading',
    '@bad scope/name',
    '@/name',
    'trailing/',
    'a'.repeat(215),
  ])('refuses %p without requesting it', (name) => {
    expect(isNpmPackageName(name)).toBe(false)
    expect(npmStoreAdapter(name)).toMatchObject({ channel: 'npm', refused: 'npm-package-required' })
  })

  it('reports a refused name as an unavailable npm row, never a failed source', async () => {
    // Sibling channels succeed, so the refused npm row stays visible in the data.
    const transport = vi.fn((request: { url: string }) =>
      Promise.resolve(Response.json({ version: '1.0.0', url: request.url })),
    )
    const result = await readStoresReport({
      transport,
      project: published,
      releaseVersion: '1.0.0',
      adapters: [
        siblingAdapter('Marketplace', 'https://marketplace.visualstudio.com/fixture'),
        siblingAdapter('Open VSX', 'https://open-vsx.org/fixture'),
        npmStoreAdapter('My Package'),
      ],
    })
    expectNpmPackageRequired(result, transport)
    expect(transport.mock.calls.map((call) => call[0].url)).toEqual([
      'https://marketplace.visualstudio.com/fixture',
      'https://open-vsx.org/fixture',
    ])
  })

  it('names the refusal in the source reason when every channel is refused', async () => {
    const rig = networkRig()
    const result = await storesReportSource({
      reader: rig.reader,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('My Package')],
    }).read(networkContext())
    expect(result.record.status).toBe('unavailable')
    expect(result.data).toBeNull()
    expect(result.record.reason).toContain('npm: npm-package-required')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('parses the captured version document and reports a matching release current', async () => {
    const transport = capturedNpm()
    const result = await readStoresReport({
      transport,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('is-even')],
    })
    expect(result.record.status).toBe('ok')
    expect(result.data).toEqual([
      {
        channel: 'npm',
        version: '1.0.0',
        url: 'https://www.npmjs.com/package/is-even',
        status: 'current',
        reason: null,
      },
    ])
    expect(transport).toHaveBeenCalledOnce()
  })

  it('reports lag when the captured channel is older, current when newer', async () => {
    for (const [served, release, status] of [
      ['1.0.0', '1.0.1', 'lagging'],
      ['1.0.2', '1.0.1', 'current'],
    ] as const) {
      const rig = networkRig({
        transport: vi.fn(() =>
          Promise.resolve(Response.json({ ...(NPM_CAPTURED_DOC as object), version: served })),
        ),
      })
      const result = await storesReportSource({
        reader: rig.reader,
        project: npmOnly,
        releaseVersion: release,
        adapters: [npmStoreAdapter('is-even')],
      }).read(networkContext())
      expect(result.data?.[0]?.status).toBe(status)
    }
  })

  it('keeps live npm beside honestly missing Marketplace and Open VSX captures', async () => {
    const transport = capturedNpm()
    const rig = networkRig({ transport })
    const result = await storesReportSource({
      reader: rig.reader,
      project: published,
      releaseVersion: '0.14.2',
      adapters: [npmStoreAdapter('fixture')],
    }).read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.data?.map((row) => [row.channel, row.status])).toEqual([
      ['Marketplace', 'unavailable'],
      ['Open VSX', 'unavailable'],
      ['npm', 'current'],
    ])
    expect(result.record.reason).toBe('channels-unavailable')
    for (const channel of ['Marketplace', 'Open VSX'])
      expect(result.data?.find((row) => row.channel === channel)).toMatchObject({
        status: 'unavailable',
        version: null,
        reason: 'store-capture-required',
      })
    expect(transport).toHaveBeenCalledOnce()
    expect(transport.mock.calls[0]?.[0]).toEqual({
      url: 'https://registry.npmjs.org/fixture/latest',
    })
  })

  it('names a missing package and an invalid document without guessing', async () => {
    const missingTransport = vi.fn(() =>
      Promise.resolve(new Response('"Not Found"', { status: 404 })),
    )
    const missing = networkRig({ transport: missingTransport })
    const absent = await storesReportSource({
      reader: missing.reader,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('is-even')],
    }).read(networkContext())
    expect(absent.record.status).toBe('unavailable')
    expect(absent.record.reason).toContain('npm: http-404')
    expect(missingTransport).toHaveBeenCalledOnce()

    const rig = networkRig({
      transport: vi.fn(() => Promise.resolve(Response.json({ wrong: true }))),
    })

    const invalid = await storesReportSource({
      reader: rig.reader,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('is-even')],
    }).read(networkContext())
    expect(invalid.record.status).toBe('unavailable')
    expect(invalid.record.reason).toContain('npm: store-response-invalid')
  })

  it('makes no request when the network mode is off', async () => {
    const transport = capturedNpm()
    const base = networkRig()
    const rig = networkRig({ transport, policy: { ...base.deps.policy, mode: 'off' } })
    const result = await storesReportSource({
      reader: rig.reader,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('is-even')],
    }).read(networkContext())
    expect(result.record).toMatchObject({
      status: 'unavailable',
      reason: UI_TEXT.reportUi.networkOff,
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it('reuses the captured fact on 304 with its output schema', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(NPM_CAPTURED_DOC, { headers: { etag: '"npm1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const rig = networkRig({ transport })
    const options = {
      reader: rig.reader,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('is-even')],
    }
    const initial = await storesReportSource(options).read(networkContext())
    expect(initial.record.status).toBe('ok')
    const cached = await storesReportSource(options).read(networkContext())
    expect(cached.record).toMatchObject({ status: 'ok', freshness: { state: 'stale' } })
    expect(cached.data).toEqual(initial.data)
    expect(transport.mock.calls[1]?.[1]).toBe('"npm1"')
  })

  it('stops a refused registry dispatch and names the wait', async () => {
    const transport = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 429, headers: { 'retry-after': '60' } })),
    )
    const result = await readStoresReport({
      transport,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('is-even')],
    })
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toContain(
      fill(UI_TEXT.reportUi.rateLimitedUntil, {
        time: new Date(Date.parse(REPORT_FIXTURE_AS_OF) + 60_000).toISOString(),
      }),
    )
    expect(transport).toHaveBeenCalledOnce()
  })
})

describe('workflow and release paths without captures', () => {
  it('never reaches the workflow/release port when the network mode is off', async () => {
    const transport = capturedNpm()
    const base = networkRig()
    const rig = networkRig({ transport, policy: { ...base.deps.policy, mode: 'off' } })
    const additional = { read: vi.fn(() => Promise.resolve({ runs: [], releases: [] })) }
    const result = await githubReportSource({
      remote: 'https://github.com/fixture/fixture.git',
      headSha: 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5',
      defaultBranch: 'main',
      reader: rig.reader,
      additional,
    }).read(networkContext())
    expect(result.record).toMatchObject({
      status: 'unavailable',
      reason: UI_TEXT.reportUi.networkOff,
    })
    expect(additional.read).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('keeps pulls and checks while a failing workflow/release port stays honest', async () => {
    const transport = vi.fn((request: { url: string }) =>
      Promise.resolve(
        Response.json(
          request.url.includes('/pulls?') ? CAPTURED_PULL_LIST : CAPTURED_CHECKS_FAILED,
        ),
      ),
    )
    const rig = networkRig({ transport })
    const result = await githubReportSource({
      remote: 'https://github.com/fixture/fixture.git',
      headSha: 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5',
      defaultBranch: 'main',
      reader: rig.reader,
      additional: { read: () => Promise.reject(new Error('actions-capture-required')) },
    }).read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.data?.pullRequests).toHaveLength(1)
    expect(result.record.reason).toBe('workflow-releases-unavailable')
  })
})

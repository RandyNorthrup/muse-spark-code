// The npm channel adapter (M113 lane C-M113-6): the default npm adapter built
// from M97 lane R's verbatim capture, and the per-source acceptance behavior
// for every store/workflow/release path this lane can honestly exercise.
//
// Wire provenance: test/unit/fixtures/legalRegistry/npm-is-even-1.0.0.json is
// M97's live `GET https://registry.npmjs.org/is-even/1.0.0` response,
// verbatim (docs/certification/m97-r.md). It is served here as the fake
// registry's `/latest` document: `/latest` answers the same version-document
// shape, and only `version` is read. Marketplace, Open VSX, GitHub Actions
// workflow runs and GitHub releases have no approved capture on this lane, so
// they are covered only through their honest-unavailable ports, never through
// a guessed wire shape (AGENTS.md rule 14).
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { githubReportSource } from '../../src/core/reporting/sources/github'
import { CAPTURED_CHECKS_FAILED, CAPTURED_PULL_LIST } from './helpers/githubCapture'
import { encodeNpmPackageName, npmStoreAdapter } from '../../src/core/reporting/sources/npmStore'
import { storesReportSource } from '../../src/core/reporting/sources/stores'
import { networkContext, networkRig } from './helpers/reportNetwork'
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

  it.each(['', ' '.repeat(3), 'has space'])('rejects %p instead of requesting it', (name) => {
    expect(() => npmStoreAdapter(name)).toThrow('npm-package-required')
  })

  it('parses the captured version document and reports a matching release current', async () => {
    const transport = capturedNpm()
    const rig = networkRig({ transport })
    const result = await storesReportSource({
      reader: rig.reader,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('is-even')],
    }).read(networkContext())
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
    const rig = networkRig({ transport })
    const result = await storesReportSource({
      reader: rig.reader,
      project: npmOnly,
      releaseVersion: '1.0.0',
      adapters: [npmStoreAdapter('is-even')],
    }).read(networkContext())
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

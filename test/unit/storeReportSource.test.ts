import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  storesReportSource,
  type ReportStoreAdapter,
} from '../../src/core/reporting/sources/stores'
import { networkContext, networkRig } from './helpers/reportNetwork'

// Normalized application-port fakes, deliberately not claimed store captures.
const fact = z.strictObject({ version: z.string(), url: z.url() })
const adapters: ReportStoreAdapter[] = [
  {
    channel: 'Marketplace',
    request: {
      url: 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
      method: 'POST',
      body: '{}',
    },
    schema: fact,
  },
  {
    channel: 'Open VSX',
    request: { url: 'https://open-vsx.org/api/fixture/extension/latest' },
    schema: fact,
  },
  { channel: 'npm', request: { url: 'https://registry.npmjs.org/fixture/latest' }, schema: fact },
]
const project = {
  name: 'fixture',
  publisher: 'fixture',
  engines: { vscode: '^1.99.0' },
  private: false,
}

function healthyStores() {
  const transport = vi.fn((request: { url: string }) =>
    Promise.resolve(Response.json({ version: '0.14.2', url: request.url })),
  )
  return { ...networkRig({ transport }), transport }
}

describe('store report source', () => {
  it('reuses transformed store facts on 304 with their output schema', async () => {
    // Synthetic adapter-contract input, not a claimed npm wire capture.
    const url = 'https://registry.npmjs.org/fixture/latest'
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ wireVersion: '0.14.2' }, { headers: { etag: '"v1"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const rig = networkRig({ transport })
    const source = storesReportSource({
      reader: rig.reader,
      project: { name: 'fixture', private: false },
      releaseVersion: '0.14.2',
      adapters: [
        {
          channel: 'npm',
          request: { url },
          schema: z.pipe(
            z.strictObject({ wireVersion: z.string() }),
            z.transform(({ wireVersion }) => ({ version: wireVersion, url })),
          ),
        },
      ],
    })
    const initial = await source.read(networkContext())
    expect(initial.record.status).toBe('ok')
    expect(rig.entries()).toEqual([expect.objectContaining({ data: { version: '0.14.2', url } })])
    const cached = await source.read(networkContext())
    expect(cached.record).toMatchObject({ status: 'ok', freshness: { state: 'stale' } })
    expect(cached.data).toEqual(initial.data)
    expect(transport.mock.calls[1]?.[1]).toBe('"v1"')
    const metadata = z
      .array(z.object({ key: z.string(), etag: z.nullable(z.string()), observedAt: z.string() }))
      .parse(rig.entries())
    rig.replaceEntries(
      metadata.map((entry) => ({ ...entry, data: { version: '0.14.2', url: 'invalid' } })),
    )
    const corrupted = await source.read(networkContext())
    expect(corrupted.data).toBeNull()
    expect(corrupted.record).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('store-response-invalid'),
    })
  })

  it('reads only applicable public channels and exposes lag for Needs you', async () => {
    const transport = vi.fn((request: { url: string }) =>
      Promise.resolve(
        Response.json({
          version: request.url.includes('open-vsx') ? '0.14.1' : '0.14.2',
          url: request.url,
        }),
      ),
    )
    const rig = networkRig({ transport })
    const result = await storesReportSource({
      reader: rig.reader,
      project,
      releaseVersion: 'v0.14.2',
      adapters,
    }).read(networkContext())
    expect(result.record.status).toBe('ok')
    expect(result.data?.map((row) => [row.channel, row.status])).toEqual([
      ['Marketplace', 'current'],
      ['Open VSX', 'lagging'],
      ['npm', 'current'],
    ])
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['0.14.3', 'current'],
    ['0.14.2+build', 'current'],
    ['0.14.2-beta.2', 'lagging'],
    ['0.14.1', 'lagging'],
    ['malformed', 'unavailable'],
  ] as const)('compares channel %s honestly as %s', async (version, status) => {
    const rig = networkRig({
      transport: vi.fn(() =>
        Promise.resolve(Response.json({ version, url: 'https://registry.npmjs.org/fixture' })),
      ),
    })
    const result = await storesReportSource({
      reader: rig.reader,
      project,
      releaseVersion: '0.14.2',
      adapters,
    }).read(networkContext())
    if (status === 'unavailable') expect(result.record.status).toBe('unavailable')
    else expect(result.data?.every((row) => row.status === status)).toBe(true)
  })

  it('does not request npm for a private extension', async () => {
    const { reader, transport } = healthyStores()
    const result = await storesReportSource({
      reader,
      project: { ...project, private: true },
      releaseVersion: '0.14.2',
      adapters,
    }).read(networkContext())
    expect(result.data?.map((row) => row.channel)).toEqual(['Marketplace', 'Open VSX'])
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('uses only npm for a non-extension public package', async () => {
    const { reader, transport } = healthyStores()
    const result = await storesReportSource({
      reader,
      project: { name: 'fixture', private: false },
      releaseVersion: '0.14.2',
      adapters,
    }).read(networkContext())
    expect(result.data?.map((row) => row.channel)).toEqual(['npm'])
    expect(transport).toHaveBeenCalledOnce()
  })

  it('reports a private non-extension as not applicable', async () => {
    const rig = networkRig()
    const observed18 = await storesReportSource({
      reader: rig.reader,
      project: { name: 'private', private: true },
      releaseVersion: '0.14.2',
      adapters,
    }).read(networkContext())
    expect(observed18.record.status).toBe('notApplicable')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('requires terminal opt-in for stores even with sign-in', async () => {
    const base = networkRig()
    const rig = networkRig({ policy: { ...base.deps.policy, surface: 'terminal' } })
    const observed19 = await storesReportSource({
      reader: rig.reader,
      project,
      releaseVersion: '0.14.2',
      adapters,
    }).read(networkContext(false))
    expect(observed19.record.status).toBe('unavailable')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('allows public stores under whenSignedIn without a GitHub login', async () => {
    const base = networkRig()
    const rig = networkRig({
      policy: { ...base.deps.policy, mode: 'whenSignedIn', githubSignedIn: false },
      transport: vi.fn((request: { url: string }) =>
        Promise.resolve(Response.json({ version: '0.14.2', url: request.url })),
      ),
    })
    const observed20 = await storesReportSource({
      reader: rig.reader,
      project,
      releaseVersion: '0.14.2',
      adapters,
    }).read(networkContext())
    expect(observed20.record.status).toBe('ok')
  })

  it('reports missing captured adapters explicitly without requesting guessed shapes', async () => {
    const rig = networkRig()
    const result = await storesReportSource({
      reader: rig.reader,
      project,
      releaseVersion: '0.14.2',
      adapters: [],
    }).read(networkContext())
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toContain('Marketplace: store-capture-required')
    expect(result.record.reason).toContain('Open VSX: store-capture-required')
    expect(result.record.reason).toContain('npm: store-capture-required')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('retains unavailable channel rows beside successful channels', async () => {
    const rig = networkRig({
      transport: vi.fn((request: { url: string }) =>
        Promise.resolve(
          request.url.includes('open-vsx')
            ? Response.json({ wrong: true })
            : Response.json({ version: '0.14.2', url: request.url }),
        ),
      ),
    })
    const result = await storesReportSource({
      reader: rig.reader,
      project,
      releaseVersion: '0.14.2',
      adapters,
    }).read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.data?.find((row) => row.channel === 'Open VSX')).toMatchObject({
      status: 'unavailable',
      version: null,
      reason: 'store-response-invalid',
    })
    expect(result.data).toHaveLength(3)
  })
})

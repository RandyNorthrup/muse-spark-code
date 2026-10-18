// The Open VSX channel adapter (M113 lane C-M113-6): the default adapter
// built from the lead's N-captures handoff.
//
// Wire provenance (AGENTS.md rule 14):
// test/fixtures/m113/stores/openvsx-extension/response.body.json is the
// live `GET https://open-vsx.org/api/RandyNorthrup/muse-spark-code` answer,
// byte-exact beside its receipt (test/unit/storeCaptures.test.ts). Only
// `version` is read. The 404 answer was not captured, so no 404 body shape
// is asserted: the reader reports the status itself as `http-404`.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openVsxStoreAdapter } from '../../src/core/reporting/sources/openVsxStore'
import { npmStoreAdapter } from '../../src/core/reporting/sources/npmStore'
import { readStoresReport, recordingTransport } from './helpers/reportKindNetwork'

const CAPTURED_RECORD: unknown = JSON.parse(
  readFileSync(
    new URL('../fixtures/m113/stores/openvsx-extension/response.body.json', import.meta.url),
    'utf8',
  ),
)

const project = {
  name: 'muse-spark-code',
  publisher: 'RandyNorthrup',
  engines: { vscode: '^1.99.0' },
  private: false,
}

describe('open vsx store adapter', () => {
  it('builds a credential-free GET for the workspace extension record', () => {
    const adapter = openVsxStoreAdapter('RandyNorthrup', 'muse-spark-code')
    expect(adapter).toMatchObject({
      channel: 'Open VSX',
      request: { url: 'https://open-vsx.org/api/RandyNorthrup/muse-spark-code' },
    })
    expect(adapter.request).toEqual({
      url: 'https://open-vsx.org/api/RandyNorthrup/muse-spark-code',
    })
  })

  it('reads the served version from the captured record', async () => {
    const transport = recordingTransport(() => Promise.resolve(Response.json(CAPTURED_RECORD)))
    const result = await readStoresReport({
      transport: transport.transport,
      project,
      releaseVersion: '0.17.0',
      adapters: [openVsxStoreAdapter('RandyNorthrup', 'muse-spark-code')],
    })
    // The project publishes on three channels but only the Open VSX adapter
    // is bound: sibling rows stay honestly unavailable.
    expect(result.record.status).toBe('partial')
    expect(result.data).toEqual([
      {
        channel: 'Marketplace',
        version: null,
        url: 'https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code',
        status: 'unavailable',
        reason: 'store-capture-required',
      },
      {
        channel: 'Open VSX',
        version: '0.17.0',
        url: 'https://open-vsx.org/extension/RandyNorthrup/muse-spark-code',
        status: 'current',
        reason: null,
      },
      {
        channel: 'npm',
        version: null,
        url: 'https://www.npmjs.com/package/muse-spark-code',
        status: 'unavailable',
        reason: 'store-capture-required',
      },
    ])
    expect(transport.calls).toHaveLength(1)
  })

  it('reports a 404 as its own refusal without parsing a guessed body', async () => {
    // The 404 body was not captured: only the reader's status refusal is
    // asserted, beside a succeeding npm sibling so the row stays visible.
    const transport = recordingTransport((request) =>
      Promise.resolve(
        request.url.includes('open-vsx.org')
          ? new Response('not found', { status: 404 })
          : Response.json({ version: '0.17.0', url: request.url }),
      ),
    )
    const result = await readStoresReport({
      transport: transport.transport,
      project,
      releaseVersion: '0.17.0',
      adapters: [
        openVsxStoreAdapter('RandyNorthrup', 'muse-spark-code'),
        npmStoreAdapter('muse-spark-code'),
      ],
    })
    expect(result.record.status).toBe('partial')
    expect(result.data?.find((row) => row.channel === 'Open VSX')).toMatchObject({
      version: null,
      status: 'unavailable',
      reason: 'http-404',
    })
  })

  it('blames the document when the captured version field is missing', async () => {
    const result = await readStoresReport({
      transport: recordingTransport(() => Promise.resolve(Response.json({}))).transport,
      project,
      releaseVersion: '0.17.0',
      adapters: [openVsxStoreAdapter('RandyNorthrup', 'muse-spark-code')],
    })
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toContain('Open VSX: store-response-invalid')
  })
})

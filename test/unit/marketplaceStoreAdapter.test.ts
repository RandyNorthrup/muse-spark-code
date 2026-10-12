// The Marketplace channel adapter (M113 lane C-M113-6): the default
// adapter built from the lead's N-captures handoff.
//
// Wire provenance (AGENTS.md rule 14):
// test/fixtures/m113/stores/marketplace-extensionquery/response.body.json is
// the live `POST
// .../extensionquery?api-version=3.0-preview.1` answer, byte-exact beside
// its receipt (test/unit/storeCaptures.test.ts). Only `versions[0].version`
// is read. Synthetic bodies below are marked as such and never claimed as
// captures.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { marketplaceStoreAdapter } from '../../src/core/reporting/sources/marketplaceStore'
import { npmStoreAdapter } from '../../src/core/reporting/sources/npmStore'
import { readStoresReport } from './helpers/reportNetwork'

const CAPTURED_ANSWER: unknown = JSON.parse(
  readFileSync(
    new URL(
      '../fixtures/m113/stores/marketplace-extensionquery/response.body.json',
      import.meta.url,
    ),
    'utf8',
  ),
)
const CAPTURED_REQUEST: { body: string } = JSON.parse(
  readFileSync(
    new URL('../fixtures/m113/stores/marketplace-extensionquery/request.json', import.meta.url),
    'utf8',
  ),
)
const QUERY_URL =
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1'

const project = {
  name: 'muse-spark-code',
  publisher: 'RandyNorthrup',
  engines: { vscode: '^1.99.0' },
  private: false,
}

function capturedMarketplace() {
  return vi.fn(() => Promise.resolve(Response.json(CAPTURED_ANSWER)))
}

describe('marketplace store adapter', () => {
  it('sends the captured query form with the workspace publisher and name', () => {
    const adapter = marketplaceStoreAdapter('RandyNorthrup', 'muse-spark-code')
    expect(adapter).toMatchObject({
      channel: 'Marketplace',
      request: { url: QUERY_URL, method: 'POST' },
    })
    expect(adapter.request).toEqual({
      url: QUERY_URL,
      method: 'POST',
      body: CAPTURED_REQUEST.body,
    })
  })

  it('reads the served version from the captured answer', async () => {
    const transport = capturedMarketplace()
    const result = await readStoresReport({
      transport,
      project,
      releaseVersion: '0.17.0',
      adapters: [marketplaceStoreAdapter('RandyNorthrup', 'muse-spark-code')],
    })
    // The project publishes on three channels but only the Marketplace
    // adapter is bound: sibling rows stay honestly unavailable.
    expect(result.record.status).toBe('partial')
    expect(result.data).toEqual([
      {
        channel: 'Marketplace',
        version: '0.17.0',
        url: 'https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code',
        status: 'current',
        reason: null,
      },
      {
        channel: 'Open VSX',
        version: null,
        url: 'https://open-vsx.org/extension/RandyNorthrup/muse-spark-code',
        status: 'unavailable',
        reason: 'store-capture-required',
      },
      {
        channel: 'npm',
        version: null,
        url: 'https://www.npmjs.com/package/muse-spark-code',
        status: 'unavailable',
        reason: 'store-capture-required',
      },
    ])
    expect(transport).toHaveBeenCalledOnce()
  })

  it('reports lag when the captured channel is older than the release', async () => {
    const result = await readStoresReport({
      transport: capturedMarketplace(),
      project,
      releaseVersion: '0.17.1',
      adapters: [marketplaceStoreAdapter('RandyNorthrup', 'muse-spark-code')],
    })
    expect(result.data?.[0]).toMatchObject({ version: '0.17.0', status: 'lagging' })
  })

  it('refuses an empty extensions list as not listed without guessing its shape', async () => {
    // Synthetic, never claimed as a capture: the not-listed answer was not
    // captured, so only the empty extensions array of the captured shape is
    // asserted. Sibling npm succeeds, so the refused row stays visible.
    const transport = vi.fn((request: { url: string }) =>
      Promise.resolve(
        Response.json(
          request.url.includes('marketplace.visualstudio.com')
            ? { results: [{ extensions: [], resultMetadata: [] }] }
            : { version: '0.17.0', url: request.url },
        ),
      ),
    )
    const result = await readStoresReport({
      transport,
      project,
      releaseVersion: '0.17.0',
      adapters: [
        marketplaceStoreAdapter('RandyNorthrup', 'muse-spark-code'),
        npmStoreAdapter('muse-spark-code'),
      ],
    })
    expect(result.record.status).toBe('partial')
    expect(result.data?.find((row) => row.channel === 'Marketplace')).toMatchObject({
      version: null,
      status: 'unavailable',
      reason: 'marketplace-not-listed',
    })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['an empty answer', {}],
    ['missing results', { results: [] }],
    ['a version-less entry', { results: [{ extensions: [{ versions: [] }] }] }],
  ])('blames the document for %s', async (_label, answer) => {
    const result = await readStoresReport({
      transport: vi.fn(() => Promise.resolve(Response.json(answer))),
      project,
      releaseVersion: '0.17.0',
      adapters: [marketplaceStoreAdapter('RandyNorthrup', 'muse-spark-code')],
    })
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toContain('Marketplace: store-response-invalid')
  })
})

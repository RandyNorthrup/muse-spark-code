// Report adapter hosts (M113 lane C-M113-6): the reader's allowlist carries
// exactly the four hosts the captured adapters need, no more. Each adapter's
// own request form dispatches; anything else refuses before the transport.
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { marketplaceStoreAdapter } from '../../src/core/reporting/sources/marketplaceStore'
import { npmStoreAdapter } from '../../src/core/reporting/sources/npmStore'
import { openVsxStoreAdapter } from '../../src/core/reporting/sources/openVsxStore'
import { networkContext, networkRig } from './helpers/reportNetwork'

const schema = z.looseObject({})

describe('report adapter hosts', () => {
  it.each([
    ['Marketplace', marketplaceStoreAdapter('fixture', 'fixture').request],
    ['Open VSX', openVsxStoreAdapter('fixture', 'fixture').request],
    ['npm', npmStoreAdapter('fixture').request],
    ['GitHub', { url: 'https://api.github.com/repos/fixture/fixture/tags?per_page=100&page=1' }],
  ])('dispatches the %s adapter request', async (_label, request) => {
    const transport = vi.fn(() => Promise.resolve(Response.json({})))
    const rig = networkRig({ transport })
    await rig.reader.read(networkContext(), 'hosts', schema, async (query) => ({
      data: await query(request, schema),
      reason: null,
    }))
    expect(transport).toHaveBeenCalledOnce()
  })

  it('refuses a host no adapter needs', async () => {
    const rig = networkRig()
    const result = await rig.reader.read(networkContext(), 'hosts', schema, async (query) => ({
      data: await query({ url: 'https://example.com/extension' }, schema),
      reason: null,
    }))
    expect(result.record.reason).toContain('endpoint-refused')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('refuses a POST outside the captured gallery query path', async () => {
    const rig = networkRig()
    const result = await rig.reader.read(networkContext(), 'hosts', schema, async (query) => ({
      data: await query(
        {
          url: 'https://marketplace.visualstudio.com/_apis/public/gallery/other',
          method: 'POST',
          body: '{}',
        },
        schema,
      ),
      reason: null,
    }))
    expect(result.record.reason).toContain('read-method-refused')
    expect(rig.transport).not.toHaveBeenCalled()
  })
})

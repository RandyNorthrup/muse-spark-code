// An injected provider send that fails keeps ambiguous liability: the
// request may have reached the provider, so the failure must not read as
// `not_sent` (which releases the run's ticket and records zero). The key
// probe rides the real entry validation, the real pinned transport and the
// real error mapping; only the socket outcome is injected, as a failure,
// and no request leaves the machine. The address is an IP literal, so no
// lookup runs either.
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import type { ProviderEntry } from '../../src/core/providers/providersFile'
import { UI_TEXT } from '../../src/shared/constants'

const entry: ProviderEntry = {
  id: 'probe',
  preset: 'custom',
  address: 'https://8.8.8.8/v1',
  auth: 'apiKey',
  models: [],
}

describe('an injected provider send that fails', () => {
  it('keeps ambiguous liability instead of reading as not sent', async () => {
    const services = createConfiguredProviderServices(undefined, {
      configFile: path.join(tmpdir(), 'configured-probe-providers.json'),
      catalogFile: path.join(tmpdir(), 'configured-probe-catalog.json'),
      secrets: { get: () => Promise.resolve(undefined) },
      send: () => Promise.reject(new Error('the injected transport failed after dispatch')),
    })
    const outcome = await services.test(entry, 'test-key')
    // Not the probe's own fallbacks: the uncertain sentence survives, so
    // accounting holds the attempt's liability instead of releasing it.
    expect(outcome).toEqual({ kind: 'failed', detail: UI_TEXT.modelsPanelUnavailable })
  })
})

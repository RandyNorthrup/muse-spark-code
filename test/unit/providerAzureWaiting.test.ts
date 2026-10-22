// The Azure preset waits for the owner's resource (msm95 gap): built and
// shape-proven against the documented API, but dispatch refuses before
// send until Azure's own capture lands (rule 13). Real services over a
// real temp file; the injected transport counts sends, and none may go
// out. The live send needs the owner's Azure resource, which also
// produces the capture that lists Azure.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'

describe('the Azure preset waits for its capture', () => {
  it('refuses an Azure resolve before send, with zero dispatches', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'muse-azure-waiting-'))
    const configFile = path.join(directory, 'providers.json')
    const catalogFile = path.join(directory, 'catalog.json')
    writeFileSync(
      catalogFile,
      JSON.stringify({ providers: { azure: { models: { 'gpt-5-4': {} } } } }),
    )
    writeFileSync(
      configFile,
      JSON.stringify({
        v: 1,
        providers: [
          {
            id: 'azure',
            preset: 'azure',
            auth: 'apiKey',
            address: 'https://my-resource.openai.azure.com/openai/v1',
            deployment: 'my-deploy',
            models: ['gpt-5-4'],
            modelCapabilities: { 'gpt-5-4': { tools: { calling: { state: 'yes', value: true } } } },
          },
        ],
      }),
    )
    const sends: string[] = []
    // A stored key: the missing capture is the only reason to refuse.
    const stored = JSON.stringify({
      v: 1,
      auth: 'apiKey',
      origin: 'https://my-resource.openai.azure.com',
      secret: 'test-azure-key',
    })
    const services = createConfiguredProviderServices(undefined, {
      configFile,
      catalogFile,
      secrets: { get: () => Promise.resolve(stored) },
      send: (target) => {
        sends.push(target.url)
        return Promise.reject(new Error('no send may go out before the capture'))
      },
    })
    await expect(services.client.models.resolve('azure/gpt-5-4')).rejects.toThrow()
    expect(sends).toEqual([])
  })
})

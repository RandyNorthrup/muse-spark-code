// Session-level refresh (msm95 gap): a providers-file edit between turns
// changes the next resolution. Every resolve re-reads the file — the turn
// resolves through the registry on each request — so no restart and no
// cache invalidation stands between the edit and the next turn. Real
// services over a real temp file; resolve dispatches nothing.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'

function writeProvidersFile(file: string, contextTokens: number): void {
  writeFileSync(
    file,
    JSON.stringify({
      v: 1,
      providers: [
        {
          id: 'refresh',
          preset: 'custom',
          auth: 'none',
          address: 'https://127.0.0.1:1/v1',
          models: ['native'],
          modelLimits: { native: { contextTokens, outputTokens: 4096 } },
          modelCapabilities: { native: { tools: { calling: { state: 'yes', value: true } } } },
        },
      ],
    }),
  )
}

describe('session-level provider refresh', () => {
  it('a file edit between resolves changes the next resolution', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'muse-refresh-'))
    const configFile = path.join(directory, 'providers.json')
    const catalogFile = path.join(directory, 'catalog.json')
    writeFileSync(catalogFile, JSON.stringify({ providers: {} }))
    writeProvidersFile(configFile, 8192)
    const services = createConfiguredProviderServices(undefined, {
      configFile,
      catalogFile,
      secrets: { get: () => Promise.resolve(undefined) },
    })
    const models = services.client.models
    if (models === undefined) throw new Error('configured models missing')
    const first = await models.resolve('refresh/native')
    expect(first.contextTokens).toBe(8192)
    // The edit between turns: the next turn resolves the new cap.
    writeProvidersFile(configFile, 16_384)
    const second = await models.resolve('refresh/native')
    expect(second.contextTokens).toBe(16_384)
  })
})

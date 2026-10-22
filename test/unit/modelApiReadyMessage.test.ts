// RLTESTDRIVE item 3: the ready line names the provider actually used.
// An exec run on an Anthropic provider logged "Model API backend ready
// (api.meta.ai/v1, …)": the line named the Meta backend for every run.
import { describe, expect, it } from 'vitest'
import { modelApiReadyMessage } from '../../src/host/backend/modelApiBackendManager'

describe('Model API ready line', () => {
  it('names the Meta backend when no provider run is known', () => {
    expect(modelApiReadyMessage(undefined)).toBe(
      'Model API backend ready (api.meta.ai/v1, stateless reasoning replay)',
    )
  })

  it('names the provider id and origin a run actually uses', () => {
    const line = modelApiReadyMessage({ id: 'anthropic-s2', origin: 'https://api.anthropic.com' })
    expect(line).toContain('anthropic-s2')
    expect(line).toContain('api.anthropic.com')
    expect(line).not.toContain('api.meta.ai')
  })

  it('keeps a local origin readable, with its port', () => {
    expect(modelApiReadyMessage({ id: 'local', origin: 'http://127.0.0.1:1234' })).toContain(
      '127.0.0.1:1234',
    )
  })
})

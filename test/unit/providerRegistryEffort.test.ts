// Finding F79 (2026-10-14): a configured provider's model listed no effort
// levels, so every editor's effort picker was empty and the editor protocol
// refused every level ("Invalid params: xhigh") for, for example, Anthropic's
// claude-sonnet-5-5, whose capability record lists low..max. The registry's
// listing now carries the levels its own policy holds. Real modules only:
// the registry, the model policy and the effort table; no client is called.

import { describe, expect, it } from 'vitest'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'

const registryWith = (effortLevels: readonly string[] | undefined) =>
  createProviderRegistry({
    models: () =>
      Promise.resolve([
        {
          ref: 'anthropic-s2/claude-sonnet-5-5',
          origin: 'https://api.anthropic.com',
          pricing: { kind: 'unpriced' },
          evidence: { capabilities: { toolCalling: true, reasoning: true }, effortLevels },
        },
      ]),
    createClient: () => Promise.reject(new Error('no client is created by a listing')),
    isCurrent: () => true,
  })

/** The registry's listing; the resolver type makes list optional, the registry always has it. */
async function listed(effortLevels: readonly string[] | undefined) {
  const registry = registryWith(effortLevels)
  if (registry.list === undefined) throw new Error('the provider registry lists models')
  return await registry.list()
}

describe('configured provider models list their effort levels (F79)', () => {
  it('lists the levels the model record names', async () => {
    const [model] = await listed(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(model?.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('keeps only levels the app can represent', async () => {
    const [model] = await listed(['low', 'xhigh', 'ultra'])
    expect(model?.effortLevels).toEqual(['low', 'xhigh'])
  })

  it('lists no levels where the record names none', async () => {
    const [model] = await listed(undefined)
    expect(model?.effortLevels).toBeUndefined()
  })
})

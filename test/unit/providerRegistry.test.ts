import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { unknownModelRefText } from '../../src/core/unknownModel'
import {
  createProviderRegistry,
  type ProviderRegistryDeps,
  type RegistryModel,
} from '../../src/core/providers/providerRegistry'

// F83: a model without confirmed tool calling stays listed with its limit
// stated, and an agent turn on it is refused with the same sentence.
function row(ref: string, isToolCalling?: boolean): RegistryModel {
  return {
    ref,
    origin: 'https://example.test',
    evidence: isToolCalling === undefined ? {} : { capabilities: { toolCalling: isToolCalling } },
    pricing: { kind: 'unpriced' },
  }
}

function deps(models: readonly RegistryModel[]): ProviderRegistryDeps {
  return {
    models: () => Promise.resolve(models),
    createClient: () => Promise.reject(new Error('unreachable: the refusal happens first')),
    isCurrent: () => true,
  }
}

describe('providerRegistry tool-calling gate', () => {
  it('lists an unconfirmed model with its limit instead of hiding it', async () => {
    const registry = createProviderRegistry(
      deps([
        row('together/openai/gpt-oss-20b', false),
        row('openai/gpt-4o', true),
        row('custom/mystery'),
      ]),
    )
    const list = registry.list
    if (list === undefined) throw new Error('the registry lists models')
    const listed = await list()
    expect(listed.map((model) => model.modelId)).toEqual([
      'together/openai/gpt-oss-20b',
      'openai/gpt-4o',
      'custom/mystery',
    ])
    const limited = fill(UI_TEXT.providerModelNoToolCalling, {
      model: 'together/openai/gpt-oss-20b',
    })
    expect(
      listed.find((model) => model.modelId === 'together/openai/gpt-oss-20b')?.agentLimit,
    ).toBe(limited)
    expect(listed.find((model) => model.modelId === 'custom/mystery')?.agentLimit).toBe(
      fill(UI_TEXT.providerModelNoToolCalling, { model: 'custom/mystery' }),
    )
    expect(listed.find((model) => model.modelId === 'openai/gpt-4o')?.agentLimit).toBeUndefined()
  })

  it('refuses an agent turn on an unconfirmed model with that sentence', async () => {
    const registry = createProviderRegistry(deps([row('together/openai/gpt-oss-20b', false)]))
    await expect(registry.resolve('together/openai/gpt-oss-20b')).rejects.toThrow(
      fill(UI_TEXT.providerModelNoToolCalling, {
        model: 'together/openai/gpt-oss-20b',
      }),
    )
    // An unknown id is refused with the shared unknown-model sentence
    // (the id as typed, the entry asked, what the person can do), not the
    // old fixed line.
    await expect(registry.resolve('together/unknown-model')).rejects.toThrow(
      unknownModelRefText('together/unknown-model'),
    )
    expect(unknownModelRefText('together/unknown-model')).toContain('together/unknown-model')
  })
})

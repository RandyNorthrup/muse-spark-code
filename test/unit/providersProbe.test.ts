// The provider probe's failure rules: a send with no answer reads as
// unreachable, an unreadable list as unparseable, and only a parsed list
// proves the key.
import { describe, expect, it } from 'vitest'
// The two static imports warm the probe's lazily loaded bundles at
// collection time, so the assertion itself runs inside the repository's
// own per-test timeout.
import '../../src/host/backend/configuredProvidersEntry'
import '../../src/host/backend/modelApiEntry'
import { presetById } from '../../src/core/providers/presets'
import type { ProviderEntry, ProvidersFile } from '../../src/core/providers/providersFile'
import { resolveProvider, type ResolvedProvider } from '../../src/runtime/exec/providerExec'
import { probeProvider } from '../../src/runtime/providersCommands'

const ENTRY: ProviderEntry = {
  id: 'testprovider',
  preset: 'openai',
  address: 'https://api.openai.com',
  auth: 'apiKey',
  models: [],
}
const FILE: ProvidersFile = { v: 1, providers: [ENTRY] }

function resolveAnswers(): Promise<readonly string[]> {
  return Promise.resolve(['93.184.215.14'])
}

async function resolved(): Promise<ResolvedProvider> {
  const result = await resolveProvider(FILE, 'testprovider', presetById, resolveAnswers)
  if (!result.ok) throw new Error(result.error)
  return result.provider
}

function answer(body: string): Promise<Response> {
  return Promise.resolve(new Response(body, { status: 200 }))
}

describe('probeProvider failure rules', () => {
  it('reads a send with no answer as unreachable', async () => {
    const provider = await resolved()
    const outcome = await probeProvider(
      () => Promise.reject(new TypeError('fetch failed')),
      provider,
      'sk-test-key-00000000000000',
      resolveAnswers,
    )
    expect(outcome).toEqual({ ok: false, paid: false, reason: 'unreachable' })
  })

  it('reads an unreadable list as unparseable, never as proven', async () => {
    const provider = await resolved()
    const outcome = await probeProvider(
      () => answer('this is not json{{{'),
      provider,
      'sk-test-key-00000000000000',
      resolveAnswers,
    )
    expect(outcome).toEqual({ ok: false, paid: false, reason: 'unparseable' })
  })

  it('proves the key only on a parsed list', async () => {
    const provider = await resolved()
    const outcome = await probeProvider(
      () => answer(JSON.stringify({ data: [{ id: 'gpt-x' }] })),
      provider,
      'sk-test-key-00000000000000',
      resolveAnswers,
    )
    expect(outcome).toEqual({ ok: true, modelCount: 1, modelIds: ['gpt-x'] })
  })
})

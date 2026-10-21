// The provider run's boundary rules: bad addresses refuse before DNS, a
// malformed secret reads as unparseable, the origin pin refuses rebindings,
// and a failed resolve reads as unreachable with nothing sent.
import { describe, expect, it } from 'vitest'
import { UserRefusalError } from '../../src/core/refusal'
import { presetById } from '../../src/core/providers/presets'
import type { ProviderEntry, ProvidersFile } from '../../src/core/providers/providersFile'
import {
  allowedProviderPaths,
  pinProviderFetch,
  readProviderKey,
  resolveProvider,
  type ResolvedProvider,
} from '../../src/runtime/exec/providerExec'
import { UI_TEXT } from '../../src/shared/constants'

const ENTRY: ProviderEntry = {
  id: 'testprovider',
  preset: 'openai',
  address: 'https://api.openai.com',
  auth: 'apiKey',
  models: [],
}
const FILE: ProvidersFile = { v: 1, providers: [ENTRY] }
const ANSWERS = ['93.184.215.14']

function resolveAnswers(): Promise<readonly string[]> {
  return Promise.resolve(ANSWERS)
}

function refuseDns(): Promise<readonly string[]> {
  return Promise.reject(new Error('ENOTFOUND-test'))
}

function unreachableFetch(): Promise<Response> {
  throw new Error('the upstream is never reached')
}

async function resolved(): Promise<ResolvedProvider> {
  const result = await resolveProvider(FILE, 'testprovider', presetById, resolveAnswers)
  if (!result.ok) throw new Error(result.error)
  return result.provider
}

describe('providerExec boundary rules', () => {
  it('refuses an address the URL parser cannot take', async () => {
    const bad: ProvidersFile = { v: 1, providers: [{ ...ENTRY, address: '::not a url::' }] }
    await expect(resolveProvider(bad, 'testprovider', presetById, resolveAnswers)).resolves.toEqual(
      { ok: false, error: 'bad-address' },
    )
  })

  it('reads a malformed stored secret as unparseable', async () => {
    const provider = await resolved()
    await expect(
      readProviderKey(
        {
          get: () => Promise.resolve('{oops'),
        },
        provider,
      ),
    ).resolves.toEqual({ ok: false, error: 'unparseable' })
  })

  it('refuses a request off the resolved origin', async () => {
    const provider = await resolved()
    const pinned = pinProviderFetch(unreachableFetch, provider, [], resolveAnswers)
    await expect(pinned('https://evil.example/x')).rejects.toMatchObject({
      name: 'UserRefusalError',
      message: UI_TEXT.providerProbeRebinding,
    })
  })

  it('reads a failed resolve as unreachable with nothing sent', async () => {
    const provider = await resolved()
    const rules = allowedProviderPaths(provider)
    const pinned = pinProviderFetch(unreachableFetch, provider, rules, refuseDns)
    await expect(pinned(`${provider.origin}/v1/responses`)).rejects.toMatchObject({
      name: 'UserRefusalError',
      message: UI_TEXT.providerProbeUnreachable,
    })
  })

  it('names a refused connection unreachable and lets other failures through', async () => {
    const provider = await resolved()
    const rules = allowedProviderPaths(provider)
    const url = `${provider.origin}/v1/responses`
    const refused = new Error('connect', { cause: { code: 'ECONNREFUSED' } })
    const refusing = pinProviderFetch(
      () => Promise.reject(refused),
      provider,
      rules,
      resolveAnswers,
    )
    let failure: unknown
    try {
      await refusing(url)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(UserRefusalError)
    if (!(failure instanceof UserRefusalError)) throw new Error('unreachable')
    expect(failure.message).toBe(UI_TEXT.providerProbeUnreachable)
    expect(failure.cause).toBe(refused)
    const plain = new Error('boom')
    const passing = pinProviderFetch(() => Promise.reject(plain), provider, rules, resolveAnswers)
    await expect(passing(url)).rejects.toBe(plain)
  })
})

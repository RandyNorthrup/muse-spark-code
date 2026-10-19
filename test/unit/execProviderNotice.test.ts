// A piped provider key that looks like the wrong thing is named on the
// exec surface too (PLAN.md D123): assembly returns the question beside
// the run, and the key still reaches the in-memory store for the provider
// to judge. Pure: the real assembly with values passed in as data; the
// network seam is a guard that fails a test that ever calls it.

import { describe, expect, it } from 'vitest'
import { emptyProvidersFile, type ProvidersFile } from '../../src/core/providers/providersFile'
import { memorySecretStoreFor } from '../../src/runtime/exec/keyInput'
import type { KeyLineResult } from '../../src/runtime/exec/keyInput'
import { assembleProviderRun, type ProviderRunInput } from '../../src/runtime/exec/providerExec'
import { providerSecretAccount } from '../../src/runtime/keyStore'
import { CREDENTIAL_RECORD_VERSION } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'

const URL_KEY = 'https://not-a-key.example/v1'
const WORDS_KEY = 'two words'
const PLACEHOLDER_KEY = 'test-key'
// Built, not typed: a committed key-like literal trips the secret scanner.
const PLAIN_KEY = `sk-test-${'0'.repeat(16)}`

function assemblyInput(key: string): ProviderRunInput {
  const result: KeyLineResult = { ok: true, key }
  const file: ProvidersFile = {
    ...emptyProvidersFile(),
    providers: [
      {
        auth: 'apiKey',
        models: ['m1'],
        address: 'https://api.groq.com',
        preset: 'groq',
        id: 'groq',
      },
    ],
  }
  return {
    filePath: '/user/providers.json',
    readFile: () => Promise.resolve(JSON.stringify(file)),
    secrets: memorySecretStoreFor({}),
    resolveHost: () => Promise.resolve(['93.184.216.34']),
    readKey: () => Promise.resolve(result),
    providerId: 'groq',
    model: 'groq/m1',
    keyFromStdin: true,
  }
}

describe('assembleProviderRun stdin key notice', () => {
  it('names a URL-shaped stdin key and still stores it for the provider', async () => {
    const assembled = await assembleProviderRun(assemblyInput(URL_KEY))
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error('not assembled')
    expect(assembled.notice).toBe(EN.providerKeyNoticeUrl)
    expect(assembled.run.literals).toEqual([URL_KEY])
    const account = providerSecretAccount('groq') ?? ''
    const envelope = await assembled.run.secrets.get(account)
    expect(envelope).toContain('https://api.groq.com')
    expect(envelope).toBe(
      formatStoredProviderSecret(
        { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: 'https://api.groq.com' },
        URL_KEY,
      ),
    )
  })

  it('names a whitespace-carrying stdin key', async () => {
    const assembled = await assembleProviderRun(assemblyInput(WORDS_KEY))
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error('not assembled')
    expect(assembled.notice).toBe(EN.providerKeyNoticeWhitespace)
    expect(assembled.run.literals).toEqual([WORDS_KEY])
  })

  it('names placeholder stdin text', async () => {
    const assembled = await assembleProviderRun(assemblyInput(PLACEHOLDER_KEY))
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error('not assembled')
    expect(assembled.notice).toBe(EN.providerKeyNoticePlaceholder)
  })

  it('carries no notice for an ordinary stdin key', async () => {
    const assembled = await assembleProviderRun(assemblyInput(PLAIN_KEY))
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error('not assembled')
    expect(assembled.notice).toBe(undefined)
    expect(assembled.run.literals).toEqual([PLAIN_KEY])
  })
})

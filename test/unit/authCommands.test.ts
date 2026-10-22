// The auth status verdicts: malformed secrets read as unreadable, and a
// label lookup failure degrades the label without changing the verdict.
import { describe, expect, it } from 'vitest'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import type { ProviderEntry, ProvidersFileRead } from '../../src/core/providers/providersFile'
import {
  authStatusAll,
  authStatusProvider,
  type AuthCommandDeps,
} from '../../src/runtime/authCommands'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import { CREDENTIAL_RECORD_VERSION } from '../../src/shared/constants'
import { mapSecrets } from './helpers/mapSecrets'

const ENTRY: ProviderEntry = {
  id: 'testprovider',
  preset: 'testprovider',
  auth: 'apiKey',
  models: [],
}
const ENVELOPE = formatStoredProviderSecret(
  { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: 'https://api.example.com' },
  'candidate-key',
)

function deps(secrets: SecretStore, lines: { out: string[]; err: string[] }): AuthCommandDeps {
  return {
    secrets,
    storeName: 'test store',
    readSecret: () => Promise.resolve(''),
    confirmKeyUse: () => Promise.reject(new Error('auth-commands test asks no key-use question')),
    print: (line) => {
      lines.out.push(line)
    },
    printError: (line) => {
      lines.err.push(line)
    },
  }
}

function failingFile(): Promise<ProvidersFileRead> {
  return Promise.reject(new Error('the file could not be read'))
}

const lines = () => ({ out: [] as string[], err: [] as string[] })
const file = (): Promise<ProvidersFileRead> =>
  Promise.resolve({ ok: true, file: { v: 1, providers: [ENTRY] } })

describe('auth status stored-secret verdicts', () => {
  it('reads a malformed provider secret as unreadable in the file loop', async () => {
    const said = lines()
    const exit = await authStatusAll(
      deps(mapSecrets({ 'museSpark.provider.testprovider': '{oops' }), said),
      file,
    )
    expect(exit).toBe(1)
    expect(said.err.join('\n')).toContain('cannot be read')
  })

  it('reports a well-formed provider secret as present', async () => {
    const said = lines()
    const exit = await authStatusAll(
      deps(mapSecrets({ 'museSpark.provider.testprovider': ENVELOPE }), said),
      file,
    )
    expect(exit).toBe(0)
    expect(said.out.join('\n')).toContain('testprovider')
  })

  it('tells apart two providers that share one preset label', async () => {
    // Real use, Windows 0.19.0: anthropic-s1 and anthropic-s2 printed two
    // identical "The Anthropic key is stored…" lines.
    const said = lines()
    const twins: ProviderEntry[] = ['anthropic-s2', 'anthropic-s1'].map((id) => ({
      id,
      preset: 'anthropic',
      auth: 'apiKey',
      models: [],
    }))
    const exit = await authStatusAll(
      deps(
        mapSecrets({
          'museSpark.provider.anthropic-s2': ENVELOPE,
          'museSpark.provider.anthropic-s1': ENVELOPE,
        }),
        said,
      ),
      () => Promise.resolve({ ok: true, file: { v: 1, providers: twins } }),
    )
    expect(exit).toBe(0)
    const stored = said.out.filter((line) => line.startsWith('The Anthropic'))
    expect(stored).toEqual([
      'The Anthropic (anthropic-s2) key is stored in test store, bound to https://api.example.com.',
      'The Anthropic (anthropic-s1) key is stored in test store, bound to https://api.example.com.',
    ])
  })

  it('reads a malformed stored secret as unreadable for one provider', async () => {
    const said = lines()
    const exit = await authStatusProvider(
      deps(mapSecrets({ 'museSpark.provider.testprovider': '{oops' }), said),
      'testprovider',
    )
    expect(exit).toBe(1)
    expect(said.err.join('\n')).toContain('cannot be read')
  })

  it('keeps the verdict when the label lookup fails', async () => {
    const said = lines()
    const exit = await authStatusProvider(deps(mapSecrets({}), said), 'testprovider', failingFile)
    expect(exit).toBe(1)
    expect(said.out.join('\n')).toContain('testprovider')
  })
})

const CHATGPT_ENTRY: ProviderEntry = {
  id: 'chatgpt',
  preset: 'chatgpt',
  auth: 'subscription',
  models: [],
}
const grant = (expiresAt: number): string =>
  JSON.stringify({
    v: CREDENTIAL_RECORD_VERSION,
    auth: 'subscription',
    origin: 'https://api.openai.com',
    issuer: 'https://auth.openai.com',
    clientId: 'test-client',
    hostId: 'test-host',
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expiresAt,
    scope: 'test-scope',
    nonce: 'test-nonce',
  })
const chatgptFile = (): Promise<ProvidersFileRead> =>
  Promise.resolve({ ok: true, file: { v: 1, providers: [CHATGPT_ENTRY] } })

// RLTESTDRIVE item 7: one truth from both. `providers status chatgpt`
// reads the subscription grant; `auth status` read every stored value
// as an API-key envelope, so a valid ChatGPT sign-in read "cannot be
// read; enter the key again" here while "signed in" there.
describe('auth status chatgpt grant verdicts', () => {
  it('reads a valid grant as signed in, as providers status does', async () => {
    const said = lines()
    const exit = await authStatusAll(
      deps(mapSecrets({ 'museSpark.provider.chatgpt': grant(Date.now() + 3_600_000) }), said),
      chatgptFile,
    )
    expect(exit).toBe(0)
    expect(said.out).toContain('ChatGPT is signed in.')
    expect(said.err.join('\n')).not.toContain('cannot be read')
  })

  it('reads an expired grant as expired, refreshing on use', async () => {
    const said = lines()
    const exit = await authStatusAll(
      deps(mapSecrets({ 'museSpark.provider.chatgpt': grant(Date.now() - 1) }), said),
      chatgptFile,
    )
    expect(exit).toBe(0)
    expect(said.out.join('\n')).toContain('has expired')
  })

  it('reads a missing grant as not signed in', async () => {
    const said = lines()
    const exit = await authStatusAll(deps(mapSecrets({}), said), chatgptFile)
    expect(exit).toBe(1)
    expect(said.out).toContain('ChatGPT is not signed in.')
  })

  it('reads a malformed grant with the sign-in remedy, not the key remedy', async () => {
    const said = lines()
    const exit = await authStatusAll(
      deps(mapSecrets({ 'museSpark.provider.chatgpt': '{oops' }), said),
      chatgptFile,
    )
    expect(exit).toBe(1)
    expect(said.err.join('\n')).toContain('Remove ChatGPT and sign in again.')
    expect(said.err.join('\n')).not.toContain('enter the key again')
  })

  it('agrees for one provider: signed in, not unreadable', async () => {
    const said = lines()
    const exit = await authStatusProvider(
      deps(mapSecrets({ 'museSpark.provider.chatgpt': grant(Date.now() + 3_600_000) }), said),
      'chatgpt',
    )
    expect(exit).toBe(0)
    expect(said.out).toContain('ChatGPT is signed in.')
  })
})

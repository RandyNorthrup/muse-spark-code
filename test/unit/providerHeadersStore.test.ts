// M95c part 6: `providers headers <id> [set|unset <name>]` on the real OS
// credential store, the store the terminal agent keeps every provider
// secret in (`keyringSecretStore` over `@napi-rs/keyring`, opened exactly as
// src/runtime/main.ts opens it). Every record lives under a random test
// service, never the product's own, and is removed afterwards. The value
// arrives on standard input; the providers file is a real file.
//
// This suite writes to the machine's credential store. It runs where that
// store opens (Windows, macOS, and Linux with a session bus), under the
// same availability guard as the vault's real-store suites. Like
// keyringParts, keystoreOwner and credentialLease, it is never run on the
// owner's own PC.
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import {
  emptyProvidersFile,
  writeProvidersFileAtomic,
  type ProviderEntry,
} from '../../src/core/providers/providersFile'
import { parseStoredHeaders, providerHeadersAccount } from '../../src/core/providers/requestHeaders'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { readSecretLine } from '../../src/runtime/hiddenInput'
import { keyringSecretStore } from '../../src/runtime/keyStore'
import { providersRemove, type ProvidersDeps } from '../../src/runtime/providersCommands'
import { providersHeaders } from '../../src/runtime/providersHeadersCommand'
import { KEYRING_SERVICE, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { providersCommandHarness } from './helpers/providersCommandHarness'

const OPENAI = 'https://api.openai.com'
const entry: ProviderEntry = {
  id: 'openai',
  preset: 'openai',
  address: OPENAI,
  auth: 'apiKey',
  models: ['gpt-6.1-sol'],
}

/** Linux's OS store is the Secret Service over the session bus; without one there is no store. */
function hasStore(): boolean {
  return process.platform !== 'linux' || (process.env['DBUS_SESSION_BUS_ADDRESS'] ?? '') !== ''
}

const harnesses = providersCommandHarness()
const services: string[] = []
afterAll(async () => {
  await harnesses.cleanup()
  if (services.length === 0) return
  const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring')
  for (const service of services) {
    const credentials = await findCredentialsAsync(service)
    for (const credential of credentials) {
      await new AsyncEntry(service, credential.account, {
        linux: { store: 'secret-service' },
      }).deletePassword()
    }
  }
})

/** The real command, the real OS store under a random test service, the value on stdin. */
async function harness(stdin: string) {
  const { AsyncEntry } = await import('@napi-rs/keyring')
  const scope = randomUUID()
  const service = `${KEYRING_SERVICE}.test.${scope}`
  services.push(service)
  const store = keyringSecretStore(
    (_, account) => new AsyncEntry(service, account, { linux: { store: 'secret-service' } }),
    { lockScope: scope },
  )
  const base = await harnesses.make('provider-headers-store-')
  const written = await writeProvidersFileAtomic(base.filePath, {
    ...emptyProvidersFile(),
    providers: [entry],
  })
  if (!written.ok) throw new Error(written.detail)
  const input = new PassThrough()
  input.end(stdin)
  const deps: ProvidersDeps = {
    ...base.deps,
    secrets: store,
    readSecret: (prompt) => readSecretLine(prompt, input, new PassThrough()),
  }
  return { deps, store, printed: base.printed, errors: base.errors }
}

describe.skipIf(!hasStore())('providers headers on the real OS credential store', () => {
  it('sets a header whose value comes from stdin, lists names only, and unsets it', async () => {
    const command = parseCommandLine(['providers', 'headers', 'openai', 'set', 'OpenAI-Project'])
    if (command.command !== 'providersHeaders') throw new Error(`parsed ${command.command}`)
    const h = await harness('proj_cli\n')
    expect(await providersHeaders(h.deps, command.options)).toBe(0)
    const stored = parseStoredHeaders('openai', await h.store.get(providerHeadersAccount('openai')))
    expect(stored).toEqual({ v: 1, origin: OPENAI, headers: { 'OpenAI-Project': 'proj_cli' } })
    expect(h.printed.join('\n')).not.toContain('proj_cli')
    expect(h.printed.at(-1)).toBe(
      fill(UI_TEXT.providerHeaders.list, { provider: 'openai', names: 'OpenAI-Project' }),
    )
    expect(await providersHeaders(h.deps, { provider: 'openai', unset: 'openai-project' })).toBe(0)
    expect(await h.store.get(providerHeadersAccount('openai'))).toBeUndefined()
    expect(h.printed.at(-1)).toBe(fill(UI_TEXT.providerHeaders.none, { provider: 'openai' }))
  })

  it('refuses a reserved name before reading any value', async () => {
    const h = await harness('Bearer other\n')
    expect(await providersHeaders(h.deps, { provider: 'openai', set: 'Authorization' })).toBe(1)
    expect(h.errors).toEqual([
      fill(UI_TEXT.providerHeaders.nameReserved, { name: 'Authorization' }),
    ])
    expect(await h.store.get(providerHeadersAccount('openai'))).toBeUndefined()
  })

  it('removing the provider removes its headers with it', async () => {
    const h = await harness('proj_cli\n')
    expect(await providersHeaders(h.deps, { provider: 'openai', set: 'OpenAI-Project' })).toBe(0)
    expect(await h.store.get(providerHeadersAccount('openai'))).toBeDefined()
    expect(await providersRemove(h.deps, 'openai')).toBe(0)
    expect(await h.store.get(providerHeadersAccount('openai'))).toBeUndefined()
  })
})

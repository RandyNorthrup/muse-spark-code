// M95c part 6: custom request headers per provider. The shape is the one
// OpenAI documents for choosing the organization and project a request
// bills (`OpenAI-Organization: <id>`, `OpenAI-Project: <id>` beside
// `Authorization: Bearer <key>`; developers.openai.com/api/reference/overview,
// "Authentication", read 2026-10-23). The whole-request tests ride the
// real configured request builder up to the socket
// (helpers/providerWire.ts); the CLI tests run the real command over a
// real providers file and a map-backed secret port, with
// the value arriving on standard input.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CustomHeadersAuthSource, NoAuthSource } from '../../src/core/backends/modelapi/authSource'
import {
  formatStoredHeaders,
  headerNameProblem,
  parseStoredHeaders,
  providerHeadersAccount,
  StoredHeadersError,
} from '../../src/core/providers/requestHeaders'
import type { ProviderEntry } from '../../src/core/providers/providersFile'
import {
  emptyProvidersFile,
  writeProvidersFileAtomic,
} from '../../src/core/providers/providersFile'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { readSecretLine } from '../../src/runtime/hiddenInput'
import { resolveEndpointHost } from '../../src/runtime/providerPaths'
import { userFileIo, type ProvidersDeps } from '../../src/runtime/providersCommands'
import { providersHeaders } from '../../src/runtime/providersHeadersCommand'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { makeTurnBody } from './helpers/turnBodies'
import { storedKey, turnRequest, wireServices, type WireRequest } from './helpers/providerWire'

const OPENAI = 'https://api.openai.com'
const entry: ProviderEntry = {
  id: 'openai',
  preset: 'openai',
  address: OPENAI,
  auth: 'apiKey',
  models: ['gpt-6.1-sol'],
}
const KEY = { 'museSpark.provider.openai': storedKey(OPENAI, 'test-openai-key') }

function body(): CreateResponseBody {
  return makeTurnBody({
    model: 'openai/gpt-6.1-sol',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi.' }] }],
    instructions: 'You are a coding agent.',
    toolName: 'read_file',
    effort: 'medium',
    include: [],
    maxOutputTokens: 8192,
    promptCacheKey: 'prefix-1',
  })
}

async function send(secrets: Readonly<Record<string, string>>): Promise<WireRequest[]> {
  const captured: WireRequest[] = []
  const services = wireServices([entry], { ...KEY, ...secrets }, captured)
  try {
    await turnRequest(services, captured, 'openai/gpt-6.1-sol', body())
  } catch (error: unknown) {
    // A refusal before the socket leaves `captured` empty; the caller asserts it.
    if (captured.length > 0) throw error
  }
  return captured
}

describe('custom request headers through the real request builder', () => {
  it('sends the stored headers beside the key, on the documented OpenAI shape', async () => {
    const [request] = await send({
      [providerHeadersAccount('openai')]: formatStoredHeaders(OPENAI, {
        'OpenAI-Organization': 'org-test',
        'OpenAI-Project': 'proj_test',
      }),
    })
    expect(request?.url).toBe(`${OPENAI}/v1/responses`)
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer test-openai-key',
      'OpenAI-Organization': 'org-test',
      'OpenAI-Project': 'proj_test',
    })
  })

  it('sends none when none are stored', async () => {
    const [request] = await send({})
    expect(
      Object.keys(request?.headers ?? {}).filter((name) => name.startsWith('OpenAI-')),
    ).toEqual([])
  })

  it('refuses before the socket when the headers were entered for another origin', async () => {
    const captured = await send({
      [providerHeadersAccount('openai')]: formatStoredHeaders('https://gateway.example', {
        'OpenAI-Project': 'proj_test',
      }),
    })
    expect(captured).toEqual([])
  })

  it('refuses before the socket on a damaged record, never sending without it', async () => {
    const captured: WireRequest[] = []
    const services = wireServices(
      [entry],
      { ...KEY, [providerHeadersAccount('openai')]: '{"v":1,' },
      captured,
    )
    await expect(turnRequest(services, captured, 'openai/gpt-6.1-sol', body())).rejects.toThrow(
      fill(UI_TEXT.providerHeadersUnreadable, { provider: 'openai' }),
    )
    expect(captured).toEqual([])
  })
})

describe('the header record', () => {
  it('refuses the names the app sends itself and names that are not field tokens', () => {
    for (const name of [
      'Authorization',
      'x-api-key',
      'Content-Type',
      'anthropic-beta',
      'X-Amz-Date',
    ])
      expect(headerNameProblem(name)).toBe('reserved')
    for (const name of ['', 'Two Words', 'Name:', 'naïve'])
      expect(headerNameProblem(name)).toBe('invalid')
    expect(headerNameProblem('OpenAI-Project')).toBeUndefined()
    // A stored record that carries one is damaged, never sent.
    expect(() =>
      parseStoredHeaders(
        'openai',
        JSON.stringify({ v: 1, origin: OPENAI, headers: { Authorization: 'Bearer other' } }),
      ),
    ).toThrow(StoredHeadersError)
    expect(() => formatStoredHeaders(OPENAI, { 'OpenAI-Project': 'line\nbreak' })).toThrow()
  })

  it('scrubs every value from error text and the streamed answer, as the key is', async () => {
    const source = new CustomHeadersAuthSource(new NoAuthSource('http://127.0.0.1:8080'), () =>
      Promise.resolve({
        origin: 'http://127.0.0.1:8080',
        headers: { 'X-Tenant': 'tenant-secret-1' },
      }),
    )
    const headers = await source.headers('http://127.0.0.1:8080/v1/chat/completions')
    expect(headers.values).toEqual({ 'X-Tenant': 'tenant-secret-1' })
    expect(headers.redact('gateway said tenant-secret-1 is unknown')).not.toContain(
      'tenant-secret-1',
    )
    expect(headers.secretValues).toEqual(['tenant-secret-1'])
  })
})

/** The real command over a real providers file; the value arrives on stdin. */
async function harness(stdin: string) {
  const folder = mkdtempSync(path.join(tmpdir(), 'provider-headers-cli-'))
  const filePath = path.join(folder, 'providers.json')
  const written = await writeProvidersFileAtomic(filePath, {
    ...emptyProvidersFile(),
    providers: [entry],
  })
  if (!written.ok) throw new Error(written.detail)
  // The OS credential store cannot be opened on a test machine; the
  // command's port is backed by a map, as the provider suites back it.
  const held = new Map<string, string>()
  const store: ProvidersDeps['secrets'] = {
    get: (name) => Promise.resolve(held.get(name)),
    store: (name, value) => {
      held.set(name, value)
      return Promise.resolve()
    },
    delete: (name) => {
      held.delete(name)
      return Promise.resolve()
    },
  }
  const input = new PassThrough()
  input.end(stdin)
  const printed: string[] = []
  const errors: string[] = []
  const deps: ProvidersDeps = {
    ...userFileIo(filePath),
    secrets: store,
    resolveHost: resolveEndpointHost,
    fetch: globalThis.fetch.bind(globalThis),
    readSecret: (prompt) => readSecretLine(prompt, input, new PassThrough()),
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
  }
  return { deps, store, printed, errors }
}

describe('providers headers (CLI)', () => {
  it('sets a header whose value comes from stdin, lists names only, and unsets it', async () => {
    const command = parseCommandLine(['providers', 'headers', 'openai', 'set', 'OpenAI-Project'])
    if (command.command !== 'providersHeaders') throw new Error(`parsed ${command.command}`)
    const h = await harness('proj_cli\n')
    expect(await providersHeaders(h.deps, command.options)).toBe(0)
    const stored = parseStoredHeaders('openai', await h.store.get(providerHeadersAccount('openai')))
    expect(stored).toEqual({ v: 1, origin: OPENAI, headers: { 'OpenAI-Project': 'proj_cli' } })
    expect(h.printed.join('\n')).not.toContain('proj_cli')
    expect(h.printed.at(-1)).toBe(
      fill(UI_TEXT.providerHeadersList, { provider: 'openai', names: 'OpenAI-Project' }),
    )
    expect(await providersHeaders(h.deps, { provider: 'openai', unset: 'openai-project' })).toBe(0)
    expect(await h.store.get(providerHeadersAccount('openai'))).toBeUndefined()
    expect(h.printed.at(-1)).toBe(fill(UI_TEXT.providerHeadersNone, { provider: 'openai' }))
  })

  it('refuses a reserved name before reading any value', async () => {
    const h = await harness('Bearer other\n')
    expect(await providersHeaders(h.deps, { provider: 'openai', set: 'Authorization' })).toBe(1)
    expect(h.errors).toEqual([fill(UI_TEXT.providerHeadersNameReserved, { name: 'Authorization' })])
    expect(await h.store.get(providerHeadersAccount('openai'))).toBeUndefined()
  })

  it('never takes a value as an argument', () => {
    const command = parseCommandLine(['providers', 'headers', 'openai', 'set', 'A', 'value'])
    expect(command.command).toBe('invalid')
  })
})

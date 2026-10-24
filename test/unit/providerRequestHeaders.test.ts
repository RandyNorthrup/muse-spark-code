// M95c part 6: custom request headers per provider. The shape is the one
// OpenAI documents for choosing the organization and project a request
// bills (`OpenAI-Organization: <id>`, `OpenAI-Project: <id>` beside
// `Authorization: Bearer <key>`; developers.openai.com/api/reference/overview,
// "Authentication", read 2026-10-23). The whole-request tests ride the
// real configured request builder and the real pinned transport to a real
// local socket that records the request and closes unanswered
// (helpers/providerWire.ts), with the key and headers held in the
// product's memory store. The `providers headers` command runs on the
// real OS credential store in providerHeadersStore.test.ts.
import { describe, expect, it } from 'vitest'
import { CustomHeadersAuthSource, NoAuthSource } from '../../src/core/backends/modelapi/authSource'
import {
  formatStoredHeaders,
  headerNameProblem,
  parseStoredHeaders,
  providerHeadersAccount,
  StoredHeadersError,
} from '../../src/core/providers/requestHeaders'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { memorySecretStoreFor } from '../../src/runtime/exec/keyInput'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { makeTurnBody } from './helpers/turnBodies'
import {
  responsesEntryAt,
  storedKey,
  suiteSocket,
  turnRequest,
  wireServices,
} from './helpers/providerWire'

const OPENAI = 'https://api.openai.com'

const opened = suiteSocket()
const entryAt = (origin: string) => responsesEntryAt(origin, ['gpt-6.1-sol'])

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

/** The requests one turn put on the socket (none when it refused first). */
async function send(secrets: Readonly<Record<string, string>>) {
  const socket = await opened
  const before = socket.requests.length
  const services = wireServices([entryAt(socket.origin)], {
    'museSpark.provider.openai': storedKey(socket.origin, 'test-openai-key'),
    ...secrets,
  })
  try {
    await turnRequest(services, socket, 'openai/gpt-6.1-sol', body())
  } catch (error: unknown) {
    // A refusal before the socket leaves nothing recorded; the caller asserts it.
    if (socket.requests.length > before) throw error
  }
  return socket.requests.slice(before)
}

describe('custom request headers through the real request builder', () => {
  it('sends the stored headers beside the key, on the documented OpenAI shape', async () => {
    const socket = await opened
    const [request] = await send({
      [providerHeadersAccount('openai')]: formatStoredHeaders(socket.origin, {
        'OpenAI-Organization': 'org-test',
        'OpenAI-Project': 'proj_test',
      }),
    })
    expect(request?.path).toBe('/v1/responses')
    // As the socket read them (HTTP header names are case-insensitive).
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer test-openai-key',
      'openai-organization': 'org-test',
      'openai-project': 'proj_test',
    })
  })

  it('sends none when none are stored', async () => {
    const [request] = await send({})
    expect(
      Object.keys(request?.headers ?? {}).filter((name) => name.startsWith('openai-')),
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
    const socket = await opened
    const before = socket.requests.length
    const services = wireServices([entryAt(socket.origin)], {
      'museSpark.provider.openai': storedKey(socket.origin, 'test-openai-key'),
      [providerHeadersAccount('openai')]: '{"v":1,',
    })
    await expect(turnRequest(services, socket, 'openai/gpt-6.1-sol', body())).rejects.toThrow(
      fill(UI_TEXT.providerHeaders.unreadable, { provider: 'openai' }),
    )
    expect(socket.requests.length).toBe(before)
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
    // The same read the configured transport makes: the record from the
    // product's memory store, parsed by the product's own reader.
    const origin = 'http://127.0.0.1:8080'
    const store = memorySecretStoreFor({
      [providerHeadersAccount('local')]: formatStoredHeaders(origin, {
        'X-Tenant': 'tenant-secret-1',
      }),
    })
    const source = new CustomHeadersAuthSource(new NoAuthSource(origin), async () =>
      parseStoredHeaders('local', await store.get(providerHeadersAccount('local'))),
    )
    const headers = await source.headers('http://127.0.0.1:8080/v1/chat/completions')
    expect(headers.values).toEqual({ 'X-Tenant': 'tenant-secret-1' })
    expect(headers.redact('gateway said tenant-secret-1 is unknown')).not.toContain(
      'tenant-secret-1',
    )
    // A tool argument the provider streams back is scrubbed of them too.
    expect(source.scrubContent('curl -H "X-Tenant: tenant-secret-1"')).not.toContain(
      'tenant-secret-1',
    )
  })
})

describe('providers headers arguments', () => {
  it('never takes a value as an argument', () => {
    const command = parseCommandLine(['providers', 'headers', 'openai', 'set', 'A', 'value'])
    expect(command.command).toBe('invalid')
  })
})

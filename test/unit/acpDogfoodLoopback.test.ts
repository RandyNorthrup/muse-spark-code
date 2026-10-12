import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { createUsageRecording, type UsageWriter } from '../../src/core/usage/recording'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { keyringSecretStore } from '../../src/runtime/keyStore'
import { Usd } from '../../src/shared/usd'
import type { UsageRecord } from '../../src/shared/usageJournal'
import { ACP_ERROR_CODES } from '../../src/shared/constants'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_KEY,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryPaidGrants } from './helpers/paidGrants'

const root = '/workspace'
const ref = 'dogfood/native'
const usage = {
  input_tokens: 100,
  output_tokens: 10,
  input_tokens_details: { cached_tokens: 20, cache_write_tokens: 30, cache_write_tokens_1h: 10 },
  output_tokens_details: { reasoning_tokens: 2 },
}
async function fixture(mode: 'busy' | 'slow' | 'absent' | 'mid-turn') {
  const api = fakeModelApi()
  api.script(
    {
      calls: [{ name: 'read_file', arguments: '{"path":"a.md"}', callId: 'a' }],
      usageOverride: usage,
    },
    {
      calls: [{ name: 'read_file', arguments: '{"path":"b.md"}', callId: 'b' }],
      usageOverride: usage,
    },
    { text: 'Completed', usageOverride: usage },
  )
  let requests = 0
  const serve = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await new Promise<string>((resolve, reject) => {
      let text = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: unknown) => {
        if (typeof chunk === 'string') text += chunk
      })
      request.on('end', () => {
        resolve(text)
      })
      request.on('error', reject)
    })
    requests++
    const result = await api.fetch(`https://fake.meta.test${request.url ?? ''}`, {
      method: request.method,
      ...(body !== '' && { body }),
      headers: { Authorization: request.headers.authorization ?? '' },
    })
    response.writeHead(result.status, Object.fromEntries(result.headers))
    response.end(await result.text())
  }
  const server = createServer((request, response) => {
    void serve(request, response).catch(() => {
      response.writeHead(500)
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing loopback address')
  let reads = 0
  let isRecovered = false
  const records: UsageRecord[] = []
  const log = new FakeLogOutputChannel()
  const secrets = keyringSecretStore(() => ({
    getPassword: async () => {
      reads++
      if (!isRecovered && mode === 'absent') return null
      if (!isRecovered && mode === 'mid-turn' && requests >= 2)
        throw new Error('private native store detail')
      if (mode === 'busy' && reads === 1) throw new Error('busy')
      return mode === 'slow' && reads === 1
        ? await new Promise<string>(() => undefined)
        : FAKE_MODEL_API_KEY
    },
    setPassword: () => Promise.resolve(),
    deletePassword: () => Promise.resolve(true),
  }))
  let ids = 0
  const writer: UsageWriter = {
    noteUsage: (value, context) => {
      records.push(createUsageRecord(value, context))
    },
    append: () => undefined,
    read: () => Promise.resolve({ records }),
    flush: () => Promise.resolve(),
  }
  const recording = createUsageRecording({
    client: 'ACP loopback',
    now: Date.now,
    newId: () => `receipt-${String(++ids)}`,
    isEnabled: () => true,
    writer: () => Promise.resolve(writer),
    log,
  })
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    fetch,
    apiKey: () => Promise.resolve(secrets.get('synthetic')),
  })
  client.listModels = () => Promise.resolve([])
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client,
      workspaceRoot: root,
      io: memoryToolIo({ 'a.md': 'a', 'b.md': 'b' }, root),
      log,
    }),
    usageRecording: recording,
    models: createProviderRegistry({
      models: () =>
        Promise.resolve([
          {
            ref,
            isDefault: true,
            origin: `http://127.0.0.1:${String(address.port)}`,
            evidence: { capabilities: { toolCalling: true }, maxOutputTokens: 100 },
            pricing: {
              kind: 'priced',
              card: {
                input: 0.000004,
                cachedInput: 0.0000004,
                cacheWrite: 0.000005,
                cacheWrite1h: 0.000008,
                output: 0.000016,
                source: 'user',
              },
            },
          },
        ]),
      createClient: () => Promise.resolve(client),
      isCurrent: () => true,
    }),
  })
  const agent = createAcpAgent({
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    defaultCwd: root,
    signIn: { id: 'auth', name: 'Auth', description: 'Auth', args: [], command: 'auth' },
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
    questions: 'decline',
    accounting: {
      readRecords: () => recording.records?.() ?? recording.today(),
      readBudgets: () => Promise.resolve([]),
    },
  })
  const peer = acp.client({ name: 'loopback' })
  return {
    run: <T>(work: (client: acp.ClientContext) => Promise<T>) => peer.connectWith(agent, work),
    records,
    requests: () => requests,
    reads: () => reads,
    recover: () => {
      isRecovered = true
    },
    close: async () => {
      await host.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve()
        }),
      )
    },
  }
}

describe('ACPDOG real ACP / HTTP / credential stack', () => {
  it.each(['busy', 'slow'] as const)(
    'retries a %s OS-store read and reports exact settled requests',
    async (mode) => {
      const h = await fixture(mode)
      try {
        await h.run(async (client) => {
          await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
          const { sessionId } = await client.request('session/new', { cwd: root, mcpServers: [] })
          const result = await client.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: 'Read the files' }],
          })
          expect(result).toMatchObject({
            stopReason: 'end_turn',
            _meta: { 'museSpark.usage': { turn: { requests: 3, settledUsd: '0.001644' } } },
          })
          expect(h.requests()).toBe(3)
          expect(h.reads()).toBeGreaterThan(3)
          expect(h.records.map((record) => record.cost.usdAmount)).toEqual(
            Array.from({ length: 3 }, () => Usd.from('0.000548').toAmount()),
          )
        })
      } finally {
        await h.close()
      }
    },
  )
  it.each(['absent', 'mid-turn'] as const)(
    'keeps an ACP session usable after a %s store refusal',
    async (mode) => {
      const h = await fixture(mode)
      try {
        await h.run(async (client) => {
          await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
          const { sessionId } = await client.request('session/new', { cwd: root, mcpServers: [] })
          await expect(
            client.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: 'Read the files' }],
            }),
          ).rejects.toMatchObject({
            code:
              mode === 'mid-turn' ? ACP_ERROR_CODES.credentialStore : ACP_ERROR_CODES.turnFailed,
          })
          expect(h.requests()).toBe(mode === 'mid-turn' ? 2 : 0)
          h.recover()
          expect(
            await client.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: 'Continue' }],
            }),
          ).toMatchObject({ stopReason: 'end_turn' })
        })
      } finally {
        await h.close()
      }
    },
  )
})

import { ACCOUNT_REQUEST_CERTIFICATION } from '../../src/shared/constants'
// Fake-only installed request path. Responses use the existing captured Meta
// codec fixtures; loopback is private and receives only test credentials.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import { runtimeProvidersFile } from '../../src/runtime/providers/providersFileStore'
import { fakeModelApiHostDeps } from '../unit/helpers/modelApiHostDeps'
import { memoryToolIo } from '../unit/helpers/fakeToolIo'
import { memorySessionStore } from '../unit/helpers/fakeSessionStore'
import { memoryKeyring } from '../unit/helpers/keyring'
import { CURRENT_SHAPE_KEYS } from '../unit/helpers/modelApiKeys'
import { streamFor, TINY_PNG_BASE64 } from '../unit/helpers/fakeModelApi'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  ACCOUNT_REQUEST_STORE,
  MODEL_API_BASE_URL,
  M106_CAPTURED_META_MODEL,
} from '../../src/shared/constants'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import { accountPolicyFor } from '../../src/core/providers/accountPolicy'
import { loadDeveloperMachineId } from '../../src/core/developer/machineId'
import { Usd } from '../../src/shared/usd'
import { activeAccountBilling } from '../../src/core/accounts/requestWriter'
import type { PaidUseRequest } from '../../src/shared/paid'
import { poolRequest } from '../unit/helpers/accounts/pool'
import type { AccountRequestPort } from '../../src/core/accounts/requestWriter'
import {
  accountRequestRowSchema,
  accountRequestBlockSchema,
} from '../../src/runtime/providers/accountRequestJournal'
import { randomUUID } from 'node:crypto'

const MODEL = M106_CAPTURED_META_MODEL
const KEY_A = CURRENT_SHAPE_KEYS[0]
const KEY_B = CURRENT_SHAPE_KEYS[1]
const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const fixture: {
  origin: string
  is429: boolean
  was429: boolean
  failOnce: boolean
  switched?: (() => Promise<void>) | undefined
} = { origin: '', is429: false, was429: false, failOnce: false }
const frames: { authorization: string; body: unknown }[] = []
const folders: string[] = []
const hosts: ModelApiHost[] = []

const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
  if (request.url?.endsWith('/models') === true) {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }))
    return
  }
  const bytes: Buffer[] = []
  for await (const chunk of request) {
    const raw: unknown = chunk
    if (Buffer.isBuffer(raw)) bytes.push(raw)
    else if (typeof raw === 'string') bytes.push(Buffer.from(raw))
    else throw new Error('invalid fake HTTP chunk')
  }
  frames.push({
    authorization: request.headers.authorization ?? '',
    body: JSON.parse(Buffer.concat(bytes).toString()),
  })
  if (request.url?.includes('/images/') === true) {
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({ created: 1, data: [{ b64_json: TINY_PNG_BASE64 }], output_format: 'png' }),
    )
    return
  }
  if (fixture.failOnce) {
    fixture.failOnce = false
    await fixture.switched?.()
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({ error: { message: 'fixture server error', type: 'server_error' } }),
    )
    return
  }
  if (fixture.is429 && !fixture.was429 && request.headers.authorization === `Bearer ${KEY_A}`) {
    fixture.was429 = true
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
    response.end(
      JSON.stringify({ error: { message: 'fake rate limit', type: 'rate_limit_error' } }),
    )
    return
  }
  response.setHeader('content-type', 'text/event-stream')
  response.end(
    streamFor(
      { text: 'done', reasoning: 'visible reasoning', usage: { input: 10, output: 2 } },
      `reply${String(frames.length)}`,
      MODEL,
    ),
  )
}
const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    response.writeHead(500)
    response.end('fake fixture failure')
  })
})

beforeAll(async () => {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = true
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing loopback address')
  fixture.origin = `http://127.0.0.1:${String(address.port)}`
})
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  frames.length = 0
  fixture.is429 = false
  fixture.was429 = false
  fixture.failOnce = false
  fixture.switched = undefined
})
afterAll(async () => {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    }),
  )
})

async function rig(
  hasCap: boolean,
  requiresPolicyStop = false,
  selection?: { account: string; isInteractive: boolean; hasPoolFlag: boolean },
) {
  const folder = mkdtempSync(path.join(tmpdir(), 'cm1082-loopback-'))
  folders.push(folder)
  // The fake's permissive API policy lets the 429 drill test selection; the
  // real Meta record remains confirm and is separately covered by policy tests.
  writeFileSync(
    runtimeProvidersFile(folder),
    JSON.stringify({
      providers: {
        meta: {
          id: 'meta',
          policyProvider: 'meta',
          product: 'model-api',
          auth: 'apiKey',
          origin: new URL(MODEL_API_BASE_URL).origin,
          accounts: [
            {
              id: 'default',
              label: 'A',
              order: 0,
              thresholds: hasCap ? { requests: { day: 1 } } : {},
            },
            { id: 'work', label: 'B', order: 1, thresholds: {} },
          ],
        },
      },
    }),
  )
  const keyring = memoryKeyring()
  const services = createRuntimeAccountServices({
    dataDir: folder,
    openEntry: keyring.openEntry,
    now: () => Date.parse('2026-10-11T12:00:00Z'),
  })
  for (const [account, secret] of [
    ['default', KEY_A],
    ['work', KEY_B],
  ])
    await services.store.setCredential('meta', account!, {
      v: 1,
      auth: 'apiKey',
      provider: 'meta',
      account: account!,
      origin: new URL(MODEL_API_BASE_URL).origin,
      secret: secret!,
    })
  if (!requiresPolicyStop) {
    const policy = accountPolicyFor('meta', 'model-api')
    if (policy === undefined) throw new Error('missing captured policy')
    const confirmations = new AccountConfirmations({
      machineId: await loadDeveloperMachineId(folder),
      now: () => Date.parse('2026-10-11T12:00:00Z'),
      ask: () => Promise.resolve('confirm'),
      store: {
        read: () => Promise.resolve(undefined),
        write: (provider, product, value) => {
          writeFileSync(
            path.join(folder, `confirmation-${provider}-${product}.json`),
            JSON.stringify(value),
          )
          return Promise.resolve()
        },
        remove: () => Promise.resolve(),
      },
    })
    await confirmations.obtain(policy, true)
  }
  const client = new ModelApiClient({
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve(KEY_A),
    fetch: (url, init) => {
      const target = new URL(url instanceof Request ? url.url : url.toString())
      return fetch(new URL(target.pathname + target.search, fixture.origin), init)
    },
    now: Date.now,
    sleep: () => Promise.resolve(),
    random: () => 0,
    log,
  })
  const requests = await services.requests(client, selection)
  const host = createHost(client, requests)
  hosts.push(host)
  const { session, events } = await observedSession(host)
  const turn = async (terminal = 'completed') => {
    const previous = events.filter((event) => event.type === 'turnCompleted').length
    await session.sendTurn([{ type: 'text', text: 'hello' }])
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'turnCompleted')).toHaveLength(previous + 1)
    })
    expect(events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal,
    })
  }
  return { folder, services, session, requests, client, turn, keyring }
}

describe('installed account request writer', () => {
  it.each([true, false])(
    'headless account caps stay active and pooling requires its flag: %s',
    async (isPoolOn) => {
      const t = await rig(true, false, {
        account: 'default',
        isInteractive: false,
        hasPoolFlag: isPoolOn,
      })
      await t.turn()
      await t.turn(isPoolOn ? 'completed' : 'failed')
      expect(frames.map((frame) => frame.authorization)).toEqual(
        isPoolOn ? [`Bearer ${KEY_A}`, `Bearer ${KEY_B}`] : [`Bearer ${KEY_A}`],
      )
      t.services.dispose()
    },
  )

  it.each([true, false])(
    'user-selected payer is asked for hosted search before its first charge, never under default consent; allow=%s',
    async (allowed) => {
      const t = await rig(false)
      await t.services.sessions('meta').use(t.session.sessionId, 'work', () => true)
      const asked: string[] = []
      const host = new ModelApiHost({
        ...fakeModelApiHostDeps({
          client: t.client,
          workspaceRoot: '/workspace',
          io: memoryToolIo({}, '/workspace'),
          log,
        }),
        now: Date.now,
        accountRequests: t.requests,
        store: memorySessionStore(),
        isPaidFeatureOn: (feature) => feature === 'webSearch',
        modelCapabilities: () => ({
          hosted: {
            webSearch: { state: 'yes', value: { tool: 'web_search' } },
            maxToolCalls: { state: 'yes', value: true },
          },
        }),
        allowsPaidUse: (request) => {
          expect(frames).toEqual([])
          asked.push(activeAccountBilling()?.account ?? 'unleased')
          if (request.feature !== 'webSearch') throw new Error('unexpected paid fixture feature')
          return Promise.resolve(allowed ? request.quote : undefined)
        },
      })
      hosts.push(host)
      const { session, events } = await observedSession(host)
      await t.services.sessions('meta').use(session.sessionId, 'work', () => true)
      await session.sendTurn([{ type: 'text', text: 'search' }])
      await vi.waitFor(() => {
        expect(events.some((event) => event.type === 'turnCompleted')).toBe(true)
      })
      expect(asked).toEqual(['work'])
      expect(frames).toHaveLength(1)
      expect(frames[0]?.authorization).toBe(`Bearer ${KEY_B}`)
      if (allowed)
        expect(frames[0]?.body).toMatchObject({
          tools: expect.arrayContaining([expect.objectContaining({ type: 'web_search' })]),
        })
      else {
        expect(frames[0]?.body).toMatchObject({
          tools: expect.not.arrayContaining([expect.objectContaining({ type: 'web_search' })]),
        })
        const claim = readClaims(path.join(t.folder, ACCOUNT_REQUEST_STORE.directory))[0]
        expect(claim?.settledUsd).not.toBeNull()
        expect(claim?.settledUsd).not.toBe('0')
      }
      t.services.dispose()
    },
  )

  it('a user switch during HTTP 500 applies after the original payer retry and its settlement', async () => {
    const t = await rig(false)
    fixture.failOnce = true
    fixture.switched = async () => {
      await t.services.sessions('meta').use(t.session.sessionId, 'work', () => true)
    }
    await t.turn()
    await t.turn()
    expect(frames.map((frame) => frame.authorization)).toEqual([
      `Bearer ${KEY_A}`,
      `Bearer ${KEY_A}`,
      `Bearer ${KEY_B}`,
    ])
    const claims = readClaims(path.join(t.folder, ACCOUNT_REQUEST_STORE.directory))
    expect(claims.filter((row) => row.account === 'default')).toHaveLength(2)
    expect(claims.filter((row) => row.account === 'work')).toHaveLength(1)
    t.services.dispose()
  })
  it('chosen conversation account survives a service reload and removed selection refuses before default charge', async () => {
    const t = await rig(false)
    await t.services.sessions('meta').use(t.session.sessionId, 'work', () => true)
    t.services.dispose()
    const reloaded = createRuntimeAccountServices({
      dataDir: t.folder,
      openEntry: t.keyring.openEntry,
    })
    try {
      expect(await reloaded.sessions('meta').read(t.session.sessionId)).toMatchObject({
        currentAccount: 'work',
      })
      const requests = await reloaded.requests(t.client)
      const request = poolRequest({
        owner: t.session.sessionId,
        modelId: MODEL,
        account: 'default',
        checkSharedCaps: () => undefined,
      })
      const lease = await requests.acquire(request, new URL(MODEL_API_BASE_URL).origin)
      expect(lease.account).toBe('work')
      lease.beforeSend()
      await lease.settle(Usd.from('0.02').toAmount())
      await reloaded.store.remove('meta', 'work')
      await expect(requests.acquire(request, new URL(MODEL_API_BASE_URL).origin)).rejects.toThrow(
        'The chosen account no longer exists',
      )
      expect(frames).toEqual([])
      const next = await requests.acquire(request, new URL(MODEL_API_BASE_URL).origin)
      expect(next.account).toBe('default')
      await next.settle(Usd.from(0).toAmount())
    } finally {
      reloaded.dispose()
    }
  })

  it.each(['imageGeneration', 'autoReviewer', 'hookModels'] as const)(
    'selected payer is asked before the actual %s charge',
    async (feature) => {
      const t = await rig(false)
      await t.services.sessions('meta').use(t.session.sessionId, 'work', () => true)
      if (t.requests.paidClient === undefined)
        throw new Error('missing installed paid request port')
      const question: PaidUseRequest =
        feature === 'imageGeneration'
          ? { feature, kind: 'generate', path: 'test.png', sources: [], prompt: 'fixture' }
          : feature === 'autoReviewer'
            ? { feature, modelId: MODEL, tool: 'write_file', action: 'fixture' }
            : { feature, kind: 'prompt', modelId: MODEL, event: 'PreToolUse' }
      const ask = vi.fn(() => {
        expect(frames).toEqual([])
        expect(activeAccountBilling()).toMatchObject({ account: 'work' })
        return Promise.resolve(true)
      })
      const client = t.requests.paidClient(
        t.client,
        poolRequest({
          owner: t.session.sessionId,
          modelId: MODEL,
          account: 'default',
          checkSharedCaps: () => undefined,
        }),
        new URL(MODEL_API_BASE_URL).origin,
        question,
        false,
        ask,
      )
      if (feature === 'imageGeneration')
        await client.createImage(
          {
            model: 'muse-image',
            prompt: 'fixture',
            n: 1,
            size: '1024x1024',
            response_format: 'b64_json',
            output_format: 'png',
          },
          new AbortController().signal,
        )
      else {
        const events = client.streamResponse(
          {
            model: MODEL,
            input: [],
            instructions: 'fixture',
            tools: [],
            tool_choice: 'auto',
            stream: true,
            store: false,
            include: ['reasoning.encrypted_content'],
            max_output_tokens: 100,
            reasoning: { effort: 'low', summary: 'auto' },
            prompt_cache_key: 'fixture',
            prompt_cache_retention: 'in_memory',
          },
          new AbortController().signal,
        )
        for await (const _event of events) {
          /* Consume the actual response. */
        }
      }
      expect(ask).toHaveBeenCalledOnce()
      expect(frames.map((frame) => frame.authorization)).toEqual([`Bearer ${KEY_B}`])
      expect(readClaims(path.join(t.folder, ACCOUNT_REQUEST_STORE.directory))).toEqual([
        expect.objectContaining({ account: 'work', isClosed: true }),
      ])
      t.services.dispose()
    },
  )

  it('sees external cap and credential-revision edits before a held lease can send', async () => {
    for (const edit of ['cap', 'credential'] as const) {
      const t = await rig(false)
      const lease = await t.requests.acquire(
        poolRequest({
          modelId: MODEL,
          owner: `held-${edit}`,
          account: 'default',
          checkSharedCaps: () => undefined,
        }),
        new URL(MODEL_API_BASE_URL).origin,
      )
      const value: unknown = JSON.parse(readFileSync(runtimeProvidersFile(t.folder), 'utf8'))
      if (typeof value !== 'object' || value === null || !('providers' in value))
        throw new Error('missing fixture metadata')
      // The written fixture is parsed again by the production metadata port.
      const encoded = JSON.stringify(value)
      const changed =
        edit === 'cap'
          ? encoded.replace('"thresholds":{}', '"thresholds":{"requests":{"day":0}}')
          : encoded.replace(
              /"credentialRevision":"[a-f0-9-]+"/,
              () => `"credentialRevision":"${randomUUID()}"`,
            )
      writeFileSync(runtimeProvidersFile(t.folder), changed)
      expect(() => {
        lease.beforeSend()
      }).toThrow()
      await lease.settle(null)
      expect(frames).toEqual([])
      t.services.dispose()
    }
  })

  it('refuses a miswired A client for admitted B before any model frame or adoption', async () => {
    const t = await rig(true)
    await t.turn()
    const requests: AccountRequestPort = {
      current: t.requests.current.bind(t.requests),
      within: t.requests.within.bind(t.requests),
      acquire: async (request, target) => ({
        ...(await t.requests.acquire(request, target)),
        client: t.client,
      }),
    }
    const host = createHost(t.client, requests)
    hosts.push(host)
    const { session, events } = await observedSession(host)
    await session.sendTurn([{ type: 'text', text: 'hello' }])
    await vi.waitFor(() => {
      expect(
        events.some((event) => event.type === 'turnCompleted' && event.terminal === 'failed'),
      ).toBe(true)
    })
    expect(frames.map((frame) => frame.authorization)).toEqual([`Bearer ${KEY_A}`])
    expect(requests.current('conversation', session.sessionId)).toBe('default')
    t.services.dispose()
  })
  it('actual Meta policy stops a vendor-limit swap without a machine grant and names reset', async () => {
    fixture.is429 = true
    const t = await rig(false, true)
    await t.turn('failed')
    expect(frames.map((frame) => frame.authorization)).toEqual([`Bearer ${KEY_A}`])
    expect(t.requests.current('conversation', t.session.sessionId)).toBe('default')
    t.services.dispose()
  })

  it.each([true, false])(
    'paid worker spread uses B consent and original shared budget, allow=%s',
    async (isAllowed) => {
      const t = await rig(false)
      await t.turn()
      const question: PaidUseRequest = {
        feature: 'bestOfN',
        modelId: MODEL,
        prompt: 'hello',
        attempts: 2,
        requestCeilingPerAttempt: 1,
      }
      const ask = vi.fn((request: PaidUseRequest) => {
        expect(request).toEqual(question)
        expect(activeAccountBilling()).toMatchObject({ provider: 'meta', account: 'work' })
        return Promise.resolve(isAllowed)
      })
      const ownerDigest = createHash('sha256').update(KEY_A).digest('hex')
      const admit = vi.fn((digest: string | undefined) => {
        expect(digest).toBe(ownerDigest)
      })
      const host = new ModelApiHost({
        ...fakeModelApiHostDeps({
          client: t.client,
          workspaceRoot: '/worker',
          io: memoryToolIo({}, '/workspace'),
          log,
        }),
        now: Date.now,
        store: memorySessionStore(),
        getAccountId: () => Promise.resolve(ownerDigest),
        accountRequests: t.requests,
        usageKind: 'bestOfN',
        allowsAccountPaidUse: ask,
        admitResponseAttempt: Object.assign(admit, {
          paidRequest: question,
          paidFeature: 'bestOfN' as const,
        }),
      })
      hosts.push(host)
      const worker = await host.startSession({
        workspaceRoot: '/worker',
        modelId: MODEL,
        approvalMode: 'promptUnmatched',
      })
      const events: AgentEvent[] = []
      worker.onEvent((event) => {
        events.push(event)
      })
      await worker.sendTurn([{ type: 'text', text: 'hello' }])
      await vi.waitFor(() => {
        expect(events.some((event) => event.type === 'turnCompleted')).toBe(true)
      })
      expect(
        ask,
        JSON.stringify(events.findLast((event) => event.type === 'turnCompleted')),
      ).toHaveBeenCalledOnce()
      if (isAllowed) {
        expect(frames.map((frame) => frame.authorization)).toEqual([
          `Bearer ${KEY_A}`,
          `Bearer ${KEY_B}`,
        ])
        expect(admit).toHaveBeenCalled()
      } else {
        expect(frames.map((frame) => frame.authorization)).toEqual([`Bearer ${KEY_A}`])
        expect(admit).not.toHaveBeenCalled()
        expect(t.requests.current('worker', worker.sessionId)).toBeUndefined()
      }
      t.services.dispose()
    },
  )
  it('swaps A to B at cap, strips native replay, journals each payer, and keeps shared budget identity', async () => {
    const t = await rig(true)
    const notices: unknown[] = []
    t.services.sessions('meta').subscribe(t.session.sessionId, (event) => {
      notices.push(event)
    })
    await t.turn()
    await t.turn()
    expect(frames.map((frame) => frame.authorization)).toEqual([
      `Bearer ${KEY_A}`,
      `Bearer ${KEY_B}`,
    ])
    expect(frames[1]?.body).not.toMatchObject({
      input: expect.arrayContaining([expect.objectContaining({ type: 'reasoning' })]),
    })
    expect(JSON.stringify(frames[1]?.body)).toContain('visible reasoning')
    expect(notices).toContainEqual(
      expect.objectContaining({ type: 'swap', previousAccount: 'default', account: 'work' }),
    )
    expect(await t.services.sessions('meta').read(t.session.sessionId)).toMatchObject({
      currentAccount: 'work',
    })
    const files = path.join(t.folder, ACCOUNT_REQUEST_STORE.directory)
    const rows = readClaims(files)
    expect(rows.map((row) => row.account).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'default',
      'work',
    ])
    expect(
      rows.every((row) => row.isClosed && row.inputTokens === 10 && row.outputTokens === 2),
    ).toBe(true)
    expect(JSON.stringify(rows)).not.toContain(KEY_A)
    expect(JSON.stringify(rows)).not.toContain('"label"')
    t.services.dispose()
  })
  it('honours A 429 without transferring its retry and moves the next request to B', async () => {
    fixture.is429 = true
    const t = await rig(false)
    await t.turn('failed')
    await t.turn()
    expect(frames.map((frame) => frame.authorization)).toEqual([
      `Bearer ${KEY_A}`,
      `Bearer ${KEY_B}`,
    ])
    const files = path.join(t.folder, ACCOUNT_REQUEST_STORE.directory)
    const limitFile = readdirSync(files, { recursive: true })
      .map(String)
      .find((file) => path.basename(file).startsWith('limit-meta-default-'))
    if (limitFile === undefined) throw new Error('missing limit')
    const limit = accountRequestBlockSchema.parse(
      JSON.parse(readFileSync(path.join(files, limitFile), 'utf8')),
    )
    expect(Date.parse(limit.resetAt)).toBeGreaterThan(Date.now())
    const claim = readClaims(files).find((row) => row.account === 'default')
    if (claim?.settledUsd == null) throw new Error('missing settled claim')
    expect(Usd.from(claim.settledUsd).toAmount()).toBe('0')
    t.services.dispose()
  })
  it('switches only selected session, refuses stale adoption, and sends selected account header', async () => {
    const t = await rig(false)
    const sessions = t.services.sessions('meta')
    await expect(sessions.use(t.session.sessionId, 'work', () => false)).rejects.toThrow()
    await expect(sessions.read(t.session.sessionId)).resolves.toMatchObject({
      currentAccount: 'default',
    })
    await sessions.use(t.session.sessionId, 'work', () => true)
    await t.turn()
    expect(frames.map((frame) => frame.authorization)).toEqual([`Bearer ${KEY_B}`])
    await expect(sessions.read('other-session')).resolves.toMatchObject({
      currentAccount: 'default',
    })
    t.services.dispose()
  })
})

function createHost(client: ModelApiClient, requests: AccountRequestPort) {
  return new ModelApiHost({
    ...fakeModelApiHostDeps({
      client,
      workspaceRoot: '/workspace',
      io: memoryToolIo({}, '/workspace'),
      log,
    }),
    now: Date.now,
    accountRequests: requests,
    store: memorySessionStore(),
    getAccountId: () => Promise.resolve(createHash('sha256').update(KEY_A).digest('hex')),
  })
}
function readClaims(files: string) {
  return readdirSync(files, { recursive: true })
    .map(String)
    .filter((file) => path.basename(file).startsWith('claim-'))
    .map((file) =>
      accountRequestRowSchema.parse(JSON.parse(readFileSync(path.join(files, file), 'utf8'))),
    )
}

async function observedSession(host: ModelApiHost) {
  const session = await host.startSession({
    workspaceRoot: '/workspace',
    modelId: MODEL,
    approvalMode: 'promptUnmatched',
  })
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  return { session, events }
}

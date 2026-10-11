import { resolveAttemptBillingRoute } from '../../src/core/backends/modelapi/billingRoute'
import { describe, expect, it, vi } from 'vitest'
import type { PaidUseRequest } from '../../src/shared/paid'
import type { PaidFeature } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient, type ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import { billingKeyDigest, billingRoute } from '../../src/core/backends/modelapi/billingRoute'
import { RequestTransport } from '../../src/core/backends/modelapi/transport'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { SubscriptionCredential } from '../../src/host/auth/subscriptionCredential'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { memorySubscriptionFile } from './helpers/subscriptionFile'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

const MODEL = 'muse-spark-1.3'
const KEY = 'LLM|1|secret'
const PROVIDER = 'custom/model'

function setup(
  options: {
    cap?: number
    hook?: () => void
    pacing?: () => void
    paid?: PaidFeature[]
    hasPaidKey?: boolean
    consent?: (request: PaidUseRequest) => void
  } = {},
) {
  const log = new FakeLogOutputChannel()
  const api = fakeModelApi()
  const providerApi = fakeModelApi()
  const file = memorySubscriptionFile()
  file.writeAccessToken(KEY)
  let isEnabled = true
  const credential = new SubscriptionCredential({
    credentials: {
      getApiKey: () => Promise.resolve(options.hasPaidKey === false ? undefined : KEY),
    },
    isEnabled: () => isEnabled,
    platform: 'linux',
    homeDir: '/home/u',
    xdgConfigHome: undefined,
    source: file.source,
  })
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: api.fetch,
    apiKey: () => credential.getApiKey(),
    ...(options.pacing !== undefined && {
      pacing: {
        acquire: () => {
          options.pacing?.()
          return Promise.resolve()
        },
        snapshot: () => ({ requests: 0, tokens: 0 }),
        observe: () => undefined,
      },
    }),
  })
  const provider = fakeModelApiClient(providerApi, log)
  const registry = createProviderRegistry({
    models: () =>
      Promise.resolve([
        {
          ref: PROVIDER,
          origin: 'https://custom.test',
          evidence: { capabilities: { toolCalling: true }, maxOutputTokens: 100 },
          contextTokens: 1000,
          pricing: { kind: 'priced', card: { input: 0.000001, output: 0.000002, source: 'user' } },
        },
      ]),
    createClient: () => Promise.resolve(provider),
    isCurrent: () => true,
  })
  const io = memoryToolIo({}, '/workspace')
  io.runHook = () => {
    options.hook?.()
    return Promise.resolve({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
      isTimedOut: false,
      isCancelled: false,
    })
  }
  const hooks = parseHookConfig(
    JSON.stringify({
      hooks: { PreLLMCall: [{ hooks: [{ type: 'command', command: 'fake route change' }] }] },
    }),
    'project',
    'linux',
  ).hooks
  const paid = vi.fn()
  const consent = vi.fn((request: PaidUseRequest) => {
    options.consent?.(request)
    return Promise.resolve(true)
  })
  const store = memorySessionStore()
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: '/workspace', io, log }),
    store,
    models: registry,
    isPaidFeatureOn: (feature) => options.paid?.includes(feature) === true,
    notePaidUse: paid,
    allowsPaidUse: consent,
    ...(options.hook !== undefined && { loadHooks: () => Promise.resolve(hooks) }),
    sessionBudgetUsd: () => Usd.from(options.cap ?? 0).toAmount(),
    subscriptionAccountId: credential.accountId(),
    getBillingRoute: (isPaid) => credential.route(isPaid),
    getAccountId: async () => {
      try {
        const route = await credential.route()
        return route?.accountId
      } catch {
        return billingKeyDigest('configured-provider-account')
      }
    },
  })
  return {
    api,
    providerApi,
    host,
    client,
    io,
    paid,
    consent,
    credential,
    file,
    disable: () => {
      isEnabled = false
    },
  }
}

function captureGuards(t: ReturnType<typeof setup>, feature?: PaidFeature) {
  const guards: ResponseAttemptGuard[] = []
  const original = t.client.streamResponse.bind(t.client)
  vi.spyOn(t.client, 'streamResponse').mockImplementation(
    (body, signal, retry, budget, guard, confirmed) => {
      if (guard !== undefined && (feature === undefined || guard.paidFeature === feature))
        guards.push(guard)
      return original(body, signal, retry, budget, guard, confirmed)
    },
  )
  return guards
}

async function start(
  t: ReturnType<typeof setup>,
  approvalMode: 'allowAll' | 'onRequest' = 'allowAll',
) {
  const session = await t.host.startSession({
    workspaceRoot: '/workspace',
    modelId: MODEL,
    approvalMode,
  })
  if (!(session instanceof ModelApiSession)) throw new Error('expected Model API session')
  return { session, watch: watchSessionTurns(session) }
}

async function turn(s: Awaited<ReturnType<typeof start>>, text = 'hello') {
  const done = s.watch.turnDone()
  await s.session.sendTurn([{ type: 'text', text }])
  await done
  return s.watch.events.findLast((event) => event.type === 'turnCompleted')
}

describe('immutable billing routes', () => {
  it('refuses a legacy payer change before a retry can join pacing', async () => {
    const api = fakeModelApi()
    let key = KEY
    const acquire = vi.fn(() => Promise.resolve())
    const client = new ModelApiClient({
      ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
      fetch: api.fetch,
      apiKey: () => Promise.resolve(key),
      sleep: () => {
        key = 'opaque changed payer'
        return Promise.resolve()
      },
      pacing: { acquire, snapshot: () => ({ requests: 0, tokens: 0 }), observe: vi.fn() },
    })
    api.script({ httpError: { status: 503 } }, { text: 'must not dispatch' })
    await expect(
      Array.fromAsync(
        client.streamResponse(
          {
            model: MODEL,
            input: [],
            instructions: '',
            tools: [],
            tool_choice: 'auto',
            reasoning: { effort: 'high', summary: 'auto' },
            stream: true,
            store: false,
            include: [],
            max_output_tokens: 100,
            prompt_cache_key: 'legacy-retry',
            prompt_cache_retention: '24h',
          },
          new AbortController().signal,
          undefined,
          undefined,
          Object.assign(() => undefined, { paidFeature: 'subagents' as const }),
        ),
      ),
    ).rejects.toThrow(UI_TEXT.subscriptionKey.billingChanged)
    expect(acquire).toHaveBeenCalledOnce()
    expect(api.responseBodies()).toHaveLength(1)
  })

  it('uses the pasted key for Auto review on a subscription conversation', async () => {
    const t = setup({
      paid: ['autoReviewer'],
      cap: 1,
      consent: () => {
        t.file.writeAccessToken('opaque rotated plan bearer')
      },
    })
    const guards = captureGuards(t, 'autoReviewer')
    try {
      const s = await start(t, 'onRequest')
      t.api.script(
        { calls: [{ name: 'bash', arguments: '{"command":"npm test"}' }] },
        { text: 'ALLOW: runs tests', usage: { input: 900, output: 20 } },
        { text: 'done' },
      )
      await turn(s)
      expect(t.consent).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'autoReviewer' }),
        false,
        s.session.sessionId,
      )
      expect(t.paid).toHaveBeenCalledWith('autoReviewer', 1)
      expect(guards).toHaveLength(1)
      expect(guards[0]?.billingRoute?.kind).toBe('payAsYouGo')
      expect(t.io.shellCalls).toHaveLength(1)
      const reviews = t.api.requests.filter((request) =>
        JSON.stringify(request.body).includes('You review one action'),
      )
      expect(reviews).toHaveLength(1)
      expect(reviews[0]?.headers['Authorization']).toBe(`Bearer ${KEY}`)
    } finally {
      await t.host.close()
    }
  })
  it('uses the pasted key and a paid grant for a subscription subagent', async () => {
    const t = setup({
      paid: ['subagents'],
      consent: () => {
        t.file.writeAccessToken('opaque rotated plan bearer')
      },
    })
    const guards = captureGuards(t, 'subagents')
    try {
      const s = await start(t)
      t.api.script(
        {
          calls: [
            { name: 'subagent_spawn', arguments: '{"role":"explorer","objective":"Map files"}' },
          ],
        },
        { text: 'child done' },
        { text: 'parent done' },
      )
      await turn(s)
      await vi.waitFor(() => {
        expect(s.session.history().items).toContainEqual(
          expect.objectContaining({ kind: 'subagent', controlStatus: 'resultReady' }),
        )
      })
      expect(t.consent).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'subagents' }),
        false,
        s.session.sessionId,
      )
      expect(guards).toHaveLength(1)
      expect(guards[0]?.billingRoute?.kind).toBe('payAsYouGo')
      expect(t.paid).toHaveBeenCalledWith('subagents', 1)
      expect(
        t.api.requests.filter(
          (request) =>
            request.path === '/responses' && request.headers['Authorization'] === `Bearer ${KEY}`,
        ),
      ).toHaveLength(2)
    } finally {
      await t.host.close()
    }
  })
  it('refuses a subscription subagent without a pasted key with the localized reason', async () => {
    const t = setup({ paid: ['subagents'], hasPaidKey: false })
    try {
      const s = await start(t)
      t.api.script(
        {
          calls: [
            { name: 'subagent_spawn', arguments: '{"role":"explorer","objective":"Map files"}' },
          ],
        },
        { text: 'no child sent' },
      )
      expect(await turn(s)).toMatchObject({ terminal: 'completed' })
      expect(t.consent).not.toHaveBeenCalled()
      expect(t.paid).not.toHaveBeenCalled()
      expect(JSON.stringify(t.api.responseBodies())).toContain(UI_TEXT.subscriptionKey.paidNeedsKey)
    } finally {
      await t.host.close()
    }
  })
  it('sends the frozen subscription credential after bearer rotation during a hook', async () => {
    const t = setup({
      hook: () => {
        t.file.writeAccessToken('opaque rotated bearer')
      },
    })
    const guards = captureGuards(t)
    try {
      const s = await start(t)
      t.api.script({ text: 'accepted frozen credential' })
      expect(await turn(s)).toMatchObject({ terminal: 'completed' })
      expect(t.api.requests[0]?.headers['Authorization']).toBe(`Bearer ${KEY}`)
      expect(guards[0]?.billingRoute).toMatchObject({ kind: 'museCodePlan', credential: KEY })
      expect(() => guards[0]?.(billingKeyDigest('different sent key'))).toThrow(
        UI_TEXT.subscriptionKey.billingChanged,
      )
    } finally {
      await t.host.close()
    }
  })
  it('confirms the frozen route after prepare without re-reading auth', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const getter = vi.fn(() => {
      throw new Error('must use snapshot')
    })
    const transport = new RequestTransport({
      ...fakeModelApiClientSettings(log),
      apiKey: getter,
      fetch: api.fetch,
    })
    let isPrepared = false
    const confirm = vi.fn(() => {
      expect(isPrepared).toBe(true)
      return Promise.resolve()
    })
    const guard: ResponseAttemptGuard = Object.assign(() => undefined, {
      billingRoute: billingRoute('museCodePlan', KEY),
      prepare: () => {
        isPrepared = true
        return Promise.resolve()
      },
      confirmBillingRoute: confirm,
    })
    api.script({ text: 'snapshot answer' })
    await transport.request(
      '/responses',
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'ordinary',
          isMetaDirect: true,
          snapshot: guard.billingRoute,
        }),
        method: 'POST',
        accept: 'text/event-stream',
        body: { model: MODEL },
      },
      new AbortController().signal,
      undefined,
      undefined,
      guard,
    )
    expect(getter).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledOnce()
    expect(api.requests[0]?.headers['Authorization']).toBe(`Bearer ${KEY}`)
  })
  it.each([
    { name: 'a subscription opt-out during PreLLMCall', isPacing: false },
    { name: 'sign-out during pacing after auth retrieval', isPacing: true },
  ])('refuses $name without sending the pasted key', async ({ isPacing }) => {
    const change = () => {
      if (isPacing) t.file.writeText('{"schema_version":1,"providers":{}}')
      else t.disable()
    }
    const t = setup(isPacing ? { pacing: change } : { hook: change })
    try {
      const s = await start(t)
      t.api.script({ text: 'must not send' })
      expect(await turn(s)).toMatchObject({
        terminal: 'failed',
        reason: UI_TEXT.subscriptionKey.billingChanged,
      })
      expect(t.api.responseBodies()).toHaveLength(0)
    } finally {
      await t.host.close()
    }
  })
  it('carries the route and change fence through compaction collection', async () => {
    let shouldChange = false
    const t = setup({
      hook: () => {
        if (shouldChange) t.disable()
      },
    })
    try {
      const s = await start(t)
      t.api.script({ text: 'history to summarize' })
      expect(await turn(s)).toMatchObject({ terminal: 'completed' })
      shouldChange = true
      t.api.script({ text: 'must not summarize' })
      await expect(s.session.compact()).rejects.toThrow(UI_TEXT.subscriptionKey.billingChanged)
      expect(t.api.responseBodies()).toHaveLength(1)
    } finally {
      await t.host.close()
    }
  })
  it('keeps the next capped provider turn usable after a subscription turn', async () => {
    const t = setup({ cap: 1 })
    try {
      const s = await start(t)
      t.api.script({ text: 'plan answer' })
      expect(await turn(s)).toMatchObject({ terminal: 'completed' })
      await s.session.setModel(PROVIDER)
      t.providerApi.script({ text: 'paid answer' })
      expect(await turn(s)).toMatchObject({ terminal: 'completed' })
      expect(t.providerApi.responseBodies()).toHaveLength(1)
      const budgets = await t.host.readUsageBudgets()
      expect(budgets[0]?.budget.spentUsd).toBeGreaterThan(0)
    } finally {
      await t.host.close()
    }
  })
  it.each([0, 1])(
    'drops subscription fences after sign-out for a provider on the living host (cap: %s)',
    async (cap) => {
      const t = setup({ cap })
      try {
        const s = await start(t)
        t.api.script({ text: 'plan answer' })
        expect(await turn(s)).toEqual(expect.objectContaining({ terminal: 'completed' }))
        t.file.writeText('{"schema_version":1,"providers":{}}')
        await s.session.setModel(PROVIDER)
        t.providerApi.script({ text: 'provider answer' })
        expect(await turn(s)).toEqual(expect.objectContaining({ terminal: 'completed' }))
        expect(t.providerApi.responseBodies()).toHaveLength(1)
        const next = await t.host.startSession({
          workspaceRoot: '/workspace',
          modelId: PROVIDER,
          approvalMode: 'allowAll',
        })
        expect(next.modelId).toBe(PROVIDER)
      } finally {
        await t.host.close()
      }
    },
  )
  it('binds an external paid scope to the pasted credential and stable subscription owner', async () => {
    const t = setup({ cap: 1 })
    try {
      const s = await start(t)
      t.api.script({ text: 'plan parent' })
      expect(await turn(s)).toMatchObject({ terminal: 'completed' })
      const scope = await t.host.getOwnedBudgetScope(s.session.sessionId)
      expect(scope?.accountId).toBe(t.credential.accountId())
      expect(scope?.isStillAllowed(billingKeyDigest(KEY))).toBe(true)
      expect(t.consent).not.toHaveBeenCalled()
      expect(t.api.responseBodies()).toHaveLength(1)
    } finally {
      await t.host.close()
    }
  })
  it('uses provider auth even when an accidental Meta route or auth override is attached', async () => {
    const log = new FakeLogOutputChannel()
    const api = fakeModelApi()
    const auth = vi.fn(() =>
      Promise.resolve({
        values: { Authorization: `Bearer ${KEY}` },
        keyDigest: billingKeyDigest(KEY),
        redact: (text: string) => text,
      }),
    )
    const transport = new RequestTransport({
      ...fakeModelApiClientSettings(log),
      fetch: api.fetch,
      baseUrl: 'https://custom.test',
      auth: { headers: auth },
      verifyEndpoint: () => Promise.resolve(),
    })
    const route = billingRoute('museCodePlan', 'opaque Meta credential')
    const guard: ResponseAttemptGuard = Object.assign(() => undefined, { billingRoute: route })
    api.script({ text: 'provider answer' })
    await transport.request(
      '/responses',
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'ordinary',
          isMetaDirect: true,
          snapshot: route,
        }),
        method: 'POST',
        accept: 'text/event-stream',
        body: { model: MODEL },
        authKey: 'other Meta credential',
      },
      new AbortController().signal,
      undefined,
      undefined,
      guard,
    )
    expect(auth).toHaveBeenCalled()
    expect(api.requests[0]?.headers['Authorization']).toBe(`Bearer ${KEY}`)
  })
})

it('rebinds subscription to provider and back without restarting the host', async () => {
  const t = setup({ cap: 1 })
  try {
    const s = await start(t)
    t.api.script({ text: 'plan' })
    expect(await turn(s)).toMatchObject({ terminal: 'completed' })
    t.file.writeText('{}')
    const provider = await t.host.startSession({
      workspaceRoot: '/workspace',
      modelId: PROVIDER,
      approvalMode: 'allowAll',
    })
    const watch = watchSessionTurns(provider)
    t.providerApi.script({ text: 'provider' })
    const done = watch.turnDone()
    await provider.sendTurn([{ type: 'text', text: 'provider turn' }])
    await done
    t.file.writeAccessToken(KEY)
    const page = await t.host.listSessions({ workspaceRoot: '/workspace', limit: 100 })
    expect(page.sessions.some((entry) => entry.sessionId === s.session.sessionId)).toBe(true)
    await expect(t.host.resumeSession(s.session.sessionId, MODEL)).resolves.toBeDefined()
    const next = await start(t)
    t.api.script({ text: 'plan again' })
    expect(await turn(next)).toMatchObject({ terminal: 'completed' })
  } finally {
    await t.host.close()
  }
})

it('describes a refused retry after an earlier response was dispatched', async () => {
  let attempts = 0
  const t = setup({
    pacing: () => {
      attempts += 1
      if (attempts === 2) t.file.writeText('{}')
    },
  })
  try {
    const s = await start(t)
    t.api.script({ httpError: { status: 503 } })
    const result = await turn(s)
    expect(result).toMatchObject({ terminal: 'failed' })
    expect(t.api.requests).toHaveLength(1)
    expect(JSON.stringify(s.watch.events)).toContain('This attempt was refused')
    expect(JSON.stringify(s.watch.events)).not.toContain('Nothing was sent')
  } finally {
    await t.host.close()
  }
})

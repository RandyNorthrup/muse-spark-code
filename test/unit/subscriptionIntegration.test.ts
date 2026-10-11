import { Usd } from '../../src/shared/usd'
import type { AgentSession } from '../../src/core/agent/agentBackend'
import * as copilotAdapter from '../../src/host/providers/copilotClient'
import { fakeCopilotPort } from './helpers/fakeCopilotPort'
import { HOOK_EVENTS, parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { describe, expect, it, vi } from 'vitest'
import { createSubscriptionFeatures } from '../../src/host/providers/subscriptionFeatures'
import {
  providersFileSchema,
  readProvidersFile,
  writeProvidersFileAtomic,
} from '../../src/core/providers/providersFile'
import {
  runtimeChatGptCommandDeps,
  runChatGptProviderCommand,
  runtimeSubscriptionClient,
  chatGptAuthenticationMethods,
} from '../../src/runtime/chatGptProviderCommands'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeChatGptServer } from './helpers/fakeChatGptServer'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'
import { EN } from '../../src/shared/l10n/en'
import { chatGptPlanAccount } from '../../src/core/providers/subscriptions/registry'
import { chatGptRecordSchema } from '../../src/core/providers/subscriptions/chatgpt'

function secretStore() {
  const values = new Map<string, string>()
  return {
    values,
    get: (key: string) => Promise.resolve(values.get(key)),
    store: (key: string, value: string) => {
      values.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string) => {
      values.delete(key)
      return Promise.resolve()
    },
  }
}

function testMemento(state: Map<string, unknown>) {
  return {
    get: (key: string) => state.get(key),
    update: (key: string, value: unknown) => {
      state.set(key, value)
      return Promise.resolve()
    },
  }
}

function testWindow(directory: string, state: Map<string, unknown>) {
  return {
    log: new FakeLogOutputChannel(),
    globalStorageUri: vscode.Uri.file(directory),
    configFile: path.join(directory, 'providers.json'),
    l10n: { table: EN, locale: 'en' },
    globalState: testMemento(state),
    isRemote: false,
  }
}

async function observedTurn(
  session: AgentSession,
  watch: ReturnType<typeof watchSessionTurns>,
  text: string,
) {
  const done = watch.turnDone()
  await session.sendTurn([{ type: 'text', text }])
  await done
}

const ENTRY = {
  id: 'chatgpt',
  preset: 'chatgpt',
  auth: 'subscription',
  address: 'https://api.openai.com',
  format: 'responses',
  models: ['gpt-6-astra'],
}

async function exerciseHost(
  client: Parameters<typeof fakeModelApiHostDeps>[0]['client'],
  server: Awaited<ReturnType<typeof fakeChatGptServer>>,
) {
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'example.txt': 'An example.' }, '/workspace')
  const paid = vi.fn()
  const hookPayloads: unknown[] = []
  io.runHook = (_command, payload) => {
    const parsed: unknown = JSON.parse(payload)
    hookPayloads.push(parsed)
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
      hooks: Object.fromEntries(
        HOOK_EVENTS.map((event) => [
          event,
          [
            {
              ...((event === 'PreLLMCall' || event === 'PostLLMCall') && { matcher: 'chatgpt' }),
              hooks: [{ type: 'command', command: 'synthetic observer' }],
            },
          ],
        ]),
      ),
    }),
    'project',
    'linux',
  ).hooks
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/workspace' }),
    loadHooks: () => Promise.resolve(hooks),
    sessionBudgetUsd: () => Usd.from(0.000001).toAmount(),
    notePaidUse: paid,
    getAccountId: () => client.currentKeyDigest(),
  })
  try {
    const models = await host.listModels()
    expect(models.map((model) => model.modelId)).toEqual(['chatgpt/gpt-6-astra'])
    expect(models[0]).toMatchObject({ providerId: 'chatgpt', pricing: 'plan' })
    const session = await host.startSession({
      modelId: models[0]!.modelId,
      approvalMode: 'allowAll',
      workspaceRoot: '/workspace',
    })
    const watch = watchSessionTurns(session)
    await observedTurn(session, watch, 'Read example.txt.')
    expect(watch.events).toContainEqual(
      expect.objectContaining({ type: 'turnCompleted', terminal: 'completed' }),
    )
    expect(watch.events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({ tool: 'read_file' }),
      }),
    )
    const calls = server.requests.filter((request) => request.path === '/v1/responses')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.body).toMatchObject({ model: 'gpt-6-astra', store: false, stream: true })
    expect(calls[0]?.body).not.toHaveProperty('max_output_tokens')
    expect(calls[0]?.body).not.toHaveProperty('prompt_cache_retention')
    expect(calls[0]?.body).not.toHaveProperty('previous_response_id')
    expect(calls[1]?.body).toMatchObject({
      input: expect.arrayContaining([expect.objectContaining({ type: 'function_call_output' })]),
    })
    server.cap()
    await observedTurn(session, watch, 'Test the client output cap.')
    expect(watch.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      errorKind: 'modelApi',
    })
    server.limit()
    await observedTurn(session, watch, 'One more turn.')
    expect(watch.events).toContainEqual(
      expect.objectContaining({
        type: 'turnCompleted',
        terminal: 'failed',
        errorKind: 'subscription_sharing_usage_limit_exceeded',
      }),
    )
    server.overflow()
    // The real stream receives more than its byte cap in bounded comment frames.
    await observedTurn(session, watch, 'Refuse an oversized SSE transport.')
    expect(watch.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      errorKind: 'modelApi',
    })
    expect(host.readPlanUsage()).toMatchObject([
      {
        providerId: 'chatgpt',
        requests: 5,
        reported: { requests: 3, inputTokens: 30, outputTokens: 32_779 },
      },
    ])
    expect(paid).not.toHaveBeenCalled()
    for (const event of [
      'SessionStart',
      'UserPromptSubmit',
      'PreLLMCall',
      'PostLLMCall',
      'PreToolUse',
      'PostToolUse',
      'Stop',
      'StopFailure',
    ]) {
      expect(hookPayloads).toContainEqual(
        expect.objectContaining({
          hook_event_name: event,
          model: 'chatgpt/gpt-6-astra',
          model_provider: 'chatgpt',
          ...((event === 'PreLLMCall' || event === 'PostLLMCall') && { provider: 'chatgpt' }),
        }),
      )
    }
    expect(JSON.stringify(hookPayloads)).not.toContain('synthetic-plan-access')
    expect(
      JSON.stringify([log.warn.mock.calls, log.info.mock.calls, log.error.mock.calls]),
    ).not.toContain('synthetic-plan-access')
  } finally {
    await host.close()
  }
}

describe('M95b production subscription integration', () => {
  it('sanitizes corrupted own-store identity records before a host can expose their parse detail', async () => {
    const secrets = secretStore()
    secrets.values.set('museSpark.provider.chatgpt', 'synthetic-private-grant')
    const features = createSubscriptionFeatures({
      ...testWindow(tmpdir(), new Map()),
      secrets,
      isConfidential: () => false,
      access: { canSendRequest: () => false, onDidChange: () => ({ dispose: vi.fn() }) },
      fetch: () => Promise.reject(new Error('No HTTP')),
      connected: vi.fn(() => Promise.resolve()),
      disconnected: vi.fn(() => Promise.resolve()),
    })
    await expect(features.accountId()).rejects.toThrow(EN.acpChatGpt.failure)
    await expect(features.planAccount()).rejects.toThrow(EN.acpChatGpt.failure)
  })
  it('pins subscription configuration and refuses credential or arbitrary-origin fields', () => {
    expect(providersFileSchema.safeParse({ v: 1, providers: [ENTRY] }).success).toBe(true)
    for (const changed of [
      { address: 'https://evil.example' },
      { address: 'http://127.0.0.1' },
      { format: 'chat' },
      { preset: 'custom' },
      { id: 'other' },
      { models: [] },
      { models: [''] },
      { token: 'synthetic-credential' },
    ]) {
      expect(
        providersFileSchema.safeParse({ v: 1, providers: [{ ...ENTRY, ...changed }] }).success,
      ).toBe(false)
    }
  })
  it('VS Code browser sign-in → account catalogue → real host tool turn → HTTP-200 usage limit', async () => {
    const server = await fakeChatGptServer()
    const directory = await mkdtemp(path.join(tmpdir(), 'm95b-int-'))
    const secrets = secretStore()
    try {
      const state = new Map<string, unknown>()
      const connected = vi.fn(() => Promise.resolve())
      const disconnected = vi.fn(() => Promise.resolve())
      vi.spyOn(vscode.env, 'openExternal').mockImplementation(async (uri) => {
        await server.openBrowser(uri.path)
        return true
      })
      const features = createSubscriptionFeatures({
        ...testWindow(directory, state),
        secrets,
        isConfidential: () => false,
        access: { canSendRequest: () => true, onDidChange: () => ({ dispose: vi.fn() }) },
        fetch: server.fetch,
        connected,
        disconnected,
      })
      await features.connectChatGpt()
      const account = await features.planAccount()
      expect(account).toMatchObject({
        providerId: 'chatgpt',
        accountIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      })
      expect(JSON.stringify(account)).not.toContain('synthetic-account-A')
      const stored = secrets.values.get('museSpark.provider.chatgpt')
      if (stored === undefined) throw new Error('Missing synthetic grant')
      const record = chatGptRecordSchema.parse(JSON.parse(stored))
      expect(chatGptPlanAccount({ ...record, pendingRefresh: {} })).toBeUndefined()
      expect(chatGptPlanAccount({ ...record, accountIdHash: undefined })).toBeUndefined()
      expect(chatGptPlanAccount(undefined)).toBeUndefined()
      expect(connected).toHaveBeenCalledWith('chatgpt/gpt-6-astra')
      const configuredProviders = await features.seam.store.list()
      expect(configuredProviders[0]?.models).toEqual(['gpt-6-astra'])
      const meta = fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())
      await exerciseHost(await features.createClient(meta), server)
      await vi.waitFor(() => {
        expect(state.get('subscriptionUsage')).toMatchObject([
          { providerId: 'chatgpt', requests: 5 },
        ])
      })
      await features.removeSubscription('chatgpt')
      expect(disconnected).toHaveBeenCalledOnce()
      expect(secrets.values.has('museSpark.provider.chatgpt')).toBe(false)
      expect(await features.planAccount()).toBeUndefined()
      await features.connectChatGpt()
      expect(await features.planAccount()).toEqual(account)
      await features.removeSubscription('chatgpt')
      server.account('synthetic-account-B')
      await features.connectChatGpt()
      expect(await features.planAccount()).not.toEqual(account)
      await features.removeSubscription('chatgpt')
      expect(server.requests.some((request) => request.path === '/api/accounts/oauth/revoke')).toBe(
        true,
      )
    } finally {
      await server.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('terminal add/status/remove and ACP authentication share the real runtime registry', async () => {
    const server = await fakeChatGptServer()
    const directory = await mkdtemp(path.join(tmpdir(), 'm95b-acp-'))
    const configFile = path.join(directory, 'providers.json')
    const secrets = secretStore()
    const options = {
      secrets,
      fetch: server.fetch,
      openBrowser: server.openBrowser,
      callbackText: () => 'Synthetic callback',
      configFile,
      uiText: EN,
      locale: 'en',
      print: vi.fn(),
      printError: vi.fn(),
    }
    try {
      const commands = runtimeChatGptCommandDeps(options)
      expect(await runChatGptProviderCommand('add', commands)).toBe(0)
      expect(await readProvidersFile(configFile)).toMatchObject({
        ok: true,
        file: { providers: [ENTRY] },
      })
      const auth = chatGptAuthenticationMethods(commands.createHost)
      expect(auth.map((method) => method.args)).toEqual([
        ['providers', 'add', 'chatgpt'],
        ['providers', 'remove', 'chatgpt'],
        ['providers', 'status', 'chatgpt'],
      ])
      expect(await auth[0]!.verify?.()).toBeUndefined()
      expect(await runChatGptProviderCommand('status', commands)).toBe(0)
      const runtime = runtimeSubscriptionClient(options)
      const meta = fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())
      await exerciseHost(await runtime.createClient(meta), server)
      expect(await runChatGptProviderCommand('remove', commands)).toBe(0)
      expect(await auth[1]!.verify?.()).toBeUndefined()
      expect(await runtime.accountId()).toBeUndefined()
      expect(options.printError).not.toHaveBeenCalled()
    } finally {
      await server.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('VS Code factory → host Copilot consent → tool loop → estimated usage → sanitized quota and confidentiality', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm95b-copilot-'))
    const fixture = fakeCopilotPort()
    const connect = copilotAdapter.connectCopilotFromClick
    vi.spyOn(copilotAdapter, 'connectCopilotFromClick').mockImplementation(
      async (deps) => await connect({ ...deps, api: fixture.api }),
    )
    const state = new Map<string, unknown>()
    let isConfidential = false
    const features = createSubscriptionFeatures({
      ...testWindow(directory, state),
      secrets: secretStore(),
      isConfidential: () => isConfidential,
      access: { canSendRequest: () => undefined, onDidChange: () => ({ dispose: vi.fn() }) },
      fetch: () => Promise.reject(new Error('No HTTP for Copilot')),
      connected: vi.fn(() => Promise.resolve()),
      disconnected: vi.fn(() => Promise.resolve()),
    })
    let host: ModelApiHost | undefined
    try {
      expect(features.hasCopilotAccess()).toBe(false)
      await features.connectCopilot()
      expect(fixture.model.sendRequest).not.toHaveBeenCalled()
      expect(features.hasCopilotAccess()).toBe(true)
      const client = await features.createClient(
        fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel()),
      )
      const io = memoryToolIo({ 'example.txt': 'An example.' }, '/workspace')
      host = new ModelApiHost({
        ...fakeModelApiHostDeps({
          client,
          io,
          log: new FakeLogOutputChannel(),
          workspaceRoot: '/workspace',
        }),
        getAccountId: features.accountId,
        sessionBudgetUsd: () => Usd.from(0.000001).toAmount(),
      })
      expect(await host.listModels()).toMatchObject([
        {
          modelId: 'copilot/synthetic-copilot',
          pricing: 'plan',
          trainsOnContent: true,
          contextLimit: 1000,
        },
      ])
      const session = await host.startSession({
        modelId: 'copilot/synthetic-copilot',
        approvalMode: 'allowAll',
        workspaceRoot: '/workspace',
      })
      const watch = watchSessionTurns(session)
      await observedTurn(session, watch, 'Read example.txt.')
      expect(watch.events).toContainEqual(
        expect.objectContaining({
          type: 'itemCompleted',
          item: expect.objectContaining({ tool: 'read_file' }),
        }),
      )
      expect(fixture.model.sendRequest).toHaveBeenCalledTimes(2)
      expect(fixture.model.sendRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ justification: EN.planUi.aiContent }),
        expect.anything(),
      )
      fixture.quota()
      await observedTurn(session, watch, 'One more turn.')
      expect(watch.events).toContainEqual(
        expect.objectContaining({
          type: 'turnCompleted',
          terminal: 'failed',
          reason: EN.planUi.copilotQuota,
        }),
      )
      expect(host.readPlanUsage()).toMatchObject([
        {
          providerId: 'copilot',
          requests: 3,
          estimated: { requests: 3, inputTokens: 15, outputTokens: 2 },
        },
      ])
      isConfidential = true
      expect(features.hasCopilotAccess()).toBe(false)
      await expect(host.listModels()).rejects.toThrow(EN.planUi.copilotUnavailable)
      expect(fixture.model.sendRequest).toHaveBeenCalledTimes(3)
    } finally {
      await host?.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('retries a Windows sharing refusal without deleting the previous providers file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm95b-rename-'))
    const file = path.join(directory, 'providers.json')
    try {
      expect(await writeProvidersFileAtomic(file, { v: 1, providers: [] })).toEqual({ ok: true })
      let attempts = 0
      const result = await writeProvidersFileAtomic(
        file,
        { v: 1, providers: [ENTRY] },
        async (from, to) => {
          attempts += 1
          if (attempts === 1) {
            expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ v: 1, providers: [] })
            throw Object.assign(new Error('synthetic sharing refusal'), { code: 'EPERM' })
          }
          await rename(from, to)
        },
      )
      expect(result).toEqual({ ok: true })
      expect(attempts).toBe(2)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConfiguredProviderServices,
  type ConfiguredProviderOptions,
} from '../../src/core/providers/configured'
import * as configuredEntry from '../../src/host/backend/configuredProvidersEntry'
import { createSubscriptionFeatures } from '../../src/host/providers/subscriptionFeatures'
import { createPkcePair } from '../../src/core/providers/pkce'
import { startOAuthLoopback, type OAuthLoopback } from '../../src/host/providers/oauthLoopback'
import {
  writeProvidersFileAtomic,
  emptyProvidersFile,
} from '../../src/core/providers/providersFile'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  runOpenRouterConnect,
  runOpenRouterUsage,
  openRouterAuthenticationMethods,
} from '../../src/runtime/openRouterCommands'
import { providersAdd, userFileIo } from '../../src/runtime/providersCommands'
import type { ProvidersDeps } from '../../src/runtime/providersCommands'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import { EN } from '../../src/shared/l10n/en'
import { providerKeyUsageSchema } from '../../src/shared/modelsPanel'
import { providerUsageRowSchema } from '../../src/shared/usage'
import { UI_TEXT, PROVIDER_SECRET_PREFIX } from '../../src/shared/constants'
import { memorySecrets } from './helpers/fakes'
import { testProvidersHost } from './helpers/m95kFixtures'
import {
  latestState,
  openModelsPanel,
  resetModelsPanelWindow,
  send,
} from './helpers/modelsPanelHarness'

const KEY = 'sk-or-synthetic-test-key-never-valid'
const ORIGIN = 'https://openrouter.ai'
const ENTRY = {
  id: 'router',
  preset: 'openrouter',
  address: ORIGIN,
  auth: 'apiKey' as const,
  models: ['openai/gpt-oss-20b'],
}
const roots: string[] = []
beforeEach(resetModelsPanelWindow)
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const response = (body: unknown, status = 200) => ({
  status,
  headers: {},
  body: (async function* () {
    yield* await Promise.resolve([Buffer.from(JSON.stringify(body))])
  })(),
  close: vi.fn(),
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'cm952-'))
  roots.push(root)
  const configFile = path.join(root, 'providers.json')
  const catalogFile = path.join(root, 'catalog.json')
  const secrets = memorySecrets()
  const captured: unknown = JSON.parse(
    await readFile('docs/certification/m95-captures/openrouter/02-key-usage.json', 'utf8'),
  )
  const usage = z.object({ response: z.object({ body: z.json() }) }).parse(captured).response.body
  const calls: { url: string; body: unknown; headers: Readonly<Record<string, string>> }[] = []
  let payload: unknown = usage
  let status = 200
  const send: NonNullable<ConfiguredProviderOptions['send']> = (target, bytes, headers) => {
    calls.push({
      url: target.url.href,
      body: bytes === undefined ? undefined : JSON.parse(bytes),
      headers,
    })
    return Promise.resolve(response(payload, status))
  }
  const options = {
    configFile,
    catalogFile,
    secrets,
    send,
    resolve: () => Promise.resolve(['8.8.8.8']),
  }
  const services = createConfiguredProviderServices(undefined, options)
  await writeProvidersFileAtomic(configFile, { v: 1, providers: [ENTRY] })
  await secrets.store(
    `${PROVIDER_SECRET_PREFIX}router`,
    formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY),
  )
  const printed: string[] = [],
    errors: string[] = []
  let file = emptyProvidersFile()
  const deps: ProvidersDeps = {
    secrets,
    fetch: vi.fn(),
    resolveHost: options.resolve,
    readSecret: () => Promise.resolve('synthetic-code'),
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
    readUserFile: () => Promise.resolve({ ok: true, file }),
    writeUserFile: (next) => {
      file = next
      return Promise.resolve(true)
    },
  }
  return {
    ...options,
    services,
    deps,
    printed,
    errors,
    calls,
    usage,
    getFile: () => file,
    setPayload: (next: unknown, code = 200) => {
      payload = next
      status = code
    },
  }
}

function waitForAbort<T>(
  signal: AbortSignal | undefined,
  started: { readonly resolve: (value: undefined) => void },
  onAbort: () => void = () => undefined,
): Promise<T> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener(
      'abort',
      () => {
        onAbort()
        reject(new Error('cancelled'))
      },
      { once: true },
    )
    started.resolve(undefined)
  })
}

async function panelWithCredential(host: ReturnType<typeof testProvidersHost>) {
  const account = `${PROVIDER_SECRET_PREFIX}openrouter`
  await host.secrets.store(
    account,
    formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY),
  )
  const opened = openModelsPanel({ providers: host.providers })
  await send(opened.panel, { type: 'modelsPanel/ready' }, () => {
    expect(latestState(opened.panel).providers[0]?.keyUsage).toBeDefined()
  })
  return { ...opened, account }
}

const EXPECTED_USAGE = {
  usedTotal: 0,
  unlimited: false,
  usedToday: 0,
  usedThisWeek: 0,
  usedThisMonth: 0,
  limit: 2,
  remaining: 2,
}
describe('CM952 production OpenRouter composition', () => {
  it('normalizes every new key-usage money field through the exact boundary', () => {
    const amounts = { totalUsd: 0.0000001, weekUsd: 0.125 }
    const exact = { totalUsd: '0.0000001', weekUsd: '0.125' }
    expect(providerKeyUsageSchema.parse(amounts)).toMatchObject(exact)
    const base = {
      providerId: 'router',
      providerLabel: 'OpenRouter',
      pricing: 'priced',
      inputTokens: 0,
      outputTokens: 0,
    }
    expect(
      providerUsageRowSchema.parse({ ...base, keyUsage: { ...amounts, todayUsd: 0, monthUsd: 0 } })
        .keyUsage,
    ).toMatchObject(exact)
    for (const invalid of [-1, NaN, Infinity]) {
      expect(
        providerKeyUsageSchema.safeParse({ totalUsd: invalid, weekUsd: invalid }).success,
      ).toBe(false)
      expect(
        providerUsageRowSchema.safeParse({
          ...base,
          keyUsage: { totalUsd: invalid, weekUsd: invalid, todayUsd: 0, monthUsd: 0 },
        }).success,
      ).toBe(false)
    }
  })

  it.each([
    ['aborts exchange before dispatch when endpoint verification is still pending', 'exchange'],
    ['aborts key-usage endpoint verification without dispatch', 'usage'],
  ] as const)('%s', async (_name, operation) => {
    const f = await fixture()
    const controller = new AbortController()
    const dns = Promise.withResolvers<readonly string[]>()
    const entered = Promise.withResolvers<undefined>()
    const api = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => {
        entered.resolve(undefined)
        return dns.promise
      },
    })
    const pending =
      operation === 'exchange'
        ? api.openRouterExchange('synthetic-code', createPkcePair().verifier, controller.signal)
        : api.openRouterUsage(ENTRY, KEY, controller.signal)
    const refused = expect(pending).rejects.toThrow(
      operation === 'exchange' ? UI_TEXT.providerConnectFailed : UI_TEXT.providerUsageFailed,
    )
    await entered.promise
    controller.abort()
    await refused
    dns.resolve(['8.8.8.8'])
    expect(f.calls).toEqual([])
  })

  it.each(['cancel', 'back', 'close'] as const)(
    'cancels an in-flight key-usage read without starting another: %s',
    async (event) => {
      const started = Promise.withResolvers<undefined>()
      let shouldHold = false
      let wasAborted = false
      const read = vi.fn((_credential: string, signal?: AbortSignal) => {
        if (!shouldHold) return Promise.resolve(EXPECTED_USAGE)
        return waitForAbort<typeof EXPECTED_USAGE>(signal, started, () => {
          wasAborted = true
        })
      })
      const f = testProvidersHost({ deps: { usage: { read } } })
      const { panel, account } = await panelWithCredential(f)
      try {
        await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
          expect(latestState(panel).drafts.wizard).toBeDefined()
        })
        const previousReads = read.mock.calls.length
        shouldHold = true
        panel.webview.messages.fire({ type: 'providers/readUsage' })
        await started.promise
        if (event === 'close') panel.dispose()
        else
          await send(panel, { type: 'providers/wizard', event }, () => {
            expect(wasAborted).toBe(true)
            if (event === 'cancel') expect(latestState(panel).drafts.wizard).toBeUndefined()
            else expect(latestState(panel).drafts.wizard?.step).toBe('pick-provider')
          })
        expect(wasAborted).toBe(true)
        expect(read.mock.calls.length).toBe(previousReads + 1)
        expect(await f.secrets.get(account)).toBeDefined()
      } finally {
        panel.dispose()
      }
    },
  )

  it.each(['cancel', 'back', 'remove', 'close', 'select', 'change-key'] as const)(
    'cancels a stalled token transport and releases the panel queue: %s',
    async (event) => {
      const f = await fixture()
      const started = Promise.withResolvers<undefined>()
      let wasAborted = false
      const api = createConfiguredProviderServices(undefined, {
        ...f,
        send: (_target, _body, _headers, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                wasAborted = true
                reject(new Error('cancelled'))
              },
              { once: true },
            )
            started.resolve(undefined)
          }),
      })
      const host = testProvidersHost({
        deps: {
          pkce: { create: createPkcePair, newState: () => createPkcePair().state },
          exchanger: {
            exchange: (request) =>
              api.openRouterExchange(request.code, request.verifier, request.signal),
          },
        },
      })
      const { panel } = openModelsPanel({ providers: host.providers })
      try {
        await send(panel, { type: 'modelsPanel/ready' }, () => {
          expect(latestState(panel).presets.length).toBeGreaterThan(0)
        })
        await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
          expect(latestState(panel).drafts.wizard).toBeDefined()
        })
        panel.webview.messages.fire({ type: 'providers/connect' })
        await started.promise
        expect(latestState(panel).drafts.wizard?.connecting).toBe(true)
        switch (event) {
          case 'close': {
            panel.dispose()
            break
          }
          case 'remove': {
            panel.webview.messages.fire({ type: 'providers/remove', providerId: 'openrouter' })
            break
          }
          case 'select': {
            panel.webview.messages.fire({ type: 'providers/select', presetId: 'ollama' })
            break
          }
          case 'change-key': {
            panel.webview.messages.fire({ type: 'providers/enterKey', mode: 'new' })
            break
          }
          default: {
            panel.webview.messages.fire({ type: 'providers/wizard', event })
          }
        }
        await vi.waitFor(() => {
          expect(wasAborted).toBe(true)
        })
        if (event !== 'close') {
          await send(panel, { type: 'providers/select', presetId: 'ollama' }, () => {
            expect(latestState(panel).drafts.wizard?.presetId).toBe('ollama')
            expect(latestState(panel).drafts.wizard?.connecting).not.toBe(true)
            expect(latestState(panel).notice).toBeUndefined()
          })
        }
        expect(host.secrets.values.size).toBe(0)
      } finally {
        panel.dispose()
      }
    },
  )

  it.each(['removed', 'rotated', 'failed', 'unreadable'] as const)(
    'discards previous Models usage on the next observation: %s',
    async (event) => {
      const read = vi.fn(() =>
        Promise.resolve({
          usedTotal: 8,
          usedToday: 1,
          usedThisWeek: 2,
          usedThisMonth: 3,
          limit: undefined,
          remaining: undefined,
        }),
      )
      const f = testProvidersHost({ deps: { usage: { read } } })
      const { panel, account } = await panelWithCredential(f)
      try {
        expect(latestState(panel).providers[0]?.keyUsage?.totalUsd).toBe('8')
        switch (event) {
          case 'removed': {
            await f.secrets.delete(account)
            break
          }
          case 'unreadable': {
            await f.secrets.store(account, 'invalid-record')
            break
          }
          case 'rotated': {
            await f.secrets.store(
              account,
              formatStoredProviderSecret(
                { v: 1, auth: 'apiKey', origin: ORIGIN },
                'sk-or-rotated-synthetic',
              ),
            )
            break
          }
          case 'failed': {
            break
          }
        }
        read.mockRejectedValue(new Error('unavailable'))
        await send(
          panel,
          { type: 'models/filter', filter: {}, sort: { key: 'name', direction: 'asc' } },
          () => {
            const row = latestState(panel).providers[0]
            expect(row?.keyUsage).toBeUndefined()
            expect(row?.keyUsageError).toBe(UI_TEXT.providerUsageFailed)
          },
        )
        expect(read).toHaveBeenCalledTimes(event === 'removed' || event === 'unreadable' ? 1 : 2)
      } finally {
        panel.dispose()
      }
    },
  )

  it.each(['rotated', 'removed'] as const)(
    'discards Models usage when the credential changes during its read: %s',
    async (event) => {
      let shouldChangeCredential = false
      const account = `${PROVIDER_SECRET_PREFIX}openrouter`
      const f = testProvidersHost({
        deps: {
          usage: {
            read: async () => {
              if (shouldChangeCredential) {
                if (event === 'removed') await f.secrets.delete(account)
                else
                  await f.secrets.store(
                    account,
                    formatStoredProviderSecret(
                      { v: 1, auth: 'apiKey', origin: ORIGIN },
                      'sk-or-rotated-synthetic',
                    ),
                  )
              }
              return {
                usedTotal: 8,
                usedToday: 1,
                usedThisWeek: 2,
                usedThisMonth: 3,
                limit: undefined,
                remaining: undefined,
              }
            },
          },
        },
      })
      const { panel } = await panelWithCredential(f)
      try {
        expect(latestState(panel).providers[0]?.keyUsage?.totalUsd).toBe('8')
        shouldChangeCredential = true
        await send(panel, { type: 'providers/readUsage' }, () => {
          expect(latestState(panel).providers[0]?.keyUsage).toBeUndefined()
          expect(latestState(panel).providers[0]?.keyUsageError).toBe(UI_TEXT.providerUsageFailed)
        })
      } finally {
        panel.dispose()
      }
    },
  )

  it('reads the captured key endpoint with bound auth, pinned DNS and all attribution headers', async () => {
    const f = await fixture()
    expect(await f.services.openRouterUsage(ENTRY)).toEqual(EXPECTED_USAGE)
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({
      url: `${ORIGIN}/api/v1/key`,
      body: undefined,
      headers: {
        authorization: `Bearer ${KEY}`,
        'HTTP-Referer': 'https://github.com/RandyNorthrup/muse-spark-code',
        'X-OpenRouter-Title': 'Muse Spark Code (Unofficial)',
        'X-OpenRouter-Categories': 'ide-extension',
      },
    })
  })
  it('keeps an unlimited key distinct from a zero-dollar limit', async () => {
    const f = await fixture()
    f.setPayload({
      data: {
        usage: 4,
        usage_daily: 1,
        usage_weekly: 2,
        usage_monthly: 3,
        limit: null,
        limit_remaining: null,
      },
    })
    expect(await f.services.openRouterUsage(ENTRY)).toEqual({
      usedTotal: 4,
      unlimited: true,
      usedToday: 1,
      usedThisWeek: 2,
      usedThisMonth: 3,
      limit: undefined,
      remaining: undefined,
    })
  })
  it('refuses malformed, negative, missing and undocumented usage without echoing service text', async () => {
    const f = await fixture()
    for (const data of [
      { usage: -1 },
      { usage: KEY },
      { usage: 0 },
      { limit: '2' },
      { unexpected: true },
    ]) {
      f.setPayload({ data })
      await expect(f.services.openRouterUsage(ENTRY)).rejects.toThrow(UI_TEXT.providerUsageFailed)
    }
    f.setPayload({ error: { message: KEY } }, 401)
    await expect(f.services.openRouterUsage(ENTRY)).rejects.toThrow(UI_TEXT.providerUsageFailed)
  })
  it('refuses edited origins, private DNS and credentials for another origin before sending', async () => {
    const f = await fixture()
    for (const address of ['https://attacker.example', `${ORIGIN}/other`])
      await expect(f.services.openRouterUsage({ ...ENTRY, address }, KEY)).rejects.toThrow()
    const privateApi = createConfiguredProviderServices(undefined, {
      ...f,
      resolve: () => Promise.resolve(['127.0.0.1']),
    })
    await expect(privateApi.openRouterUsage(ENTRY)).rejects.toThrow()
    await f.secrets.store(
      `${PROVIDER_SECRET_PREFIX}router`,
      formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: 'https://attacker.example' }, KEY),
    )
    await expect(f.services.openRouterUsage(ENTRY)).rejects.toThrow()
    expect(f.calls).toEqual([])
  })
  it('exchanges the documented PKCE body once, without credentials or a guessed redirect field', async () => {
    const f = await fixture()
    const pair = createPkcePair()
    f.setPayload({ key: KEY })
    expect(await f.services.openRouterExchange('synthetic-code', pair.verifier)).toBe(KEY)
    expect(f.calls).toEqual([
      {
        url: `${ORIGIN}/api/v1/auth/keys`,
        headers: { 'content-type': 'application/json' },
        body: {
          code: 'synthetic-code',
          code_verifier: pair.verifier,
          code_challenge_method: 'S256',
        },
      },
    ])
  })
  it('refuses empty codes and invalid verifiers before exchange dispatch', async () => {
    const f = await fixture()
    await expect(f.services.openRouterExchange('', createPkcePair().verifier)).rejects.toThrow(
      UI_TEXT.providerConnectFailed,
    )
    await expect(f.services.openRouterExchange('synthetic-code', 'invalid')).rejects.toThrow(
      UI_TEXT.providerConnectFailed,
    )
    expect(f.calls).toEqual([])
  })
  it('refuses exchange failure, redirects and unknown key shapes without retries or disclosure', async () => {
    const f = await fixture()
    for (const [payload, status] of [
      [{ key: '' }, 200],
      [{ key: 'undocumented' }, 200],
      [{ token: KEY }, 200],
      [{ key: KEY }, 302],
      [{ error: { message: KEY } }, 500],
    ]) {
      f.setPayload(payload, z.number().parse(status))
      await expect(
        f.services.openRouterExchange('synthetic-code', createPkcePair().verifier),
      ).rejects.toThrow(UI_TEXT.providerConnectFailed)
    }
    expect(f.calls).toHaveLength(5)
  })
  it('supplies Connect and key-usage ports through the production lazy factory', async () => {
    const f = await fixture()
    const real = createConfiguredProviderServices
    vi.spyOn(configuredEntry, 'createConfiguredProviderServices').mockImplementation(
      (meta, options) => real(meta, { ...options, resolve: f.resolve, send: f.send }),
    )
    const features = createSubscriptionFeatures({
      ...f,
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      globalStorageUri: vscode.Uri.file(roots[0] ?? ''),
      l10n: { table: EN, locale: 'en' },
      globalState: { get: () => undefined, update: () => Promise.resolve() },
      isRemote: false,
      isConfidential: () => false,
      access: { canSendRequest: () => true, onDidChange: vi.fn() },
      connected: () => Promise.resolve(),
      disconnected: () => Promise.resolve(),
    })
    expect(features.seam.catalog.get('openrouter')?.connectLabel).toContain('OpenRouter')
    expect(features.seam.exchanger).toBeDefined()
    f.setPayload({ key: KEY })
    expect(
      await features.seam.exchanger.exchange({
        code: 'synthetic-factory-code',
        verifier: createPkcePair().verifier,
      }),
    ).toBe(KEY)
    f.setPayload(f.usage)
    expect(await features.seam.usage.read(KEY)).toEqual(EXPECTED_USAGE)
    expect(await features.readKeyUsage()).toMatchObject([
      {
        providerId: 'router',
        keyUsage: {
          totalUsd: '0',
          todayUsd: 0,
          weekUsd: '0',
          monthUsd: 0,
          limitUsd: 2,
          remainingUsd: 2,
        },
      },
    ])
    f.setPayload({ data: {} })
    expect(await features.readKeyUsage()).toMatchObject([
      { providerId: 'router', keyUsageError: UI_TEXT.providerUsageFailed },
    ])
    f.setPayload(f.usage)
    vi.mocked(configuredEntry.createConfiguredProviderServices).mockImplementation(
      (meta, options) =>
        real(meta, {
          ...options,
          resolve: f.resolve,
          send: async (...args) => {
            const reply = await f.send(...args)
            await f.secrets.store(`${PROVIDER_SECRET_PREFIX}router`, 'rotated-after-send')
            return reply
          },
        }),
    )
    expect(await features.readKeyUsage()).toMatchObject([
      { providerId: 'router', keyUsageError: UI_TEXT.providerUsageFailed },
    ])
    await f.secrets.delete(`${PROVIDER_SECRET_PREFIX}router`)
    expect(await features.readKeyUsage()).toMatchObject([
      { providerId: 'router', keyUsageError: UI_TEXT.providerUsageFailed },
    ])
    const started = Promise.withResolvers<undefined>()
    let wasAborted = false
    const installHeldSend = (entered: { readonly resolve: (value: undefined) => void }) => {
      vi.mocked(configuredEntry.createConfiguredProviderServices).mockImplementation(
        (meta, options) =>
          real(meta, {
            ...options,
            resolve: f.resolve,
            send: (_target, _body, _headers, signal) =>
              waitForAbort(signal, entered, () => {
                wasAborted = true
              }),
          }),
      )
    }
    installHeldSend(started)
    const controller = new AbortController()
    const pending = features.seam.exchanger.exchange({
      code: 'synthetic-code',
      verifier: createPkcePair().verifier,
      signal: controller.signal,
    })
    const refused = expect(pending).rejects.toThrow(UI_TEXT.providerConnectFailed)
    await started.promise
    controller.abort()
    await refused
    expect(wasAborted).toBe(true)
    const usageStarted = Promise.withResolvers<undefined>()
    installHeldSend(usageStarted)
    const usageController = new AbortController()
    const reading = features.seam.usage.read(KEY, usageController.signal)
    const usageRefused = expect(reading).rejects.toThrow(UI_TEXT.providerUsageFailed)
    await usageStarted.promise
    usageController.abort()
    await usageRefused
  })
  it('publishes key usage on Models panel open and refresh, with no credential in state', async () => {
    const f = testProvidersHost()
    const key = 'synthetic-provider-credential'
    await f.secrets.store(
      `${PROVIDER_SECRET_PREFIX}openrouter`,
      JSON.stringify({ v: 1, auth: 'apiKey', origin: ORIGIN, secret: key }),
    )
    const { panel } = openModelsPanel({ providers: f.providers })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).providers[0]?.keyUsage).toMatchObject({
        dayUsd: 0,
        monthUsd: 0,
        limitUsd: 10,
      })
    })
    await send(panel, { type: 'providers/readUsage' }, () => {
      expect(latestState(panel).providers[0]?.keyUsage).toBeDefined()
    })
    expect(JSON.stringify(panel.webview.postMessage.mock.calls)).not.toContain(key)
    panel.dispose()
  })
  it.each([
    [
      'deduplicates Connect and cancels its listener immediately when the wizard is cancelled',
      'cancel',
    ],
    [
      'closes pending authorization on Back without discarding the draft or reporting failure',
      'back',
    ],
  ] as const)('%s', async (_name, event) => {
    let loopback: OAuthLoopback | undefined
    const startLoopback = vi.fn(async (state: string) => {
      loopback = await startOAuthLoopback(state)
      return loopback
    })
    const exchange = vi.fn()
    const f = testProvidersHost({ deps: { startLoopback, exchanger: { exchange } } })
    const { panel } = openModelsPanel({ providers: f.providers })
    try {
      await send(panel, { type: 'modelsPanel/ready' }, () => {
        expect(latestState(panel).presets).not.toHaveLength(0)
      })
      await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
        expect(latestState(panel).drafts.wizard).toBeDefined()
      })
      await send(panel, { type: 'providers/connect' }, () => {
        expect(latestState(panel).drafts.wizard?.connecting).toBe(true)
      })
      if (event === 'cancel') panel.webview.messages.fire({ type: 'providers/connect' })
      await send(panel, { type: 'providers/wizard', event }, () => {
        if (event === 'cancel') expect(latestState(panel).drafts.wizard).toBeUndefined()
        else expect(latestState(panel).drafts.wizard?.connecting).toBe(false)
        expect(latestState(panel).notice).toBeUndefined()
      })
      expect(startLoopback).toHaveBeenCalledTimes(1)
      expect(exchange).not.toHaveBeenCalled()
      expect(f.secrets.values.size).toBe(0)
      expect(loopback).toBeDefined()
      await expect(fetch(loopback?.redirectUri ?? '')).rejects.toThrow()
    } finally {
      panel.dispose()
      loopback?.close()
    }
  })
})

describe('CM952 terminal and ACP routes', () => {
  it('parses only the documented terminal commands and refuses extra flags', () => {
    expect(parseCommandLine(['providers', 'connect', 'openrouter'])).toEqual({
      command: 'openRouterConnect',
    })
    expect(parseCommandLine(['providers', 'usage', 'router'])).toEqual({
      command: 'providerKeyUsage',
      provider: 'router',
    })
    for (const words of [
      ['providers', 'connect', 'openai'],
      ['providers', 'connect', 'openrouter', '--key-stdin'],
      ['providers', 'usage', 'router', '--address', ORIGIN],
    ])
      expect(parseCommandLine(words)).toMatchObject({ command: 'invalid' })
  })
  it('stores a remote connection in the provider-key path and publishes only a URL and fixed status', async () => {
    const f = await fixture()
    f.setPayload({ key: KEY })
    expect(await runOpenRouterConnect(f.deps, f.services)).toBe(0)
    const stored = await f.secrets.get(`${PROVIDER_SECRET_PREFIX}openrouter`)
    expect(JSON.parse(stored ?? '')).toEqual({ v: 1, auth: 'apiKey', origin: ORIGIN, secret: KEY })
    expect(f.printed[0]).toContain(`${ORIGIN}/auth?`)
    expect(f.printed[0]).not.toContain('callback_url')
    expect(f.printed.join(',')).not.toContain(KEY)
    expect(f.errors).toEqual([])
    const methods = openRouterAuthenticationMethods(f.deps)
    expect(methods.map((method) => method.args)).toEqual([
      ['providers', 'connect', 'openrouter'],
      ['auth', 'set', '--provider', 'openrouter'],
      ['providers', 'usage', 'openrouter'],
    ])
    for (const method of methods) expect(await method.verify?.()).toBeUndefined()
  })
  it('connects on first run without a providers file and refuses a malformed file', async () => {
    const f = await fixture()
    const firstRunFile = path.join(path.dirname(f.configFile), 'first-run.json')
    const deps = { ...f.deps, ...userFileIo(firstRunFile) }
    f.setPayload({ key: KEY })
    expect(await runOpenRouterConnect(deps, f.services)).toBe(0)
    for (const method of openRouterAuthenticationMethods(deps))
      expect(await method.verify?.()).toBeUndefined()
    await expect(readFile(firstRunFile)).rejects.toMatchObject({ code: 'ENOENT' })
    f.setPayload(f.usage)
    expect(await runOpenRouterUsage(deps, f.services, 'openrouter')).toBe(0)
    await writeFile(firstRunFile, '{}')
    expect(await runOpenRouterConnect(deps, f.services)).toBe(1)
    for (const method of openRouterAuthenticationMethods(deps))
      expect(await method.verify?.()).toBe(UI_TEXT.providerKeyNotStored)
    expect(f.errors).toEqual([UI_TEXT.providerConnectFailed])
    expect(f.calls).toHaveLength(2)
  })
  it('reports usage through the stored key and refuses an unbound ACP sign-in', async () => {
    const f = await fixture()
    await f.secrets.store(
      `${PROVIDER_SECRET_PREFIX}openrouter`,
      formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY),
    )
    expect(await runOpenRouterUsage(f.deps, f.services, 'openrouter')).toBe(0)
    expect(f.printed).toContain(`${UI_TEXT.usageRemaining}: $2.00`)
    expect(f.printed.join(',')).not.toContain(KEY)
    await f.secrets.store(
      `${PROVIDER_SECRET_PREFIX}openrouter`,
      formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: 'https://attacker.example' }, KEY),
    )
    for (const method of openRouterAuthenticationMethods(f.deps))
      expect(await method.verify?.()).toBe(UI_TEXT.providerKeyNotStored)
    expect(await runOpenRouterUsage(f.deps, f.services, 'openrouter')).toBe(1)
    expect(f.errors).toEqual([UI_TEXT.providerUsageFailed])
  })
  it('does not overwrite a key rotated while browser authorization is pending', async () => {
    const f = await fixture()
    const api = {
      ...f.services,
      openRouterExchange: async () => {
        await f.secrets.store(`${PROVIDER_SECRET_PREFIX}openrouter`, 'concurrently-rotated')
        return KEY
      },
    }
    expect(await runOpenRouterConnect(f.deps, api)).toBe(1)
    expect(await f.secrets.get(`${PROVIDER_SECRET_PREFIX}openrouter`)).toBe('concurrently-rotated')
    expect(f.errors).toEqual([UI_TEXT.providerConnectFailed])
  })
  it('refuses terminal usage from a key rotated during the read without printing stale amounts', async () => {
    const f = await fixture()
    const account = `${PROVIDER_SECRET_PREFIX}openrouter`
    await f.secrets.store(
      account,
      formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY),
    )
    const api = {
      ...f.services,
      openRouterUsage: async () => {
        await f.secrets.store(account, 'rotated-during-usage')
        return EXPECTED_USAGE
      },
    }
    expect(await runOpenRouterUsage(f.deps, api, 'openrouter')).toBe(1)
    expect(f.printed).toEqual([])
    expect(f.errors).toEqual([UI_TEXT.providerUsageFailed])
  })
  it.each(['rotated', 'removed', 'locked-rotation', 'write-failure'] as const)(
    'never restores a borrowed credential changed during provider add: %s',
    async (event) => {
      const f = await fixture()
      const account = `${PROVIDER_SECRET_PREFIX}openrouter`
      const original = formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY)
      const rotated = formatStoredProviderSecret(
        { v: 1, auth: 'apiKey', origin: ORIGIN },
        'sk-or-rotated-synthetic',
      )
      await f.secrets.store(account, original)
      const store = vi.spyOn(f.secrets, 'store')
      const mutate = async () => {
        if (event === 'removed') await f.secrets.delete(account)
        else await f.secrets.store(account, rotated)
      }
      let calls = 0
      const fetcher: typeof fetch = async (url) => {
        calls++
        if (calls === 1 && (event === 'rotated' || event === 'removed')) await mutate()
        const target = typeof url === 'object' && 'url' in url ? url.url : String(url)
        return Response.json(target.endsWith('/key') ? f.usage : { data: [{ id: 'm1' }] })
      }
      const deps = {
        ...f.deps,
        fetch: fetcher,
        withUserFileLock: async (operation: () => Promise<number>) => {
          if (event === 'locked-rotation') await mutate()
          return await operation()
        },
        writeUserFile: async (...args: Parameters<ProvidersDeps['writeUserFile']>) => {
          if (event !== 'write-failure') return await f.deps.writeUserFile(...args)
          await mutate()
          return false
        },
      }
      expect(
        await providersAdd(deps, {
          preset: 'openrouter',
          models: ['m1'],
          privateOk: false,
          keyFromStdin: false,
        }),
      ).toBe(1)
      expect(await f.secrets.get(account)).toBe(event === 'removed' ? undefined : rotated)
      expect(f.getFile().providers).toEqual([])
      expect(store.mock.calls.some(([, value]) => value === original)).toBe(false)
    },
  )

  it.each(['exchange', 'store', 'interrupted-replacement', 'interrupted-removal'] as const)(
    'cancels terminal Connect without retaining a late credential: %s',
    async (phase) => {
      const f = await fixture()
      const controller = new AbortController()
      const started = Promise.withResolvers<undefined>()
      const released = Promise.withResolvers<undefined>()
      const account = `${PROVIDER_SECRET_PREFIX}openrouter`
      if (phase === 'interrupted-replacement' || phase === 'interrupted-removal')
        await f.secrets.store(
          account,
          formatStoredProviderSecret(
            { v: 1, auth: 'apiKey', origin: ORIGIN },
            'sk-or-previous-synthetic',
          ),
        )
      const originalStore = f.secrets.store
      if (phase !== 'exchange')
        vi.spyOn(f.secrets, 'store').mockImplementation(async (id, value) => {
          started.resolve(undefined)
          await released.promise
          await originalStore(id, value)
        })
      const api = {
        ...f.services,
        openRouterExchange: async (_code: string, _verifier: string, signal?: AbortSignal) => {
          if (phase === 'exchange') {
            const wait = new Promise<void>((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () => {
                  reject(new Error('cancelled'))
                },
                {
                  once: true,
                },
              )
              started.resolve(undefined)
            })
            await wait
          }
          return KEY
        },
      }
      const pending = runOpenRouterConnect(f.deps, api, controller.signal)
      await started.promise
      expect(await runOpenRouterConnect(f.deps, api)).toBe(1)
      if (phase === 'interrupted-removal') await f.secrets.delete(account)
      controller.abort()
      released.resolve(undefined)
      expect(await pending).toBe(1)
      expect(await f.secrets.get(account)).toBeUndefined()
    },
  )

  it('adds an OpenRouter model using a connected key without asking for the key again and keeps ZDR', async () => {
    const f = await fixture()
    await f.secrets.store(
      `${PROVIDER_SECRET_PREFIX}openrouter`,
      formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY),
    )
    const readSecret = vi.fn()
    const fetcher: typeof fetch = (url) => {
      let target: string
      if (typeof url === 'string') target = url
      else if (url instanceof URL) target = url.href
      else target = url.url
      return Promise.resolve(
        Response.json(target.endsWith('/key') ? f.usage : { data: [{ id: 'm1' }] }),
      )
    }
    expect(
      await providersAdd(
        { ...f.deps, readSecret, fetch: fetcher },
        { preset: 'openrouter', models: ['m1'], privateOk: false, keyFromStdin: false },
      ),
    ).toBe(0)
    expect(readSecret).not.toHaveBeenCalled()
    expect(f.getFile().providers[0]?.routing).toEqual({ privacy: 'zdr', allowFallbacks: true })
  })
})

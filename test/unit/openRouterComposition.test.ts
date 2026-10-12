import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import { Usd } from '../../src/shared/usd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConfiguredProviderServices,
  type ConfiguredProviderOptions,
} from '../../src/core/providers/configured'
import * as configuredEntry from '../../src/host/backend/configuredProvidersEntry'
import { openRouterDiscardedKeyNotice } from '../../src/host/backend/providersEntry'
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
import { runAddProviderQuickPick } from '../../src/host/models/modelsQuickPick'
import { scriptedUi } from './helpers/providerQuickPickScript'
import { memorySessionBudgetConfig } from './helpers/fakes'
import { providersAdd, userFileIo } from '../../src/runtime/providersCommands'
import type { ProvidersDeps } from '../../src/runtime/providersCommands'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import { formatCredentialJournal, parseCredentialJournal } from '../../src/core/credentialLease'
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
  let rawPayload: string | undefined
  const send: NonNullable<ConfiguredProviderOptions['send']> = (target, bytes, headers) => {
    calls.push({
      url: target.url.href,
      body: bytes === undefined ? undefined : JSON.parse(bytes),
      headers,
    })
    return Promise.resolve(
      rawPayload === undefined
        ? response(payload, status)
        : {
            status,
            headers: {},
            body: (async function* () {
              yield* await Promise.resolve([Buffer.from(rawPayload)])
            })(),
            close: vi.fn(),
          },
    )
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
    readSecret: (prompt) =>
      Promise.resolve(prompt === UI_TEXT.providerConnectReplaceKey ? 'yes' : 'synthetic-code'),
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
    setRawPayload: (text: string) => {
      rawPayload = text
    },
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
  usedTotal: Usd.from(0).toAmount(),
  unlimited: false,
  usedToday: Usd.from(0).toAmount(),
  usedThisWeek: Usd.from(0).toAmount(),
  usedThisMonth: Usd.from(0).toAmount(),
  limit: Usd.from(2).toAmount(),
  remaining: Usd.from(2).toAmount(),
}
describe('CM952 production OpenRouter composition', () => {
  it('keeps six filter and sort actions off the network', async () => {
    const read = vi.fn(() => Promise.resolve(EXPECTED_USAGE))
    const f = testProvidersHost({ deps: { usage: { read } } })
    const { panel } = await panelWithCredential(f)
    try {
      read.mockClear()
      for (const query of ['c', 'cl', 'cla', 'clau', 'claud', 'claude'])
        await send(
          panel,
          {
            type: 'models/filter',
            filter: { search: query },
            sort: { key: 'name', direction: 'asc' },
          },
          () => {
            expect(latestState(panel).filter.search).toBe(query)
            expect(latestState(panel).providers[0]?.keyUsage?.monthUsd).toBe('0')
          },
        )
      expect(read).not.toHaveBeenCalled()
      await send(panel, { type: 'providers/readUsage' }, () => {
        expect(read).toHaveBeenCalledOnce()
      })
    } finally {
      panel.dispose()
    }
  })

  it('preserves the exact previous terminal key at every Connect await', async () => {
    const f = await fixture()
    const account = `${PROVIDER_SECRET_PREFIX}openrouter`
    const previous = formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: ORIGIN },
      'sk-or-previous-synthetic',
    )
    const originalGet = f.secrets.get
    const originalStore = f.secrets.store
    const originalDelete = f.secrets.delete
    let count = 0,
      stopAt = 0
    let controller = new AbortController()
    const hit = () => {
      if (++count === stopAt) controller.abort()
    }
    const secrets = {
      get: async (id: string) => {
        const value = await originalGet(id)
        hit()
        return value
      },
      store: async (id: string, value: string) => {
        await originalStore(id, value)
        hit()
      },
      delete: async (id: string) => {
        await originalDelete(id)
        hit()
      },
    }
    const deps = {
      ...f.deps,
      secrets,
      readUserFile: async () => {
        const value = await f.deps.readUserFile()
        hit()
        return value
      },
      readSecret: async (prompt: string) => {
        const value = await f.deps.readSecret(prompt)
        hit()
        return value
      },
      print: () => {
        hit()
      },
      withUserFileLock: async <T>(work: () => Promise<T>) => {
        const value = await work()
        hit()
        return value
      },
    }
    const api = {
      ...f.services,
      openRouterExchange: () => {
        hit()
        return Promise.resolve(KEY)
      },
    }
    await originalStore(account, previous)
    expect(await runOpenRouterConnect(deps, api, controller.signal)).toBe(0)
    const written = formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY)
    expect(await originalGet(account)).toBe(written)
    expect(await originalGet(`${account}.connect`)).toBeUndefined()
    const awaits = count - 1 // final synchronous success print is the commit boundary
    // Cancellation before the commit preserves the previous record. The
    // staging slot may keep a journal (the durable intent, or a staged
    // attempt): it is a journal, never a raw key, and the next start
    // recovers it. The abort landing after the lock released reports the
    // committed key: a rollback there would risk overwriting a rotation
    // someone else made or resurrecting a removal.
    for (stopAt = 1; stopAt < awaits; stopAt++) {
      controller = new AbortController()
      count = 0
      await originalStore(account, previous)
      expect(
        await runOpenRouterConnect(deps, api, controller.signal),
        `await ${String(stopAt)}`,
      ).toBe(1)
      expect(await originalGet(account), `await ${String(stopAt)}`).toBe(previous)
      const slot = await originalGet(`${account}.connect`)
      let journal: unknown
      try {
        journal = slot === undefined ? undefined : JSON.parse(slot)
      } catch {
        journal = undefined
      }
      expect(
        slot === undefined || parseCredentialJournal(journal) !== undefined,
        `await ${String(stopAt)}`,
      ).toBe(true)
    }
    controller = new AbortController()
    count = 0
    stopAt = awaits
    await originalStore(account, previous)
    expect(await runOpenRouterConnect(deps, api, controller.signal), 'commit stands').toBe(0)
    expect(await originalGet(account)).toBe(written)
    expect(await originalGet(`${account}.connect`)).toBeUndefined()
  })

  it.each(['rotation', 'removal'] as const)(
    'leaves an independent %s made during the commit alone instead of rolling back',
    async (mode) => {
      const f = await fixture()
      const account = `${PROVIDER_SECRET_PREFIX}openrouter`
      const previous = formatStoredProviderSecret(
        { v: 1, auth: 'apiKey', origin: ORIGIN },
        '[REDACTED]',
      )
      await f.secrets.store(account, previous)
      const rotated = formatStoredProviderSecret(
        { v: 1, auth: 'apiKey', origin: ORIGIN },
        'rotated-synthetic-key',
      )
      const written = formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY)
      const underlying = f.secrets.store.bind(f.secrets)
      vi.spyOn(f.secrets, 'store').mockImplementation(async (id, value) => {
        await underlying(id, value)
        // A second actor wins the race right after this flow's main write.
        if (id === account && value === written) {
          if (mode === 'rotation') await underlying(id, rotated)
          else await f.secrets.delete(id)
        }
      })
      expect(
        await runOpenRouterConnect(f.deps, {
          ...f.services,
          openRouterExchange: () => Promise.resolve(KEY),
        }),
      ).toBe(1)
      expect(await f.secrets.get(account)).toBe(mode === 'rotation' ? rotated : undefined)
      expect(await f.secrets.get(`${account}.connect`)).toBeUndefined()
      expect(f.errors).toContain(openRouterDiscardedKeyNotice())
      expect(f.errors).toContain(UI_TEXT.providerConnectFailed)
    },
  )

  it('reports a refusing credential store with both the removal notice and the failure', async () => {
    const f = await fixture()
    const account = `${PROVIDER_SECRET_PREFIX}openrouter`
    const previous = formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: ORIGIN },
      '[REDACTED]',
    )
    await f.secrets.store(account, previous)
    // The exchange succeeded, then the store refuses every call: the
    // minted key is known from memory and reported before any cleanup, even
    // though the primary was never attempted.
    let hasExchanged = false
    const get = f.secrets.get
    const store = f.secrets.store.bind(f.secrets)
    const remove = f.secrets.delete.bind(f.secrets)
    vi.spyOn(f.secrets, 'get').mockImplementation((id) =>
      hasExchanged ? Promise.reject(new Error('store-unavailable')) : get(id),
    )
    vi.spyOn(f.secrets, 'store').mockImplementation((id, value) =>
      hasExchanged ? Promise.reject(new Error('store-unavailable')) : store(id, value),
    )
    vi.spyOn(f.secrets, 'delete').mockImplementation((id) =>
      hasExchanged ? Promise.reject(new Error('store-unavailable')) : remove(id),
    )
    expect(
      await runOpenRouterConnect(f.deps, {
        ...f.services,
        openRouterExchange: () => {
          hasExchanged = true
          return Promise.resolve(KEY)
        },
      }),
    ).toBe(1)
    expect(f.errors).toContain(openRouterDiscardedKeyNotice())
    expect(f.errors).toContain(UI_TEXT.providerConnectFailed)
    expect(await get(account)).toBe(previous)
    // The primary was never attempted, so the intent journal stays for the
    // next start's recovery.
    const intent = await get(`${account}.connect`)
    expect(
      intent === undefined ? undefined : parseCredentialJournal(JSON.parse(intent))?.phase,
    ).toBe('started')
  })

  it.each(['completed', 'declined'] as const)(
    'recovers a crashed Connect journal with a notice instead of silently overwriting it: %s',
    async (outcome) => {
      const f = await fixture()
      const account = `${PROVIDER_SECRET_PREFIX}openrouter`
      const crashed = formatStoredProviderSecret(
        { v: 1, auth: 'apiKey', origin: ORIGIN },
        'crashed-synthetic-key',
      )
      const previous = formatStoredProviderSecret(
        { v: 1, auth: 'apiKey', origin: ORIGIN },
        '[REDACTED]',
      )
      // A crash after the journal write: the primary still holds the
      // previous record (or nothing), while the journal names it and the
      // staged key.
      await f.secrets.store(
        `${account}.connect`,
        formatCredentialJournal({
          v: 1,
          phase: 'staged',
          previous: outcome === 'declined' ? previous : null,
          next: crashed,
        }),
      )
      const deps =
        outcome === 'completed'
          ? f.deps
          : {
              ...f.deps,
              readSecret: () => Promise.resolve('no'),
            }
      if (outcome === 'declined') await f.secrets.store(account, previous)
      expect(
        await runOpenRouterConnect(deps, {
          ...f.services,
          openRouterExchange: () => Promise.resolve(KEY),
        }),
      ).toBe(outcome === 'completed' ? 0 : 1)
      // The crashed key is reported (never silently overwritten) and cleaned.
      expect(f.errors).toContain(openRouterDiscardedKeyNotice())
      expect(await f.secrets.get(`${account}.connect`)).toBeUndefined()
      expect(await f.secrets.get(account)).toBe(
        outcome === 'completed'
          ? formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY)
          : previous,
      )
    },
  )

  it('notifies when a successful quick-pick Connect is discarded', async () => {
    const f = testProvidersHost()
    const discard = vi.spyOn(f.providers, 'discardOpenRouterKey')
    vi.spyOn(f.providers, 'connectOpenRouter').mockResolvedValue({ key: KEY })
    const result = await runAddProviderQuickPick({
      providers: f.providers,
      ui: scriptedUi({ pickOne: ['openrouter', 'connect'] }),
      isRemote: true,
      sessionBudget: memorySessionBudgetConfig(),
    })
    expect(result).toBeUndefined()
    expect(discard).toHaveBeenCalledOnce()
    expect(f.secrets.values.size).toBe(0)
  })

  it('coalesces panel Refresh deliveries while a read is pending', async () => {
    const held = Promise.withResolvers<typeof EXPECTED_USAGE>()
    const read = vi.fn(() => Promise.resolve(EXPECTED_USAGE))
    const f = testProvidersHost({ deps: { usage: { read } } })
    const { panel } = await panelWithCredential(f)
    try {
      read.mockImplementation(() => held.promise)
      panel.webview.messages.fire({ type: 'providers/readUsage' })
      await vi.waitFor(() => {
        expect(read).toHaveBeenCalledTimes(2)
      })
      panel.webview.messages.fire({ type: 'providers/readUsage' })
      held.resolve(EXPECTED_USAGE)
      await send(
        panel,
        {
          type: 'models/filter',
          filter: { search: 'settled' },
          sort: { key: 'name', direction: 'asc' },
        },
        () => {
          expect(latestState(panel).filter.search).toBe('settled')
        },
      )
      expect(read).toHaveBeenCalledTimes(2)
    } finally {
      panel.dispose()
    }
  })

  it('names a created draft key when the panel cancels it', async () => {
    const f = testProvidersHost()
    const onDiscardedKey = vi.spyOn(f.providers, 'discardOpenRouterKey')
    const { panel } = openModelsPanel({ providers: f.providers, isRemote: true })
    try {
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('synthetic-code')
      await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
        expect(latestState(panel).drafts.wizard?.presetId).toBe('openrouter')
      })
      await send(panel, { type: 'providers/connect' }, () => {
        expect(latestState(panel).drafts.wizard).toMatchObject({
          connected: true,
          presetId: 'openrouter',
        })
      })
      await send(panel, { type: 'providers/wizard', event: 'cancel' }, () => {
        expect(latestState(panel).drafts).toEqual({ edits: {} })
      })
      expect(onDiscardedKey).toHaveBeenCalledOnce()
      expect(f.secrets.values.size).toBe(0)
    } finally {
      panel.dispose()
    }
  })

  it('recovers a legacy raw staging record with a notice instead of absorbing it', async () => {
    const f = await fixture()
    const account = `${PROVIDER_SECRET_PREFIX}openrouter`
    const previous = formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: ORIGIN },
      'sk-or-previous-synthetic',
    )
    await f.secrets.store(account, previous)
    // A pre-journal attempt staged the raw record here. Recovery reports
    // the possibly-created vendor key, cleans the slot, and continues.
    await f.secrets.store(`${account}.connect`, 'unverified')
    expect(
      await runOpenRouterConnect(f.deps, {
        ...f.services,
        openRouterExchange: () => Promise.resolve(KEY),
      }),
    ).toBe(0)
    expect(f.errors).toContain(openRouterDiscardedKeyNotice())
    expect(await f.secrets.get(account)).toBe(
      formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY),
    )
    expect(await f.secrets.get(`${account}.connect`)).toBeUndefined()
  })

  it('asks in terminal words before replacing a pasted key', async () => {
    const f = await fixture()
    const account = `${PROVIDER_SECRET_PREFIX}openrouter`
    const previous = formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, KEY)
    await f.secrets.store(account, previous)
    const readSecret = vi.fn(() => Promise.resolve('no'))
    const exchange = vi.fn()
    expect(
      await runOpenRouterConnect(
        { ...f.deps, readSecret },
        { ...f.services, openRouterExchange: exchange },
      ),
    ).toBe(1)
    expect(readSecret).toHaveBeenCalledExactlyOnceWith(UI_TEXT.providerConnectReplaceKey)
    expect(exchange).not.toHaveBeenCalled()
    expect(await f.secrets.get(account)).toBe(previous)
  })

  it('retains all six exact wire decimals through terminal output', async () => {
    const f = await fixture()
    const decimal = '0.12345678901234567890123456789'
    const label = JSON.stringify('digits 123.456 "quoted"')
    f.setRawPayload(
      `{"data":{"usage":${decimal},"usage_daily":${decimal},"usage_weekly":${decimal},"usage_monthly":${decimal},"limit":${decimal},"limit_remaining":${decimal},"label":${label}}}`,
    )
    expect(await f.services.openRouterUsage(ENTRY)).toEqual({
      usedTotal: decimal,
      unlimited: false,
      usedToday: decimal,
      usedThisWeek: decimal,
      usedThisMonth: decimal,
      limit: decimal,
      remaining: decimal,
    })
    await f.deps.writeUserFile({ v: 1, providers: [ENTRY] }, f.getFile())
    expect(await runOpenRouterUsage(f.deps, f.services, 'router')).toBe(0)
    expect(f.printed).toHaveLength(6)
    for (const line of f.printed) expect(line).toContain(`$${decimal}`)
  })

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
      providerUsageRowSchema.parse({
        ...base,
        keyUsage: { ...amounts, todayUsd: '0', monthUsd: 0 },
      }).keyUsage,
    ).toMatchObject(exact)
    for (const invalid of [-1, NaN, Infinity]) {
      expect(
        providerKeyUsageSchema.safeParse({ totalUsd: invalid, weekUsd: invalid }).success,
      ).toBe(false)
      expect(
        providerUsageRowSchema.safeParse({
          ...base,
          keyUsage: { totalUsd: invalid, weekUsd: invalid, todayUsd: '0', monthUsd: 0 },
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
        await send(panel, { type: 'providers/readUsage' }, () => {
          const row = latestState(panel).providers[0]
          expect(row?.keyUsage).toBeUndefined()
          expect(row?.keyUsageError).toBe(UI_TEXT.providerUsageFailed)
        })
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
      const onKeyUsage = vi.fn()
      const account = `${PROVIDER_SECRET_PREFIX}openrouter`
      const f = testProvidersHost({
        deps: {
          onKeyUsage,
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
        expect(onKeyUsage).toHaveBeenCalledOnce()
        await send(panel, { type: 'providers/readUsage' }, () => {
          expect(latestState(panel).providers[0]?.keyUsage).toBeUndefined()
          expect(latestState(panel).providers[0]?.keyUsageError).toBe(UI_TEXT.providerUsageFailed)
        })
        expect(onKeyUsage).toHaveBeenCalledOnce()
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
      usedTotal: '4',
      unlimited: true,
      usedToday: '1',
      usedThisWeek: '2',
      usedThisMonth: '3',
      limit: undefined,
      remaining: undefined,
    })
  })
  it('refuses malformed, missing and undocumented usage without echoing service text', async () => {
    const f = await fixture()
    for (const data of [{ usage: KEY }, { usage: 0 }, { limit: '2' }, { unexpected: true }]) {
      f.setPayload({ data })
      await expect(f.services.openRouterUsage(ENTRY)).rejects.toThrow(UI_TEXT.providerUsageFailed)
    }
    f.setPayload({ error: { message: KEY } }, 401)
    await expect(f.services.openRouterUsage(ENTRY)).rejects.toThrow(UI_TEXT.providerUsageFailed)
  })
  it('refuses a negative amount in each of the six usage fields', async () => {
    const f = await fixture()
    const valid = {
      usage: 1,
      usage_daily: 1,
      usage_weekly: 1,
      usage_monthly: 1,
      limit: 2,
      limit_remaining: 1,
    }
    // All six fields are supplied every time: only the negativity refuses.
    for (const field of [
      'usage',
      'usage_daily',
      'usage_weekly',
      'usage_monthly',
      'limit',
      'limit_remaining',
    ] as const) {
      f.setPayload({ data: { ...valid, [field]: -1 } })
      await expect(f.services.openRouterUsage(ENTRY), field).rejects.toThrow(
        UI_TEXT.providerUsageFailed,
      )
    }
  })
  it('refuses forged decimal objects, forged markers and unbounded exponents', async () => {
    const f = await fixture()
    const valid = {
      usage: 1,
      usage_daily: 1,
      usage_weekly: 1,
      usage_monthly: 1,
      limit: 2,
      limit_remaining: 1,
    }
    // A wire object shaped like the tokenizer's old tag is not an amount.
    f.setPayload({ data: { ...valid, usage: { decimal: '1e101' } } })
    await expect(f.services.openRouterUsage(ENTRY)).rejects.toThrow(UI_TEXT.providerUsageFailed)
    // A marker-shaped wire string without this call's nonce is not an amount.
    f.setPayload({
      data: { ...valid, usage: 'exact-decimal:00000000-0000-0000-0000-000000000000:1' },
    })
    await expect(f.services.openRouterUsage(ENTRY)).rejects.toThrow(UI_TEXT.providerUsageFailed)
    // The exponent bound applies to every numeric path.
    for (const usage of [1e101, '1e101', -1e101, 1e-101]) {
      f.setPayload({ data: { ...valid, usage } })
      await expect(f.services.openRouterUsage(ENTRY)).rejects.toThrow(UI_TEXT.providerUsageFailed)
    }
    // The bound itself still reads: |exponent| 100 is an amount.
    f.setPayload({ data: { ...valid, usage: 1e100 } })
    expect(await f.services.openRouterUsage(ENTRY)).toMatchObject({ unlimited: false })
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
          todayUsd: '0',
          weekUsd: '0',
          monthUsd: '0',
          limitUsd: '2',
          remainingUsd: '2',
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
        dayUsd: '0',
        monthUsd: '0',
        limitUsd: '10',
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
    expect(f.errors).toEqual([
      expect.stringContaining('https://openrouter.ai/settings/keys'),
      UI_TEXT.providerConnectFailed,
    ])
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
        withUserFileLock: async <T>(operation: () => Promise<T>) => {
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
      expect(await f.secrets.get(account)).toBe(
        phase === 'interrupted-replacement'
          ? formatStoredProviderSecret(
              { v: 1, auth: 'apiKey', origin: ORIGIN },
              'sk-or-previous-synthetic',
            )
          : undefined,
      )
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

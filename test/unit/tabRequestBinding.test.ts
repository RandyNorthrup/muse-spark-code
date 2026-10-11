import { Usd } from '../../src/shared/usd'
// M94KR3 (RVM94KR2): Tab's consent key and policy binding through the
// production path: the real PaidUseConsent under the keyed Tab consent, the
// real window hook runner, the shipped lazy provider factory and the real
// engine over the real Model API client, whose fetch is a fake transport.
// Each review scenario is reproduced as the reviewer ran it; nothing here
// spends money or starts a process.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { InlineCompletionTriggerKind, Position, Uri } from 'vscode'
import type * as vscode from 'vscode'
import { PaidUseConsent, type PaidUseAnswer } from '../../src/core/paid/paidConsent'
import { ModelApiClient, type ModelApiClientDeps } from '../../src/core/backends/modelapi/client'
import type { TransportDeps } from '../../src/core/backends/modelapi/transport'
import { ModelApiPacing } from '../../src/core/backends/modelapi/pacing'
import { createTabEngine } from '../../src/core/tab/tabEngine'
import type { ShellResult } from '../../src/core/shellResult'
import { GitExitError } from '../../src/host/git'
import { ExtensionHookRunner } from '../../src/host/extensionHooksRunner'
import {
  TAB_CONSENT_STATE_KEY,
  createTabConsent,
  tabPriceFingerprint,
  type TabOutcome,
  type TabReportedUsage,
  type TabReservation,
  type TabUseConsent,
} from '../../src/host/tab/tabBundle'
import { createTabProvider as entryProvider } from '../../src/host/tab/tabEntry'
import {
  TAB_DEBOUNCE_MS,
  TAB_REPLY_CLOSE_TAG,
  TAB_REPLY_OPEN_TAG,
  UI_TEXT,
  type PaidFeature,
} from '../../src/shared/constants'
import type { PaidUseRequest } from '../../src/shared/paid'
import { BASE_LOCALE } from '../../src/shared/l10n/text'
import { FakeCancellationToken, FakeLogOutputChannel, FakeTextDocument } from './helpers/fakes'
import { memoryContextIo } from './helpers/fakeContextIo'
import {
  FAKE_MODEL_API_KEY,
  fakeModelApi,
  fakeModelApiClientSettings,
} from './helpers/fakeModelApi'
import { hookResult } from './helpers/fakeToolIo'

const STANDARD = 'muse-spark-1.3'
const CONTRIBUTOR = 'muse-spark-1.3-contributor'
const SPARK = '/ws/.muse/spark-hooks.json'
const FILE = '/ws/file.ts'
const TEXT = 'const y = '
const LEGACY_MODEL_KEY = 'museSpark.tabConsentModel'
const NOTHING_SENT: TabReportedUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }
const RESERVATION: TabReservation = {
  model: STANDARD,
  worstCaseUsd: Usd.from(0.01).toAmount(),
  date: '2026-10-09',
}

/** The read guard and a ConfigChange observer, as one spark-hooks.json. */
const HOOKS = JSON.stringify({
  hooks: {
    beforeTabFileRead: [{ hooks: [{ type: 'command', command: 'guard' }] }],
    ConfigChange: [{ hooks: [{ type: 'command', command: 'observer' }] }],
  },
})

afterEach(() => {
  vi.useRealTimers()
})

/** A workspace's stores, shared by every window opened on it. */
interface WorkspaceStores {
  grants: ReadonlySet<PaidFeature>
  readonly state: Map<string, unknown>
}

function workspaceStores(): WorkspaceStores {
  return { grants: new Set(), state: new Map() }
}

/** The popup: each question waits for the case to answer it. */
interface Popup {
  readonly asked: string[]
  answer(answer: PaidUseAnswer): void
  /** Resolves when the `count`th question is open. */
  opened(count: number): Promise<void>
}

function popup(): {
  readonly popup: Popup
  readonly ask: (request: PaidUseRequest) => Promise<PaidUseAnswer>
} {
  const asked: string[] = []
  const open: PromiseWithResolvers<PaidUseAnswer>[] = []
  const arrivals: { count: number; resolve: () => void }[] = []
  const ask = (request: PaidUseRequest): Promise<PaidUseAnswer> => {
    asked.push(request.feature === 'tab' ? request.modelId : request.feature)
    for (const arrival of arrivals) {
      if (asked.length >= arrival.count) arrival.resolve()
    }
    const question = Promise.withResolvers<PaidUseAnswer>()
    open.push(question)
    return question.promise
  }
  return {
    ask,
    popup: {
      asked,
      answer: (answer) => {
        const question = open.shift()
        if (question === undefined) throw new Error('no question is open')
        question.resolve(answer)
      },
      opened: (count) =>
        asked.length >= count
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              arrivals.push({ count, resolve })
            }),
    },
  }
}

/** One window's paid gate and Tab consent, wired as src/extension.ts wires them. */
function tabWindow(
  stores: WorkspaceStores,
  options: {
    readonly canRemember?: boolean
    readonly priceOf?: (model: string) => string | undefined
    readonly writeAlways?: () => Promise<void>
  } = {},
) {
  const log = new FakeLogOutputChannel()
  const { popup: questions, ask } = popup()
  const paid = new PaidUseConsent({
    isOn: () => true,
    windowOnceFeatures: new Set<PaidFeature>(['tab']),
    windowOnceGeneration: () => 1,
    canRemember: () => options.canRemember ?? true,
    readGrants: () => stores.grants,
    writeGrants: (grants) => {
      stores.grants = new Set(grants)
      return Promise.resolve()
    },
    ask,
    log,
  })
  const consent: TabUseConsent = createTabConsent({
    priceOf: options.priceOf ?? tabPriceFingerprint,
    ask: async (model) =>
      await paid.askScope({ feature: 'tab', modelId: model, budgetUsd: Usd.from(1).toAmount() }),
    isOn: () => true,
    isRemembered: () => paid.isRemembered('tab'),
    windowOnceToken: () => paid.windowOnceToken('tab'),
    revocations: () => paid.revocations('tab'),
    readAlways: () => stores.state.get(TAB_CONSENT_STATE_KEY),
    writeAlways: async (record) => {
      await options.writeAlways?.()
      stores.state.set(TAB_CONSENT_STATE_KEY, record)
    },
    log,
  })
  return { paid, consent, popup: questions }
}

/** Holds one await point until the case releases it. */
interface Hold {
  isHeld: boolean
  readonly reached: PromiseWithResolvers<undefined>
  readonly release: PromiseWithResolvers<undefined>
}

function hold(): Hold {
  return {
    isHeld: false,
    reached: Promise.withResolvers<undefined>(),
    release: Promise.withResolvers<undefined>(),
  }
}

async function pass(point: Hold): Promise<void> {
  if (!point.isHeld) return
  point.reached.resolve(undefined)
  await point.release.promise
}

/** The window: provider, engine, client, runner and consent, all production code. */
async function tabHarness(options: {
  readonly consent: TabUseConsent
  readonly hooks?: string
  readonly guard?: (stdin: string) => string
  readonly atAdmission?: () => void
  readonly beforeClient?: () => void
}) {
  const state: { model: string; observer: Promise<unknown> | undefined } = {
    model: STANDARD,
    observer: undefined,
  }
  const files = new Map<string, string | Uint8Array>()
  if (options.hooks !== undefined) files.set(SPARK, options.hooks)
  const guardModels: string[] = []
  const runner = new ExtensionHookRunner({
    io: memoryContextIo(files),
    platform: 'linux',
    workspaceRoot: '/ws',
    settingsPath: '/home/user/.config/muse/settings.json',
    isWorkspaceTrusted: () => true,
    isHooksEnabled: () => true,
    now: Date.now,
    runHook: async (command, stdin): Promise<ShellResult> => {
      if (command === 'observer') {
        await state.observer
        return hookResult('')
      }
      const payload: unknown = JSON.parse(stdin)
      const model =
        typeof payload === 'object' && payload !== null && 'model' in payload
          ? String(payload.model)
          : ''
      guardModels.push(model)
      return hookResult(options.guard?.(model) ?? '{"permission":"allow"}')
    },
    notice: () => undefined,
    showOutput: () => undefined,
    warn: () => undefined,
  })
  await runner.reload()
  const credentials = hold()
  const credentialReads = { count: 0 }
  const pacing = hold()
  const endpoint = hold()
  const reservation = hold()
  const admission = hold()
  const hookLoad = hold()
  const token = new FakeCancellationToken()
  const api = fakeModelApi()
  const wireRequests: string[] = []
  api.script({ text: `${TAB_REPLY_OPEN_TAG}foo()${TAB_REPLY_CLOSE_TAG}` })
  const log = new FakeLogOutputChannel()
  const settings = fakeModelApiClientSettings(log)
  const realPacing = new ModelApiPacing({ now: () => 0, wait: () => Promise.resolve() })
  // ModelApiClient forwards its deps to RequestTransport. This test-only
  // projection holds that existing transport port; Meta exposes no endpoint setting.
  const clientDeps: ModelApiClientDeps & Pick<TransportDeps, 'verifyEndpoint'> = {
    ...settings,
    verifyEndpoint: () => pass(endpoint),
    fetch: async (url, init) => {
      if (typeof init?.body === 'string') wireRequests.push(init.body)
      return await api.fetch(url, init)
    },
    apiKey: async () => {
      credentialReads.count += 1
      await pass(credentials)
      return FAKE_MODEL_API_KEY
    },
    pacing: {
      acquire: async (...args) => {
        await pass(pacing)
        await realPacing.acquire(...args)
      },
      snapshot: (account) => realPacing.snapshot(account),
      observe: (...args) => {
        realPacing.observe(...args)
      },
    },
  }
  const client = new ModelApiClient(clientDeps)
  const sent: string[] = []
  const engine = createTabEngine({
    stream: (body, signal, budget, admit) => {
      options.beforeClient?.()
      return client.streamResponse(
        body,
        signal,
        undefined,
        budget,
        Object.assign(
          (keyDigest: string | undefined) => {
            admit(keyDigest)
            options.atAdmission?.()
          },
          admit,
          { prepare: () => pass(admission) },
        ),
      )
    },
    onSent: (model) => {
      sent.push(model)
    },
    onUsage: () => undefined,
  })
  const outcomes: TabOutcome[] = []
  const settled: TabReportedUsage[] = []
  const handle = entryProvider({
    uiTable: UI_TEXT,
    locale: BASE_LOCALE,
    settings: () => ({
      tabModel: state.model,
      tabLanguages: { '*': true },
      tabMultiline: 'never',
      tabTrigger: 'automatic',
      tabWithCopilot: 'both',
    }),
    isSnoozed: () => false,
    isTrusted: () => true,
    isPaidOn: () => true,
    isKeyStored: () => true,
    filesExclude: () => ({}),
    foreignSetting: () => undefined,
    isCopilotExtensionPresent: () => false,
    realPath: (absolutePath) => Promise.resolve(absolutePath),
    workspaceRoots: (absolutePath) => (absolutePath.startsWith('/ws/') ? ['/ws'] : []),
    ignoreFileExists: () => false,
    runGit: () => Promise.reject(new GitExitError(1, '', 'check-ignore')),
    onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
    onDidChangeTextDocument: () => ({ dispose: () => undefined }),
    engine,
    spend: {
      reserve: async () => {
        await pass(reservation)
        return RESERVATION
      },
      settle: (_reservation, usage) => {
        settled.push(usage)
      },
      todayTotalUsd: () => Usd.from(0).toAmount(),
      todayRequests: () => 0,
    },
    consent: options.consent,
    hookDispatch: {
      isHooksEnabled: () => true,
      load: async () => {
        await pass(hookLoad)
        return runner
      },
    },
    onOutcome: (outcome) => {
      outcomes.push(outcome)
    },
    log,
  })
  const posts = () => api.requests.filter((request) => request.path === '/responses')
  return {
    state,
    files,
    runner,
    credentials,
    credentialReads,
    pacing,
    endpoint,
    reservation,
    admission,
    hookLoad,
    token,
    posts,
    wireRequests,
    sent,
    settled,
    outcomes,
    guardModels,
    handle,
    /** One trigger: Invoke goes at once, Automatic waits out the debounce. */
    serve: async (
      triggerKind: vscode.InlineCompletionTriggerKind = InlineCompletionTriggerKind.Invoke,
      text = TEXT,
    ): Promise<vscode.InlineCompletionItem[]> => {
      const result = await handle.provider.provideInlineCompletionItems(
        new FakeTextDocument(Uri.file(FILE), 'typescript', text),
        new Position(0, text.length),
        { triggerKind, selectedCompletionInfo: undefined },
        token,
      )
      if (!Array.isArray(result)) throw new Error('the provider returned no items array')
      return result
    },
  }
}

/** The request ended with nothing POSTed, nothing counted and its reservation released. */
async function expectNothingSent(
  tab: Awaited<ReturnType<typeof tabHarness>>,
  request: Promise<vscode.InlineCompletionItem[]>,
): Promise<void> {
  await expect(request).resolves.toEqual([])
  expect(tab.posts()).toEqual([])
  expect(tab.sent).toEqual([])
  expect(tab.settled).toEqual([NOTHING_SENT])
  tab.handle.dispose()
}

/** Start a request at a held admission point, then advance the fake clock once. */
async function startHeld(
  tab: Awaited<ReturnType<typeof tabHarness>>,
  window: ReturnType<typeof tabWindow>,
  held: Hold,
) {
  held.isHeld = true
  const request = tab.serve()
  await window.popup.opened(1)
  window.popup.answer('once')
  await held.reached.promise
  await vi.advanceTimersByTimeAsync(1)
  return { request }
}

/** A window whose guard allows Standard only, after one Standard request was allowed and served. */
async function servedStandard() {
  const window = tabWindow(workspaceStores())
  const tab = await tabHarness({
    consent: window.consent,
    hooks: HOOKS,
    guard: (model) => JSON.stringify({ permission: model === STANDARD ? 'allow' : 'deny' }),
  })
  const standard = tab.serve()
  await window.popup.opened(1)
  window.popup.answer('once')
  await expect(standard).resolves.toHaveLength(1)
  return { window, tab }
}

describe('RVM94KR2 1: a question answers only its own key', () => {
  it('coalesces no questions with different prices even for the same model', async () => {
    let price = tabPriceFingerprint(STANDARD)
    const window = tabWindow(workspaceStores(), { priceOf: () => price })
    const tab = await tabHarness({ consent: window.consent })
    const first = tab.serve()
    await window.popup.opened(1)
    price = `${String(price)}:new-tariff`
    const second = tab.serve()
    await window.popup.opened(2)
    window.popup.answer('once')
    await expect(first).resolves.toEqual([])
    expect(tab.posts()).toEqual([])
    window.popup.answer('deny')
    await expect(second).resolves.toEqual([])
    expect(window.popup.asked).toEqual([STANDARD, STANDARD])
    tab.handle.dispose()
  })
  it('never hands a Standard answer to a Contributor request', async () => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
    const standard = tab.serve()
    await window.popup.opened(1)
    tab.state.model = CONTRIBUTOR
    const contributor = tab.serve()
    await window.popup.opened(2)
    window.popup.answer('once')
    await expect(standard).resolves.toEqual([])
    // The Contributor request waits on its own question, not Standard's answer.
    expect(tab.posts()).toEqual([])
    expect(window.popup.asked).toEqual([STANDARD, CONTRIBUTOR])
    window.popup.answer('deny')
    await expect(contributor).resolves.toEqual([])
    expect(tab.posts()).toEqual([])
    expect(tab.sent).toEqual([])
    expect(tab.outcomes).toEqual([
      { kind: 'quiet', reason: 'policy-changed' },
      { kind: 'quiet', reason: 'consent-denied' },
    ])
    tab.handle.dispose()
  })

  it('shares one open question only between requests of the same key', async () => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent })
    const first = tab.serve()
    const second = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('once')
    await Promise.all([first, second])
    expect(window.popup.asked).toEqual([STANDARD])
    tab.handle.dispose()
  })
})

describe('RVM94KR2 2: Once and window answers are never persisted', () => {
  it('does not revive revoked Always when a stale popup is answered Always', async () => {
    const stores = workspaceStores()
    const window = tabWindow(stores)
    const tab = await tabHarness({ consent: window.consent })
    const first = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('always')
    await first
    tab.state.model = CONTRIBUTOR
    const stale = tab.serve()
    await window.popup.opened(2)
    await window.paid.forget()
    window.popup.answer('always')
    await expect(stale).resolves.toEqual([])
    tab.state.model = STANDARD
    const fresh = tab.serve()
    await window.popup.opened(3)
    window.popup.answer('deny')
    await expect(fresh).resolves.toEqual([])
    expect(tab.posts()).toHaveLength(1)
    tab.handle.dispose()
  })
  it('revokes request-only consent while credentials wait', async () => {
    const window = tabWindow(workspaceStores(), { canRemember: false })
    const tab = await tabHarness({ consent: window.consent })
    tab.credentials.isHeld = true
    const request = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('always')
    await tab.credentials.reached.promise
    await window.paid.forget()
    tab.credentials.release.resolve(undefined)
    await expectNothingSent(tab, request)
  })

  it('refuses an Always answer revoked while its keyed record is being written', async () => {
    const writing = hold()
    writing.isHeld = true
    const stores = workspaceStores()
    const window = tabWindow(stores, { writeAlways: () => pass(writing) })
    const tab = await tabHarness({ consent: window.consent })
    const request = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('always')
    await writing.reached.promise
    await window.paid.forget()
    // Another key's answer restores the feature-wide grant while this write waits.
    const other = window.paid.askScope({
      feature: 'tab',
      modelId: CONTRIBUTOR,
      budgetUsd: Usd.from(1).toAmount(),
    })
    await window.popup.opened(2)
    window.popup.answer('always')
    await other
    writing.release.resolve(undefined)
    await expect(request).resolves.toEqual([])
    expect(tab.posts()).toEqual([])
    expect(stores.state.get(TAB_CONSENT_STATE_KEY)).toBeUndefined()
    tab.handle.dispose()
  })

  it('asks a new window about a model this window allowed only once', async () => {
    const stores = workspaceStores()
    const first = tabWindow(stores)
    const tab = await tabHarness({ consent: first.consent })
    const standard = tab.serve()
    await first.popup.opened(1)
    first.popup.answer('always')
    await expect(standard).resolves.toHaveLength(1)
    tab.state.model = CONTRIBUTOR
    const contributor = tab.serve()
    await first.popup.opened(2)
    first.popup.answer('once')
    await expect(contributor).resolves.toHaveLength(1)
    expect(stores.state.get(TAB_CONSENT_STATE_KEY)).toMatchObject({
      scope: 'always',
      model: STANDARD,
    })
    tab.handle.dispose()

    const second = tabWindow(stores)
    const next = await tabHarness({ consent: second.consent })
    next.state.model = CONTRIBUTOR
    const asked = next.serve()
    await second.popup.opened(1)
    expect(second.popup.asked).toEqual([CONTRIBUTOR])
    second.popup.answer('deny')
    await expect(asked).resolves.toEqual([])
    // Standard's Always is still its own: the new window does not ask for it.
    next.state.model = STANDARD
    await expect(next.serve()).resolves.toHaveLength(1)
    expect(second.popup.asked).toEqual([CONTRIBUTOR])
    next.handle.dispose()
  })
})

describe('RVM94KR2 P2: legacy Always migrates only after an Always answer', () => {
  it('asks the migration question once for the model, and records only Always', async () => {
    const stores = workspaceStores()
    stores.grants = new Set<PaidFeature>(['tab'])
    stores.state.set(LEGACY_MODEL_KEY, CONTRIBUTOR)
    const first = tabWindow(stores)
    const tab = await tabHarness({ consent: first.consent })
    tab.state.model = CONTRIBUTOR
    const migrated = tab.serve()
    await first.popup.opened(1)
    expect(tab.posts()).toEqual([])
    first.popup.answer('always')
    await expect(migrated).resolves.toHaveLength(1)
    await expect(tab.serve()).resolves.toHaveLength(1)
    expect(first.popup.asked).toEqual([CONTRIBUTOR])
    expect(stores.state.get(TAB_CONSENT_STATE_KEY)).toEqual({
      scope: 'always',
      model: CONTRIBUTOR,
      price: tabPriceFingerprint(CONTRIBUTOR),
    })
    tab.handle.dispose()
    const second = tabWindow(stores)
    const next = await tabHarness({ consent: second.consent })
    next.state.model = CONTRIBUTOR
    await expect(next.serve()).resolves.toHaveLength(1)
    expect(second.popup.asked).toEqual([])
    next.handle.dispose()
  })

  it('keeps asking new windows when the migration question is answered once', async () => {
    const stores = workspaceStores()
    stores.grants = new Set<PaidFeature>(['tab'])
    const first = tabWindow(stores)
    const tab = await tabHarness({ consent: first.consent })
    const migrated = tab.serve()
    await first.popup.opened(1)
    first.popup.answer('once')
    await expect(migrated).resolves.toHaveLength(1)
    await expect(tab.serve()).resolves.toHaveLength(1)
    expect(first.popup.asked).toEqual([STANDARD])
    expect(stores.state.has(TAB_CONSENT_STATE_KEY)).toBe(false)
    tab.handle.dispose()
    const second = tabWindow(stores)
    const next = await tabHarness({ consent: second.consent })
    const asked = next.serve()
    await second.popup.opened(1)
    expect(second.popup.asked).toEqual([STANDARD])
    expect(next.posts()).toEqual([])
    second.popup.answer('deny')
    await expect(asked).resolves.toEqual([])
    expect(stores.state.has(TAB_CONSENT_STATE_KEY)).toBe(false)
    next.handle.dispose()
  })
})

describe('RVM94KR3G: feature-scoped window consent revocations', () => {
  it.each(['imageGeneration', 'voice', 'tab'] as const)(
    'revoking %s while credentials wait affects only its own consent',
    async (feature) => {
      vi.useFakeTimers()
      const window = tabWindow(workspaceStores())
      const tab = await tabHarness({ consent: window.consent })
      const { request } = await startHeld(tab, window, tab.credentials)
      window.paid.revokeWindowOnce(feature)
      tab.credentials.release.resolve(undefined)
      if (feature === 'tab') {
        await expectNothingSent(tab, request)
      } else {
        await expect(request).resolves.toHaveLength(1)
        expect(tab.posts()).toHaveLength(1)
        expect(tab.sent).toHaveLength(1)
        expect(window.popup.asked).toEqual([STANDARD])
        tab.handle.dispose()
      }
    },
  )

  it('refuses a Tab answer revoked while its question is still open', async () => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent })
    const request = tab.serve()
    await window.popup.opened(1)
    window.paid.revokeWindowOnce('tab')
    window.popup.answer('once')
    await expect(request).resolves.toEqual([])
    expect(tab.posts()).toEqual([])
    expect(tab.sent).toEqual([])
    tab.handle.dispose()
  })
})

describe('RVM94KR2 3: the policy epoch moves when a change is detected', () => {
  it('keeps the starting model bound while the lazy hook runner loads', async () => {
    vi.useFakeTimers()
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
    tab.hookLoad.isHeld = true
    const request = tab.serve()
    await tab.hookLoad.reached.promise
    tab.state.model = CONTRIBUTOR
    tab.hookLoad.release.resolve(undefined)
    await vi.advanceTimersByTimeAsync(1)
    if (window.popup.asked.length > 0) window.popup.answer('deny')
    await expect(request).resolves.toEqual([])
    expect(window.popup.asked).toEqual([])
    expect(tab.guardModels).toEqual([])
    expect(tab.posts()).toEqual([])
    tab.handle.dispose()
  })
  it('refuses a request whose hook file broke while its ConfigChange observer runs', async () => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
    const request = tab.serve()
    await window.popup.opened(1)
    // The file breaks and its real configuration event arrives; the observer hangs.
    const observer = Promise.withResolvers<undefined>()
    tab.state.observer = observer.promise
    tab.files.set(SPARK, '{"hooks": {')
    const noted = tab.runner.noteConfigFile(SPARK, 'spark-hooks')
    expect(tab.runner.isReloading()).toBe(true)
    window.popup.answer('once')
    await expect(request).resolves.toEqual([])
    expect(tab.posts()).toEqual([])
    // A new request while the observer still runs reads nothing either.
    await expect(tab.serve()).resolves.toEqual([])
    expect(tab.guardModels).toEqual([STANDARD])
    observer.resolve(undefined)
    await noted
    expect(tab.runner.isReloading()).toBe(false)
    await expect(tab.serve()).resolves.toEqual([])
    expect(tab.outcomes.map((outcome) => (outcome.kind === 'quiet' ? outcome.reason : ''))).toEqual(
      ['policy-changed', 'policy-changed', 'hooks-invalid'],
    )
    expect(tab.posts()).toEqual([])
    tab.handle.dispose()
  })
})

describe('RVM94KR2 4: the last check runs at the HTTP send', () => {
  it('revalidates client admission before reading credentials', async () => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({
      consent: window.consent,
      beforeClient: () => {
        tab.state.model = CONTRIBUTOR
      },
    })
    const request = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('once')
    await expectNothingSent(tab, request)
    expect(tab.credentialReads.count).toBe(0)
  })
  it('checks again after synchronous admission immediately before dispatch', async () => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({
      consent: window.consent,
      atAdmission: () => {
        tab.state.model = CONTRIBUTOR
      },
    })
    const request = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('once')
    await expectNothingSent(tab, request)
  })

  it('POSTs nothing when the hook policy moves while the key read waits', async () => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
    tab.credentials.isHeld = true
    const request = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('once')
    await tab.credentials.reached.promise
    tab.files.set(
      SPARK,
      JSON.stringify({
        hooks: { beforeTabFileRead: [{ hooks: [{ type: 'command', command: 'deny' }] }] },
      }),
    )
    await tab.runner.noteConfigFile(SPARK, 'spark-hooks')
    tab.credentials.release.resolve(undefined)
    await expectNothingSent(tab, request)
  })
})

describe('RVM94KR2 5: a cached read verdict is bound to its model and epoch', () => {
  it('asks a model-sensitive guard again for another model', async () => {
    const { window, tab } = await servedStandard()
    tab.state.model = CONTRIBUTOR
    await expect(tab.serve()).resolves.toEqual([])
    expect(tab.guardModels).toEqual([STANDARD, CONTRIBUTOR])
    expect(tab.posts()).toHaveLength(1)
    expect(window.popup.asked).toEqual([STANDARD])
    tab.handle.dispose()
  })

  it('reuses no verdict while a model switch’s ConfigChange observer waits', async () => {
    const { tab } = await servedStandard()
    const observer = Promise.withResolvers<undefined>()
    tab.state.observer = observer.promise
    tab.state.model = CONTRIBUTOR
    const noted = tab.runner.noteSettingsChange()
    await expect(tab.serve()).resolves.toEqual([])
    expect(tab.guardModels).toEqual([STANDARD])
    observer.resolve(undefined)
    await noted
    await expect(tab.serve()).resolves.toEqual([])
    expect(tab.guardModels).toEqual([STANDARD, CONTRIBUTOR])
    expect(tab.posts()).toHaveLength(1)
    tab.handle.dispose()
  })
})

/** What moves under a waiting request in the interleaving cases. */
type Change = (
  tab: Awaited<ReturnType<typeof tabHarness>>,
  window: ReturnType<typeof tabWindow>,
) => Promise<void>

const CHANGES: readonly (readonly [string, Change])[] = [
  [
    'the hook policy epoch',
    async (tab) => {
      await tab.runner.noteConfigFile(SPARK, 'spark-hooks')
    },
  ],
  [
    'the model',
    (tab) => {
      tab.state.model = CONTRIBUTOR
      return Promise.resolve()
    },
  ],
  [
    'the consent (Ask again)',
    async (_tab, window) => {
      await window.paid.forget()
    },
  ],
  [
    'cancellation',
    (tab) => {
      tab.token.cancel()
      return Promise.resolve()
    },
  ],
]

describe('RVM94KR2: every await point revalidates, and the send checks last', () => {
  it('preserves the byte-exact automatic fast request from the review base', async () => {
    vi.useFakeTimers()
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
    const request = tab.serve(InlineCompletionTriggerKind.Automatic)
    await window.popup.opened(1)
    window.popup.answer('once')
    await vi.advanceTimersByTimeAsync(TAB_DEBOUNCE_MS + 1)
    await expect(request).resolves.toHaveLength(1)
    expect(tab.wireRequests).toEqual([
      readFileSync('test/fixtures/tabRequest/fast.golden.txt', 'utf8').trimEnd(),
    ])
    tab.handle.dispose()
  })
  it.each(CHANGES)(
    'POSTs nothing when %s changes while waiting for a free slot',
    async (_name, change) => {
      vi.useFakeTimers()
      const window = tabWindow(workspaceStores())
      const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
      tab.credentials.isHeld = true
      const first = tab.serve()
      const second = tab.serve()
      await window.popup.opened(1)
      window.popup.answer('once')
      await vi.advanceTimersByTimeAsync(1)
      expect(tab.credentialReads.count).toBe(2)
      const third = tab.serve()
      await vi.advanceTimersByTimeAsync(1)
      expect(tab.credentialReads.count).toBe(2)
      await change(tab, window)
      tab.credentials.release.resolve(undefined)
      await expect(Promise.all([first, second, third])).resolves.toEqual([[], [], []])
      expect(tab.posts()).toEqual([])
      expect(tab.sent).toEqual([])
      expect(tab.settled).toEqual([NOTHING_SENT, NOTHING_SENT, NOTHING_SENT])
      tab.handle.dispose()
    },
  )
  it('serves through the whole real path when nothing moves', async () => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
    const request = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('once')
    await expect(request).resolves.toHaveLength(1)
    expect(tab.posts()).toHaveLength(1)
    expect(tab.sent).toEqual([STANDARD])
    // Captured from the bea292208 builder: the complete serialized HTTP body.
    expect(tab.wireRequests).toEqual([
      readFileSync('test/fixtures/tabRequest/multiline.golden.txt', 'utf8').trimEnd(),
    ])
    tab.handle.dispose()
  })

  it.each(CHANGES)(
    'POSTs nothing when %s changes while the question is open',
    async (_name, change) => {
      vi.useFakeTimers()
      const window = tabWindow(workspaceStores())
      const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
      const request = tab.serve()
      await window.popup.opened(1)
      await vi.advanceTimersByTimeAsync(1)
      await change(tab, window)
      window.popup.answer('once')
      await expect(request).resolves.toEqual([])
      expect(tab.posts()).toEqual([])
      tab.handle.dispose()
    },
  )

  it.each(CHANGES)('POSTs nothing when %s changes during the debounce', async (_name, change) => {
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
    // An earlier Invoke answers the question, so the Automatic trigger asks nothing.
    const first = tab.serve()
    await window.popup.opened(1)
    window.popup.answer('once')
    await expect(first).resolves.toHaveLength(1)
    vi.useFakeTimers()
    // Other text than the first: the typing-through cache would answer it unsent.
    const request = tab.serve(InlineCompletionTriggerKind.Automatic, 'const z = ')
    await vi.advanceTimersByTimeAsync(TAB_DEBOUNCE_MS / 2)
    await change(tab, window)
    await vi.advanceTimersByTimeAsync(TAB_DEBOUNCE_MS)
    await expect(request).resolves.toEqual([])
    expect(tab.posts()).toHaveLength(1)
    tab.handle.dispose()
  })

  it.each(
    CHANGES.flatMap(([name, change]) => [
      ['reservation', name, change] as const,
      ['credentials', name, change] as const,
      ['endpoint', name, change] as const,
      ['pacing', name, change] as const,
      ['admission', name, change] as const,
    ]),
  )('POSTs nothing when %s waits and %s changes', async (point, _name, change) => {
    vi.useFakeTimers()
    const window = tabWindow(workspaceStores())
    const tab = await tabHarness({ consent: window.consent, hooks: HOOKS })
    const held = tab[point]
    const { request } = await startHeld(tab, window, held)
    await change(tab, window)
    held.release.resolve(undefined)
    await expectNothingSent(tab, request)
  })

  it.each(['reservation', 'credentials', 'endpoint', 'pacing', 'admission'] as const)(
    'POSTs nothing when the bound price changes during %s',
    async (point) => {
      vi.useFakeTimers()
      let price = tabPriceFingerprint(STANDARD)
      const window = tabWindow(workspaceStores(), { priceOf: () => price })
      const tab = await tabHarness({ consent: window.consent })
      const held = tab[point]
      const { request } = await startHeld(tab, window, held)
      price = `${String(price)}:new-tariff`
      held.release.resolve(undefined)
      await expectNothingSent(tab, request)
    },
  )

  it.each(['credentials', 'endpoint', 'pacing'] as const)(
    'stops immediately after %s rather than entering the next admission wait',
    async (point) => {
      vi.useFakeTimers()
      const window = tabWindow(workspaceStores())
      const tab = await tabHarness({ consent: window.consent })
      const held = tab[point]
      const next = { credentials: tab.endpoint, endpoint: tab.pacing, pacing: tab.admission }[point]
      next.isHeld = true
      const { request } = await startHeld(tab, window, held)
      tab.token.cancel()
      held.release.resolve(undefined)
      await vi.advanceTimersByTimeAsync(1)
      // Release the next wait even on failure so this probe leaves no held work.
      let didReachNext = false
      void next.reached.promise.then(() => {
        didReachNext = true
      })
      next.release.resolve(undefined)
      await expectNothingSent(tab, request)
      expect(didReachNext).toBe(false)
    },
  )
})

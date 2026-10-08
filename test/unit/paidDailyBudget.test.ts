import { Usd as PortUsd } from '../../src/shared/usd'
import { Usd } from '../../src/shared/usd'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import type { CreateImageBody, CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  estimateInput,
  requestParts,
  type AccountBudgetAdmission,
} from '../../src/core/backends/modelapi/sessionBudget'
import {
  AccountThresholdExceededError,
  evaluateAccountThresholds,
} from '../../src/core/accounts/thresholds'
import { FakeAccountJournal } from './helpers/accounts/fakes'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import * as atomicFiles from '../../src/host/fsAtomic'
import { PAID_DAILY_BUDGET, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { watchSessionTurns } from './helpers/sessionTurns'
import { removeFolder } from './helpers/temporaryFolders'
import { window } from './mocks/vscode'
import { confirmModal } from './helpers/vscodeViews'

const IMAGE: CreateImageBody = {
  model: 'muse-image-1.0',
  prompt: 'A tree',
  n: 1,
  size: '1024x1024',
  response_format: 'b64_json',
  output_format: 'png',
}
const BODY: CreateResponseBody = {
  model: 'muse-spark-1.3',
  input: [],
  instructions: 'Be brief',
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'high', summary: 'auto' },
  stream: true,
  store: false,
  include: ['reasoning.encrypted_content'],
  max_output_tokens: 100,
  prompt_cache_key: 'stable',
  prompt_cache_retention: 'in_memory',
}
const state = { directory: '', now: new Date(2026, 9, 4, 12).getTime() }
beforeEach(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'muse-defaults-'))
  state.now = new Date(2026, 9, 4, 12).getTime()
  vi.mocked(window.showWarningMessage).mockReset()
  vi.mocked(window.showInputBox).mockReset()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await removeFolder(state.directory)
})

function budget(
  capUsd: number | (() => number) = 5,
  isModelApi = true,
  accountAdmission?: AccountBudgetAdmission,
) {
  return createPaidDailyBudget({
    directory: state.directory,
    now: () => state.now,
    capUsd: () => Usd.from(typeof capUsd === 'function' ? capUsd() : capUsd).toAmount(),
    isModelApi: () => isModelApi,
    sleep: () => Promise.resolve(),
    ...(accountAdmission !== undefined && { accountAdmission }),
  })
}
function client(daily: ReturnType<typeof budget> | false = budget()) {
  const api = fakeModelApi()
  const instance = new ModelApiClient({
    fetch: api.fetch,
    ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
    ...(daily !== false && { reservePaidRequest: daily.reserve }),
  })
  return { api, instance }
}
function requireClaim<T>(claim: T | undefined): T {
  if (claim === undefined) throw new Error('Expected daily claim')
  return claim
}
function defaultImagePaid() {
  const store = { keys: () => [], get: () => undefined, update: () => Promise.resolve() }
  return createPaidFeatures({
    globalState: store,
    workspaceState: store,
    isSettingOn: (feature) => feature === 'imageGeneration',
    isDefaultOn: () => true,
    dailyBudgetUsd: () => Usd.from(5).toAmount(),
    isKeyStored: () => true,
    canRememberPaidUse: () => false,
    log: new FakeLogOutputChannel(),
  })
}

async function expectPendingImageConsent(api: ReturnType<typeof fakeModelApi>): Promise<void> {
  await vi.waitFor(() => {
    expect(confirmModal).toHaveBeenCalledOnce()
  })
  expect(api.imageBodies()).toEqual([])
  expect(vi.mocked(confirmModal).mock.calls[0]?.[1]?.detail).toContain('$5.00')
}

async function failureOf(work: Promise<unknown>, state?: { isSettled: boolean }): Promise<unknown> {
  try {
    await work
    return undefined
  } catch (error: unknown) {
    return error
  } finally {
    if (state !== undefined) state.isSettled = true
  }
}

async function ordinaryRequest(isPacking: boolean, isCapped: boolean, hasPaidFeatures: boolean) {
  const { api, instance } = client(isCapped && budget())
  const log = new FakeLogOutputChannel()
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: instance,
      workspaceRoot: '/ws',
      io: memoryToolIo({}, '/ws'),
      log,
    }),
    observationPacking: () => isPacking,
    isPaidFeatureOn: () => hasPaidFeatures,
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  const watched = watchSessionTurns(session)
  try {
    await session.sendTurn([{ type: 'text', text: 'Reply OK' }])
    await watched.turnDone()
    expect(api.responseBodies()).toHaveLength(1)
    return JSON.stringify(api.responseBodies()[0])
  } finally {
    await host.close()
  }
}

async function claimEntries(): Promise<unknown[]> {
  const directory = path.join(
    state.directory,
    'budget-journal',
    PAID_DAILY_BUDGET.accountId,
    '2026-10-4',
    'claims',
  )
  const names = await readdir(directory)
  return await Promise.all(
    names.map(async (name): Promise<unknown> =>
      JSON.parse(await readFile(path.join(directory, name, 'claim.json'), 'utf8')),
    ),
  )
}

async function raiseAtCap() {
  const daily = budget(0.5)
  await requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).settle(Usd.from(0.5).toAmount())
  vi.mocked(confirmModal).mockImplementationOnce((_title, _options, ...items) =>
    Promise.resolve(items[0]),
  )
  return daily
}

function boundBudget(accountAdmission: AccountBudgetAdmission, capUsd = 0.5) {
  return budget(capUsd, true, accountAdmission)
}

describe('D78 interactive paid daily budget', () => {
  it('returns exact decimal headroom to Judge without binary subtraction', async () => {
    const daily = budget(0.8)
    await requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).settle(
      Usd.from(0.1).toAmount(),
    )
    expect(await daily.judgeLedger.remainingUsd()).toBe('0.7')
  })

  it('reserves token extras at exact decimal prices', async () => {
    const daily = budget()
    const claim = requireClaim(
      await daily.reserve(
        { ...BODY, model: 'muse-spark-1.3-contributor', max_output_tokens: 3 },
        'subagents',
        7,
      ),
    )
    expect(claim.reservedUsd).toBe('0.0000013')
    await claim.settle(Usd.from(0).toAmount())
  })

  it('refuses fractional, negative and unsafe token estimates before reserving', async () => {
    const daily = budget()
    for (const value of [0.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(daily.reserve(BODY, 'subagents', value)).rejects.toThrow(
        UI_TEXT.paidDailyLedgerUnavailable,
      )
      await expect(
        daily.reserve({ ...BODY, max_output_tokens: value }, 'subagents', 1),
      ).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
    }
  })

  it('preserves every decimal of a newly entered cap before publication', async () => {
    const daily = await raiseAtCap()
    vi.mocked(window.showInputBox).mockResolvedValueOnce('1.0000000001')
    const claim = requireClaim(await daily.reserve(IMAGE, 'imageGeneration'))
    expect(daily.capUsd()).toBe('1.0000000001')
    await claim.settle(Usd.from(0).toAmount())
  })

  it.each(['extra', 'judge'] as const)(
    'refunds a refused %s account preflight and preserves its structured trigger',
    async (kind) => {
      const stop = new AccountThresholdExceededError({
        kind: 'vendorLimit',
        reason: 'quota',
        resetAt: null,
      })
      const check = () => {
        throw stop
      }
      const bind = vi.fn<AccountBudgetAdmission>(() => check)
      const daily = boundBudget(bind)
      await expect(
        kind === 'extra'
          ? daily.reserve(IMAGE, 'imageGeneration')
          : daily.judgeLedger.reserve(Usd.from(0.01).toAmount()),
      ).rejects.toBe(stop)
      expect(bind).toHaveBeenCalledOnce()
      expect(await claimEntries()).toEqual([expect.objectContaining({ settledUsd: '0' })])
      const total = await daily.latestDay()
      expect(total.spentUsd).toBe('0')
      expect(confirmModal).not.toHaveBeenCalled()
    },
  )

  it.each(['image', 'tokens'] as const)(
    'rechecks %s account thresholds after key retrieval, before fetch',
    async (kind) => {
      const journal = new FakeAccountJournal()
      const bind = vi.fn<AccountBudgetAdmission>((claim) => {
        return () => {
          expect(claim.claimId).toBeTruthy()
          const trigger = evaluateAccountThresholds({
            provider: 'meta',
            account: { id: 'work', thresholds: { requests: { day: 1 } } },
            now: state.now,
            journal,
          })[0]
          if (trigger !== undefined) throw new AccountThresholdExceededError(trigger)
        }
      })
      const daily = boundBudget(bind)
      const api = fakeModelApi()
      const settings = fakeModelApiClientSettings(new FakeLogOutputChannel())
      let hasRecordedRequest = false
      const instance = new ModelApiClient({
        ...settings,
        fetch: api.fetch,
        reservePaidRequest: daily.reserve,
        apiKey: () => {
          if (!hasRecordedRequest) {
            hasRecordedRequest = true
            journal.append({
              provider: 'meta',
              account: 'work',
              time: new Date(state.now).toISOString(),
              settledUsd: PortUsd.from(0).toAmount(),
              reservedUsd: PortUsd.from(0).toAmount(),
              uncertainUsd: PortUsd.from(0).toAmount(),
              inputTokens: 0,
              outputTokens: 0,
              requests: 1,
            })
          }
          return settings.apiKey()
        },
      })
      const signal = new AbortController().signal
      const guard = Object.assign(() => undefined, {
        paidFeature: 'subagents' as const,
        paidEstimatedInputTokens: 100,
      })
      await expect(
        kind === 'image'
          ? instance.createImage(IMAGE, signal)
          : Array.fromAsync(instance.streamResponse(BODY, signal, undefined, undefined, guard)),
      ).rejects.toMatchObject({
        name: 'AccountThresholdExceededError',
        trigger: { kind: 'userCap', metric: 'requests', value: 1 },
      })
      expect(bind).toHaveBeenCalledOnce()
      expect(api.imageBodies()).toEqual([])
      expect(api.responseBodies()).toEqual([])
      expect(await claimEntries()).toEqual([expect.objectContaining({ settledUsd: '0' })])
    },
  )

  it.each(['extra', 'judge'] as const)(
    'refunds a %s account admission factory failure',
    async (kind) => {
      const failure = new Error('Account journal unavailable')
      const bind: AccountBudgetAdmission = () => {
        throw failure
      }
      const daily = boundBudget(bind)
      await expect(
        kind === 'extra'
          ? daily.reserve(IMAGE, 'imageGeneration')
          : daily.judgeLedger.reserve(Usd.from(0.01).toAmount()),
      ).rejects.toBe(failure)
      expect(await claimEntries()).toEqual([expect.objectContaining({ settledUsd: '0' })])
      expect(confirmModal).not.toHaveBeenCalled()
    },
  )

  it('rechecks the same bound account before a 429 retry and sends no request after revocation', async () => {
    const stop = new AccountThresholdExceededError({
      kind: 'vendorLimit',
      reason: 'rateLimited',
      resetAt: new Date(state.now + 60_000).toISOString(),
    })
    let checks = 0
    const check = () => {
      checks++
      if (checks > 2) throw stop
    }
    const bind = vi.fn<AccountBudgetAdmission>(() => check)
    const { instance, api } = client(boundBudget(bind))
    api.images.push({ httpError: { status: 429, message: 'Limited' } })
    await expect(instance.createImage(IMAGE, new AbortController().signal)).rejects.toBe(stop)
    expect(bind).toHaveBeenCalledOnce()
    expect(checks).toBe(3)
    expect(api.imageBodies()).toHaveLength(1)
    expect(await claimEntries()).toEqual([expect.objectContaining({ settledUsd: '0' })])
  })

  it('does not let an account swap reset D78 daily spend across windows', async () => {
    let selected = 'work'
    const bound: string[] = []
    const bind: AccountBudgetAdmission = () => {
      const account = selected
      bound.push(account)
      return () => {
        if (account !== selected) throw new Error('Account changed')
      }
    }
    const first = boundBudget(bind)
    await requireClaim(await first.reserve(IMAGE, 'imageGeneration')).settle(
      Usd.from(0.49).toAmount(),
    )
    const pending = requireClaim(await first.reserve(IMAGE, 'imageGeneration'))
    selected = 'personal'
    expect(() => {
      pending.check(Usd.from(0).toAmount())
    }).toThrow('Account changed')
    const second = boundBudget(bind)
    await expect(second.reserve(IMAGE, 'imageGeneration')).rejects.toThrow(UI_TEXT.paidDailyStopped)
    expect(bound).toEqual(['work', 'work', 'personal'])
    const entries = await claimEntries()
    expect(
      entries.filter(
        (entry) => typeof entry === 'object' && entry !== null && 'settledUsd' in entry,
      ),
    ).toHaveLength(2)
    await expect(second.latestDay()).rejects.toThrow(UI_TEXT.paidDailyStopped)
    // Both accounts used the same fixed journal scope; Stop did not erase it.
    expect(entries).toContainEqual(expect.objectContaining({ settledUsd: '0.49' }))
    expect(entries).toContainEqual(expect.objectContaining({ reservedUsd: '0.01' }))
  })

  it('keeps Judge final account admission inside the shared daily budget and retains unsettled spend', async () => {
    let isAllowed = true
    const check = vi.fn(() => {
      if (!isAllowed) throw new Error('Account unavailable')
    })
    const daily = boundBudget(() => check)
    const claim = await daily.judgeLedger.reserve(Usd.from(0.5).toAmount())
    claim.check()
    isAllowed = false
    expect(() => {
      claim.check()
    }).toThrow('Account unavailable')
    const open = await daily.latestDay()
    expect(open.spentUsd).toBe('0.5')
    await claim.settle(Usd.from(0).toAmount())
    const settled = await daily.latestDay()
    expect(settled.spentUsd).toBe('0')
  })

  it.each([false, true])(
    'keeps packing=%s ordinary requests byte-exact under daily admission, including tools and cache key',
    async (isPacking) => {
      const plain = await ordinaryRequest(isPacking, false, false)
      expect(await ordinaryRequest(isPacking, true, false)).toBe(plain)
    },
  )
  it('reads usage without seeding a ledger and retains outstanding reservations in the meter', async () => {
    const daily = budget()
    expect(await daily.readToday()).toEqual([
      {
        budget: expect.objectContaining({
          kind: 'paidDaily',
          spentUsd: 0,
          capUsd: 5,
          stopped: false,
        }),
      },
    ])
    expect(await readdir(state.directory)).toEqual([])
    const claim = requireClaim(await daily.reserve(IMAGE, 'imageGeneration', undefined))
    const before = await readdir(state.directory)
    const reserved = await daily.readToday()
    expect(reserved[0]?.budget.spentUsd).toBeGreaterThan(0)
    expect(reserved[0]?.budget.uncertainUsd).toBe(reserved[0]?.budget.spentUsd)
    expect(await readdir(state.directory)).toEqual(before)
    await claim.settle(Usd.from(0).toAmount())
    const settled = await daily.readToday()
    expect(settled[0]?.budget.spentUsd).toBe(0)
  })

  it('declares recall when packing is enabled and keeps paid admission byte-exact in each mode', async () => {
    const plain = await ordinaryRequest(false, false, false)
    const packing = await ordinaryRequest(true, false, false)
    expect(plain).not.toContain('"name":"recall_output"')
    expect(packing).toContain('"name":"recall_output"')
    const request = z.object({ prompt_cache_key: z.string() })
    expect(request.parse(JSON.parse(packing)).prompt_cache_key).not.toBe(
      request.parse(JSON.parse(plain)).prompt_cache_key,
    )
    expect(packing).not.toBe(plain)
    expect(await ordinaryRequest(false, true, false)).toBe(plain)
    expect(await ordinaryRequest(true, true, false)).toBe(packing)
  })

  it('keeps a later committed Stop in force when another window publishes a held raise', async () => {
    const daily = budget(0.5)
    await requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).settle(
      Usd.from(0.5).toAmount(),
    )
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const originalWrite = atomicFiles.writeFileAtomically
    vi.spyOn(atomicFiles, 'writeFileAtomically').mockImplementation(
      async (target, content, options) => {
        if (
          target.endsWith(PAID_DAILY_BUDGET.overrideFile) &&
          String(content).includes('"stopped":false')
        ) {
          entered.resolve(undefined)
          await released.promise
          // Simulate a rename already handed to the OS: its final guard
          // cannot be rerun, and the numeric override really lands late.
          await originalWrite(target, content, { sleep: options.sleep })
          return
        }
        await originalWrite(target, content, options)
      },
    )
    vi.mocked(confirmModal).mockImplementationOnce((_title, _options, ...items) =>
      Promise.resolve(items[0]),
    )
    vi.mocked(window.showInputBox).mockResolvedValueOnce('1')
    const raising = failureOf(daily.reserve(IMAGE, 'imageGeneration'))
    try {
      await entered.promise
      await expect(budget(0.5).reserve(IMAGE, 'imageGeneration')).rejects.toThrow(
        UI_TEXT.paidDailyStopped,
      )
      expect(() => daily.capUsd()).toThrow(UI_TEXT.paidDailyStopped)
    } finally {
      released.resolve(undefined)
    }
    const outcome = await raising
    expect(() => budget(0.5).capUsd()).toThrow(UI_TEXT.paidDailyStopped)
    expect(outcome).toBeInstanceOf(Error)
    state.now = new Date(2026, 9, 5, 12).getTime()
    expect(daily.capUsd()).toBe(Usd.from(0.5).toAmount())
  })

  it.each(['image', 'tokens'] as const)(
    'cancels %s daily admission while its budget popup waits, refunds and ignores the late answer',
    async (kind) => {
      const daily = budget(0.5)
      await requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).settle(
        Usd.from(0.5).toAmount(),
      )
      const popup = Promise.withResolvers<string | undefined>()
      let raiseTitle: string | undefined
      vi.mocked(confirmModal).mockImplementationOnce((_title, _options, ...items) => {
        raiseTitle = items[0]
        return popup.promise
      })
      vi.mocked(window.showInputBox).mockResolvedValueOnce('1')
      const { api, instance } = client(daily)
      const abort = new AbortController()
      const guard = Object.assign(() => undefined, {
        paidFeature: 'subagents' as const,
        paidEstimatedInputTokens: 100,
      })
      const settlement = { isSettled: false }
      const pending = failureOf(
        kind === 'image'
          ? instance.createImage(IMAGE, abort.signal)
          : Array.fromAsync(
              instance.streamResponse(BODY, abort.signal, undefined, undefined, guard),
            ),
        settlement,
      )
      try {
        await vi.waitFor(() => {
          expect(confirmModal).toHaveBeenCalledOnce()
        })
        abort.abort()
        await vi.waitFor(() => {
          expect(settlement.isSettled).toBe(true)
        })
        expect(await pending).toMatchObject({ name: 'AbortError' })
        const entries = await claimEntries()
        expect(entries).toHaveLength(2)
        expect(entries).toContainEqual(expect.objectContaining({ settledUsd: '0' }))
      } finally {
        abort.abort()
        popup.resolve(raiseTitle)
        await pending
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve)
      })
      expect(window.showInputBox).not.toHaveBeenCalled()
      expect(daily.capUsd()).toBe(Usd.from(0.5).toAmount())
      expect(api.imageBodies()).toEqual([])
      expect(api.responseBodies()).toEqual([])
    },
  )

  it('cancels a held raise input without publishing a late limit or Stop', async () => {
    const daily = await raiseAtCap()
    const input = Promise.withResolvers<string | undefined>()
    vi.mocked(window.showInputBox).mockReturnValueOnce(input.promise)
    const { api, instance } = client(daily)
    const abort = new AbortController()
    const settlement = { isSettled: false }
    const pending = failureOf(instance.createImage(IMAGE, abort.signal), settlement)
    try {
      await vi.waitFor(() => {
        expect(window.showInputBox).toHaveBeenCalledOnce()
      })
      abort.abort()
      await vi.waitFor(() => {
        expect(settlement.isSettled).toBe(true)
      })
      expect(await pending).toMatchObject({ name: 'AbortError' })
    } finally {
      abort.abort()
      input.resolve('1')
      await pending
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(daily.capUsd()).toBe(Usd.from(0.5).toAmount())
    expect(api.imageBodies()).toEqual([])
  })

  it('refunds cancellation during a held policy write and refuses its late publication', async () => {
    const daily = await raiseAtCap()
    vi.mocked(window.showInputBox).mockResolvedValueOnce('1')
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const finished = Promise.withResolvers<undefined>()
    const originalWrite = atomicFiles.writeFileAtomically
    vi.spyOn(atomicFiles, 'writeFileAtomically').mockImplementation(
      async (target, content, options) => {
        if (target.endsWith(PAID_DAILY_BUDGET.overrideFile)) {
          entered.resolve(undefined)
          await released.promise
          try {
            await originalWrite(target, content, options)
          } finally {
            finished.resolve(undefined)
          }
        } else {
          await originalWrite(target, content, options)
        }
      },
    )
    const { api, instance } = client(daily)
    const abort = new AbortController()
    const settlement = { isSettled: false }
    const pending = failureOf(instance.createImage(IMAGE, abort.signal), settlement)
    try {
      await entered.promise
      abort.abort()
      await vi.waitFor(() => {
        expect(settlement.isSettled).toBe(true)
      })
      expect(await pending).toMatchObject({ name: 'AbortError' })
    } finally {
      abort.abort()
      released.resolve(undefined)
      await pending
      await finished.promise
    }
    expect(daily.capUsd()).toBe(Usd.from(0.5).toAmount())
    expect(api.imageBodies()).toEqual([])
    await expect(readdir(path.join(state.directory, '2026-10-4'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('keeps an ordinary single-model turn and its request prefix unchanged by daily admission', async () => {
    const plain = await ordinaryRequest(true, false, true)
    expect(await ordinaryRequest(true, true, true)).toBe(plain)
    await expect(readdir(state.directory)).resolves.toEqual([])
  })
  it('drives the real host image path: default availability asks before fetch and remains usable after Allow once', async () => {
    const paid = defaultImagePaid()
    const { api, instance } = client()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, '/ws')
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client: instance, workspaceRoot: '/ws', io, log }),
      isPaidFeatureOn: (feature) => paid.gate.isOn(feature),
      allowsPaidUse: (request, requiresAsking) => paid.consent.allows(request, requiresAsking),
    })
    const session = await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    const watched = watchSessionTurns(session)
    const popup = Promise.withResolvers<string | undefined>()
    let allow: (() => void) | undefined
    vi.mocked(confirmModal).mockImplementationOnce((_title, _options, ...items) => {
      allow = () => {
        popup.resolve(items[0])
      }
      return popup.promise
    })
    api.script(
      {
        calls: [
          {
            name: 'generate_image',
            arguments: JSON.stringify({ prompt: 'A tree', path: 'art.png' }),
          },
        ],
      },
      { text: 'Done' },
    )
    try {
      await session.sendTurn([{ type: 'text', text: 'Draw a tree' }])
      await expectPendingImageConsent(api)
      allow?.()
      await watched.turnDone()
      expect(api.imageBodies()).toHaveLength(1)
      expect(io.binaries.has('/ws/art.png')).toBe(true)
    } finally {
      await host.close()
    }
  })
  it('shares settled and open liabilities across windows and keeps ambiguous charges', async () => {
    const a = budget(0.5)
    const b = budget(0.5)
    const first = requireClaim(await a.reserve(IMAGE, 'imageGeneration'))
    first.check(Usd.from(0).toAmount())
    await first.settle(Usd.from(0.49).toAmount())
    const second = requireClaim(await b.reserve(IMAGE, 'imageGeneration'))
    second.check(Usd.from(0).toAmount())
    await expect(a.reserve(IMAGE, 'imageGeneration')).rejects.toThrow(UI_TEXT.paidDailyStopped)
    const call = vi.mocked(confirmModal).mock.calls.at(-1)
    expect(call?.[0]).toBe(UI_TEXT.paidDailyReached)
    expect(call?.[1]?.detail).toContain('$0.50')
    state.now = new Date(2026, 9, 5, 12).getTime()
    requireClaim(await a.reserve(IMAGE, 'imageGeneration')).check(Usd.from(0).toAmount())
  })

  it('rejects a final send if another window reserved the last funds meanwhile', async () => {
    const daily = budget(0.5)
    const seed = requireClaim(await daily.reserve(IMAGE, 'imageGeneration'))
    await seed.settle(Usd.from(0.48).toAmount())
    const a = requireClaim(await daily.reserve(IMAGE, 'imageGeneration'))
    const b = requireClaim(await budget(0.5).reserve(IMAGE, 'imageGeneration'))
    a.check(Usd.from(0).toAmount())
    b.check(Usd.from(0).toAmount())
    const answer = Promise.withResolvers<string | undefined>()
    vi.mocked(confirmModal).mockReturnValueOnce(answer.promise)
    const pending = budget(0.5).reserve(IMAGE, 'imageGeneration')
    await vi.waitFor(() => {
      expect(confirmModal).toHaveBeenCalledOnce()
    })
    expect(() => {
      a.check(Usd.from(0).toAmount())
    }).toThrow(UI_TEXT.paidDailyLedgerUnavailable)
    answer.resolve(undefined)
    await expect(pending).rejects.toThrow(UI_TEXT.paidDailyStopped)
  })

  it('fails closed on a corrupt shared ledger, without a paid fetch or a raise offer', async () => {
    const daily = budget()
    requireClaim(await daily.reserve(IMAGE, 'imageGeneration'))
    const seed = path.join(
      state.directory,
      'budget-journal',
      PAID_DAILY_BUDGET.accountId,
      '2026-10-4',
      'seed.json',
    )
    await writeFile(seed, '{broken')
    const { api, instance } = client(daily)
    await expect(instance.createImage(IMAGE, new AbortController().signal)).rejects.toThrow(
      UI_TEXT.paidDailyLedgerUnavailable,
    )
    expect(api.imageBodies()).toEqual([])
    expect(confirmModal).not.toHaveBeenCalled()
  })

  it('rechecks the daily cap after key retrieval before the actual fetch', async () => {
    let capUsd = 1
    const daily = budget(() => capUsd)
    await requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).settle(
      Usd.from(0.5).toAmount(),
    )
    const api = fakeModelApi()
    const instance = new ModelApiClient({
      fetch: api.fetch,
      baseUrl: 'https://api.example.test/v1',
      apiKey: () => {
        capUsd = 0.5
        return Promise.resolve('LLM|1|secret')
      },
      sleep: () => Promise.resolve(),
      now: () => state.now,
      random: () => 0,
      log: new FakeLogOutputChannel(),
      reservePaidRequest: daily.reserve,
    })
    await expect(instance.createImage(IMAGE, new AbortController().signal)).rejects.toThrow(
      UI_TEXT.paidDailyLedgerUnavailable,
    )
    expect(api.imageBodies()).toEqual([])
  })

  it('shares a raise for today, and resets that override tomorrow', async () => {
    const daily = await raiseAtCap()
    vi.mocked(window.showInputBox).mockResolvedValueOnce('1')
    requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).check(Usd.from(0).toAmount())
    expect(budget(0.5).capUsd()).toBe(Usd.from(1).toAmount())
    state.now = new Date(2026, 9, 5, 12).getTime()
    expect(daily.capUsd()).toBe(Usd.from(0.5).toAmount())
  })

  it('settles model token extras at reported prices and preserves the request byte-exact', async () => {
    const { api, instance } = client()
    api.script({ text: 'OK', usage: { input: 100, output: 20, cached: 50 } })
    const guard = Object.assign(vi.fn<() => void>(), {
      paidFeature: 'subagents' as const,
      paidEstimatedInputTokens: estimateInput(requestParts(BODY), undefined).inputTokens,
    })
    await Array.fromAsync(
      instance.streamResponse(BODY, new AbortController().signal, undefined, undefined, guard),
    )
    expect(JSON.stringify(api.responseBodies()[0])).toBe(JSON.stringify(BODY))
    expect(await claimEntries()).toEqual([expect.objectContaining({ settledUsd: '0.000155' })])
  })

  it('refunds final nonsends and retains an ambiguous sent image fee', async () => {
    const { api, instance } = client()
    await expect(
      instance.createImage(IMAGE, new AbortController().signal, () => {
        throw new Error('Stopped before send')
      }),
    ).rejects.toThrow('Stopped before send')
    expect(api.imageBodies()).toEqual([])
    api.images.push({ networkError: 'connection lost' })
    await expect(instance.createImage(IMAGE, new AbortController().signal)).rejects.toThrow()
    const entries = await claimEntries()
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reservedUsd: '0.01', settledUsd: '0' }),
        expect.objectContaining({ reservedUsd: '0.01' }),
      ]),
    )
    expect(
      entries.filter(
        (value) => typeof value === 'object' && value !== null && 'settledUsd' in value,
      ),
    ).toHaveLength(1)
  })

  it('default-on first use asks before any paid request, and Deny sends nothing', async () => {
    const paid = defaultImagePaid()
    const { api, instance } = client()
    const answer = Promise.withResolvers<string | undefined>()
    vi.mocked(confirmModal).mockReturnValueOnce(answer.promise)
    const use = async () => {
      if (
        await paid.consent.allows({
          feature: 'imageGeneration',
          kind: 'generate',
          path: 'art.png',
          sources: [],
          prompt: 'A tree',
        })
      )
        await instance.createImage(IMAGE, new AbortController().signal)
    }
    await paid.gate.review()
    expect(confirmModal).not.toHaveBeenCalled()
    const pending = use()
    await expectPendingImageConsent(api)
    answer.resolve(undefined)
    await pending
    expect(api.imageBodies()).toEqual([])
  })

  it('leaves Muse Code outside the daily ledger and refuses unbounded hosted search', async () => {
    await expect(budget(5, false).reserve(IMAGE, 'imageGeneration')).resolves.toBeUndefined()
    await expect(
      budget().reserve({ ...BODY, tools: [{ type: 'web_search' }] }, 'webSearch'),
    ).rejects.toThrow(UI_TEXT.sessionBudgetSearchUnavailable)
    await expect(readdir(state.directory)).resolves.toEqual([])
  })
})

it.each(['1.00000000000000015', '0.50000000000000004'])(
  'R3 P3: preserves newly entered exact daily limit %s without Number parsing',
  async (entered) => {
    const daily = budget(0.5)
    await daily.reserveExact(Usd.from('0.49000000000000004').toAmount())
    vi.mocked(window.showWarningMessage).mockResolvedValue({ title: UI_TEXT.paidDailyRaise })
    vi.mocked(window.showInputBox).mockResolvedValue(entered)
    const claim = await daily.reserve(IMAGE, 'imageGeneration')
    expect(claim).toBeDefined()
    const current = await daily.latestDay()
    expect(current.capUsd).toBe(Usd.from(entered).toAmount())
    const raw = JSON.parse(
      await readFile(
        path.join(state.directory, current.day, PAID_DAILY_BUDGET.overrideFile),
        'utf8',
      ),
    ) as unknown
    expect(raw).toEqual({ limitUsd: entered, stopped: false })
  },
)
// TRAIN15D: M97 explanations use this ledger even while Muse Code owns chat.
it('reserves and settles legal explanation spend on Muse Code while other extras keep their backend policy', async () => {
  const daily = budget(5, false)
  expect(await daily.reserve(IMAGE, 'imageGeneration', undefined)).toBeUndefined()
  const claim = requireClaim(await daily.reserve(BODY, 'legalExplanation', 100))
  expect(Number(claim.reservedUsd)).toBeGreaterThan(0)
  await claim.settle(Usd.from(0.01).toAmount())
  const settled = await daily.latestDay()
  expect(settled.spentUsd).toBe(Usd.from(0.01).toAmount())
})

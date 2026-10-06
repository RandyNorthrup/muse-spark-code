import { Usd } from '../../src/shared/usd'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateImageBody, CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { estimateInput, requestParts } from '../../src/core/backends/modelapi/sessionBudget'
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

function budget(capUsd = 5, isModelApi = true) {
  return createPaidDailyBudget({
    directory: state.directory,
    now: () => state.now,
    capUsd: () => Usd.from(capUsd).toAmount(),
    isModelApi: () => isModelApi,
    sleep: () => Promise.resolve(),
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

describe('D78 interactive paid daily budget', () => {
  it.each([false, true])(
    'keeps packing=%s ordinary requests byte-exact under daily admission, including tools and cache key',
    async (isPacking) => {
      const plain = await ordinaryRequest(isPacking, false, false)
      expect(await ordinaryRequest(isPacking, true, false)).toBe(plain)
    },
  )

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
      await vi.waitFor(() => {
        expect(confirmModal).toHaveBeenCalledOnce()
      })
      expect(api.imageBodies()).toEqual([])
      expect(vi.mocked(confirmModal).mock.calls[0]?.[1]?.detail).toContain('$5.00')
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
    const daily = createPaidDailyBudget({
      directory: state.directory,
      now: () => state.now,
      capUsd: () => Usd.from(capUsd).toAmount(),
      isModelApi: () => true,
      sleep: () => Promise.resolve(),
    })
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
    expect(confirmModal).toHaveBeenCalledOnce()
    expect(api.imageBodies()).toEqual([])
    expect(vi.mocked(confirmModal).mock.calls[0]?.[1]?.detail).toContain('$5.00')
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

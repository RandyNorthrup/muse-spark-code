import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateImageBody, CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { estimateInput, requestParts } from '../../src/core/backends/modelapi/sessionBudget'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
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
  await removeFolder(state.directory)
})

function budget(capUsd = 5, isModelApi = true) {
  return createPaidDailyBudget({
    directory: state.directory,
    now: () => state.now,
    capUsd: () => capUsd,
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
  const store = { get: () => undefined, update: () => Promise.resolve() }
  return createPaidFeatures({
    globalState: store,
    workspaceState: store,
    isSettingOn: (feature) => feature === 'imageGeneration',
    isDefaultOn: () => true,
    dailyBudgetUsd: () => 5,
    isKeyStored: () => true,
    canRememberPaidUse: () => false,
    log: new FakeLogOutputChannel(),
  })
}

describe('D78 interactive paid daily budget', () => {
  it('keeps an ordinary single-model turn and its request prefix unchanged by daily admission', async () => {
    const bodies: unknown[] = []
    for (const isCapped of [false, true]) {
      const { api, instance } = client(isCapped && budget())
      const log = new FakeLogOutputChannel()
      const io = memoryToolIo({}, '/ws')
      const host = new ModelApiHost({
        ...fakeModelApiHostDeps({ client: instance, workspaceRoot: '/ws', io, log }),
        observationPacking: () => true,
        isPaidFeatureOn: () => true,
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
        bodies.push(api.responseBodies()[0])
      } finally {
        await host.close()
      }
    }
    expect(JSON.stringify(bodies[0])).toBe(JSON.stringify(bodies[1]))
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
    first.check(0)
    await first.settle(0.49)
    const second = requireClaim(await b.reserve(IMAGE, 'imageGeneration'))
    second.check(0)
    await expect(a.reserve(IMAGE, 'imageGeneration')).rejects.toThrow(UI_TEXT.paidDailyStopped)
    const call = vi.mocked(confirmModal).mock.calls.at(-1)
    expect(call?.[0]).toBe(UI_TEXT.paidDailyReached)
    expect(call?.[1]?.detail).toContain('$0.50')
    state.now = new Date(2026, 9, 5, 12).getTime()
    requireClaim(await a.reserve(IMAGE, 'imageGeneration')).check(0)
  })

  it('rejects a final send if another window reserved the last funds meanwhile', async () => {
    const daily = budget(0.5)
    const seed = requireClaim(await daily.reserve(IMAGE, 'imageGeneration'))
    await seed.settle(0.48)
    const a = requireClaim(await daily.reserve(IMAGE, 'imageGeneration'))
    const b = requireClaim(await budget(0.5).reserve(IMAGE, 'imageGeneration'))
    a.check(0)
    b.check(0)
    const answer = Promise.withResolvers<string | undefined>()
    vi.mocked(confirmModal).mockReturnValueOnce(answer.promise)
    const pending = budget(0.5).reserve(IMAGE, 'imageGeneration')
    await vi.waitFor(() => {
      expect(confirmModal).toHaveBeenCalledOnce()
    })
    expect(() => a.check(0)).toThrow(UI_TEXT.paidDailyLedgerUnavailable)
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
      capUsd: () => capUsd,
      isModelApi: () => true,
      sleep: () => Promise.resolve(),
    })
    await requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).settle(0.5)
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
    const daily = budget(0.5)
    await requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).settle(0.5)
    vi.mocked(confirmModal).mockImplementationOnce((_title, _options, ...items) =>
      Promise.resolve(items[0]),
    )
    vi.mocked(window.showInputBox).mockResolvedValueOnce('1')
    requireClaim(await daily.reserve(IMAGE, 'imageGeneration')).check(0)
    expect(budget(0.5).capUsd()).toBe(1)
    state.now = new Date(2026, 9, 5, 12).getTime()
    expect(daily.capUsd()).toBe(0.5)
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
    const claims = path.join(
      state.directory,
      'budget-journal',
      PAID_DAILY_BUDGET.accountId,
      '2026-10-4',
      'claims',
    )
    const names = await readdir(claims)
    expect(names).toHaveLength(1)
    const json: unknown = JSON.parse(
      await readFile(path.join(claims, names[0] ?? '', 'claim.json'), 'utf8'),
    )
    expect(json).toMatchObject({ settledUsd: 0.000155 })
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
    const claims = path.join(
      state.directory,
      'budget-journal',
      PAID_DAILY_BUDGET.accountId,
      '2026-10-4',
      'claims',
    )
    const names = await readdir(claims)
    const entries = await Promise.all(
      names.map(async (name): Promise<unknown> =>
        JSON.parse(await readFile(path.join(claims, name, 'claim.json'), 'utf8')),
      ),
    )
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reservedUsd: 0.01, settledUsd: 0 }),
        expect.objectContaining({ reservedUsd: 0.01 }),
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

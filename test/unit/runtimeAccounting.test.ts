import { reserveRequestAmount } from '../../src/core/providers/priceCard'
import { requestImageCount } from '../../src/core/backends/modelapi/modelPolicy'
import { Usd } from '../../src/shared/usd'
import { fork } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  createRuntimeDailyBudget,
  readRuntimeDailyBudget,
  withRuntimeAccounting,
} from '../../src/runtime/runtimeAccountingEntry'
import { SETTING_DEFAULTS } from '../../src/shared/constants'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import {
  createAutoCompactionAdmission,
  resolveAutoCompactModel,
} from '../../src/core/backends/modelapi/autoCompactionAdmission'
import { PAID_DAILY_BUDGET } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { createRunLedger } from '../../src/runtime/exec/runLedger'

const roots: string[] = []
const folder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'train15e-budget-'))
  roots.push(root)
  return root
}
const built = folder()
beforeAll(async () => {
  await build({
    entryPoints: ['src/runtime/runtimeAccountingEntry.ts'],
    outfile: path.join(built, 'accounting.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  writeFileSync(
    path.join(built, 'race.cjs'),
    `const { createRuntimeDailyBudget } = require('./accounting.cjs'); const { setTimeout } = require('node:timers/promises'); const budget = createRuntimeDailyBudget({ dataFolder: process.argv[2], now: () => Date.now(), sleep: setTimeout }); process.on('message', async () => { try { const claim = await budget.reserve(1, new AbortController().signal); claim.check(0); process.send({ admitted: true }); } catch { process.send({ admitted: false }); } process.disconnect(); }); process.send({ ready: true });`,
  )
})
afterAll(async () => {
  await Promise.all(roots.map((root) => removeFolder(root)))
})
const body: CreateResponseBody = {
  model: 'muse-spark-1.3',
  instructions: 'Test',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
  tools: [],
  tool_choice: 'auto',
  stream: true,
  store: false,
  prompt_cache_key: 'test-cache',
  prompt_cache_retention: 'in_memory',
  max_output_tokens: 64,
  reasoning: { effort: 'minimal' },
  include: [],
}

function isConsentCurrent(): boolean {
  return true
}
describe('standalone daily admission', () => {
  it('runtime automatic summaries use exactly one daily claim and one debit', async () => {
    const daily = dailyBudgetAt(folder())
    const original = daily.reserve.bind(daily)
    const reserve = vi.spyOn(daily, 'reserve')
    const settlements: ReturnType<typeof vi.fn>[] = []
    reserve.mockImplementation(async (...args) => {
      const claim = await original(...args)
      const settled = vi.fn(claim.settle.bind(claim))
      settlements.push(settled)
      return { ...claim, settle: settled }
    })
    const api = fakeModelApi()
    api.script({ text: 'automatic summary', usage: { input: 1000, output: 500, cached: 200 } })
    const client = withRuntimeAccounting(fakeModelApiClient(api, new FakeLogOutputChannel()), daily)
    const admit = createAutoCompactionAdmission({
      loadPricing: () => Promise.resolve({ reserveRequestAmount, requestImageCount }),
      accounting: 'transport',
      allowsPaidUse: () => Promise.resolve(true),
      isOn: () => true,
      isTrusted: () => true,
      isEvaluated: () => true,
      paidUseFence: () => isConsentCurrent,
      notePaidUse: () => undefined,
      dailyBudgetUsd: () => Usd.from(5).toAmount(),
      log: new FakeLogOutputChannel(),
      storeUnavailable: EN.sessionBudgetStoreUnavailable,
    })
    const model = resolveAutoCompactModel(body.model)
    if (model === undefined) throw new Error('missing test model')
    const admission = await admit({
      sessionId: 'session',
      turnId: 'turn',
      modelId: body.model,
      model,
      decision: {
        reason: 'cost',
        newDebt: 0.012,
        saving: 0.05,
        breakEvenRequests: 3,
        writeReadRatio: 2,
      },
      signal: new AbortController().signal,
    })
    await Array.fromAsync(
      client.streamResponse(
        body,
        new AbortController().signal,
        undefined,
        undefined,
        admission?.guard,
      ),
    )
    await admission?.close?.()
    expect(api.responseBodies()).toHaveLength(1)
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(settlements).toHaveLength(1)
    expect(settlements[0]).toHaveBeenCalledTimes(1)
    const debit = settlements[0]?.mock.calls[0]?.[0]
    expect(debit).toBe(Usd.from(0.003155).toAmount())
  })
  it('runtime settlement failures surface the terminal accounting error', async () => {
    const daily = dailyBudgetAt(folder())
    const original = daily.reserve.bind(daily)
    vi.spyOn(daily, 'reserve').mockImplementation(async (...args) => ({
      ...(await original(...args)),
      settle: () => Promise.reject(new Error('storage failed')),
    }))
    const api = fakeModelApi()
    api.script({ text: 'summary' })
    const client = withRuntimeAccounting(fakeModelApiClient(api, new FakeLogOutputChannel()), daily)
    await expect(
      Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow(EN.sessionBudgetStoreUnavailable)
    expect(api.responseBodies()).toHaveLength(1)
  })
  it('runtime retries refund a known 429 nonsend before reserving the next attempt', async () => {
    const daily = dailyBudgetAt(folder())
    const original = daily.reserve.bind(daily)
    const settlements: ReturnType<typeof vi.fn>[] = []
    vi.spyOn(daily, 'reserve').mockImplementation(async (...args) => {
      const claim = await original(...args)
      const settle = vi.fn(claim.settle.bind(claim))
      settlements.push(settle)
      return { ...claim, settle }
    })
    const api = fakeModelApi()
    api.script(
      { httpError: { status: 429, body: { error: { message: 'rate limited' } } } },
      { text: 'done' },
    )
    const client = withRuntimeAccounting(fakeModelApiClient(api, new FakeLogOutputChannel()), daily)
    await Array.fromAsync(client.streamResponse(body, new AbortController().signal))
    expect(api.responseBodies()).toHaveLength(2)
    expect(settlements).toHaveLength(2)
    expect(settlements[0]).toHaveBeenCalledWith(Usd.from(0).toAmount())
    expect(settlements[1]).toHaveBeenCalledTimes(1)
  })
  it.each(['stop', 'unreadable'])(
    'runtime refuses shared daily %s at reserve and final send',
    async (state) => {
      const root = folder()
      const daily = dailyBudgetAt(root)
      const claim = await daily.reserve(Usd.from(1).toAmount(), new AbortController().signal)
      const date = new Date()
      const scope = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
      const directory = path.join(root, PAID_DAILY_BUDGET.directory, scope)
      mkdirSync(directory, { recursive: true })
      if (state === 'stop') mkdirSync(path.join(directory, PAID_DAILY_BUDGET.stopDirectory))
      else writeFileSync(path.join(directory, PAID_DAILY_BUDGET.overrideFile), 'corrupt')
      await expect(
        daily.reserve(Usd.from(1).toAmount(), new AbortController().signal),
      ).rejects.toThrow()
      expect(() => claim.check(Usd.from(0).toAmount())).toThrow()
    },
  )
  it('refuses admission itself when full, before a final dispatch fence', async () => {
    const root = folder()
    writeFileSync(path.join(root, 'settings.json'), '{"paidDailyBudgetUsd":1}')
    const daily = dailyBudgetAt(root)
    await daily.reserve(Usd.from(1).toAmount(), new AbortController().signal)
    await expect(
      daily.reserve(Usd.from(1).toAmount(), new AbortController().signal),
    ).rejects.toThrow()
  })
  it.each([false, true])(
    'settles verified usage and retains unpriced liability (missing usage: %s)',
    async (omitUsage) => {
      const daily = createRuntimeDailyBudget({
        dataFolder: folder(),
        now: () => Date.now(),
        sleep: delay,
      })
      const api = fakeModelApi()
      api.script({ text: 'done', omitUsage })
      const client = withRuntimeAccounting(
        fakeModelApiClient(api, new FakeLogOutputChannel()),
        daily,
      )
      await Array.fromAsync(client.streamResponse(body, new AbortController().signal))
      expect(api.responseBodies()).toHaveLength(1)
      const next = daily.reserve(Usd.from(4.99).toAmount(), new AbortController().signal)
      if (omitUsage) await expect(next).rejects.toThrow()
      else
        await expect(next).resolves.toEqual(
          expect.objectContaining({ reservedUsd: Usd.from(4.99).toAmount() }),
        )
    },
  )
  it('rechecks a reduced cap and a changed local day at dispatch', async () => {
    const root = folder()
    let now = new Date(2026, 9, 6, 12).getTime()
    writeFileSync(path.join(root, 'settings.json'), '{"paidDailyBudgetUsd":1}')
    const daily = createRuntimeDailyBudget({ dataFolder: root, now: () => now, sleep: delay })
    const claim = await daily.reserve(Usd.from(1).toAmount(), new AbortController().signal)
    writeFileSync(path.join(root, 'settings.json'), '{"paidDailyBudgetUsd":0.5}')
    expect(() => claim.check(Usd.from(0).toAmount())).toThrow()
    writeFileSync(path.join(root, 'settings.json'), '{"paidDailyBudgetUsd":1}')
    now += 86_400_000
    expect(() => claim.check(Usd.from(0).toAmount())).toThrow()
  })
  it('serializes two processes racing the last dollar', async () => {
    const root = folder()
    writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ paidDailyBudgetUsd: 1 }))
    const children = [
      fork(path.join(built, 'race.cjs'), [root], {
        env: withoutCredentials(process.env),
        silent: true,
      }),
      fork(path.join(built, 'race.cjs'), [root], {
        env: withoutCredentials(process.env),
        silent: true,
      }),
    ]
    const results = children.map(
      (child) =>
        new Promise<boolean>((resolve, reject) => {
          child.on('error', reject)
          child.on('message', (message: unknown) => {
            const parsed = z
              .object({ admitted: z.optional(z.boolean()), ready: z.optional(z.boolean()) })
              .parse(message)
            if (parsed.admitted !== undefined) resolve(parsed.admitted)
          })
          child.on('exit', (code) => {
            if (code !== 0) reject(new Error('budget child failed'))
          })
        }),
    )
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) =>
            child.once('message', () => {
              resolve()
            }),
          ),
      ),
    )
    for (const child of children) child.send({ start: true })
    const admissions = await Promise.all(results)
    expect(admissions.toSorted((left, right) => Number(left) - Number(right))).toEqual([
      false,
      true,
    ])
  })
  it('refuses before shared transport dispatch when the daily ledger is full', async () => {
    const root = folder()
    writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ paidDailyBudgetUsd: 1 }))
    const daily = dailyBudgetAt(root)
    await daily.reserve(Usd.from(1).toAmount(), new AbortController().signal)
    const api = fakeModelApi()
    api.script({ text: 'done' })
    const client = withRuntimeAccounting(fakeModelApiClient(api, new FakeLogOutputChannel()), daily)
    await expect(
      Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow()
    expect(api.responseBodies()).toHaveLength(0)
  })
  it('refuses an unaffordable run before dispatch and refunds its daily reservation', async () => {
    const root = folder()
    const daily = dailyBudgetAt(root)
    const api = fakeModelApi()
    api.script({ text: 'done' })
    const ledger = createRunLedger({ capUsd: Usd.from(0.000001).toAmount(), maxRequests: 1 })
    const refusals: string[] = []
    const client = withRuntimeAccounting(
      fakeModelApiClient(api, new FakeLogOutputChannel()),
      daily,
      {
        ledger,
        refuse: (reason) => {
          refusals.push(reason)
        },
        started: () => undefined,
        settled: () => undefined,
      },
    )
    await expect(
      Array.fromAsync(client.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow()
    expect(refusals).toEqual(['budget'])
    expect(api.responseBodies()).toHaveLength(0)
    const claim = await daily.reserve(Usd.from(5).toAmount(), new AbortController().signal)
    expect(claim.check(Usd.from(0).toAmount()).spentUsd).toBe(Usd.from(5).toAmount())
  })
  it('fails closed on malformed runtime settings and an abandoned process lock', async () => {
    const root = folder()
    writeFileSync(path.join(root, 'settings.json'), '{}')
    const daily = createRuntimeDailyBudget({
      dataFolder: root,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })
    writeFileSync(path.join(root, 'settings.json'), '{"paidDailyBudgetUsd":0}')
    await expect(
      daily.reserve(Usd.from(1).toAmount(), new AbortController().signal),
    ).rejects.toThrow()
    writeFileSync(path.join(root, 'settings.json'), '{"paidDailyBudgetUsd":1}')
    const date = new Date()
    const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
    mkdirSync(path.join(root, 'paid-daily', 'budget-intents', '0'.repeat(64), day + '.lock'), {
      recursive: true,
    })
    await expect(
      daily.reserve(Usd.from(1).toAmount(), new AbortController().signal),
    ).rejects.toThrow()
  })
  it('reads today’s shared daily budget for report Limits sections', async () => {
    // The same pair VS Code passes: the daily ledger first, then the live
    // session budgets (RVCM1132B finding 3). A missing ledger reads as zero
    // spend under the configured cap, never an error.
    const root = folder()
    const fresh = await readRuntimeDailyBudget({ dataFolder: root, now: Date.now })
    expect(fresh).toHaveLength(1)
    expect(fresh[0]?.budget.kind).toBe('paidDaily')
    expect(fresh[0]?.budget.spentUsd).toBe(Usd.from(0).toAmount())
    expect(fresh[0]?.budget.capUsd).toBe(Usd.from(SETTING_DEFAULTS.paidDailyBudgetUsd).toAmount())
    expect(fresh[0]?.budget.stopped).toBe(false)
    expect(fresh[0]?.budget.resetsAt).toBeGreaterThan(Date.now())
    writeFileSync(path.join(root, 'settings.json'), '{"paidDailyBudgetUsd":1}')
    const capped = await readRuntimeDailyBudget({ dataFolder: root, now: Date.now })
    expect(capped[0]?.budget.capUsd).toBe(Usd.from(1).toAmount())
    const daily = dailyBudgetAt(root)
    expect(await daily.readToday()).toEqual(capped)
  })
})

function dailyBudgetAt(dataFolder: string) {
  return createRuntimeDailyBudget({ dataFolder, now: Date.now, sleep: delay })
}

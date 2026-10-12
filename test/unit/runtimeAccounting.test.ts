import { reserveRequestAmount } from '../../src/core/providers/priceCard'
import { requestImageCount } from '../../src/core/backends/modelapi/modelPolicy'
import { UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { metaResolvedModel, type ModelResolver } from '../../src/core/backends/modelapi/modelPolicy'
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
  withRuntimeAccounting,
} from '../../src/runtime/runtimeAccountingEntry'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
} from './helpers/fakeModelApi'
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
import { createSchedulePaidScope } from '../../src/core/paid/paidConsent'
import { unattendedRun } from './helpers/schedules/unattended'
import { fakeRunContext } from './helpers/schedules/fixtures'
import { fakeSchedule } from './helpers/schedules/fixtures'

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
    `const { createRuntimeDailyBudget } = require('./accounting.cjs'); const { setTimeout } = require('node:timers/promises'); const budget = createRuntimeDailyBudget({ dataFolder: process.argv[2], now: () => Date.now(), sleep: setTimeout }); process.on('message', async (message) => { let claim; try { const signal = new AbortController().signal; claim = message.schedule === undefined ? await budget.reserve('1', signal) : await budget.reserveSchedule(message.schedule, '1', signal); claim.check(0); process.send({ admitted: true }); } catch { if (claim !== undefined) await claim.settle('0'); process.send({ admitted: false }); } process.disconnect(); }); process.send({ ready: true });`,
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
  it('preserves scheduled transport authority and reserves both caps without a second shared charge', async () => {
    const daily = dailyBudgetAt(folder())
    const api = fakeModelApi()
    const client = withRuntimeAccounting(fakeModelApiClient(api, new FakeLogOutputChannel()), daily)
    const base = paidSchedule(1, 5)
    if (base.paidConsent === undefined || client.models === undefined)
      throw new Error('missing fixture authority')
    const schedule = fakeSchedule({
      ...base,
      paidConsent: { ...base.paidConsent, accountId: FAKE_MODEL_API_ACCOUNT_ID },
    })
    const identity = {
      modelId: body.model,
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      priceTier: 'verified',
      payerKind: 'paidKey' as const,
      price: 'Verified fixture rates',
      sharedDailyBudgetUsd: Usd.from(5).toAmount(),
    }
    const reserve = vi.spyOn(daily, 'reserveSchedule')
    const interactive = vi.spyOn(daily, 'reserve')
    const policy = createSchedulePaidScope({
      backend: 'modelApi',
      schedule,
      identity,
      currentIdentity: () => identity,
      isCurrent: () => true,
      isOn: () => true,
      estimate: () => Usd.from('0.1').toAmount(),
      reserve: (...args) => daily.reserveSchedule(...args),
    })
    const { run } = unattendedRun({ context: fakeRunContext(schedule), paid: policy })
    const model = await client.models.resolve(body.model)
    if (model.client.withScheduleAuthority === undefined)
      throw new Error('scheduled transport authority lost')
    const bound = model.client.withScheduleAuthority(() => run, model.price)
    await Array.fromAsync(bound.streamResponse(body, new AbortController().signal))
    expect(api.responseBodies()).toHaveLength(1)
    expect(reserve).toHaveBeenCalledOnce()
    expect(interactive).not.toHaveBeenCalled()
    expect(policy.cost()).toMatchObject({ certainty: 'exact', retainedLiabilityUsd: '0' })
  })
  it.each(['schedule', 'shared'] as const)(
    'refuses scheduled HTTP past the %s cap and refunds nonsends exactly',
    async (cap) => {
      const root = folder()
      const sharedCap = cap === 'schedule' ? 2 : 1
      writeFileSync(
        path.join(root, 'settings.json'),
        JSON.stringify({ paidDailyBudgetUsd: sharedCap }),
      )
      const daily = dailyBudgetAt(root)
      const schedule = paidSchedule(1, sharedCap)
      const first = await daily.reserveSchedule(
        schedule,
        Usd.from('0.6').toAmount(),
        new AbortController().signal,
      )
      const api = fakeModelApi()
      const client = fakeModelApiClient(api, new FakeLogOutputChannel())
      const guard = Object.assign(() => undefined, {
        paidFeature: 'scheduledPrompts' as const,
        reservePaidRequest: () =>
          daily.reserveSchedule(
            cap === 'shared' ? { ...schedule, id: 'another-schedule' } : schedule,
            Usd.from('0.5').toAmount(),
            new AbortController().signal,
          ),
      })
      await expect(
        Array.fromAsync(
          client.streamResponse(body, new AbortController().signal, undefined, undefined, guard),
        ),
      ).rejects.toThrow()
      expect(api.requests).toHaveLength(0)
      await first.settle(Usd.from('0.2').toAmount())
      const next = await daily.reserveSchedule(
        schedule,
        Usd.from('0.8').toAmount(),
        new AbortController().signal,
      )
      await next.settle(Usd.from(0).toAmount())
      const remaining = await daily.reserve(
        Usd.from(sharedCap).subtract(Usd.from('0.2')).toAmount(),
        new AbortController().signal,
      )
      expect(remaining.reservedUsd).toBe(Usd.from(sharedCap).subtract(Usd.from('0.2')).toAmount())
    },
  )
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
  it('honours durable D78 Stop even after the local-day limit is raised', async () => {
    const root = folder()
    const now = new Date(2026, 9, 11, 12).getTime()
    const daily = createRuntimeDailyBudget({ dataFolder: root, now: () => now, sleep: delay })
    const directory = path.join(root, PAID_DAILY_BUDGET.directory, '2026-10-11')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      path.join(directory, PAID_DAILY_BUDGET.overrideFile),
      '{"limitUsd":0.5,"stopped":false}',
    )
    const claim = await daily.reserve(Usd.from('0.5').toAmount(), new AbortController().signal)
    mkdirSync(path.join(directory, PAID_DAILY_BUDGET.stopDirectory))
    expect(() => claim.check(Usd.from(0).toAmount())).toThrow(UI_TEXT.paidDailyStopped)
    writeFileSync(
      path.join(directory, PAID_DAILY_BUDGET.overrideFile),
      '{"limitUsd":5,"stopped":false}',
    )
    await expect(
      daily.reserve(Usd.from('0.1').toAmount(), new AbortController().signal),
    ).rejects.toThrow(UI_TEXT.paidDailyStopped)
  })
  it('refuses a corrupt local-day override before reservation', async () => {
    const now = new Date(2026, 9, 11, 12).getTime()
    const brokenRoot = folder()
    const brokenDirectory = path.join(brokenRoot, PAID_DAILY_BUDGET.directory, '2026-10-11')
    mkdirSync(brokenDirectory, { recursive: true })
    writeFileSync(
      path.join(brokenDirectory, PAID_DAILY_BUDGET.overrideFile),
      '{"limitUsd":"NaN","stopped":false}',
    )
    const broken = createRuntimeDailyBudget({
      dataFolder: brokenRoot,
      now: () => now,
      sleep: delay,
    })
    await expect(
      broken.reserve(Usd.from('0.1').toAmount(), new AbortController().signal),
    ).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
  })
  it.each(['daily', 'schedule', 'shared'] as const)(
    'serializes two processes racing the last %s dollar',
    async (lane) => {
      const root = folder()
      const sharedCap = lane === 'schedule' ? 2 : 1
      writeFileSync(
        path.join(root, 'settings.json'),
        JSON.stringify({ paidDailyBudgetUsd: sharedCap }),
      )
      const ownCap = lane === 'shared' ? 2 : 1
      const schedule = paidSchedule(ownCap, sharedCap)
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
      for (const [index, child] of children.entries())
        child.send({
          start: true,
          ...(lane !== 'daily' && {
            schedule: {
              ...schedule,
              id: lane === 'shared' ? `schedule-${String(index)}` : schedule.id,
            },
          }),
        })
      const admissions = await Promise.all(results)
      const admitted = admissions.filter(Boolean).length
      expect(admitted).toBeLessThanOrEqual(1)
      // A final synchronous fence may see the other writer's incomplete intent and refuse both.
      // Once both nonsends are refunded, exactly the last dollar remains available.
      const daily = dailyBudgetAt(root)
      if (admitted === 0) {
        const claim =
          lane === 'daily'
            ? await daily.reserve(Usd.from(1).toAmount(), new AbortController().signal)
            : await daily.reserveSchedule(
                schedule,
                Usd.from(1).toAmount(),
                new AbortController().signal,
              )
        expect(claim.reservedUsd).toBe('1')
      }
      await expect(
        lane === 'daily'
          ? daily.reserve(Usd.from(1).toAmount(), new AbortController().signal)
          : daily.reserveSchedule(schedule, Usd.from(1).toAmount(), new AbortController().signal),
      ).rejects.toThrow()
    },
  )
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
  it('names the run when a stale model reaches dispatch', async () => {
    // RVCM1062E P3: the headless run has no schedule, so its stale-model
    // refusal names the run instead of borrowing schedule guidance.
    const daily = dailyBudgetAt(folder())
    const api = fakeModelApi()
    api.script({ text: 'done' })
    // A client whose every resolution is already lapsed when dispatch runs.
    class StaleModelClient extends ModelApiClient {
      readonly models: ModelResolver = {
        resolve: (ref: string) =>
          Promise.resolve({ ...metaResolvedModel(ref, this), isCurrent: () => false }),
      }
    }
    const client = new StaleModelClient({
      ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
      fetch: api.fetch,
    })
    const wrapped = withRuntimeAccounting(client, daily)
    await expect(
      Array.fromAsync(wrapped.streamResponse(body, new AbortController().signal)),
    ).rejects.toThrow(UI_TEXT.requestStaleRun)
    expect(api.responseBodies()).toHaveLength(0)
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
})

function dailyBudgetAt(dataFolder: string) {
  return createRuntimeDailyBudget({ dataFolder, now: Date.now, sleep: delay })
}

function paidSchedule(ownCap: number, sharedCap: number) {
  return fakeSchedule({
    paidCapUsd: Usd.from(ownCap).toAmount(),
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(ownCap).toAmount() },
    paidConsent: {
      modelId: body.model,
      accountId: 'fixture-account',
      priceTier: 'verified',
      payerKind: 'paidKey',
      dailyCapUsd: Usd.from(ownCap).toAmount(),
      sharedDailyBudgetUsd: Usd.from(sharedCap).toAmount(),
      grantedAtMs: 0,
      extras: [],
      scope: 'schedule',
    },
  })
}

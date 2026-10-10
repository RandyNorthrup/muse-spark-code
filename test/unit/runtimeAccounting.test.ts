import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { metaResolvedModel } from '../../src/core/backends/modelapi/modelPolicy'
import { billingRoute } from '../../src/core/backends/modelapi/billingRoute'
import type { ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import { Usd } from '../../src/shared/usd'
import { fork } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  createRuntimeDailyBudget,
  withRuntimeAccounting,
} from '../../src/runtime/runtimeAccountingEntry'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
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

describe('standalone daily admission', () => {
  it('prices each attempt after client creation and keeps provider responses dollar-billed', async () => {
    const daily = dailyBudgetAt(folder())
    const api = fakeModelApi()
    const meta = fakeModelApiClient(api, new FakeLogOutputChannel())
    const registry = createProviderRegistry({
      models: () =>
        Promise.resolve([
          {
            ref: 'custom/model',
            origin: 'https://custom.test',
            contextTokens: 1000,
            evidence: { capabilities: { toolCalling: true }, maxOutputTokens: 100 },
            pricing: {
              kind: 'priced',
              card: { input: 0.000001, output: 0.000002, source: 'user' },
            },
          },
        ]),
      createClient: () => Promise.resolve(meta),
      isCurrent: () => true,
    })
    const client = withRuntimeAccounting(
      Object.assign(meta, {
        models: {
          resolve: (ref: string) =>
            ref.includes('/')
              ? registry.resolve(ref)
              : Promise.resolve(metaResolvedModel(ref, meta)),
        },
      }),
      daily,
    )
    // The same client exists before login. This attempt's route establishes plan billing.
    const plan: ResponseAttemptGuard = Object.assign(() => undefined, {
      billingRoute: billingRoute('museCodePlan', 'LLM|1|secret'),
    })
    api.script({ text: 'plan', usage: { input: 100, output: 10, cached: 0 } })
    await Array.fromAsync(
      client.streamResponse(body, new AbortController().signal, undefined, undefined, plan),
    )
    const full = await daily.reserve(Usd.from(5).toAmount(), new AbortController().signal)
    await full.settle(Usd.from(0).toAmount())
    // No Meta route follows a qualified provider model, even on a signed-in host.
    api.script({ text: 'provider', usage: { input: 100, output: 10, cached: 0 } })
    await Array.fromAsync(
      client.streamResponse({ ...body, model: 'custom/model' }, new AbortController().signal),
    )
    await expect(
      daily.reserve(Usd.from(5).toAmount(), new AbortController().signal),
    ).rejects.toThrow()
    api.script({ text: 'plan again', usage: { input: 100, output: 10, cached: 0 } })
    await Array.fromAsync(
      client.streamResponse(body, new AbortController().signal, undefined, undefined, plan),
    )
    expect(api.responseBodies()).toHaveLength(3)
  })
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
  it.each([false, true])(
    'settles a plan-billed turn at $0 in the paid daily journal (plan: %s)',
    async (plan) => {
      const daily = createRuntimeDailyBudget({
        dataFolder: folder(),
        now: () => Date.now(),
        sleep: delay,
      })
      const api = fakeModelApi()
      api.script({ text: 'done', usage: { input: 50_000, output: 5000, cached: 0 } })
      const client = withRuntimeAccounting(
        fakeModelApiClient(api, new FakeLogOutputChannel()),
        daily,
      )
      const guard: ResponseAttemptGuard = Object.assign(() => undefined, {
        billingRoute: billingRoute(plan ? 'museCodePlan' : 'payAsYouGo', 'LLM|1|secret'),
      })
      await Array.fromAsync(
        client.streamResponse(body, new AbortController().signal, undefined, undefined, guard),
      )
      expect(api.responseBodies()).toHaveLength(1)
      // A plan turn settles $0, so the full day remains reservable; the
      // pay-as-you-go control settles dollars and the same reserve refuses.
      if (plan) {
        const claim = await daily.reserve(Usd.from(4.95).toAmount(), new AbortController().signal)
        expect(claim.reservedUsd).toBe(Usd.from(4.95).toAmount())
      } else {
        await expect(
          daily.reserve(Usd.from(4.95).toAmount(), new AbortController().signal),
        ).rejects.toThrow()
      }
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
})

function dailyBudgetAt(dataFolder: string) {
  return createRuntimeDailyBudget({ dataFolder, now: Date.now, sleep: delay })
}

import { Usd } from '../../src/shared/usd'
import { autoReviewPrice } from '../../src/shared/paid'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { explainLegal, type LegalExplanationDeps } from '../../src/core/paid/legalExplanation'
import { scanLegal } from '../../src/core/legal/scan'
import { PaidFeatureGate, PaidUsage } from '../../src/core/paid/paidFeatures'
import { PaidUseConsent, type PaidUseAnswer } from '../../src/core/paid/paidConsent'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import {
  DEFAULT_MODEL_ID,
  LEGAL_EXPLANATION_MAX_OUTPUT_TOKENS,
  MODEL_API_MAX_RETRIES,
  PAID_DAILY_BUDGET,
  UI_TEXT,
  type PaidFeature,
} from '../../src/shared/constants'
import { snapshotFrom } from './legal/helpers'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { removeFolder } from './helpers/temporaryFolders'
import { window } from './mocks/vscode'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories) await removeFolder(directory)
  directories.length = 0
})
async function setup(answer: PaidUseAnswer = 'once') {
  const directory = await mkdtemp(path.join(tmpdir(), 'muse-legal-paid-'))
  directories.push(directory)
  const log = new FakeLogOutputChannel()
  const status = { isOn: true, now: new Date(2026, 9, 5, 12).getTime() }
  const accepted = new Set<PaidFeature>(['legalExplanation'])
  const gate = new PaidFeatureGate({
    isSettingOn: () => status.isOn,
    setSetting: () => Promise.resolve(),
    readAccepted: () => accepted,
    writeAccepted: () => Promise.resolve(),
    confirm: () => Promise.resolve(true),
    isWindowFocused: () => true,
    log,
  })
  let grants = new Set<PaidFeature>()
  const ask = vi.fn(() => Promise.resolve(answer))
  const consent = new PaidUseConsent({
    isOn: (feature) => gate.isOn(feature),
    canRemember: () => true,
    readGrants: () => grants,
    writeGrants: (value) => {
      grants = new Set(value)
      return Promise.resolve()
    },
    ask,
    log,
  })
  const daily = createPaidDailyBudget({
    directory,
    now: () => status.now,
    capUsd: () => Usd.from(0.5).toAmount(),
    sleep: () => Promise.resolve(),
    isModelApi: () => true,
  })
  const api = fakeModelApi()
  const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
  const keyDigest = vi.fn(() => client.currentKeyDigest())
  const claims: Awaited<ReturnType<typeof daily.reserve>>[] = []
  const reserve = vi.fn(async (...args: Parameters<typeof daily.reserve>) => {
    const claim = await daily.reserve(...args)
    claims.push(claim)
    return claim
  })
  const usage = new PaidUsage(log)
  const deps: LegalExplanationDeps = {
    gate,
    consent,
    reserve,
    capUsd: daily.capUsd,
    keyDigest,
    usage,
    stream: (body, signal, guard) =>
      client.streamResponse(body, signal, undefined, { retriesUsed: MODEL_API_MAX_RETRIES }, guard),
  }
  const report = scanLegal(
    snapshotFrom({
      'package.json': JSON.stringify({ license: 'MIT' }),
      'private/source.ts': 'export const secret = 1',
    }),
    { headerPolicy: 'required' },
  )
  return {
    claims,
    directory,
    status,
    gate,
    ask,
    daily,
    api,
    keyDigest,
    reserve,
    usage,
    deps,
    report,
  }
}
async function dailyTotal(directory: string) {
  return await createSessionBudgetJournal({
    directory,
    sleep: () => Promise.resolve(),
    initialBudget: () =>
      Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
  }).read('2026-10-5', PAID_DAILY_BUDGET.accountId)
}
describe('legal explanations through the shared D78 gate', () => {
  it('declines before credential reads, reservation, files or dispatch', async () => {
    const t = await setup('deny')
    await expect(explainLegal(t.report, t.deps, new AbortController().signal)).rejects.toThrow(
      UI_TEXT.legalExplainUnavailable,
    )
    expect(t.ask).toHaveBeenCalledOnce()
    expect(t.reserve).not.toHaveBeenCalled()
    expect(t.keyDigest).not.toHaveBeenCalled()
    expect(t.api.requests).toEqual([])
    expect(await readdir(t.directory)).toEqual([])
  })
  it('keeps the free scan independent of the paid setting and model', async () => {
    const t = await setup('deny')
    t.status.isOn = false
    expect(
      scanLegal(snapshotFrom({ 'src/free.ts': 'export const value = 1' }), {
        headerPolicy: 'required',
      }).findings.length,
    ).toBeGreaterThan(0)
    await expect(explainLegal(t.report, t.deps, new AbortController().signal)).rejects.toThrow()
    expect(t.ask).not.toHaveBeenCalled()
    expect(t.reserve).not.toHaveBeenCalled()
    expect(t.api.requests).toEqual([])
  })
  it('asks once, reserves before sending, settles usage and sends technical facts only', async () => {
    const t = await setup('always')
    t.api.script({
      text: 'Review the missing copyright notice.',
      usage: { input: 50, output: 10 },
    })
    expect(await explainLegal(t.report, t.deps, new AbortController().signal)).toContain(
      'copyright',
    )
    t.api.script({ text: 'Keep the uncertainty explicit.', usage: { input: 50, output: 10 } })
    await explainLegal(t.report, t.deps, new AbortController().signal)
    expect(t.ask).toHaveBeenCalledOnce()
    expect(t.reserve).toHaveBeenCalledTimes(2)
    expect(t.usage.current.legalExplanations).toBe(2)
    expect(t.usage.current.legalExplanationUnknownRequests).toBe(0)
    expect(Number(t.usage.current.legalExplanationCostUsd)).toBeGreaterThan(0)
    const total = await dailyTotal(t.directory)
    expect(total.spentUsd).toBe(t.usage.current.legalExplanationCostUsd)
    const body = t.api.requests.find((r) => r.path === '/responses')?.body
    expect(body).toMatchObject({
      tools: [],
      store: false,
      max_output_tokens: LEGAL_EXPLANATION_MAX_OUTPUT_TOKENS,
    })
    expect(JSON.stringify(body)).not.toContain('private/source.ts')
    expect(JSON.stringify(body)).not.toContain('export const')
    expect(JSON.stringify(body)).not.toContain('evidenceExcerpt')
  })
  it('retains uncertain liability when a dispatched response has no receipt', async () => {
    const t = await setup()
    t.api.script({ text: 'Uncertain receipt.', omitUsage: true })
    await expect(explainLegal(t.report, t.deps, new AbortController().signal)).rejects.toThrow()
    const claim = t.claims[0]
    const total = await dailyTotal(t.directory)
    expect(total.spentUsd).toBe(claim?.reservedUsd)
    expect(total.hasUnknownHistoricalFees).toBe(true)
    expect(t.usage.current.legalExplanationUnknownRequests).toBe(1)
  })
  it('shares the daily scope with another D78 caller and refuses over-budget dispatch', async () => {
    const t = await setup()
    const other = createPaidDailyBudget({
      directory: t.directory,
      now: () => t.status.now,
      capUsd: () => Usd.from(0.5).toAmount(),
      sleep: () => Promise.resolve(),
      isModelApi: () => true,
    })
    const body: CreateResponseBody = {
      model: DEFAULT_MODEL_ID,
      input: [],
      instructions: '',
      tools: [],
      tool_choice: 'auto',
      reasoning: { effort: 'off', summary: 'auto' },
      stream: true,
      store: false,
      include: [],
      max_output_tokens: 1,
      prompt_cache_key: 'shared-test',
      prompt_cache_retention: 'in_memory',
    }
    // A deliberately unaffordable shared reservation must be stopped before HTTP.
    vi.mocked(window.showWarningMessage).mockResolvedValue(undefined)
    await expect(other.reserve(body, 'legalExplanation', 10_000_000)).rejects.toThrow()
    await expect(explainLegal(t.report, t.deps, new AbortController().signal)).rejects.toThrow(
      UI_TEXT.paidDailyStopped,
    )
    expect(t.api.requests).toEqual([])
    expect(PAID_DAILY_BUDGET.directory).toBe('paid-daily')
  })
  it('rechecks feature and key at the final HTTP admission', async () => {
    const t = await setup()
    t.api.script({ text: 'Must not arrive.' })
    const reserve = t.deps.reserve
    const changed: LegalExplanationDeps = {
      ...t.deps,
      reserve: async (...args) => {
        const claim = await reserve(...args)
        t.status.isOn = false
        return claim
      },
    }
    await expect(explainLegal(t.report, changed, new AbortController().signal)).rejects.toThrow()
    expect(t.api.requests).toEqual([])
    const claim = t.claims[0]
    const total = await dailyTotal(t.directory)
    expect(total.spentUsd).toBe(Usd.from(0).toAmount())
    expect(Number(claim?.reservedUsd)).toBeGreaterThan(0)
  })
  it('refuses a rotated key before HTTP and refunds an unsent claim', async () => {
    const t = await setup()
    await expect(
      explainLegal(
        t.report,
        { ...t.deps, keyDigest: () => Promise.resolve('rotated') },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    expect(t.api.requests).toEqual([])
    const total = await dailyTotal(t.directory)
    expect(total.spentUsd).toBe(Usd.from(0).toAmount())
  })
  it('refuses untrusted finding identifiers and an oversized explanation payload', async () => {
    const t = await setup()
    const first = t.report.findings[0]
    if (first === undefined) throw new Error('Fixture needs findings')
    for (const findings of [
      [{ ...first, id: 'private/source.ts' }],
      Array.from({ length: 500 }, (_, index) => ({
        ...first,
        id: `header/1/${String(index + 1)}`,
      })),
    ]) {
      await expect(
        explainLegal({ ...t.report, findings }, t.deps, new AbortController().signal),
      ).rejects.toThrow()
    }
    expect(t.reserve).not.toHaveBeenCalled()
    expect(t.api.requests).toEqual([])
  })
  it('cancels a pending consent before reading the key or reserving money', async () => {
    const t = await setup()
    const stop = new AbortController()
    t.ask.mockImplementation(() => {
      stop.abort()
      return Promise.resolve('once')
    })
    await expect(explainLegal(t.report, t.deps, stop.signal)).rejects.toThrow()
    expect(t.keyDigest).not.toHaveBeenCalled()
    expect(t.reserve).not.toHaveBeenCalled()
    expect(t.api.requests).toEqual([])
  })
  it('uses the shared popup with exact price and daily budget', async () => {
    const t = await setup()
    const store = {
      keys: () => [],
      get: () => ['legalExplanation'],
      update: () => Promise.resolve(),
    }
    const paid = createPaidFeatures({
      globalState: store,
      workspaceState: store,
      isSettingOn: () => true,
      isKeyStored: () => true,
      canRememberPaidUse: () => false,
      dailyBudgetUsd: () => Usd.from(5).toAmount(),
      log: new FakeLogOutputChannel(),
    })
    vi.mocked(window.showWarningMessage).mockResolvedValue(undefined)
    expect(
      await paid.consent.allows({ feature: 'legalExplanation', modelId: DEFAULT_MODEL_ID }),
    ).toBe(false)
    const question = vi.mocked(window.showWarningMessage).mock.calls.at(-1)
    expect(JSON.stringify(question)).toContain('Shared daily budget')
    expect(JSON.stringify(question)).toContain('$5.00')
    expect(JSON.stringify(question)).toContain('Model API key')
    expect(question?.[1]).toMatchObject({
      detail: expect.stringContaining(autoReviewPrice(DEFAULT_MODEL_ID) ?? ''),
    })
    expect(t.api.requests).toEqual([])
  })
})

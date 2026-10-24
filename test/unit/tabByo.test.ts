// M95c part 7: Tab on a bring-your-own model. A `provider/model` Tab model
// resolves through the person's configured providers with the agent
// turn's tool-calling gate opted out (a completion sends no tools), and
// the real Tab engine sends its chat-shaped hole through that provider's
// own client and codec. The request shape is the one the provider
// documents for chat completions: LM Studio's `POST /v1/chat/completions`
// with `model`, `messages` (`system`, `user`), `max_tokens` and `stream`
// (lmstudio.ai/docs/developer/openai-compat/chat-completions, read
// 2026-10-23). The request rides the real configured request builder, the
// real pinned transport and Node's HTTP client to a real local socket that
// records it and closes unanswered (helpers/providerWire.ts). The price is
// Codestral's own card from the vendored catalogue (resolved, never sent:
// Mistral's preset is pinned to its public origin).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTabEngine, type TabEngineRequest } from '../../src/core/tab/tabEngine'
import { tabUserText } from '../../src/core/tab/tabRequest'
import { paidUseQuestion } from '../../src/core/paid/paidUseQuestion'
import { createTabByoResolutions, isByoTabModel } from '../../src/host/tab/tabByo'
import { createTabLedger } from '../../src/host/tab/tabLedger'
import { createTabSpendGate } from '../../src/host/tab/tabSpendGate'
import { TAB_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'
import { collectingLogger } from './helpers/collectingLogger'
import { suiteSocket, wireServices, type ProviderEntryInput } from './helpers/providerWire'

const opened = suiteSocket()

const mistral: ProviderEntryInput = {
  id: 'mistral',
  preset: 'mistral',
  address: 'https://api.mistral.ai',
  auth: 'apiKey',
  models: ['codestral-latest'],
}
// A local server's model whose tool calling nothing confirmed: an agent
// turn refuses it, a completion (which sends no tools) may use it. It
// listens where the recording socket does.
function lmstudioAt(origin: string): ProviderEntryInput {
  return {
    id: 'lmstudio',
    preset: 'lmstudio',
    address: origin,
    auth: 'none',
    models: ['qwen3-coder'],
    modelLimits: { 'qwen3-coder': { contextTokens: 32_768, outputTokens: 2048 } },
  }
}
// A key-billed custom server with no card: nothing can be reserved for it.
const unpriced: ProviderEntryInput = {
  id: 'gateway',
  preset: 'custom',
  address: 'https://8.8.4.4/v1',
  auth: 'apiKey',
  format: 'chat',
  models: ['coder'],
  modelLimits: { coder: { contextTokens: 32_768, outputTokens: 2048 } },
}
async function servicesFor() {
  const socket = await opened
  return wireServices([mistral, lmstudioAt(socket.origin), unpriced], {})
}

function resolverOf(services: Awaited<ReturnType<typeof servicesFor>>) {
  const models = services.client.models
  if (models === undefined) throw new Error('configured models missing')
  return models
}

function triggerFor(model: string, stream: TabEngineRequest['stream']): TabEngineRequest {
  return {
    model,
    absolutePath: path.join(tmpdir(), 'src', 'sum.ts'),
    relativePath: 'src/sum.ts',
    languageId: 'typescript',
    prefix: 'export function sum(a: number, b: number) {\n  return ',
    suffix: '\n}\n',
    snippets: '',
    mode: 'fast',
    maxOutputTokens: 256,
    isInvoke: true,
    cursorLineBefore: '  return ',
    lineAbove: 'export function sum(a: number, b: number) {',
    linesBelow: ['}'],
    isCancelled: () => false,
    stream,
  }
}

describe('Tab on a bring-your-own model', () => {
  it('names a provider/model reference, never a Meta tier', () => {
    expect(isByoTabModel('mistral/codestral-latest')).toBe(true)
    expect(isByoTabModel('muse-spark-1.3')).toBe(false)
  })

  it('sends the chat-shaped hole through the provider’s own client and codec', async () => {
    const socket = await opened
    const services = await servicesFor()
    await services.registry.list?.()
    const resolver = resolverOf(services)
    // An agent turn refuses a model whose tool calling nothing confirmed;
    // Tab, which sends no tools, opts out of that gate only for itself.
    await expect(resolver.resolve('lmstudio/qwen3-coder')).rejects.toThrow(
      fill(UI_TEXT.providerModelNoToolCalling, { model: 'lmstudio/qwen3-coder' }),
    )
    const byo = createTabByoResolutions(
      async (ref) => await resolver.resolve(ref, { requireTools: false }),
    )
    const request = await byo.resolve('lmstudio/qwen3-coder')
    if (request === undefined) throw new Error('a local model is never unpriced')
    expect(request.quote).toEqual({ provider: 'lmstudio', kind: 'local' })
    expect(request.maxOutputTokens).toBe(2048)
    expect(byo.current('lmstudio/qwen3-coder')?.fingerprint).toBe(request.fingerprint)
    const sent: string[] = []
    const engine = createTabEngine({
      stream: () => {
        throw new Error('the Meta key client must not send a bring-your-own request')
      },
      onSent: (model) => {
        sent.push(model)
      },
      onUsage: () => undefined,
    })
    const trigger = triggerFor('lmstudio/qwen3-coder', request.stream)
    const before = socket.requests.length
    // The socket closes without answering, so the request ends unanswered.
    await expect(engine.complete(trigger)).rejects.toThrow()
    expect(sent).toEqual(['lmstudio/qwen3-coder'])
    expect(socket.requests.length).toBe(before + 1)
    const wire = socket.requests.at(-1)
    expect(wire?.method).toBe('POST')
    expect(wire?.path).toBe('/v1/chat/completions')
    // A keyless local server: no credential rides.
    expect(wire?.headers).not.toHaveProperty('authorization')
    expect(wire?.body).toMatchObject({
      model: 'qwen3-coder',
      stream: true,
      max_tokens: 256,
      messages: [
        { role: 'system', content: TAB_MODEL_TEXT.tabSystem },
        {
          role: 'user',
          content: tabUserText({
            path: trigger.relativePath,
            languageId: trigger.languageId,
            prefix: trigger.prefix,
            suffix: trigger.suffix,
            snippets: trigger.snippets,
          }),
        },
      ],
    })
    // A completion declares no tools.
    expect(wire?.body).not.toHaveProperty('tools')
  })

  it('resolves an unpriced model to nothing, so no request may go', async () => {
    const socket = await opened
    const before = socket.requests.length
    const services = await servicesFor()
    await services.registry.list?.()
    const resolver = resolverOf(services)
    const byo = createTabByoResolutions(
      async (ref) => await resolver.resolve(ref, { requireTools: false }),
    )
    expect(await byo.resolve('gateway/coder')).toBeUndefined()
    expect(byo.current('gateway/coder')).toBeUndefined()
    expect(socket.requests.length).toBe(before)
  })

  it('reserves and settles the daily ledger at the provider’s card', async () => {
    const services = await servicesFor()
    await services.registry.list?.()
    const resolver = resolverOf(services)
    const request = await createTabByoResolutions(
      async (ref) => await resolver.resolve(ref, { requireTools: false }),
    ).resolve('mistral/codestral-latest')
    if (request === undefined) throw new Error('Codestral carries a price card')
    // Codestral's own card from the catalogue (per token), never Meta's tiers.
    expect(request.quote).toEqual({
      provider: 'mistral',
      kind: 'priced',
      rates: { input: 0.3 / 1e6, cached: 0.03 / 1e6, output: 0.9 / 1e6, request: 0 },
    })
    expect(request.maxOutputTokens).toBe(4096)
    const log = collectingLogger([])
    const ledger = createTabLedger({
      directory: mkdtempSync(path.join(tmpdir(), 'tab-byo-ledger-')),
      windowId: 'window1',
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log,
    })
    const gate = createTabSpendGate({
      ledger,
      budgetUsd: () => Usd.from(1).toAmount(),
      now: () => Date.now(),
      onTotalChanged: () => undefined,
      log,
    })
    const reservation = await gate.reserve({
      model: 'mistral/codestral-latest',
      inputBytes: 1000,
      maxOutputTokens: 256,
      price: request.price,
    })
    if (reservation === undefined) throw new Error('the reservation fits the budget')
    // 1,000 input tokens at $0.30/M plus 256 output at $0.90/M: the card's
    // own worst case, never Meta's tier for an unknown id.
    expect(reservation.worstCaseUsd).toBe(
      request.price.reserve({ inputTokens: 1000, outputTokens: 256, cachedTokens: 0 }),
    )
    expect(Number(reservation.worstCaseUsd)).toBeCloseTo(0.0005304, 12)
    gate.settle(reservation, { inputTokens: 900, cachedTokens: 500, outputTokens: 10 })
    // 400 uncached at $0.30/M, 500 cached at $0.03/M, 10 output at $0.90/M.
    await expect
      .poll(async () => {
        const total = await ledger.todayTotal()
        return total.ok ? Number(total.totalUsd) : NaN
      })
      .toBeCloseTo(0.000144, 12)
  })

  it('asks D48’s question with the provider’s card and no Meta training note', async () => {
    const question = await paidUseQuestion({
      feature: 'tab',
      modelId: 'mistral/codestral-latest',
      budgetUsd: Usd.from(0).toAmount(),
      byo: {
        provider: 'mistral',
        kind: 'priced',
        rates: { input: 0.3 / 1e6, cached: 0.03 / 1e6, output: 0.9 / 1e6, request: 0 },
      },
    })
    expect(question.title).toBe(UI_TEXT.paidUseTabTitle)
    expect(question.detail).toContain('mistral/codestral-latest')
    expect(question.detail).toContain('$0.300')
    expect(question.detail).toContain('$0.900')
    expect(question.detail).not.toContain(UI_TEXT.tabTrainingContributor)
    const local = await paidUseQuestion({
      feature: 'tab',
      modelId: 'lmstudio/qwen3-coder',
      budgetUsd: Usd.from(1).toAmount(),
      byo: { provider: 'lmstudio', kind: 'local' },
    })
    expect(local.detail).toContain(UI_TEXT.tabByo.billedLocal)
  })
})

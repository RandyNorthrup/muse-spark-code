import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const processCalls = vi.hoisted(() => ({
  spawn: vi.fn(),
  fork: vi.fn(),
  execFile: vi.fn(),
}))
vi.mock('node:child_process', () => processCalls)
import { type JudgeDailyLedger, type JudgeLedgerClaim } from '../../src/core/judge/admission'
import {
  resolveModelCapabilities,
  type CapabilityOverrides,
  type ModelCapabilityRecord,
} from '../../src/core/providers/capabilityRecord'
import {
  reserveRequestUsd,
  settleUsageUsd,
  type ModelPricing,
  type PriceCard,
} from '../../src/core/providers/priceCard'
import {
  byoPriceFingerprint,
  createByoJudge,
  type ByoCompletionRequest,
  type ByoConsent,
  type ByoJudge,
} from '../../src/core/judge/providers/run'
import {
  judgeCapabilitySchema,
  judgeRequestBytes,
  type JudgeCapability,
  type JudgeOutcome,
  type JudgeRequest,
} from '../../src/core/judge/schema'
import {
  JUDGE_MAX_BODY_BYTES,
  JUDGE_MODEL_TEXT,
  JUDGE_TOP1_MIN_PROB,
} from '../../src/shared/constants'
import capture from './fixtures/localJudgeCapture.json'

const MODEL = 'qwen3:4b-instruct-2507-q4_K_M'
const ORIGIN = 'http://127.0.0.1:11434'
const PROVIDER = 'ollama'
const QUESTION_ID = 'qid-SHOULD-NOT-LEAK'
const CARD: PriceCard = { input: 2, output: 4, source: 'user' }
const PRICED: ModelPricing = { kind: 'priced', card: CARD }
const CAPTURE_SOURCE = { kind: 'capture' as const, ref: 'localJudgeCapture.json' }

interface Settlement {
  claimId: string
  reservedUsd: number
  settled?: number
}

interface World {
  model: string
  chatModel: string
  chatProvider: string
  chatEndpoint: string
  providerId: string
  endpoint: string
  format: 'responses' | 'chat' | 'anthropic' | 'gemini' | 'ollama'
  auth: 'apiKey' | 'none' | 'subscription'
  isLocal: boolean
  pricing: ModelPricing
  confidential: boolean
  policy: 'allow' | 'refuse'
  judgeLogprobs: JudgeCapability['logprobs']
  recordFields: CapabilityOverrides
  expiresAtMs: number
  consentState: ByoConsent['state']
  epoch: string
  consentPrice?: string
  now: number
  captureId: string
  modelVersion: string
  contextWindowTokens: number
}

interface Books {
  ledger: JudgeDailyLedger
  settlements: Settlement[]
}

interface Harness {
  world: World
  judge: ByoJudge
  bodies: ByoCompletionRequest[]
  measured: string[]
  complete: ReturnType<typeof vi.fn>
  startAgent: ReturnType<typeof vi.fn>
  digest: ReturnType<typeof vi.fn>
  books: Books
}

function memoryLedger(balance: number): Books {
  const settlements: Settlement[] = []
  let remaining = balance
  const ledger: JudgeDailyLedger = {
    remainingUsd: () => Promise.resolve(remaining),
    reserve(usd: number): Promise<JudgeLedgerClaim> {
      remaining -= usd
      const row: Settlement = {
        claimId: `claim-${String(settlements.length + 1)}`,
        reservedUsd: usd,
      }
      settlements.push(row)
      const claim: JudgeLedgerClaim = {
        claimId: row.claimId,
        reservedUsd: usd,
        check(): void {
          if (row.claimId.length === 0) {
            throw new Error('judge ledger claim is empty')
          }
        },
        settle: (actual: number) => {
          row.settled = actual
          return Promise.resolve()
        },
      }
      return Promise.resolve(claim)
    },
  }
  return { ledger, settlements }
}

function defaultWorld(): World {
  return {
    model: MODEL,
    chatModel: MODEL,
    chatProvider: PROVIDER,
    chatEndpoint: ORIGIN,
    providerId: PROVIDER,
    endpoint: ORIGIN,
    format: 'ollama',
    auth: 'apiKey',
    isLocal: false,
    pricing: PRICED,
    confidential: false,
    policy: 'allow',
    judgeLogprobs: { kind: 'topk', topK: 5 },
    recordFields: {
      logprobs: {
        state: 'yes',
        value: { kind: 'topk', maxTopK: 5, dialect: 'ollama-chat' },
        source: CAPTURE_SOURCE,
      },
      limits: { contextTokens: 8192 },
    },
    expiresAtMs: 2_000_000_000_000,
    consentState: 'granted',
    epoch: 'epoch-1',
    now: 1_000_000,
    captureId: 'local-judge-chat',
    modelVersion: 'captured',
    contextWindowTokens: 8192,
  }
}

function recordOf(world: World): ModelCapabilityRecord {
  return resolveModelCapabilities(
    { provider: world.providerId, nativeModel: world.model, format: world.format },
    [{ source: CAPTURE_SOURCE, fields: world.recordFields }],
  )
}

function capabilityOf(world: World, source: 'same' | 'separate'): JudgeCapability {
  return judgeCapabilitySchema.parse({
    source,
    providerId: world.providerId,
    model: world.model,
    modelVersion: world.modelVersion,
    endpoint: world.endpoint,
    captureId: world.captureId,
    logprobs: world.judgeLogprobs,
    stated: false,
    systemone: false,
    reasoningForced: false,
    cache: false,
    contextWindowTokens: world.contextWindowTokens,
    minOutputTokens: 1,
  })
}

function defaultRespond(request: ByoCompletionRequest): unknown {
  return { ...capture.chat, model: request.model }
}

function harness(
  options: {
    world?: Partial<World>
    source?: 'same' | 'separate'
    respond?: (request: ByoCompletionRequest, nth: number) => unknown
    digestImpl?: () => Promise<string>
    ledger?: 'memory' | 'none'
    balance?: number
    afterWait?: () => Promise<void>
    measure?: (text: string) => number
  } = {},
): Harness {
  const world: World = { ...defaultWorld(), ...options.world }
  const source = options.source ?? 'same'
  const consented = world.consentPrice ?? byoPriceFingerprint(world.pricing)
  const bodies: ByoCompletionRequest[] = []
  const measured: string[] = []
  let nth = 0
  const complete = vi.fn((request: ByoCompletionRequest) => {
    bodies.push(request)
    nth += 1
    return Promise.resolve((options.respond ?? defaultRespond)(request, nth))
  })
  const startAgent = vi.fn()
  const transport = { startAgent, complete }
  const digest = vi.fn(options.digestImpl ?? (() => Promise.resolve('digest-ready')))
  const books = memoryLedger(options.balance ?? 1000)
  const judge = createByoJudge({
    client: {
      get provider() {
        return {
          id: world.providerId,
          label: world.providerId,
          origin: world.endpoint,
          format: world.format,
          auth: world.auth,
          isLocal: world.isLocal,
        }
      },
      currentKeyDigest: () => digest(),
    },
    record: () => recordOf(world),
    capability: () => capabilityOf(world, source),
    source,
    chat: () => ({
      providerId: world.chatProvider,
      modelId: world.chatModel,
      endpoint: world.chatEndpoint,
    }),
    pricing: () => world.pricing,
    consent: () => ({
      state: world.consentState,
      epoch: world.epoch,
      expiresAtMs: world.expiresAtMs,
      priceFingerprint: world.consentPrice ?? consented,
    }),
    confidential: () => world.confidential,
    confidentialPolicy: () => world.policy,
    measureTokens: (text: string) => {
      measured.push(text)
      return (options.measure ?? (() => 4))(text)
    },
    transport,
    ...(options.ledger !== 'none' && { ledger: books.ledger }),
    ...(options.afterWait !== undefined && { afterWait: options.afterWait }),
    now: () => world.now,
  })
  return { world, judge, bodies, measured, complete, startAgent, digest, books }
}

function noulRequest(
  state = 'STATE-MARKER',
  instructions = 'QUESTION-MARKER',
  id = QUESTION_ID,
): JudgeRequest {
  return { state, questions: { [id]: { type: 'noul', instructions } } }
}

function answered(outcome: JudgeOutcome) {
  expect(outcome.outcome).toBe('answered')
  if (outcome.outcome !== 'answered') {
    throw new Error('expected an answer')
  }
  return outcome.result
}

function top1Fields(formats?: readonly ['json_object']): CapabilityOverrides {
  return {
    logprobs: {
      state: 'yes',
      value: { kind: 'top1', dialect: 'ollama-chat' },
      source: CAPTURE_SOURCE,
    },
    limits: { contextTokens: 8192 },
    ...(formats !== undefined && {
      output: {
        formats: { state: 'yes', value: [...formats], source: CAPTURE_SOURCE },
      },
    }),
  }
}

function underFloor(request: ByoCompletionRequest): unknown {
  return {
    ...capture.chat,
    model: request.model,
    logprobs: [
      {
        token: 'no',
        logprob: Math.log(0.6),
        top_logprobs: [{ token: 'no', logprob: Math.log(0.6) }],
      },
    ],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env['M98P2E_SENTINEL_KEY']
})

describe('createByoJudge', () => {
  it('fingerprints a priced card and treats an invalid card as unpriced', () => {
    expect(byoPriceFingerprint(PRICED)).toBe('priced:user:2:4:::')
    expect(byoPriceFingerprint({ kind: 'local' })).toBe('local')
    expect(byoPriceFingerprint({ kind: 'plan' })).toBe('plan')
    expect(byoPriceFingerprint({ kind: 'unpriced' })).toBe('unpriced')
    expect(
      byoPriceFingerprint({ kind: 'priced', card: { input: -1, output: 1, source: 'list' } }),
    ).toBe('unpriced')
  })

  it('reserves the complete request and settles the captured usage', async () => {
    expect(reserveRequestUsd(CARD, { inputTokens: 8, outputTokens: 1 })).toBe(20)
    expect(settleUsageUsd(CARD, { inputTokens: 30, outputTokens: 1 })).toBe(64)
    const rig = harness()
    const result = answered(await rig.judge.run(noulRequest()))
    expect(rig.books.settlements[0]).toMatchObject({ reservedUsd: 20, settled: 64 })
    expect(result.muse[QUESTION_ID]).toMatchObject({
      source: 'same',
      technique: 'logprob',
      model: MODEL,
      label: 'uncalibrated',
      partial: false,
      reservedCostUsd: 20,
      settledCostUsd: 64,
    })
    expect(result.usage).toEqual({ input_tokens: 30, output_tokens: 1 })
    expect(rig.bodies[0]?.messages[0]?.content).toBe(JUDGE_MODEL_TEXT.judgeSystemInstruction)
    expect(rig.bodies[0]?.messages[1]?.content).toContain('STATE-MARKER')
    expect(rig.bodies[0]?.messages[1]?.content).toContain('QUESTION-MARKER')
    expect(JSON.stringify(rig.bodies[0])).not.toContain(QUESTION_ID)
    expect(
      rig.measured.filter((text) => text.includes('STATE-MARKER')).length,
    ).toBeGreaterThanOrEqual(2)
    expect(rig.startAgent).not.toHaveBeenCalled()
    expect(rig.bodies[0]?.ollama).toMatchObject({
      model: MODEL,
      stream: false,
      think: false,
      logprobs: true,
      top_logprobs: 5,
      options: { num_predict: 1, temperature: 0 },
    })
  })

  it('does not reserve or send again for the same admitted request', async () => {
    const rig = harness()
    await rig.judge.run(noulRequest())
    await rig.judge.run(noulRequest())
    expect(rig.complete).toHaveBeenCalledTimes(1)
    expect(rig.books.settlements).toHaveLength(1)
  })

  it('does not return a cached answer after the chat model changes', async () => {
    const rig = harness()
    expect(answered(await rig.judge.run(noulRequest())).model).toBe(MODEL)
    expect(rig.complete).toHaveBeenCalledTimes(1)
    rig.world.chatModel = 'other-model'
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(rig.complete).toHaveBeenCalledTimes(1)
    rig.world.model = 'other-model'
    rig.world.chatModel = 'other-model'
    const third = answered(await rig.judge.run(noulRequest()))
    expect(third.model).toBe('other-model')
    expect(third.muse[QUESTION_ID]?.model).toBe('other-model')
    expect(rig.complete).toHaveBeenCalledTimes(2)
  })

  it('does not dispatch a same-model judge that is not the chat model', async () => {
    for (const world of [
      { chatModel: 'other-model' },
      { chatProvider: 'other' },
      { chatEndpoint: 'https://other.example' },
    ]) {
      const rig = harness({ world })
      await expect(rig.judge.run(noulRequest())).resolves.toEqual({
        outcome: 'no-answer',
        reason: 'capability-unavailable',
      })
      expect(rig.complete).not.toHaveBeenCalled()
    }
  })

  it('labels a separately selected model as separate', async () => {
    const coinciding = answered(await harness({ source: 'separate' }).judge.run(noulRequest()))
    expect(coinciding.muse[QUESTION_ID]?.source).toBe('separate')
    const different = answered(
      await harness({
        source: 'separate',
        world: {
          chatModel: 'chat-model',
          chatProvider: 'other',
          chatEndpoint: 'https://chat.example',
        },
      }).judge.run(noulRequest()),
    )
    expect(different.model).toBe(MODEL)
    expect(different.muse[QUESTION_ID]?.source).toBe('separate')
    expect(different.muse[QUESTION_ID]?.model).toBe(MODEL)
  })

  it('does not dispatch when the price is unpriced', async () => {
    for (const pricing of [
      { kind: 'unpriced' } as const,
      { kind: 'priced' as const, card: { input: -1, output: 4, source: 'user' as const } },
    ]) {
      const rig = harness({ world: { pricing } })
      await expect(rig.judge.run(noulRequest())).resolves.toEqual({
        outcome: 'no-answer',
        reason: 'unpriced',
      })
      expect(rig.complete).not.toHaveBeenCalled()
      expect(rig.books.settlements).toHaveLength(0)
    }
  })

  it('does not dispatch when the key is unavailable', async () => {
    const thrown = harness({
      digestImpl: () => Promise.reject(new Error('locked')),
    })
    await expect(thrown.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
    const empty = harness({ digestImpl: () => Promise.resolve('') })
    await expect(empty.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
    expect(thrown.complete).not.toHaveBeenCalled()
    expect(empty.complete).not.toHaveBeenCalled()
  })

  it('does not read a key when the provider has no credential', async () => {
    const rig = harness({
      world: { auth: 'none', pricing: { kind: 'local' }, isLocal: true },
      digestImpl: () => Promise.reject(new Error('digest was read')),
    })
    const outcome = await rig.judge.run(noulRequest())
    expect(outcome.outcome).toBe('answered')
    expect(rig.digest).not.toHaveBeenCalled()
    expect(rig.books.settlements).toHaveLength(0)
  })

  it('does not ask consent or the ledger for a local model', async () => {
    const rig = harness({
      world: {
        pricing: { kind: 'local' },
        auth: 'none',
        isLocal: true,
        expiresAtMs: 1,
        now: 1000,
        consentState: 'needed',
      },
    })
    const outcome = await rig.judge.run(noulRequest())
    expect(outcome.outcome).toBe('answered')
    expect(rig.books.settlements).toHaveLength(0)
  })

  it('does not pass a stored key to a subprocess or the request body', async () => {
    const sentinel = 'm98p2e-sentinel-not-a-credential'
    const digestText = 'digest-m98p2e-sentinel'
    process.env['M98P2E_SENTINEL_KEY'] = sentinel
    const rig = harness({ digestImpl: () => Promise.resolve(digestText) })
    const outcome = await rig.judge.run(noulRequest())
    expect(outcome.outcome).toBe('answered')
    expect(processCalls.spawn).not.toHaveBeenCalled()
    expect(processCalls.fork).not.toHaveBeenCalled()
    expect(processCalls.execFile).not.toHaveBeenCalled()
    const wire = JSON.stringify(rig.bodies)
    expect(wire).not.toContain(sentinel)
    expect(wire).not.toContain(digestText)
    expect(rig.digest).toHaveBeenCalled()
  })

  it('does not import a process spawner or a second backend', () => {
    const directory = path.join(process.cwd(), 'src/core/judge/providers')
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => readFileSync(path.join(directory, name), 'utf8'))
      .join('\n')
    expect(source).not.toMatch(
      /child_process|ModelApiHost|createRuntimeBackend|\bspawn\(|\bfork\(|\bexecFile\(/,
    )
  })

  it('does not dispatch against an expired consent binding', async () => {
    const rig = harness({ world: { expiresAtMs: 500, now: 1000 } })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'consent-needed',
    })
    expect(rig.complete).not.toHaveBeenCalled()
    expect(rig.books.settlements).toHaveLength(0)
  })

  it('refunds a reservation when consent expires during the wait', async () => {
    const holder: { rig?: Harness } = {}
    const rig = harness({
      world: { expiresAtMs: 5000, now: 1000 },
      afterWait: () => {
        const current = holder.rig
        if (current === undefined) {
          throw new Error('rig')
        }
        current.world.expiresAtMs = 1000
        return Promise.resolve()
      },
    })
    holder.rig = rig
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'consent-needed',
    })
    expect(rig.complete).not.toHaveBeenCalled()
    expect(rig.books.settlements).toEqual([
      expect.objectContaining({ reservedUsd: 20, settled: 0 }),
    ])
  })

  it('asks again when the price changes during the wait', async () => {
    const holder: { rig?: Harness } = {}
    const rig = harness({
      afterWait: () => {
        const current = holder.rig
        if (current === undefined) {
          throw new Error('rig')
        }
        current.world.pricing = { kind: 'priced', card: { input: 2, output: 9, source: 'user' } }
        return Promise.resolve()
      },
    })
    holder.rig = rig
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'consent-needed',
    })
    expect(rig.complete).not.toHaveBeenCalled()
    expect(rig.books.settlements[0]?.settled).toBe(0)
  })

  it('does not dispatch a priced call on a free consent binding', async () => {
    const rig = harness({ world: { consentPrice: 'local' } })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'consent-needed',
    })
    expect(rig.complete).not.toHaveBeenCalled()
    expect(rig.books.settlements).toHaveLength(0)
  })

  it('does not dispatch when consent was declined', async () => {
    const rig = harness({ world: { consentState: 'declined' } })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'consent-declined',
    })
    expect(rig.complete).not.toHaveBeenCalled()
  })

  it('does not dispatch a priced call without the shared ledger', async () => {
    const rig = harness({ ledger: 'none' })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    expect(rig.complete).not.toHaveBeenCalled()
  })

  it('does not dispatch when the reservation exceeds the remaining budget', async () => {
    const rig = harness({ balance: 1 })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    expect(rig.complete).not.toHaveBeenCalled()
  })

  it('refuses a confidential separate model', async () => {
    const rig = harness({
      source: 'separate',
      world: { confidential: true, policy: 'allow' },
    })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'confidential-refused',
    })
    expect(rig.complete).not.toHaveBeenCalled()
  })

  it('follows the chat model confidential rule for the same model', async () => {
    const refused = harness({ world: { confidential: true, policy: 'refuse' } })
    await expect(refused.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'confidential-refused',
    })
    expect(refused.complete).not.toHaveBeenCalled()
    const allowed = harness({ world: { confidential: true, policy: 'allow' } })
    const allowedOutcome = await allowed.judge.run(noulRequest())
    expect(allowedOutcome.outcome).toBe('answered')
  })

  it('does not dispatch an uncaptured capability', async () => {
    const rig = harness({
      world: {
        judgeLogprobs: { kind: 'unknown' },
        recordFields: { limits: { contextTokens: 8192 } },
      },
    })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(rig.complete).not.toHaveBeenCalled()
  })

  it('states a dropped field only through a captured format', async () => {
    const rig = harness({
      world: {
        judgeLogprobs: { kind: 'dropped' },
        recordFields: {
          logprobs: { state: 'no', source: CAPTURE_SOURCE },
          output: {
            formats: { state: 'yes', value: ['json_object'], source: CAPTURE_SOURCE },
          },
          limits: { contextTokens: 8192 },
        },
      },
      respond: (request) => ({
        model: request.model,
        done: true,
        message: { role: 'assistant', content: '{"answer":"no","confidence":90}' },
        prompt_eval_count: 30,
        eval_count: 1,
      }),
    })
    const result = answered(await rig.judge.run(noulRequest()))
    expect(result.muse[QUESTION_ID]?.technique).toBe('stated')
    expect(rig.bodies[0]?.technique).toBe('stated')
    expect(rig.bodies[0]?.ollama).not.toHaveProperty('logprobs')
  })

  it('sends the captured ollama logprobs switch even when the dialect says responses', async () => {
    const rig = harness({
      world: {
        recordFields: {
          logprobs: {
            state: 'yes',
            value: {
              kind: 'topk',
              maxTopK: 5,
              dialect: 'responses',
              requiresEffortNone: true,
            },
            source: CAPTURE_SOURCE,
          },
          limits: { contextTokens: 8192 },
        },
      },
    })
    await rig.judge.run(noulRequest())
    expect(rig.bodies[0]?.format).toBe('ollama')
    expect(rig.bodies[0]?.requiresEffortNone).toBe(true)
    expect(rig.bodies[0]?.ollama).toMatchObject({
      logprobs: true,
      top_logprobs: 5,
      think: false,
    })
    const wire = JSON.stringify(rig.bodies[0])
    expect(wire).not.toContain('reasoning_effort')
    expect(wire).not.toContain('response_format')
  })

  it('does not invent vendor keys for an uncaptured non-ollama body', async () => {
    const rig = harness({
      world: { format: 'chat' },
      respond: () => ({
        text: 'no',
        usage: { input_tokens: 8, output_tokens: 1 },
        alternatives: [
          { token: 'no', logprob: Math.log(0.9) },
          { token: 'yes', logprob: Math.log(0.1) },
        ],
      }),
    })
    const result = answered(await rig.judge.run(noulRequest()))
    expect(result.muse[QUESTION_ID]?.technique).toBe('logprob')
    expect(rig.bodies[0]?.ollama).toBeUndefined()
    expect(rig.bodies[0]?.requestTopK).toBe(5)
    const wire = JSON.stringify(rig.bodies[0])
    expect(wire).not.toContain('"logprobs"')
    expect(wire).not.toContain('response_format')
    expect(wire).not.toContain('responseLogprobs')
  })

  it('does not label a top-1 of 0.60 as an answer', async () => {
    const rig = harness({
      world: { judgeLogprobs: { kind: 'top1' }, recordFields: top1Fields() },
      respond: underFloor,
    })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(rig.complete).toHaveBeenCalledTimes(1)
    expect(rig.books.settlements).toEqual([
      expect.objectContaining({ reservedUsd: 20, settled: 64 }),
    ])
    expect(rig.bodies[0]?.ollama).toMatchObject({ logprobs: true, top_logprobs: 1 })
  })

  it('falls back to one stated call when top-1 is under the floor', async () => {
    const rig = harness({
      world: {
        judgeLogprobs: { kind: 'top1' },
        recordFields: top1Fields(['json_object']),
      },
      respond: (request, nth) => {
        if (nth === 1) return underFloor(request)
        return {
          model: request.model,
          done: true,
          message: { role: 'assistant', content: '{"answer":"yes","confidence":80}' },
          prompt_eval_count: 10,
          eval_count: 2,
        }
      },
    })
    const result = answered(await rig.judge.run(noulRequest()))
    expect(rig.complete).toHaveBeenCalledTimes(2)
    expect(rig.bodies[1]?.technique).toBe('stated')
    expect(rig.bodies[1]?.ollama).not.toHaveProperty('logprobs')
    expect(rig.bodies[1]?.ollama).toMatchObject({ think: false, stream: false })
    expect(result.muse[QUESTION_ID]).toMatchObject({
      technique: 'stated',
      label: 'uncalibrated',
      partial: false,
      reservedCostUsd: 40,
      settledCostUsd: 92,
    })
    expect(result.usage).toEqual({ input_tokens: 40, output_tokens: 3 })
    expect(result.muse[QUESTION_ID]?.label).not.toBe('approximate (top-1)')
  })

  it('keeps the claim when a sent response drops logprobs', async () => {
    const rig = harness({
      respond: (request) => {
        const body: Record<string, unknown> = { ...capture.chat, model: request.model }
        delete body['logprobs']
        return body
      },
    })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(rig.books.settlements[0]?.settled).toBeUndefined()
  })

  it('keeps the claim when the transport throws', async () => {
    const rig = harness({
      respond: () => {
        throw new Error('down')
      },
    })
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(rig.complete).toHaveBeenCalledTimes(1)
    expect(rig.books.settlements[0]?.settled).toBeUndefined()
  })

  it('sends the full state with every question and dispatches nothing when one does not fit', async () => {
    const rig = harness()
    const request: JudgeRequest = {
      state: 'STATE-MARKER',
      questions: {
        one: { type: 'noul', instructions: 'QUESTION-MARKER' },
        two: { type: 'noul', instructions: 'QUESTION-MARKER-B' },
      },
    }
    const result = answered(await rig.judge.run(request))
    expect(rig.complete).toHaveBeenCalledTimes(2)
    expect(rig.bodies[0]?.messages[1]?.content).toContain('STATE-MARKER')
    expect(rig.bodies[1]?.messages[1]?.content).toContain('STATE-MARKER')
    expect(Object.keys(result.answers)).toEqual(['one', 'two'])
    const tight = harness({
      world: { contextWindowTokens: 50 },
      measure: (text) => (text.includes('NO-FIT') ? 10_000 : 1),
    })
    await expect(
      tight.judge.run({
        state: 'STATE-MARKER',
        questions: {
          one: { type: 'noul', instructions: 'QUESTION-MARKER' },
          two: { type: 'noul', instructions: 'NO-FIT' },
        },
      }),
    ).resolves.toEqual({ outcome: 'no-answer', reason: 'over-context' })
    expect(tight.complete).not.toHaveBeenCalled()
  })

  it('does not cache a run whose later question fails', async () => {
    const rig = harness({
      respond: (request, nth) => {
        if (nth % 2 === 0) {
          const body: Record<string, unknown> = { ...capture.chat, model: request.model }
          delete body['logprobs']
          return body
        }
        return { ...capture.chat, model: request.model }
      },
    })
    const request: JudgeRequest = {
      state: 'STATE-MARKER',
      questions: {
        one: { type: 'noul', instructions: 'QUESTION-MARKER' },
        two: { type: 'noul', instructions: 'QUESTION-MARKER-B' },
      },
    }
    await expect(rig.judge.run(request)).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(rig.books.settlements[0]?.settled).toBe(64)
    expect(rig.books.settlements[1]?.settled).toBeUndefined()
    await rig.judge.run(request)
    expect(rig.complete).toHaveBeenCalledTimes(4)
  })

  it('refuses a body over the byte cap before dispatch', async () => {
    const request = {
      state: 'S'.repeat(65_100),
      questions: { q: { type: 'noul' as const, instructions: 'q' } },
    }
    expect(judgeRequestBytes(request)).toBeLessThanOrEqual(JUDGE_MAX_BODY_BYTES)
    const rig = harness({ measure: () => 1 })
    await expect(rig.judge.run(request)).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'over-context',
    })
    expect(rig.complete).not.toHaveBeenCalled()
  })

  it('reports an engine failure for a request the contract rejects', async () => {
    const rig = harness()
    const bad = { state: 'x', questions: {} } as JudgeRequest
    await expect(rig.judge.run(bad)).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(rig.complete).not.toHaveBeenCalled()
  })

  it('rejects a token measurement that is not a nonnegative integer', async () => {
    const rig = harness({ measure: () => -1 })
    await expect(rig.judge.run(noulRequest())).rejects.toThrow(TypeError)
    expect(rig.complete).not.toHaveBeenCalled()
  })

  it('refunds a reservation cancelled during the wait', async () => {
    const controller = new AbortController()
    const rig = harness({
      afterWait: () => {
        controller.abort()
        return Promise.resolve()
      },
    })
    await expect(rig.judge.run(noulRequest(), controller.signal)).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(rig.complete).not.toHaveBeenCalled()
    expect(rig.books.settlements[0]?.settled).toBe(0)
  })

  it('invalidates a result when the provider binding changes', async () => {
    const rig = harness()
    await rig.judge.run(noulRequest())
    rig.world.providerId = 'other'
    await expect(rig.judge.run(noulRequest())).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(rig.complete).toHaveBeenCalledTimes(1)
  })

  it('answers top-1 above the floor in one call and marks it partial', async () => {
    const rig = harness({
      world: { judgeLogprobs: { kind: 'top1' }, recordFields: top1Fields() },
    })
    const result = answered(await rig.judge.run(noulRequest()))
    expect(rig.complete).toHaveBeenCalledTimes(1)
    expect(result.muse[QUESTION_ID]).toMatchObject({
      technique: 'top1',
      label: 'approximate (top-1)',
      partial: true,
    })
    const no = result.answers[QUESTION_ID]
    expect(no?.type).toBe('noul')
    if (no?.type === 'noul') {
      expect(no.probabilities.false).toBeGreaterThan(JUDGE_TOP1_MIN_PROB)
    }
  })
})

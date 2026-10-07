import { describe, expect, it, vi } from 'vitest'
import type { JudgeOutcome, JudgeRequest, JudgeResult } from '../../src/core/judge/schema'
import { judgeLogSummary, judgeRequestBytes, judgeRequestSchema } from '../../src/core/judge/schema'
import {
  createSystemOneJudge,
  type SystemOneJudgeDependencies,
  type SystemOnePost,
  type SystemOnePostResult,
  type SystemOneReserveResult,
  type SystemOneSelection,
} from '../../src/core/judge/systemone/source'
import { SYSTEMONE_SERVICE_PRESETS, systemOnePresetById } from '../../src/core/providers/presets'
import { systemOneCapability } from '../../src/core/providers/capabilities'
import {
  JUDGE_MAX_BODY_BYTES,
  JUDGE_REQUEST_TIMEOUT_MS,
  REDACTED_MARK,
  TOKENS_PER_MILLION,
} from '../../src/shared/constants'
import captures from './fixtures/judgeSystemOneCaptures.json'

const KEY = 'sk-or-test-key-00000000000001'

function selection(over: Partial<SystemOneSelection> = {}): SystemOneSelection {
  return {
    generation: 0,
    presetId: 'openrouter-jev',
    model: 'typesafe/jev-1.13',
    enabled: true,
    selection: 'explicit',
    confidential: false,
    consent: 'granted',
    ...over,
  }
}

function openrouterRequest(): JudgeRequest {
  return judgeRequestSchema.parse(captures.openrouterRecordedNoul.request)
}

interface HarnessOptions {
  readonly selection?: SystemOneSelection
  readonly measure?: (text: string) => number
  readonly response?: SystemOnePostResult
  readonly readKey?: (keyProviderId: string) => Promise<string | undefined>
  readonly reserve?: (usd: number) => Promise<SystemOneReserveResult>
  readonly post?: (request: SystemOnePost) => Promise<SystemOnePostResult>
  readonly duringReserve?: (set: (next: SystemOneSelection) => void) => void
  readonly settle?: (usd: number) => Promise<void>
  readonly refund?: () => Promise<void>
  readonly onConfigurationRead?: () => void
}

function harness(options: HarnessOptions = {}) {
  const events: string[] = []
  const posts: SystemOnePost[] = []
  const quotes: number[] = []
  const settled: number[] = []
  let refunds = 0
  let current = options.selection ?? selection()
  const deps: SystemOneJudgeDependencies = {
    configuration: () => {
      options.onConfigurationRead?.()
      return current
    },
    readKey(keyProviderId) {
      events.push(`key:${keyProviderId}`)
      return options.readKey === undefined ? Promise.resolve(KEY) : options.readKey(keyProviderId)
    },
    measureTokens: options.measure ?? (() => 491),
    async reserve(usd) {
      events.push('reserve')
      quotes.push(usd)
      options.duringReserve?.((next) => {
        current = { ...next, generation: current.generation + 1 }
      })
      if (options.reserve !== undefined) return await options.reserve(usd)
      return {
        reserved: true,
        claim: {
          reservedUsd: usd,
          async settle(actual) {
            events.push('settle')
            settled.push(actual)
            await options.settle?.(actual)
          },
          async refund() {
            events.push('refund')
            refunds += 1
            await options.refund?.()
          },
        },
      }
    },
    post(request) {
      events.push('post')
      posts.push(request)
      return options.post === undefined
        ? Promise.resolve(
            options.response ?? {
              sent: true,
              status: 200,
              body: captures.openrouterRecordedNoul.response,
            },
          )
        : options.post(request)
    },
  }
  return {
    runtime: createSystemOneJudge(deps),
    events,
    posts,
    quotes,
    settled,
    refunds: () => refunds,
    setSelection(next: SystemOneSelection) {
      current = { ...next, generation: current.generation + 1 }
    },
  }
}

function requireAnswer(outcome: JudgeOutcome): JudgeResult {
  if (outcome.outcome !== 'answered') throw new Error('expected an answer')
  return outcome.result
}

function freshSignal(): AbortSignal {
  return new AbortController().signal
}

async function ask(rig: ReturnType<typeof harness>, request: JudgeRequest = openrouterRequest()) {
  return await rig.runtime.judge(request, freshSignal())
}

function directTypeSafe() {
  return harness({
    selection: selection({ presetId: 'typesafe-jev', model: 'jev-1.13.0' }),
    response: { sent: true, status: 200, body: captures.typesafeDocsNoul.response },
  })
}

function typeSafeRequest(): JudgeRequest {
  return judgeRequestSchema.parse(captures.typesafeDocsNoul.request)
}

async function expectFailure(options: HarnessOptions) {
  const rig = harness(options)
  expect(await ask(rig)).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
  return rig
}

function kind(text: string): 'state' | 'question' | 'body' {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'state'
  return 'model' in value ? 'body' : 'question'
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function heldKeyHarness() {
  const entered = Promise.withResolvers<undefined>()
  const key = Promise.withResolvers<string | undefined>()
  const rig = harness({
    readKey: () => {
      entered.resolve(undefined)
      return key.promise
    },
  })
  return { rig, key, entered: entered.promise }
}

describe('systemone runtime', () => {
  it('does not touch a key, a reservation or the network while being constructed', () => {
    const readKey = vi.fn()
    const reserve = vi.fn()
    const post = vi.fn()
    createSystemOneJudge({
      configuration: () => undefined,
      readKey,
      measureTokens: () => 491,
      reserve,
      post,
    })
    expect(readKey).not.toHaveBeenCalled()
    expect(reserve).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('keeps the untested opt-in labels after success and failure', async () => {
    const before = SYSTEMONE_SERVICE_PRESETS.map((preset) => ({ ...preset }))
    const rig = harness()
    const answered = await rig.runtime.judge(openrouterRequest(), new AbortController().signal)
    expect(answered.outcome).toBe('answered')
    rig.setSelection(selection({ enabled: false }))
    expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'explicit-off',
    })
    expect(SYSTEMONE_SERVICE_PRESETS.map((preset) => ({ ...preset }))).toEqual(before)
    for (const preset of SYSTEMONE_SERVICE_PRESETS) {
      expect(preset.tested).toBe(false)
      expect(preset.optIn).toBe(true)
      expect(preset.autoSelectable).toBe(false)
    }
  })

  it('refuses when the route is switched off', async () => {
    const rig = harness({ selection: selection({ enabled: false, confidential: true }) })
    expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'explicit-off',
    })
    expect(rig.events).toEqual([])
  })

  it('refuses a confidential workspace before an auto selection', async () => {
    const rig = harness({
      selection: selection({ confidential: true, selection: 'auto', consent: 'granted' }),
    })
    expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'confidential-refused',
    })
    expect(rig.events).toEqual([])
  })

  it.each([-1, 0.5, NaN])(
    'refuses an invalid policy generation %s before I/O',
    async (generation) => {
      const rig = harness({ selection: selection({ generation }) })
      expect(await ask(rig)).toEqual({ outcome: 'no-answer', reason: 'source-unavailable' })
      expect(rig.events).toEqual([])
    },
  )

  it('refuses auto selection before reserve', async () => {
    const rig = harness({ selection: selection({ selection: 'auto' }) })
    expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'source-untested',
    })
    expect(rig.posts).toHaveLength(0)
    expect(rig.events).not.toContain('reserve')
    const needed = harness({ selection: selection({ consent: 'needed' }) })
    expect(await needed.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'consent-needed',
    })
    expect(needed.events).toEqual([])
    const declined = harness({ selection: selection({ consent: 'declined' }) })
    expect(await declined.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual(
      {
        outcome: 'no-answer',
        reason: 'consent-declined',
      },
    )
    expect(declined.events).toEqual([])
  })

  it('refuses an unknown preset or model without a send', async () => {
    const missing = harness({ selection: selection({ presetId: 'clef', model: 'clef' }) })
    expect(await missing.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
    expect(missing.events).toEqual([])
    const preview = harness({ selection: selection({ model: 'jev-preview' }) })
    expect(await preview.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(preview.events).toEqual([])
    expect(systemOnePresetById('openrouter-jev')?.path).toBe('/api/v1/systemone')
    expect(systemOnePresetById('typesafe-jev')?.path).toBe('/v1/systemone')
  })

  it('redacts secrets before the remote send', async () => {
    const rig = harness()
    const request = judgeRequestSchema.parse({
      state: `ticket ${KEY} stays local`,
      questions: {
        healthy: { type: 'noul', instructions: `see ${KEY} please` },
      },
    })
    const outcome = await rig.runtime.judge(request, new AbortController().signal)
    expect(outcome.outcome).toBe('answered')
    const posted = rig.posts[0]
    expect(posted?.key).toBe(KEY)
    expect(posted?.body).not.toContain(KEY)
    expect(posted?.body).toContain(REDACTED_MARK)
    expect(posted?.origin).toBe('https://openrouter.ai')
    expect(posted?.path).toBe('/api/v1/systemone')
    const body = JSON.parse(posted?.body ?? '{}') as {
      state: string
      model: string
      questions: unknown
    }
    expect(Object.keys(body)).toEqual(['state', 'model', 'questions'])
    expect(body.model).toBe('typesafe/jev-1.13')
    expect(body.state).not.toContain('healthy')
    expect(rig.events.indexOf('reserve')).toBeLessThan(rig.events.indexOf('post'))
    expect(rig.events).toContain('key:openrouter')
    const summary = JSON.stringify(judgeLogSummary(requireAnswer(outcome)))
    expect(summary).not.toContain(KEY)
    expect(summary).not.toContain('ticket')
    expect(summary).not.toContain('noul')
  })

  it('reserves the uncached input cost before send', async () => {
    const rig = harness()
    const outcome = await rig.runtime.judge(openrouterRequest(), new AbortController().signal)
    expect(outcome.outcome).toBe('answered')
    const rate = systemOneCapability('openrouter-jev', 'typesafe/jev-1.13')
    expect(rate?.outputUsdPerMillion).toBe(0)
    expect(rig.quotes[0]).toBe((491 * (rate?.inputUsdPerMillion ?? 0)) / TOKENS_PER_MILLION)
    expect(rig.events.indexOf('reserve')).toBeLessThan(rig.events.indexOf('key:openrouter'))
    expect(rig.events.indexOf('key:openrouter')).toBeLessThan(rig.events.indexOf('post'))
    expect(rig.refunds()).toBe(0)
    const again = await rig.runtime.judge(openrouterRequest(), new AbortController().signal)
    expect(again.outcome).toBe('answered')
    expect(rig.quotes).toHaveLength(2)
    expect(rig.posts).toHaveLength(2)
  })

  it.each([
    ['openrouter-jev', 'object'],
    ['openrouter-jev', 'array'],
    ['typesafe-jev', 'object'],
    ['typesafe-jev', 'array'],
  ])(
    'redacts named secrets in every structured field on %s with %s state',
    async (presetId, shape) => {
      const names = [
        'password',
        'api_key',
        'apikey',
        'access_token',
        'refresh_token',
        'id_token',
        'client_secret',
        'private_key',
        'customToken',
      ]
      const fields = Object.fromEntries(names.map((name) => [name, `opaque-${name}-value`]))
      const structured = {
        ...fields,
        nested: { ...fields },
        list: [{ ...fields }],
        keep: 'ordinary',
      }
      const state = shape === 'array' ? [structured] : structured
      const model = presetId === 'typesafe-jev' ? 'jev-1.13.0' : 'typesafe/jev-1.13'
      const rig = harness({ selection: selection({ presetId, model }) })
      const request = judgeRequestSchema.parse({
        state,
        questions: {
          healthy: {
            type: 'noul',
            instructions: 'password=opaque-instructions',
            criteria: { true: 'api_key=opaque-true', false: 'client_secret=opaque-false' },
          },
          route: {
            type: 'choice',
            instructions: 'access_token=opaque-choice',
            criteria: { A: 'password=opaque-A', B: 'refresh_token=opaque-B' },
          },
          score: {
            type: 'score',
            instructions: 'id_token=opaque-score',
            criteria: ['"private_key":"opaque-low"', 'password=opaque-high'],
          },
        },
      })
      await ask(rig, request)
      expect(rig.posts).toHaveLength(1)
      const body = rig.posts[0]?.body ?? ''
      expect(body).not.toContain('opaque-')
      expect(body).toContain('ordinary')
      expect(body).toContain(REDACTED_MARK)
      expect(judgeRequestSchema.safeParse(JSON.parse(body)).success).toBe(true)
      expect(request.state).toEqual(state)
    },
  )

  it.each([
    [{ confidential: true }, 'confidential-refused'],
    [{ consent: 'declined' }, 'consent-declined'],
    [{ consent: 'needed' }, 'consent-needed'],
    [{ enabled: false }, 'explicit-off'],
    [{ selection: 'auto' }, 'source-untested'],
    [{ presetId: 'typesafe-jev', model: 'jev-1.13.0' }, 'consent-needed'],
    [{ model: '~typesafe/jev-latest' }, 'consent-needed'],
  ] satisfies [Partial<SystemOneSelection>, string][])(
    'rechecks policy after key lookup for %j',
    async (change, reason) => {
      const { rig, key, entered } = heldKeyHarness()
      const operation = ask(rig)
      await entered
      rig.setSelection(selection(change))
      key.resolve(KEY)
      expect(await operation).toEqual({ outcome: 'no-answer', reason })
      expect(rig.posts).toHaveLength(0)
      expect(rig.refunds()).toBe(1)
      expect(rig.settled).toEqual([])
    },
  )

  it('refuses a revoked then restored policy generation during key lookup', async () => {
    const { rig, key, entered } = heldKeyHarness()
    const operation = ask(rig)
    await entered
    rig.setSelection(selection({ consent: 'declined', confidential: true }))
    rig.setSelection(selection())
    key.resolve(KEY)
    expect(await operation).toEqual({ outcome: 'no-answer', reason: 'consent-needed' })
    expect(rig.posts).toHaveLength(0)
    expect(rig.refunds()).toBe(1)
  })

  it('snapshots a mutable policy object before key lookup', async () => {
    const initial = { ...selection() }
    const rig = harness({
      selection: initial,
      readKey: () => {
        initial.confidential = true
        initial.generation += 1
        return Promise.resolve(KEY)
      },
    })
    expect(await ask(rig)).toEqual({ outcome: 'no-answer', reason: 'confidential-refused' })
    expect(rig.posts).toHaveLength(0)
    expect(rig.refunds()).toBe(1)
  })

  it('refuses cancellation when fulfilled accounting wins the promise race', async () => {
    const caller = new AbortController()
    const rig = harness({
      settle: () => {
        // Cancel after the ledger fulfills, in the same microtask turn as delivery.
        queueMicrotask(() => {
          queueMicrotask(() => {
            queueMicrotask(() => {
              caller.abort()
            })
          })
        })
        return Promise.resolve()
      },
    })
    expect(await rig.runtime.judge(openrouterRequest(), caller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(rig.settled).toHaveLength(1)
    expect(rig.refunds()).toBe(0)
  })

  it('refuses redacted structured JSON that cannot be validated before I/O', async () => {
    const rig = harness()
    const request = judgeRequestSchema.parse({
      ...openrouterRequest(),
      state: { password: 1234 },
    })
    expect(await ask(rig, request)).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
    expect(rig.events).toEqual([])
  })

  it('refuses a synchronous cancellation at the final policy read before dispatch', async () => {
    const caller = new AbortController()
    let hasReadKey = false
    const rig = harness({
      readKey: () => {
        hasReadKey = true
        return Promise.resolve(KEY)
      },
      onConfigurationRead: () => {
        if (hasReadKey) caller.abort()
      },
    })
    expect(await rig.runtime.judge(openrouterRequest(), caller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(rig.posts).toHaveLength(0)
    expect(rig.refunds()).toBe(1)
  })

  it.each([
    ['caller', 'sent'],
    ['deadline', 'sent'],
    ['caller', 'unsent'],
    ['deadline', 'unsent'],
    ['caller', 'reject'],
    ['deadline', 'reject'],
  ])('bounds pending post by %s and accounts late %s once', async (cause, late) => {
    const caller = new AbortController()
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const entered = Promise.withResolvers<undefined>()
    const response = Promise.withResolvers<SystemOnePostResult>()
    const rig = harness({
      post: () => {
        entered.resolve(undefined)
        return response.promise
      },
    })
    const decided = vi.fn()
    const operation = rig.runtime.judge(openrouterRequest(), caller.signal)
    void operation.then(decided)
    try {
      await entered.promise
      ;(cause === 'caller' ? caller : deadline).abort()
      await nextTask()
      expect(decided).toHaveBeenCalledExactlyOnceWith({
        outcome: 'no-answer',
        reason: cause === 'caller' ? 'cancelled' : 'timeout',
      })
      expect(rig.settled).toEqual([])
      expect(rig.refunds()).toBe(0)
    } finally {
      if (late === 'reject') response.reject(new Error('transport'))
      else
        response.resolve({
          sent: late === 'sent',
          status: 200,
          body: captures.openrouterRecordedNoul.response,
        })
      await operation
      await nextTask()
      timeout.mockRestore()
    }
    expect(rig.posts).toHaveLength(1)
    expect(rig.settled).toHaveLength(late === 'sent' ? 1 : 0)
    expect(rig.refunds()).toBe(late === 'unsent' ? 1 : 0)
    expect(decided).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['key', 'caller', 'resolve'],
    ['key', 'deadline', 'resolve'],
    ['reserve', 'caller', 'resolve'],
    ['reserve', 'deadline', 'resolve'],
    ['key', 'caller', 'reject'],
    ['reserve', 'deadline', 'reject'],
  ])('bounds pending %s by %s and handles late %s once', async (stage, cause, late) => {
    const caller = new AbortController()
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(JUDGE_REQUEST_TIMEOUT_MS)
      return deadline.signal
    })
    const entered = Promise.withResolvers<undefined>()
    const key = Promise.withResolvers<string | undefined>()
    const reservation = Promise.withResolvers<SystemOneReserveResult>()
    const refund = vi.fn(() => Promise.resolve())
    const settle = vi.fn(() => Promise.resolve())
    const rig = harness(
      stage === 'key'
        ? {
            readKey: () => {
              entered.resolve(undefined)
              return key.promise
            },
          }
        : {
            reserve: () => {
              entered.resolve(undefined)
              return reservation.promise
            },
          },
    )
    const decided = vi.fn()
    const operation = rig.runtime.judge(openrouterRequest(), caller.signal)
    void operation.then(decided)
    try {
      await entered.promise
      const reason = cause === 'caller' ? 'cancelled' : 'timeout'
      ;(cause === 'caller' ? caller : deadline).abort()
      await nextTask()
      expect(decided).toHaveBeenCalledExactlyOnceWith({ outcome: 'no-answer', reason })
      expect(rig.posts).toHaveLength(0)
      if (stage === 'key') expect(rig.refunds()).toBe(1)
    } finally {
      if (late === 'reject') {
        if (stage === 'key') key.reject(new Error('late key failure'))
        else reservation.reject(new Error('late ledger failure'))
      } else {
        key.resolve(KEY)
        reservation.resolve({ reserved: true, claim: { reservedUsd: 1, refund, settle } })
      }
      await operation
      await nextTask()
      timeout.mockRestore()
    }
    caller.abort()
    deadline.abort()
    await nextTask()
    expect(rig.posts).toHaveLength(0)
    expect(rig.settled).toEqual([])
    expect(settle).not.toHaveBeenCalled()
    expect(refund).toHaveBeenCalledTimes(stage === 'reserve' && late === 'resolve' ? 1 : 0)
    expect(rig.refunds()).toBe(stage === 'key' ? 1 : 0)
    expect(decided).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['post', 'caller'],
    ['post', 'deadline'],
    ['settle', 'caller'],
    ['settle', 'deadline'],
    ['settle-failure', 'caller'],
    ['settle-failure', 'deadline'],
  ])('keeps %s cancellation from %s terminal while accounting once', async (stage, cause) => {
    const caller = new AbortController()
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const stop = cause === 'caller' ? caller : deadline
    const entered = Promise.withResolvers<undefined>()
    const settlement = Promise.withResolvers<undefined>()
    const rig = harness(
      stage === 'post'
        ? {
            post: () => {
              stop.abort()
              return Promise.resolve({
                sent: true,
                status: 200,
                body: captures.openrouterRecordedNoul.response,
              })
            },
          }
        : {
            settle: () => {
              entered.resolve(undefined)
              return settlement.promise
            },
          },
    )
    const decided = vi.fn()
    const operation = rig.runtime.judge(openrouterRequest(), caller.signal)
    void operation.then(decided)
    try {
      if (stage !== 'post') {
        await entered.promise
        stop.abort()
      }
      await nextTask()
      expect(decided).toHaveBeenCalledExactlyOnceWith({
        outcome: 'no-answer',
        reason: cause === 'caller' ? 'cancelled' : 'timeout',
      })
    } finally {
      if (stage === 'settle-failure') settlement.reject(new Error('ledger'))
      else settlement.resolve(undefined)
      await operation
      await nextTask()
      timeout.mockRestore()
    }
    expect(rig.posts).toHaveLength(1)
    expect(rig.settled).toHaveLength(1)
    expect(rig.refunds()).toBe(0)
    expect(decided).toHaveBeenCalledTimes(1)
  })

  it('sends direct TypeSafe only on an explicit opt-in and keeps its labels', async () => {
    const rig = directTypeSafe()
    const outcome = await ask(rig, typeSafeRequest())
    expect(outcome.outcome).toBe('answered')
    expect(rig.posts[0]?.origin).toBe('https://api.typesafe.ai')
    expect(rig.posts[0]?.path).toBe('/v1/systemone')
    expect(rig.events).toContain('key:typesafe')
    expect(systemOnePresetById('typesafe-jev')?.tested).toBe(false)
    expect(systemOnePresetById('typesafe-jev')?.wireCapture).toBe(false)
    const result = requireAnswer(outcome)
    expect(result.muse['healthy']?.model).toBe('jev-1.13.0')
    expect(result.usage.output_tokens).toBe(20)
  })

  it('settles actual usage rather than the reservation', async () => {
    const rig = directTypeSafe()
    const outcome = await ask(rig, typeSafeRequest())
    const rate = systemOneCapability('typesafe-jev', 'jev-1.13.0')
    const actual = (296 * (rate?.inputUsdPerMillion ?? 0)) / TOKENS_PER_MILLION
    expect(rate?.outputUsdPerMillion).toBe(0)
    expect(captures.typesafeDocsNoul.response.usage.output_tokens).toBeGreaterThan(0)
    expect(rig.settled).toEqual([actual])
    expect(rig.quotes[0]).not.toBe(actual)
    const result = requireAnswer(outcome)
    expect(result.muse['healthy']?.settledCostUsd).toBe(actual)
    expect(result.muse['healthy']?.reservedCostUsd).toBe(rig.quotes[0])
  })

  it('keeps liability when reported usage exceeds the reservation', async () => {
    const rig = await expectFailure({
      measure: () => 10,
      response: { sent: true, status: 200, body: captures.openrouterRecordedNoul.response },
    })
    expect(rig.settled).toEqual([])
    expect(rig.refunds()).toBe(0)
    expect(rig.posts).toHaveLength(1)
  })

  it('keeps liability when the response cannot be parsed', async () => {
    const rig = await expectFailure({
      response: { sent: true, status: 200, body: { model: 'typesafe/jev-1.13-20260917' } },
    })
    expect(rig.refunds()).toBe(0)
    expect(rig.settled).toEqual([])
  })

  it('does not parse an error status and does not refund it', async () => {
    for (const status of [401, 429, 529]) {
      const rig = await expectFailure({
        response: { sent: true, status, body: captures.openrouterRecordedNoul.response },
      })
      expect(rig.refunds()).toBe(0)
    }
  })

  it('refunds a known non-send and a missing key', async () => {
    const unsent = harness({ response: { sent: false, status: 0, body: undefined } })
    expect(await unsent.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(unsent.refunds()).toBe(1)
    const missingKey = harness({ readKey: () => Promise.resolve(undefined) })
    expect(
      await missingKey.runtime.judge(openrouterRequest(), new AbortController().signal),
    ).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
    expect(missingKey.refunds()).toBe(1)
    expect(missingKey.posts).toHaveLength(0)
    const thrown = harness({
      readKey: () => {
        throw new Error('store')
      },
    })
    expect(await thrown.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(thrown.refunds()).toBe(1)
    expect(thrown.posts).toHaveLength(0)
  })

  it('refunds a known non-send when the workspace becomes confidential', async () => {
    const rig = harness({
      duringReserve: (set) => {
        set(selection({ confidential: true, consent: 'granted', selection: 'explicit' }))
      },
    })
    expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'confidential-refused',
    })
    expect(rig.refunds()).toBe(1)
    expect(rig.posts).toHaveLength(0)
    const switched = harness({
      duringReserve: (set) => {
        set(selection({ presetId: 'typesafe-jev', model: 'jev-1.13.0' }))
      },
    })
    expect(await switched.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual(
      {
        outcome: 'no-answer',
        reason: 'consent-needed',
      },
    )
    expect(switched.refunds()).toBe(1)
    expect(switched.posts).toHaveLength(0)
  })

  it('keeps liability when settlement or a refund fails', async () => {
    const settle = harness({
      settle: () => {
        throw new Error('disk')
      },
    })
    expect(await settle.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(settle.refunds()).toBe(0)
    const refund = harness({
      duringReserve: (set) => {
        set(selection({ confidential: true }))
      },
      refund: () => {
        throw new Error('disk')
      },
    })
    expect(await refund.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
  })

  it('keeps liability when the send aborts', async () => {
    const controller = new AbortController()
    const rig = harness({
      post: () => {
        controller.abort()
        throw new DOMException('The operation was aborted', 'AbortError')
      },
    })
    expect(await rig.runtime.judge(openrouterRequest(), controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(rig.refunds()).toBe(0)
    expect(rig.events).toContain('post')
  })

  it('refunds when the caller aborts before the reservation', async () => {
    const controller = new AbortController()
    controller.abort()
    const rig = harness()
    expect(await rig.runtime.judge(openrouterRequest(), controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(rig.events).toEqual([])
  })

  it('refunds when the deadline is already elapsed before the reservation', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(JUDGE_REQUEST_TIMEOUT_MS)
      return AbortSignal.abort()
    })
    try {
      const rig = harness()
      expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
        outcome: 'no-answer',
        reason: 'timeout',
      })
      expect(rig.events).toEqual([])
    } finally {
      timeout.mockRestore()
    }
  })

  it('maps ledger refusals without sending', async () => {
    const over = harness({
      reserve: () => Promise.resolve({ reserved: false, reason: 'over-budget' }),
    })
    expect(await over.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    expect(over.posts).toHaveLength(0)
    const unpriced = harness({
      reserve: () => Promise.resolve({ reserved: false, reason: 'unpriced' }),
    })
    expect(await unpriced.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual(
      {
        outcome: 'no-answer',
        reason: 'unpriced',
      },
    )
    const down = harness({
      reserve: () => Promise.resolve({ reserved: false, reason: 'ledger-unavailable' }),
    })
    expect(await down.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(down.posts).toHaveLength(0)
  })

  it('refuses a body past 64000 tokens', async () => {
    const rig = harness({
      measure: (text) => (kind(text) === 'body' ? 64_001 : 10),
    })
    expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'over-context',
    })
    expect(rig.events).not.toContain('reserve')
  })

  it('allows a 40000-token body under the request cap', async () => {
    const rig = harness({
      measure: (text) => (kind(text) === 'body' ? 40_000 : 10),
    })
    const allowed = await rig.runtime.judge(openrouterRequest(), new AbortController().signal)
    expect(allowed.outcome).toBe('answered')
    const rate = systemOneCapability('openrouter-jev', 'typesafe/jev-1.13')
    expect(rig.quotes[0]).toBe((40_000 * (rate?.inputUsdPerMillion ?? 0)) / TOKENS_PER_MILLION)
  })

  it('allows a body of exactly 64000 tokens and a state total of exactly 32000', async () => {
    const atCap = harness({ measure: (text) => (kind(text) === 'body' ? 64_000 : 10) })
    const capped = await atCap.runtime.judge(openrouterRequest(), new AbortController().signal)
    expect(capped.outcome).toBe('answered')
    const atState = harness({
      measure: (text) => {
        const part = kind(text)
        if (part === 'state') return 32_000
        return part === 'question' ? 0 : 100
      },
      response: {
        sent: true,
        status: 200,
        body: {
          ...captures.openrouterRecordedNoul.response,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    })
    const stateCap = await atState.runtime.judge(openrouterRequest(), new AbortController().signal)
    expect(stateCap.outcome).toBe('answered')
  })

  it('refuses a state past 32000 tokens', async () => {
    const rig = harness({
      measure: (text) => (kind(text) === 'state' ? 32_001 : 10),
    })
    expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'over-context',
    })
    expect(rig.posts).toHaveLength(0)
    const withQuestion = harness({
      measure: (text) => {
        const part = kind(text)
        if (part === 'state') return 32_000
        return part === 'question' ? 1 : 10
      },
    })
    expect(
      await withQuestion.runtime.judge(openrouterRequest(), new AbortController().signal),
    ).toEqual({ outcome: 'no-answer', reason: 'over-context' })
  })

  it('refuses a failed or zero token count before reserve', async () => {
    for (const measure of [
      () => NaN,
      () => -1,
      () => 1.5,
      (text: string) => (kind(text) === 'body' ? 0 : 10),
    ]) {
      const rig = harness({ measure })
      expect(await rig.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
        outcome: 'no-answer',
        reason: 'engine-failure',
      })
      expect(rig.events).not.toContain('reserve')
    }
    const thrown = harness({
      measure: () => {
        throw new Error('counter')
      },
    })
    expect(await thrown.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(thrown.events).toEqual([])
  })

  it('refuses a request outside the captured bounds before send', async () => {
    const questions: Record<string, { type: 'noul'; instructions: string }> = {}
    for (let index = 0; index < 65; index += 1)
      questions[`q${String(index)}`] = { type: 'noul', instructions: 'ok' }
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    const twentySeven = Object.fromEntries([...letters, 'AA'].map((key) => [key, 'option']))
    const cases = [
      { state: 'x', questions },
      {
        state: 'x',
        questions: {
          mood: {
            type: 'score',
            instructions: 'rate',
            criteria: Array.from({ length: 11 }, (_, index) => `L${String(index)}`),
          },
        },
      },
      {
        state: 'x',
        questions: {
          route: {
            type: 'choice',
            instructions: 'pick',
            criteria: { billing: 'b', technical: 't', sales: 's' },
          },
        },
      },
      {
        state: 'x',
        questions: {
          route: { type: 'choice', instructions: 'pick', criteria: { a: 'lower', B: 'upper' } },
        },
      },
      {
        state: 'x',
        questions: { route: { type: 'choice', instructions: 'pick', criteria: twentySeven } },
      },
      { state: 's'.repeat(70_000), questions: { healthy: { type: 'noul', instructions: 'ok' } } },
    ]
    for (const request of cases) {
      const rig = harness()
      expect(
        await rig.runtime.judge(request as JudgeRequest, new AbortController().signal),
      ).toEqual({
        outcome: 'no-answer',
        reason: 'engine-failure',
      })
      expect(rig.posts).toHaveLength(0)
      expect(rig.events).not.toContain('reserve')
    }
  })

  it('refuses a redacted body that no longer fits in 64 KiB', async () => {
    const questions = { q: { type: 'noul' as const, instructions: 'ok' } }
    let low = 0
    let high = JUDGE_MAX_BODY_BYTES
    let state = ''
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const candidate = 's'.repeat(mid)
      if (judgeRequestBytes({ state: candidate, questions }) <= JUDGE_MAX_BODY_BYTES) {
        state = candidate
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    const request = { state, questions }
    expect(judgeRequestBytes(request)).toBeLessThanOrEqual(JUDGE_MAX_BODY_BYTES)
    const sent = JSON.stringify({ state, model: 'typesafe/jev-1.13', questions })
    expect(new TextEncoder().encode(sent).length).toBeGreaterThan(JUDGE_MAX_BODY_BYTES)
    const rig = harness()
    expect(await rig.runtime.judge(request, new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(rig.posts).toHaveLength(0)
    expect(rig.quotes).toHaveLength(0)
  })

  it('reports the resolved model for an alias and rejects any other id', async () => {
    const rig = harness({
      selection: selection({ model: '~typesafe/jev-latest' }),
      response: { sent: true, status: 200, body: captures.openrouterRecordedNoul.response },
    })
    const outcome = await rig.runtime.judge(openrouterRequest(), new AbortController().signal)
    expect(outcome.outcome).toBe('answered')
    const posted = JSON.parse(rig.posts[0]?.body ?? '{}') as { model: string }
    expect(posted.model).toBe('~typesafe/jev-latest')
    expect(requireAnswer(outcome).muse['healthy']?.model).toBe('typesafe/jev-1.13-20260917')
    const foreign = harness({
      response: {
        sent: true,
        status: 200,
        body: { ...captures.openrouterRecordedNoul.response, model: 'clef-1' },
      },
    })
    expect(await foreign.runtime.judge(openrouterRequest(), new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(foreign.refunds()).toBe(0)
    const mismatched = harness()
    const request = judgeRequestSchema.parse({
      ...captures.openrouterRecordedNoul.request,
      model: 'jev-1.13.0',
    })
    expect(await mismatched.runtime.judge(request, new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(mismatched.posts).toHaveLength(0)
  })
})

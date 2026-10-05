import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { runJudgeHookCommand } from '../../src/runtime/judge/hook'
import { runJudgeCommand, type JudgeCliSource } from '../../src/runtime/judge/commands'
import { JUDGE_MAX_BODY_BYTES } from '../../src/shared/constants'
import { REQUEST, command, io, source, writer } from './judgeCliFixtures'
import { CAUTION, PAYLOAD, hookDeps, invoke, riskOutcome } from './judgeHookCliFixtures'

describe('judge hook shared CLI admission and lifecycle', () => {
  it('keeps generic judge ask no-answer at exit 4 while the hook abstains at exit 0', async () => {
    const fake = source('paid', 0.01)
    const streams = io(JSON.stringify(REQUEST))
    const deps = hookDeps(fake.value)
    expect(await runJudgeCommand(command(), streams, deps)).toBe(4)
    expect(JSON.parse(streams.output())).toMatchObject({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    const hook = await invoke(PAYLOAD, { format: 'muse' }, deps)
    expect(hook.code).toBe(0)
    expect(hook.output()).toBe('')
    expect(fake.judge).not.toHaveBeenCalled()
  })
  it('requires explicit available same-model context without spawning or switching a model', async () => {
    const deps = hookDeps()
    const absent = await invoke(PAYLOAD, { format: 'muse' }, deps, command('ask', []).options)
    expect(absent.code).toBe(0)
    expect(absent.output()).toBe('')
    expect(deps.resolveSource).not.toHaveBeenCalled()
    for (const model of ['another-model', 'unavailable']) {
      const fake = source()
      const result = await invoke(
        PAYLOAD,
        { format: 'muse' },
        {
          ...hookDeps(),
          resolveSource: () =>
            Promise.resolve(model === 'unavailable' ? undefined : { ...fake.value, model }),
        },
      )
      expect(result.code).toBe(0)
      expect(fake.judge).not.toHaveBeenCalled()
      expect(result.output()).toBe('')
    }
  })
  it('keeps the default zero and tiny positive run caps from authorizing a paid batch', async () => {
    for (const args of [[], ['--budget-usd', '0.000001']]) {
      const fake = source('paid', 0.01)
      const admitPaid = vi.fn(() => Promise.resolve(riskOutcome()))
      const result = await invoke(
        PAYLOAD,
        { format: 'muse' },
        { ...hookDeps(fake.value), admitPaid },
        command('ask', ['--model', 'chosen', ...args]).options,
      )
      expect(result.code).toBe(0)
      expect(result.output()).toBe('')
      expect(fake.judge).not.toHaveBeenCalled()
      expect(admitPaid).not.toHaveBeenCalled()
    }
  })
  it('requires a verified price and the shared durable daily-ledger/consent adapter', async () => {
    for (const cost of [undefined, NaN, 0, -1, 0.01]) {
      const fake = source('paid', cost)
      const result = await invoke(
        PAYLOAD,
        { format: 'muse' },
        hookDeps(fake.value),
        command('ask', ['--model', 'chosen', '--budget-usd', '1']).options,
      )
      expect(result.code).toBe(0)
      expect(result.output()).toBe('')
      expect(fake.judge).not.toHaveBeenCalled()
    }
  })
  it('routes every paid attempt through admission and honors daily-budget and consent refusals', async () => {
    const fake = source('paid', 0.01)
    for (const outcome of [
      riskOutcome(),
      { outcome: 'no-answer', reason: 'over-budget' },
      { outcome: 'no-answer', reason: 'consent-needed' },
    ] as const) {
      const admitPaid = vi.fn(() => Promise.resolve(outcome))
      const result = await invoke(
        PAYLOAD,
        { format: 'muse' },
        { ...hookDeps(fake.value), admitPaid },
        command('ask', ['--model', 'chosen', '--budget-usd', '1']).options,
      )
      expect(result.code).toBe(0)
      expect(result.output()).toBe(
        outcome.outcome === 'answered'
          ? `${JSON.stringify({ systemMessage: CAUTION, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: CAUTION } })}\n`
          : '',
      )
      expect(admitPaid).toHaveBeenCalledWith(
        fake.value,
        expect.objectContaining({ questions: { risk: expect.any(Object) } }),
        0.01,
        expect.any(AbortSignal),
      )
      expect(fake.judge).not.toHaveBeenCalled()
    }
  })
  it('preserves explicit separate/both source choices through G resolution without adopting the payload model', async () => {
    for (const kind of ['separate', 'both'] as const) {
      const fake = source()
      const outcome = riskOutcome()
      if (outcome.outcome !== 'answered') throw new Error('fixture')
      const meta = outcome.result.muse['risk']
      if (meta === undefined) throw new Error('fixture')
      fake.judge.mockResolvedValue({
        ...outcome,
        result: { ...outcome.result, muse: { risk: { ...meta, source: kind } } },
      })
      const resolveSource = vi.fn(() => Promise.resolve({ ...fake.value, source: kind }))
      const result = await invoke(
        PAYLOAD,
        { format: 'muse' },
        { ...hookDeps(), resolveSource },
        command('ask', ['--model', 'chosen', '--engine', kind, '--separate', 'configured-source'])
          .options,
      )
      expect(result.code).toBe(0)
      expect(resolveSource).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'chosen', engine: kind, separate: 'configured-source' }),
        expect.any(AbortSignal),
      )
    }
  })
  it('validates an injected engine result and its model/id/type before native output', async () => {
    for (const invalid of [
      { outcome: 'answered', result: {} },
      { outcome: 'answered', result: { model: 'guessed', answers: {}, muse: {}, usage: {} } },
      null,
    ]) {
      const fake = source()
      // Simulate a malformed result crossing the runtime boundary without a cast.
      Reflect.set(fake.value.runtime, 'judge', () => Promise.resolve(invalid))
      const result = await invoke(PAYLOAD, { format: 'muse' }, hookDeps(fake.value))
      expect(result.code).toBe(0)
      expect(result.output()).toBe('')
    }
  })
  it('keeps private provider failures out of stdout and stderr', async () => {
    const fake = source()
    fake.judge.mockRejectedValue(new Error('private provider state and account'))
    const result = await invoke(PAYLOAD, { format: 'muse' }, hookDeps(fake.value))
    expect(result.code).toBe(0)
    expect(result.output() + result.error()).toBe('')
  })
  it('bounds stalled stdin and destroys it without invoking a source', async () => {
    const stdin = new PassThrough()
    const streams = { stdin, stdout: writer().value, stderr: writer().value }
    const deps = hookDeps()
    expect(
      await runJudgeHookCommand(
        command('ask', ['--model', 'chosen', '--timeout-ms', '20']).options,
        { format: 'muse' },
        streams,
        deps,
      ),
    ).toBe(0)
    expect(stdin.destroyed).toBe(true)
    expect(deps.resolveSource).not.toHaveBeenCalled()
  })
  it('counts stdin time against the same execution deadline', async () => {
    const stdin = new PassThrough()
    const streams = { stdin, stdout: writer().value, stderr: writer().value }
    const fake = source()
    let hasCompleted = false
    fake.judge.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            hasCompleted = true
            resolve(riskOutcome())
          }, 100)
        }),
    )
    const timer = setTimeout(() => stdin.end(JSON.stringify(PAYLOAD)), 100)
    try {
      expect(
        await runJudgeHookCommand(
          command('ask', ['--model', 'chosen', '--timeout-ms', '150']).options,
          { format: 'muse' },
          streams,
          hookDeps(fake.value),
        ),
      ).toBe(0)
      expect(fake.judge).toHaveBeenCalledOnce()
      expect(hasCompleted).toBe(false)
    } finally {
      clearTimeout(timer)
    }
  })
  it('rejects an oversized open input before waiting for EOF or resolving a source', async () => {
    const stdin = new PassThrough()
    const streams = { stdin, stdout: writer().value, stderr: writer().value }
    const deps = hookDeps()
    stdin.write(JSON.stringify({ ...PAYLOAD, extra: 'x'.repeat(JUDGE_MAX_BODY_BYTES) }))
    expect(
      await runJudgeHookCommand(
        command('ask', ['--model', 'chosen', '--timeout-ms', '20']).options,
        { format: 'muse' },
        streams,
        deps,
      ),
    ).toBe(2)
    expect(deps.resolveSource).not.toHaveBeenCalled()
    expect(stdin.destroyed).toBe(true)
  })
  it('uses one deadline across stdin, initialization and an engine that ignores abort; late output is dropped', async () => {
    const deferred = Promise.withResolvers<ReturnType<typeof riskOutcome>>()
    const fake = source()
    fake.judge.mockReturnValue(deferred.promise)
    const result = await invoke(
      PAYLOAD,
      { format: 'muse' },
      hookDeps(fake.value),
      command('ask', ['--model', 'chosen', '--timeout-ms', '20']).options,
    )
    expect(result.code).toBe(0)
    expect(result.output()).toBe('')
    deferred.resolve(riskOutcome())
    await Promise.resolve()
    expect(result.output()).toBe('')
    const initialize = vi.fn(
      () =>
        new Promise<void>(() => {
          /* Deliberately stuck test dependency. */
        }),
    )
    const deps = { ...hookDeps(), initialize }
    const stuck = await invoke(
      PAYLOAD,
      { format: 'muse' },
      deps,
      command('ask', ['--model', 'chosen', '--timeout-ms', '20']).options,
    )
    expect(stuck.code).toBe(0)
    expect(deps.resolveSource).not.toHaveBeenCalled()
  })
  it('honors parent cancellation before dispatch and during admission without leaking the reason', async () => {
    const stopped = new AbortController()
    stopped.abort(new Error('private abort reason'))
    const deps = hookDeps()
    const result = await invoke(
      PAYLOAD,
      { format: 'muse' },
      deps,
      command().options,
      stopped.signal,
    )
    expect(result.code).toBe(0)
    expect(deps.resolveSource).not.toHaveBeenCalled()
    expect(result.output() + result.error()).not.toContain('private')
    const pending = new AbortController()
    const fake = source('paid', 0.01)
    const admitPaid = vi.fn(() => {
      pending.abort(new Error('private modal reason'))
      return Promise.resolve(riskOutcome())
    })
    const paid = await invoke(
      PAYLOAD,
      { format: 'muse' },
      { ...hookDeps(fake.value), admitPaid },
      command('ask', ['--model', 'chosen', '--budget-usd', '1']).options,
      pending.signal,
    )
    expect(paid.code).toBe(0)
    expect(paid.output()).toBe('')
    expect(paid.error()).not.toContain('private')
  })
  it('abstains on closed pipes before dispatch and stalled delivery', async () => {
    for (const closed of ['stdout', 'stderr'] as const) {
      const deps = hookDeps()
      const cautionText = vi.fn(() => CAUTION)
      const streams = io(JSON.stringify(PAYLOAD))
      streams[closed] = writer(true, true).value
      expect(
        await runJudgeHookCommand(command().options, { format: 'muse' }, streams, {
          ...deps,
          cautionText,
        }),
      ).toBe(0)
      expect(deps.resolveSource).not.toHaveBeenCalled()
      expect(streams.stdin.destroyed).toBe(true)
      expect(cautionText).not.toHaveBeenCalled()
    }
    const streams = io(JSON.stringify(PAYLOAD))
    streams.stdout = writer(false).value
    expect(
      await runJudgeHookCommand(command().options, { format: 'muse' }, streams, hookDeps()),
    ).toBe(0)
  })
  it('does not deliver a result to a pipe closed while the source was resolving', async () => {
    const streams = io(JSON.stringify(PAYLOAD))
    let isClosed = false
    Object.defineProperty(streams.stdout, 'isClosed', { get: () => isClosed })
    const fake = source()
    fake.judge.mockResolvedValue(riskOutcome())
    const resolveSource = vi.fn((): Promise<JudgeCliSource> => {
      isClosed = true
      return Promise.resolve(fake.value)
    })
    expect(
      await runJudgeHookCommand(command().options, { format: 'muse' }, streams, {
        ...hookDeps(),
        resolveSource,
      }),
    ).toBe(0)
    expect(streams.output()).toBe('')
  })
})

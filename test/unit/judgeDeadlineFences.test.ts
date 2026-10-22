import { describe, expect, it } from 'vitest'
import { JudgeEntryStore } from '../../src/core/judge/entries'
import {
  canStartJudgeAtFence,
  readJudgeAtDeadline,
  type JudgeFenceEvidence,
} from '../../src/core/judge/uses/fences'
import { useAction } from './helpers/judgeUsesFixture'

const evidence: JudgeFenceEvidence = {
  kind: 'captured-pre-execution',
  receipt: 'fixture-m91',
  pairedM75Receipt: 'fixture-m75',
  deadlineMs: 50,
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function setup() {
  const store = new JudgeEntryStore()
  const handle = store.start(useAction())
  const stop = new AbortController()
  let isCurrent = true
  const result = Promise.withResolvers<'caution' | 'none' | 'failed'>()
  const signals: AbortSignal[] = []
  const run = (signal: AbortSignal) => {
    signals.push(signal)
    return result.promise
  }
  const deps = { evidence, signal: stop.signal, isCurrent: () => isCurrent, run }
  return {
    store,
    handle,
    stop,
    signals,
    deps,
    resolve: result.resolve,
    replace: () => {
      isCurrent = false
    },
  }
}

async function expectNoDispatch(t: ReturnType<typeof setup>): Promise<void> {
  const result = readJudgeAtDeadline(t.store, t.handle, t.deps)
  expect(t.signals).toHaveLength(0)
  expect(await result).toBeUndefined()
  expect(t.store.size).toBe(0)
}

describe('phase-2 pre-execution fence admission', () => {
  it('leaves immediate and native allows unjudged and uncharged without certified fences', async () => {
    for (const position of ['immediate', 'native'] as const) {
      expect(canStartJudgeAtFence(position, undefined)).toBe(false)
      expect(canStartJudgeAtFence(position, evidence)).toBe(true)
    }
    expect(canStartJudgeAtFence('reviewer-held', undefined)).toBe(true)
    expect(canStartJudgeAtFence('card-held', undefined)).toBe(true)
    const t = setup()
    expect(
      await readJudgeAtDeadline(t.store, t.handle, { ...t.deps, evidence: undefined }),
    ).toBeUndefined()
    expect(t.signals).toHaveLength(0)
    expect(t.store.size).toBe(0)
  })

  it('requires capture/measurement, paired evidence and a valid bounded deadline', () => {
    for (const invalid of [
      { ...evidence, receipt: ' ' },
      { ...evidence, pairedM75Receipt: ' ' },
      ...[0, -1, 0.5, NaN, Infinity, 60_001].map((deadlineMs) => ({ ...evidence, deadlineMs })),
    ]) {
      expect(canStartJudgeAtFence('immediate', invalid)).toBe(false)
    }
    expect(
      canStartJudgeAtFence('native', {
        ...evidence,
        kind: 'measured-deadline',
        deadlineMs: 60_000,
      }),
    ).toBe(true)
  })
})

describe('hard deadline and exact generation', () => {
  it('reads a timely caution once', async () => {
    const t = setup()
    const running = readJudgeAtDeadline(t.store, t.handle, t.deps)
    t.resolve('caution')
    expect(await running).toBe('caution')
    expect(t.store.size).toBe(0)
    expect(t.store.readLatch(t.handle)).toBeUndefined()
  })

  it('enforces the hard deadline when a source never resolves or ignores cancellation', async () => {
    const t = setup()
    const running = readJudgeAtDeadline(t.store, t.handle, t.deps)
    let hasEnded = false
    void running.then(() => {
      hasEnded = true
    })
    await sleep(40)
    expect(hasEnded).toBe(false)
    await sleep(30)
    expect(hasEnded).toBe(true)
    expect(t.store.size).toBe(0)
    expect(await running).toBeUndefined()
    expect(t.signals[0]?.aborted).toBe(true)
    const replacement = t.store.start(useAction())
    t.resolve('caution')
    await Promise.resolve()
    expect(t.store.readLatch(replacement)).toBeUndefined()
  })

  it('refuses a result that arrives after the deadline fired', async () => {
    const t = setup()
    const running = readJudgeAtDeadline(t.store, t.handle, t.deps)
    await sleep(70)
    t.resolve('caution')
    expect(await running).toBeUndefined()
  })

  it('cancels before dispatch and while held without waiting for the source', async () => {
    const before = setup()
    before.stop.abort()
    await expectNoDispatch(before)
    const t = setup()
    const running = readJudgeAtDeadline(t.store, t.handle, t.deps)
    t.stop.abort()
    expect(t.signals[0]?.aborted).toBe(true)
    expect(await running).toBeUndefined()
    expect(t.store.size).toBe(0)
    t.resolve('caution')
    await Promise.resolve()
  })

  it('checks action/owner/policy binding before and after the wait', async () => {
    const before = setup()
    before.replace()
    await expectNoDispatch(before)
    const t = setup()
    const running = readJudgeAtDeadline(t.store, t.handle, t.deps)
    t.replace()
    t.resolve('caution')
    expect(await running).toBeUndefined()
  })

  it('cannot resurrect a discarded generation when the identical action restarts', async () => {
    const t = setup()
    const running = readJudgeAtDeadline(t.store, t.handle, t.deps)
    t.store.discard(t.handle)
    const next = t.store.start(useAction())
    expect(next.key).toBe(t.handle.key)
    t.resolve('caution')
    expect(await running).toBeUndefined()
    expect(t.store.settle(next, 'caution')).toBe(true)
    expect(t.store.readLatch(next)).toBe('caution')
  })

  it.each(['backend', 'sessionId', 'turnId', 'tool', 'args'] as const)(
    'keeps changed %s actions separate',
    async (field) => {
      const t = setup()
      const running = readJudgeAtDeadline(t.store, t.handle, t.deps)
      t.store.discard(t.handle)
      const next = t.store.start(useAction({ [field]: 'changed' }))
      expect(next.key).not.toBe(t.handle.key)
      t.resolve('none')
      expect(await running).toBeUndefined()
      expect(t.store.settle(next, 'caution')).toBe(true)
      expect(t.store.readLatch(next)).toBe('caution')
    },
  )

  it('missing or malformed injected signals never become a verdict', async () => {
    const t = setup()
    for (const output of [undefined, null, true, 'ALLOW', { decision: 'allow' }]) {
      const handle = t.store.start(useAction())
      expect(
        await readJudgeAtDeadline(t.store, handle, {
          ...t.deps,
          run: () => Promise.resolve(output),
        }),
      ).toBeUndefined()
      expect(t.store.size).toBe(0)
    }
  })

  it('treats failed, rejected and synchronously throwing sources as no opinion', async () => {
    const t = setup()
    const running = readJudgeAtDeadline(t.store, t.handle, t.deps)
    t.resolve('failed')
    expect(await running).toBeUndefined()
    for (const run of [
      () => Promise.reject(new Error('fixture failure')),
      () => {
        throw new Error('fixture failure')
      },
    ]) {
      const handle = t.store.start(useAction())
      expect(await readJudgeAtDeadline(t.store, handle, { ...t.deps, run })).toBeUndefined()
      expect(t.store.size).toBe(0)
    }
  })
})

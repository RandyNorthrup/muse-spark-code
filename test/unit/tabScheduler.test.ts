import { describe, expect, it } from 'vitest'
import { TAB_DEBOUNCE_MS } from '../../src/shared/constants'
import { TabScheduler, type TabScheduledWork } from '../../src/core/tab/tabScheduler'

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function workOf(hooks: {
  runMs?: number
  isCancelled?: () => boolean
  fail?: Error
}): TabScheduledWork & {
  finished: () => Promise<void>
  isStarted: () => boolean
  reported: () => unknown
} {
  let hasStarted = false
  let reported: unknown
  let finish: Promise<void> = Promise.resolve()
  return {
    finished: () => finish,
    isStarted: () => hasStarted,
    reported: () => reported,
    token: {
      get cancelled(): boolean {
        return hooks.isCancelled?.() ?? false
      },
    },
    run: () => {
      hasStarted = true
      finish = hooks.fail === undefined ? sleep(hooks.runMs ?? 0) : Promise.reject(hooks.fail)
      return finish
    },
    report: (error: unknown) => {
      reported = error
    },
  }
}

describe('TabScheduler (M94 acceptance 7 and 9, real timers)', () => {
  it('waits out the debounce for Automatic and fires Invoke at once', async () => {
    const scheduler = new TabScheduler()
    const automatic = workOf({})
    scheduler.trigger(automatic)
    expect(automatic.isStarted()).toBe(false)
    expect(scheduler.hasPending).toBe(true)
    await sleep(TAB_DEBOUNCE_MS + 100)
    expect(automatic.isStarted()).toBe(true)
    await automatic.finished()
    expect(scheduler.hasPending).toBe(false)

    const invoked = workOf({})
    scheduler.trigger(invoked, { immediate: true })
    expect(invoked.isStarted()).toBe(true)
    await invoked.finished()
    expect(scheduler.hasPending).toBe(false)
  })

  it('replaces a waiting trigger, which is then never sent', async () => {
    const scheduler = new TabScheduler()
    const first = workOf({})
    const second = workOf({})
    scheduler.trigger(first)
    scheduler.trigger(second)
    await sleep(TAB_DEBOUNCE_MS + 100)
    expect(first.isStarted()).toBe(false)
    expect(second.isStarted()).toBe(true)
    await second.finished()
  })

  it('sends nothing for a token cancelled before the send', async () => {
    const scheduler = new TabScheduler()
    let isCancelled = false
    const work = workOf({ isCancelled: () => isCancelled })
    scheduler.trigger(work)
    isCancelled = true
    await sleep(TAB_DEBOUNCE_MS + 100)
    expect(work.isStarted()).toBe(false)
    expect(scheduler.hasPending).toBe(false)
  })

  it('runs sent work to its end even when its token is cancelled (never aborts)', async () => {
    const scheduler = new TabScheduler()
    let isCancelled = false
    const work = workOf({ runMs: 200, isCancelled: () => isCancelled })
    scheduler.trigger(work, { immediate: true })
    expect(work.isStarted()).toBe(true)
    isCancelled = true
    // The cancellation mid-run changes nothing: the work still finishes.
    await work.finished()
  })

  it('sends ready work at once with no count of ours', async () => {
    const scheduler = new TabScheduler()
    const works = [workOf({ runMs: 200 }), workOf({ runMs: 200 }), workOf({ runMs: 200 })]
    for (const work of works) {
      scheduler.trigger(work, { immediate: true })
    }
    // Every trigger started while the others were still running: nothing
    // parked for a slot or a per-minute count.
    for (const work of works) {
      expect(work.isStarted()).toBe(true)
    }
    for (const work of works) {
      await work.finished()
    }
  })

  it('reports a crashing run through the work channel instead of hanging', async () => {
    const scheduler = new TabScheduler()
    const failure = new Error('run crashed')
    const work = workOf({ fail: failure })
    scheduler.trigger(work, { immediate: true })
    expect(work.isStarted()).toBe(true)
    await expect.poll(() => work.reported()).toBe(failure)
  })

  it('drops a waiting trigger on cancelPending and leaves a sent request running', async () => {
    const scheduler = new TabScheduler()
    const sent = workOf({ runMs: 100 })
    scheduler.trigger(sent, { immediate: true })
    const waiting = workOf({})
    scheduler.trigger(waiting)
    expect(scheduler.hasPending).toBe(true)
    scheduler.cancelPending()
    expect(scheduler.hasPending).toBe(false)
    await sleep(TAB_DEBOUNCE_MS + 100)
    expect(waiting.isStarted()).toBe(false)
    await sent.finished()
  })
})

import { describe, expect, it } from 'vitest'
import { REPORT_KINDS } from '../../src/shared/constants'
import { REPORT_KIND_REGISTRY } from '../../src/core/reporting/registry'
import { EN } from '../../src/shared/l10n/en'
import {
  reportAdmissionStep,
  type ReportAdmissionState,
} from '../../src/core/reporting/sources/admission'
import { LocalSourceError, localSource } from '../../src/core/reporting/sources/local'
import type { SourceReadContext } from '../../src/core/reporting/sources/types'
import { reportOptions } from './helpers/reporting/kindFixtures'

function contextFor(kind: (typeof REPORT_KINDS)[number], signal: AbortSignal): SourceReadContext {
  return {
    reportText: EN,
    locale: 'en',
    options: reportOptions(kind),
    asOf: '2026-10-06T12:00:00Z',
    workspaceKey: 'fixture',
    signal,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe.each(REPORT_KINDS)('%s cancellation', (kind) => {
  // Ports are per source, kinds per report: exercise each kind through its
  // own first registry source, which is the port the engine hands the
  // caller's signal for that kind.
  const source = REPORT_KIND_REGISTRY[kind].sources[0]
  it('never starts a read past an abort', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const port = localSource(source, () => {
      calls += 1
      return Promise.reject(new LocalSourceError('failed'))
    })
    const result = await port.read(contextFor(kind, controller.signal))
    expect(calls).toBe(0)
    expect(result.data).toBeNull()
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(EN.reportSourceReasons.cancelled)
  })

  it('counts no resource call after the abort', async () => {
    const controller = new AbortController()
    let calls = 0
    let atAbort = -1
    controller.signal.addEventListener(
      'abort',
      () => {
        atAbort = calls
      },
      { once: true },
    )
    const port = localSource(source, async ({ signal }) => {
      while (!signal.aborted) {
        calls += 1
        await sleep(5)
      }
      const frozen = calls
      await sleep(25)
      // The read below settles only after this point; a raced abandonment
      // would report before the freeze below is observed.
      if (calls !== frozen) throw new Error('source acted after abort')
      throw new LocalSourceError('cancelled')
    })
    setTimeout(() => {
      controller.abort()
    }, 30)
    const result = await port.read(contextFor(kind, controller.signal))
    expect(atAbort).toBeGreaterThanOrEqual(0)
    expect(calls).toBe(atAbort)
    expect(result.data).toBeNull()
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(EN.reportSourceReasons.cancelled)
  })

  it('awaits the read past the abort instead of abandoning it', async () => {
    const controller = new AbortController()
    let hasSettled = false
    const port = localSource(source, async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        )
      })
      // Post-abort settlement the engine waits for; a raced abandonment
      // would report before this line runs.
      await sleep(30)
      hasSettled = true
      throw new LocalSourceError('cancelled')
    })
    setTimeout(() => {
      controller.abort()
    }, 10)
    const result = await port.read(contextFor(kind, controller.signal))
    expect(hasSettled).toBe(true)
    expect(result.data).toBeNull()
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(EN.reportSourceReasons.cancelled)
  })

  it('reports a held resource as busy, not cancelled', async () => {
    const port = localSource(source, () => Promise.reject(new LocalSourceError('busy')))
    const result = await port.read(contextFor(kind, new AbortController().signal))
    expect(result.data).toBeNull()
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(EN.teamHostBusy)
  })
})

// The engine hands no deadline (D121/D208); one a caller hands in still binds.
it('honors a deadline the caller hands in', async () => {
  const started = Date.now()
  const port = localSource('session', async ({ signal }) => {
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new LocalSourceError('cancelled'))
        },
        { once: true },
      )
    })
    throw new LocalSourceError('cancelled')
  })
  const result = await port.read({
    ...contextFor('session', new AbortController().signal),
    deadline: Date.now() + 40,
  })
  expect(result.record.status).toBe('unavailable')
  expect(result.record.reason).toBe(EN.reportSourceReasons.cancelled)
  expect(Date.now() - started).toBeLessThan(5000)
})

describe('admission queue', () => {
  it('repeated refreshes leave no waiting readers behind', () => {
    interface Generation {
      readonly id: number
    }
    const empty: ReportAdmissionState<Generation> = {
      current: null,
      waiting: [],
      limitedUntil: null,
    }
    let state = empty
    for (let round = 0; round < 3; round += 1) {
      const owner: Generation = { id: round * 2 }
      const waiter: Generation = { id: round * 2 + 1 }
      state = reportAdmissionStep(state, { type: 'requested', generation: owner }).state
      state = reportAdmissionStep(state, { type: 'requested', generation: waiter }).state
      expect(state.waiting).toHaveLength(1)
      state = reportAdmissionStep(state, { type: 'aborted', generation: waiter }).state
      expect(state.waiting).toHaveLength(0)
      state = reportAdmissionStep(state, { type: 'aborted', generation: owner }).state
      state = reportAdmissionStep(state, { type: 'released', generation: owner }).state
      expect(state).toEqual(empty)
    }
  })
})

// RVREPORTJOIN P2-3: cancellation stops work. The signal goes through
// every step of the real reader factories (session, accounts, usage), is
// checked before each next read, a deadline aborts and its cancellation
// returns at once (RLTESTDRIVE item 9: no settle grace of ours waits it
// out), and an already-expired deadline starts nothing. Every case below
// drives the real factories and localSource with counters, never a
// fabricated reader.
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { localSource } from '../../src/core/reporting/sources/local'
import { sessionSource } from '../../src/core/reporting/sources/session'
import { accountsSource } from '../../src/core/reporting/sources/accounts'
import {
  createAccountsReportReader,
  createSessionReportReader,
} from '../../src/runtime/reporting/reportInputs'
import type { SourceReadContext } from '../../src/core/reporting/sources/types'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/kindFixtures'

const scrub = (text: string) => text

function contextFor(
  kind: Parameters<typeof reportOptions>[0],
  signal: AbortSignal,
  deadline?: number,
): SourceReadContext {
  return {
    reportText: EN,
    locale: 'en',
    asOf: REPORT_FIXTURE_AS_OF,
    workspaceKey: 'workspace',
    options: reportOptions(kind),
    signal,
    ...(deadline !== undefined && { deadline }),
  }
}

/** A cancelled port holds no data and names the cancelled reason. */
function expectCancelledResult(result: {
  data: unknown
  record: { status: string; reason?: string | null }
}): void {
  expect(result.data).toBeNull()
  expect(result.record.status).toBe('unavailable')
  if (result.record.status !== 'unavailable') throw new Error('Expected no data')
  expect(result.record.reason).toContain(EN.reportSourceReasons.cancelled)
}

/** Resolves once the owner's signal aborts. */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) resolve()
    else
      signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
  })
}

describe('production reads stop on cancellation', () => {
  it('session never reads the journal after its resolve settles past an abort', async () => {
    const controller = new AbortController()
    let resolveCalls = 0
    let journalCalls = 0
    const reader = createSessionReportReader({
      resolveSession: async () => {
        resolveCalls += 1
        await aborted(controller.signal)
        return { sessionId: 's', backend: 'modelApi', modelId: 'm', items: [], turnIds: [] }
      },
      readJournal: () => {
        journalCalls += 1
        return Promise.resolve({ records: [], rollups: [], limits: [] })
      },
    })
    const pending = sessionSource(reader, [], scrub).read(contextFor('session', controller.signal))
    await vi.waitFor(() => {
      expect(resolveCalls).toBe(1)
    })
    controller.abort()
    const result = await pending
    expect(resolveCalls).toBe(1)
    expect(journalCalls).toBe(0)
    expectCancelledResult(result)
  })

  it('an already-aborted session starts neither resolve nor journal', async () => {
    const controller = new AbortController()
    controller.abort()
    let resolveCalls = 0
    let journalCalls = 0
    const reader = createSessionReportReader({
      resolveSession: () => {
        resolveCalls += 1
        return Promise.resolve(null)
      },
      readJournal: () => {
        journalCalls += 1
        return Promise.resolve({ records: [], rollups: [], limits: [] })
      },
    })
    await expect(reader.read(contextFor('session', controller.signal))).rejects.toThrow()
    expect(resolveCalls).toBe(0)
    expect(journalCalls).toBe(0)
  })

  it('accounts never read events after usage settles past an abort', async () => {
    const controller = new AbortController()
    let usageCalls = 0
    let eventsCalls = 0
    const reader = createAccountsReportReader({
      dataDir: '/nonexistent-registry-folder',
      readUsage: async () => {
        usageCalls += 1
        await aborted(controller.signal)
        return undefined
      },
      readEvents: () => {
        eventsCalls += 1
        return Promise.resolve({ events: [], confirmations: [] })
      },
    })
    const pending = accountsSource(reader, scrub).read(contextFor('accounts', controller.signal))
    await vi.waitFor(() => {
      expect(usageCalls).toBe(1)
    })
    controller.abort()
    const result = await pending
    expect(usageCalls).toBe(1)
    expect(eventsCalls).toBe(0)
    expectCancelledResult(result)
  })

  it('an already-aborted accounts read starts no sub-source', async () => {
    const controller = new AbortController()
    controller.abort()
    let usageCalls = 0
    let eventsCalls = 0
    const reader = createAccountsReportReader({
      dataDir: '/nonexistent-registry-folder',
      readUsage: () => {
        usageCalls += 1
        return Promise.resolve(undefined)
      },
      readEvents: () => {
        eventsCalls += 1
        return Promise.resolve({ events: [], confirmations: [] })
      },
    })
    await expect(reader.read(contextFor('accounts', controller.signal))).rejects.toThrow()
    expect(usageCalls).toBe(0)
    expect(eventsCalls).toBe(0)
  })

  it('an already-expired deadline starts no reader', async () => {
    let calls = 0
    const port = localSource('questions', () => {
      calls += 1
      return Promise.resolve({ data: [] })
    })
    const result = await port.read(
      contextFor('project', new AbortController().signal, Date.now() - 1000),
    )
    expect(calls).toBe(0)
    expectCancelledResult(result)
  })

  it('a deadline returns cancellation without waiting out the reader', async () => {
    let isSettled = false
    const port = localSource('questions', async ({ signal }) => {
      await aborted(signal)
      await new Promise((resolve) => setTimeout(resolve, 500))
      isSettled = true
      return { data: [] }
    })
    const result = await port.read(
      contextFor('project', new AbortController().signal, Date.now() + 30),
    )
    expect(isSettled).toBe(false)
    expectCancelledResult(result)
  })

  it('a wedged reader cannot hold cancellation past the deadline', async () => {
    const neverSettles = aborted(new AbortController().signal)
    const port = localSource('questions', async () => {
      await neverSettles
      return { data: [] }
    })
    const startedAt = Date.now()
    const result = await port.read(
      contextFor('project', new AbortController().signal, Date.now() + 30),
    )
    // Cancellation returns at the ~30 ms handed deadline; 800 ms leaves a
    // loaded rig 25x headroom while still catching any grace-length wait.
    expect(Date.now() - startedAt).toBeLessThan(800)
    expectCancelledResult(result)
  })
})

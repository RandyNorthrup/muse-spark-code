// M125 lane F1b: the hold's race. The reviewer starts as today with
// the veto question and B1's run beside it; the skip wins only on a
// non-veto inside the window and B1's delivered output, both before
// the reviewer's verdict. Ports are deferred by real short delays
// (no fake timers); windows are parameters, small here, 5 s in use.
import { describe, expect, it } from 'vitest'
import {
  raceApproval,
  readVetoFence,
  type ApprovalRacePorts,
  type VetoAnswer,
  type VetoFenceReader,
} from '../../src/core/judge/fast/approval'
import type { InspectResult } from '../../src/core/judge/fast/inspectExec'

const OUTPUT: InspectResult = {
  kind: 'output',
  stdout: 'allowed\n',
  stderr: '',
  exitCode: 0,
  excluded: 2,
}
const REFUSED: InspectResult = { kind: 'refused', reason: 'confinement' }

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

interface Schedule {
  readonly vetoAfterMs: number
  readonly veto?: VetoAnswer
  readonly vetoThrows?: boolean
  readonly inspectAfterMs: number
  readonly inspect?: InspectResult
  readonly reviewerAfterMs: number
  readonly reviewer?: string
  readonly reviewerThrows?: Error
}

function scheduledPorts(schedule: Schedule): {
  ports: ApprovalRacePorts<string>
  signals: { reviewer: AbortSignal; veto: AbortSignal; inspect: AbortSignal }
} {
  const signals: { reviewer?: AbortSignal; veto?: AbortSignal; inspect?: AbortSignal } = {}
  return {
    ports: {
      startReviewer: async (signal) => {
        signals.reviewer = signal
        await delay(schedule.reviewerAfterMs)
        signal.throwIfAborted()
        if (schedule.reviewerThrows !== undefined) throw schedule.reviewerThrows
        return schedule.reviewer ?? 'reviewer-verdict'
      },
      askVeto: async (signal) => {
        signals.veto = signal
        await delay(schedule.vetoAfterMs)
        signal.throwIfAborted()
        if (schedule.vetoThrows === true) throw new Error('veto engine failed')
        return schedule.veto ?? { veto: false }
      },
      runInspect: async (signal) => {
        signals.inspect = signal
        await delay(schedule.inspectAfterMs)
        signal.throwIfAborted()
        return schedule.inspect ?? OUTPUT
      },
    },
    // The ports fill every signal when the race starts them; the cast names the running set.
    signals: signals as { reviewer: AbortSignal; veto: AbortSignal; inspect: AbortSignal },
  }
}

/** The skip the race returns for B1's delivered OUTPUT, with any extra fields. */
const expectedSkip = (extra: Record<string, unknown> = {}) => ({
  kind: 'skip',
  stdout: 'allowed\n',
  stderr: '',
  exitCode: 0,
  excluded: 2,
  vetoLatencyMs: expect.any(Number),
  ...extra,
})

/** Races the schedule over the window onto today's path with the default verdict. */
async function expectReviewerPath(
  schedule: Schedule,
  windowMs: number,
): Promise<{ reviewer: AbortSignal; veto: AbortSignal; inspect: AbortSignal }> {
  const { ports, signals } = scheduledPorts(schedule)
  const outcome = await raceApproval(ports, windowMs)
  expect(outcome).toEqual({ kind: 'reviewer', verdict: 'reviewer-verdict' })
  return signals
}

describe("the hold's race", () => {
  it('skips on a non-veto and B1 output before the reviewer, and cancels it', async () => {
    const { ports, signals } = scheduledPorts({
      vetoAfterMs: 10,
      inspectAfterMs: 20,
      reviewerAfterMs: 500,
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome).toEqual(expectedSkip())
    if (outcome.kind === 'skip') {
      expect(outcome.vetoLatencyMs).toBeGreaterThanOrEqual(0)
      expect(outcome.vetoLatencyMs).toBeLessThan(100)
    }
    await delay(20)
    expect(signals.reviewer.aborted).toBe(true)
  })

  it("runs today's path when the reviewer's verdict comes first", async () => {
    const { ports, signals } = scheduledPorts({
      vetoAfterMs: 200,
      inspectAfterMs: 200,
      reviewerAfterMs: 10,
      reviewer: 'allow-it',
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome).toEqual({ kind: 'reviewer', verdict: 'allow-it' })
    expect(signals.veto.aborted).toBe(true)
    expect(signals.inspect.aborted).toBe(true)
  })

  it("runs today's path on a veto, discarding the run", async () => {
    const signals = await expectReviewerPath(
      { vetoAfterMs: 10, veto: { veto: true }, inspectAfterMs: 200, reviewerAfterMs: 50 },
      100,
    )
    expect(signals.inspect.aborted).toBe(true)
  })

  it('treats a closed window as a veto', async () => {
    const signals = await expectReviewerPath(
      { vetoAfterMs: 500, inspectAfterMs: 500, reviewerAfterMs: 80 },
      40,
    )
    expect(signals.veto.aborted).toBe(true)
    expect(signals.inspect.aborted).toBe(true)
  })

  it('does not let a late non-veto win even with B1 delivered', async () => {
    await expectReviewerPath(
      { vetoAfterMs: 80, veto: { veto: false }, inspectAfterMs: 10, reviewerAfterMs: 150 },
      40,
    )
  })

  it("runs today's path when B1 cannot deliver", async () => {
    await expectReviewerPath(
      { vetoAfterMs: 10, inspectAfterMs: 20, inspect: REFUSED, reviewerAfterMs: 60 },
      100,
    )
  })

  it('treats a thrown veto ask as no answer', async () => {
    await expectReviewerPath(
      { vetoAfterMs: 10, vetoThrows: true, inspectAfterMs: 200, reviewerAfterMs: 50 },
      100,
    )
  })

  it('lets a slow B1 lose to the reviewer', async () => {
    const signals = await expectReviewerPath(
      { vetoAfterMs: 10, inspectAfterMs: 300, reviewerAfterMs: 50 },
      100,
    )
    expect(signals.inspect.aborted).toBe(true)
  })

  it("propagates the reviewer's own failure on today's path", async () => {
    const failure = new Error('reviewer blew up')
    const { ports, signals } = scheduledPorts({
      vetoAfterMs: 10,
      veto: { veto: true },
      inspectAfterMs: 200,
      reviewerAfterMs: 20,
      reviewerThrows: failure,
    })
    await expect(raceApproval(ports, 100)).rejects.toBe(failure)
    expect(signals.inspect.aborted).toBe(true)
  })

  it('carries a veto pipeline detail through the skip for the audit', async () => {
    const { ports } = scheduledPorts({
      vetoAfterMs: 10,
      veto: { veto: false, detail: { engine: 'tev1', pYesMilli: 30, thresholdMilli: 800 } },
      inspectAfterMs: 20,
      reviewerAfterMs: 500,
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome).toEqual(
      expectedSkip({ detail: { engine: 'tev1', pYesMilli: 30, thresholdMilli: 800 } }),
    )
  })

  it('omits the detail a fence-read veto never carries', async () => {
    const { ports } = scheduledPorts({
      vetoAfterMs: 10,
      veto: { veto: false },
      inspectAfterMs: 20,
      reviewerAfterMs: 500,
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome.kind).toBe('skip')
    if (outcome.kind === 'skip') expect(outcome.detail).toBeUndefined()
  })
})

function fenceReader(reads: readonly ('caution' | 'none' | undefined)[]): VetoFenceReader {
  let index = 0
  return {
    read: () => {
      const outcome = reads[index] ?? reads.at(-1)
      index += 1
      return outcome
    },
  }
}

describe('veto fence read', () => {
  it('reads caution as a veto and a settled none as a non-veto', async () => {
    const controller = new AbortController()
    await expect(readVetoFence(fenceReader(['caution']), controller.signal, 5)).resolves.toEqual({
      veto: true,
    })
    await expect(readVetoFence(fenceReader(['none']), controller.signal, 5)).resolves.toEqual({
      veto: false,
    })
  })

  it('waits while the fence is unsettled', async () => {
    const controller = new AbortController()
    await expect(
      readVetoFence(fenceReader([undefined, undefined, 'none']), controller.signal, 5),
    ).resolves.toEqual({ veto: false })
  })

  it('throws on abort so the race discards the fast path', async () => {
    const controller = new AbortController()
    const read = readVetoFence(fenceReader([undefined]), controller.signal, 5)
    controller.abort()
    await expect(read).rejects.toThrow()
  })
})

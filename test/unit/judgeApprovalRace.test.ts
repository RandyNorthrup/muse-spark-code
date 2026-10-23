// M125 lane F1b: the hold's race. The reviewer starts as today with
// the veto question and B1's run beside it; the skip wins only on a
// non-veto inside the window and B1's delivered output, both before
// the reviewer's verdict. Ports are deferred by real short delays
// (no fake timers); windows are parameters, small here, 5 s in use.
import { describe, expect, it } from 'vitest'
import {
  raceApproval,
  type ApprovalRacePorts,
  type VetoAnswer,
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
    signals: signals as { reviewer: AbortSignal; veto: AbortSignal; inspect: AbortSignal },
  }
}

describe("the hold's race", () => {
  it('skips on a non-veto and B1 output before the reviewer, and cancels it', async () => {
    const { ports, signals } = scheduledPorts({
      vetoAfterMs: 10,
      inspectAfterMs: 20,
      reviewerAfterMs: 500,
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome).toEqual({
      kind: 'skip',
      stdout: 'allowed\n',
      stderr: '',
      exitCode: 0,
      excluded: 2,
      vetoLatencyMs: expect.any(Number),
    })
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
    const { ports, signals } = scheduledPorts({
      vetoAfterMs: 10,
      veto: { veto: true },
      inspectAfterMs: 200,
      reviewerAfterMs: 50,
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome).toEqual({ kind: 'reviewer', verdict: 'reviewer-verdict' })
    expect(signals.inspect.aborted).toBe(true)
  })

  it('treats a closed window as a veto', async () => {
    const { ports } = scheduledPorts({
      vetoAfterMs: 500,
      inspectAfterMs: 500,
      reviewerAfterMs: 80,
    })
    const outcome = await raceApproval(ports, 40)
    expect(outcome).toEqual({ kind: 'reviewer', verdict: 'reviewer-verdict' })
  })

  it('does not let a late non-veto win even with B1 delivered', async () => {
    const { ports } = scheduledPorts({
      vetoAfterMs: 80,
      veto: { veto: false },
      inspectAfterMs: 10,
      reviewerAfterMs: 150,
    })
    const outcome = await raceApproval(ports, 40)
    expect(outcome).toEqual({ kind: 'reviewer', verdict: 'reviewer-verdict' })
  })

  it("runs today's path when B1 cannot deliver", async () => {
    const { ports } = scheduledPorts({
      vetoAfterMs: 10,
      inspectAfterMs: 20,
      inspect: REFUSED,
      reviewerAfterMs: 60,
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome).toEqual({ kind: 'reviewer', verdict: 'reviewer-verdict' })
  })

  it('treats a thrown veto ask as no answer', async () => {
    const { ports } = scheduledPorts({
      vetoAfterMs: 10,
      vetoThrows: true,
      inspectAfterMs: 200,
      reviewerAfterMs: 50,
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome).toEqual({ kind: 'reviewer', verdict: 'reviewer-verdict' })
  })

  it('lets a slow B1 lose to the reviewer', async () => {
    const { ports, signals } = scheduledPorts({
      vetoAfterMs: 10,
      inspectAfterMs: 300,
      reviewerAfterMs: 50,
    })
    const outcome = await raceApproval(ports, 100)
    expect(outcome).toEqual({ kind: 'reviewer', verdict: 'reviewer-verdict' })
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
})

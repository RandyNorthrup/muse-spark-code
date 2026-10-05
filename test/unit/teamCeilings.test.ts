// Lane A ceilings (M96, PLAN.md D75): the computed ceiling is the lowest of
// the provider's limit, our hard ceiling and the machine's; a 429 halves the
// entry's running cap, and quiet intervals recover it step by step.

import { describe, expect, it } from 'vitest'
import { TEAM_THROTTLE_RECOVER_MS } from '../../src/shared/constants'
import {
  computeTeamCeiling,
  isLowRemainingHeader,
  metaTeamLimits,
  TeamThrottleTracker,
} from '../../src/core/team/teamCeilings'

describe('teamCeilings', () => {
  it('computes the Contributor ceiling from the documented limits: about 9 workers', () => {
    const { rpm, tpm } = metaTeamLimits('contributor')
    expect({ rpm, tpm }).toEqual({ rpm: 100, tpm: 3_000_000 })
    expect(
      computeTeamCeiling({
        kind: 'engine',
        providerRpm: rpm,
        providerTpm: tpm,
        workerRpm: undefined,
        workerTpm: undefined,
        machineLimit: 20,
      }),
    ).toBe(9)
  })

  it('computes the Standard ceiling from the documented limits: 12 workers', () => {
    const { rpm, tpm } = metaTeamLimits('standard')
    expect(
      computeTeamCeiling({
        kind: 'engine',
        providerRpm: rpm,
        providerTpm: tpm,
        workerRpm: undefined,
        workerTpm: undefined,
        machineLimit: 20,
      }),
    ).toBe(12)
  })

  it('takes the lowest of provider, hard and machine ceilings, never below 1', () => {
    const source = {
      kind: 'engine' as const,
      providerRpm: 3000,
      providerTpm: 4_000_000,
      workerRpm: undefined,
      workerTpm: undefined,
      machineLimit: 20,
    }
    expect(computeTeamCeiling(source)).toBe(12)
    // The machine binds first.
    expect(computeTeamCeiling({ ...source, machineLimit: 4 })).toBe(4)
    // Our hard ceiling binds a huge provider limit.
    expect(
      computeTeamCeiling({ ...source, providerRpm: 1_000_000, providerTpm: 1_000_000_000, machineLimit: 64 }),
    ).toBe(20)
    // A provider that documents nothing leaves 429s to decide: hard, then machine.
    expect(
      computeTeamCeiling({
        kind: 'engine',
        providerRpm: undefined,
        providerTpm: undefined,
        workerRpm: undefined,
        workerTpm: undefined,
        machineLimit: 20,
      }),
    ).toBe(20)
    expect(computeTeamCeiling({ ...source, machineLimit: 0 })).toBe(1)
  })

  it('ceilings are per agent kind: Muse Code sessions and external agents', () => {
    expect(
      computeTeamCeiling({
        kind: 'museCode',
        providerRpm: undefined,
        providerTpm: undefined,
        workerRpm: undefined,
        workerTpm: undefined,
        machineLimit: 20,
      }),
    ).toBe(4)
    expect(
      computeTeamCeiling({
        kind: 'external',
        providerRpm: undefined,
        providerTpm: undefined,
        workerRpm: undefined,
        workerTpm: undefined,
        machineLimit: 20,
      }),
    ).toBe(2)
    // The machine still binds below the kind's ceiling.
    expect(
      computeTeamCeiling({
        kind: 'external',
        providerRpm: undefined,
        providerTpm: undefined,
        workerRpm: undefined,
        workerTpm: undefined,
        machineLimit: 1,
      }),
    ).toBe(1)
  })

  it('a low remaining header halves like a 429: under 10% of the limit', () => {
    expect(isLowRemainingHeader(9, 100)).toBe(true)
    expect(isLowRemainingHeader(10, 100)).toBe(false)
    expect(isLowRemainingHeader(0, 0)).toBe(false)
  })

  it('halves the entry’s running cap on throttle, down to 1, then recovers one step per quiet interval', () => {
    let nowMs = 1_000_000
    const tracker = new TeamThrottleTracker(() => 8, TEAM_THROTTLE_RECOVER_MS, () => nowMs)
    expect(tracker.cap('eng-1')).toBe(8)
    expect(tracker.isThrottled('eng-1')).toBe(false)

    tracker.noteThrottle('eng-1')
    expect(tracker.cap('eng-1')).toBe(4)
    expect(tracker.isThrottled('eng-1')).toBe(true)
    tracker.noteThrottle('eng-1')
    expect(tracker.cap('eng-1')).toBe(2)
    tracker.noteThrottle('eng-1')
    tracker.noteThrottle('eng-1')
    expect(tracker.cap('eng-1')).toBe(1)

    // One quiet interval adds one back, up to the configured cap.
    nowMs += TEAM_THROTTLE_RECOVER_MS
    expect(tracker.cap('eng-1')).toBe(2)
    nowMs += TEAM_THROTTLE_RECOVER_MS * 10
    expect(tracker.cap('eng-1')).toBe(8)
    expect(tracker.isThrottled('eng-1')).toBe(false)

    // Another 429 restarts the quiet wait.
    tracker.noteThrottle('eng-1')
    expect(tracker.cap('eng-1')).toBe(4)
    nowMs += TEAM_THROTTLE_RECOVER_MS - 1
    expect(tracker.cap('eng-1')).toBe(4)
  })

  it('throttling is per entry: a sibling entry on the same agent keeps its cap', () => {
    let nowMs = 1_000_000
    const tracker = new TeamThrottleTracker(() => 8, TEAM_THROTTLE_RECOVER_MS, () => nowMs)
    tracker.noteThrottle('eng-1')
    expect(tracker.cap('eng-1')).toBe(4)
    expect(tracker.cap('eng-2')).toBe(8)
    void nowMs
  })

  it('a reset hands headroom back at once', () => {
    let nowMs = 1_000_000
    const tracker = new TeamThrottleTracker(() => 8, TEAM_THROTTLE_RECOVER_MS, () => nowMs)
    tracker.noteThrottle('eng-1')
    expect(tracker.cap('eng-1')).toBe(4)
    tracker.clear('eng-1')
    expect(tracker.cap('eng-1')).toBe(8)
    void nowMs
  })
})

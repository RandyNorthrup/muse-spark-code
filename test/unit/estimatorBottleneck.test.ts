import { describe, expect, it } from 'vitest'
import { findEstimateBottleneck } from '../../src/core/estimator/bottleneck'
import { prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { amount, scheduleFleet, scheduleLane } from './helpers/estimatorScheduleFixtures'

describe('M117 limiting resource', () => {
  it('refuses to claim a critical path when coupled constraints require joint expansion', () => {
    const fleet = scheduleFleet(1)
    fleet.accounts[0]!.requestsPerMinute = 1 / 60
    expect(() => findEstimateBottleneck([scheduleLane('A'), scheduleLane('B')], fleet)).toThrow(
      'coupled-resources',
    )
  })
  it.each(['machines', 'slots', 'accountRate', 'ci', 'disk'] as const)(
    'names binding %s by paired resource relaxation',
    (kind) => {
      const lanes = [scheduleLane('A'), scheduleLane('B')]
      const fleet = scheduleFleet(kind === 'machines' ? 1 : 2)
      switch (kind) {
        case 'slots': {
          fleet.slots = [fleet.slots[0]!]
          break
        }
        case 'accountRate': {
          fleet.accounts[0]!.requestsPerMinute = 1 / 60
          break
        }
        case 'ci': {
          fleet.ci[0]!.concurrentJobs = 1
          for (const lane of lanes) {
            lane.resources.ciId = 'ci-1'
            lane.resources.ciJobs = amount(1)
          }
          break
        }
        case 'disk': {
          const disk = fleet.machines[0]!.disks[0]!
          if (disk.status !== 'known') throw new Error('fixture')
          disk.freeBytes = 12
          disk.floorBytes = 0
          disk.headroomBytes = 12
          for (const lane of lanes)
            lane.resources.disk = [
              { role: 'workspace', peakBytes: amount(8), steadyBytes: amount(2) },
            ]
          break
        }
        case 'machines': {
          break
        }
      }
      const before = JSON.stringify({ lanes, fleet })
      expect(findEstimateBottleneck(lanes, fleet)).toEqual({
        kind,
        hoursSavedIfUnbounded: 1,
        moreAgentsHelp: kind === 'machines' || kind === 'slots',
      })
      expect(JSON.stringify({ lanes, fleet })).toBe(before)
    },
  )

  it('keeps aggregate governor and user caps across kinds during slot relaxation', () => {
    for (const governor of [1, 2]) {
      const fleet = scheduleFleet(1)
      fleet.machines[0]!.governorSlots = governor
      fleet.machines[0]!.capacityByKind = [
        { kind: 'core', slots: governor },
        { kind: 'host', slots: governor },
      ]
      const lanes = [scheduleLane('A'), scheduleLane('B', { kind: 'host' })]
      expect(findEstimateBottleneck(lanes, fleet).kind).toBe('machines')
    }
  })

  it('states that more agents cannot shorten a critical path', () => {
    const lanes = [
      scheduleLane('A'),
      scheduleLane('B', { dependencies: ['A'] }),
      scheduleLane('C', { dependencies: ['B'] }),
    ]
    expect(findEstimateBottleneck(lanes, scheduleFleet(1))).toEqual({
      kind: 'criticalPath',
      hoursSavedIfUnbounded: 0,
      moreAgentsHelp: false,
    })
    expect(prepareEstimateSchedule(lanes, scheduleFleet(8)).run().finishHours).toBe(3)
  })

  it('uses identical sampled durations for the baseline and every relaxation', () => {
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    const durations = new Map([
      ['A', new Map([['linux-x64-builder', 4]])],
      ['B', new Map([['linux-x64-builder', 2]])],
    ])
    expect(findEstimateBottleneck(lanes, scheduleFleet(1), durations)).toEqual({
      kind: 'machines',
      hoursSavedIfUnbounded: 2,
      moreAgentsHelp: true,
    })
  })
})

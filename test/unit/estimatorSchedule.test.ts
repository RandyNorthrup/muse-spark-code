import { describe, expect, it } from 'vitest'
import { EstimateSchedulingError, prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { estimateLaneSchema, type FleetSnapshot } from '../../src/shared/estimate'
import { ESTIMATE_MAX_ITEMS } from '../../src/shared/constants'
import dags from '../fixtures/estimator/dags.json'
import repository from '../fixtures/estimator/repository-history.json'
import { fakeFleet, ESTIMATOR_AS_OF } from './helpers/estimator/fakes'
import {
  amount,
  planHours,
  sampledHours,
  scheduleFleet,
  scheduleLane,
} from './helpers/estimatorScheduleFixtures'

function runSample(duration: number, lane = scheduleLane('A')) {
  return prepareEstimateSchedule([lane], scheduleFleet()).run(
    new Map([['A', new Map([['linux-x64-builder', planHours(duration)]])]]),
  )
}

/** A single-slot fleet whose only account quota expired long ago. */
function expiredQuotaFleet(): FleetSnapshot {
  const fleet = scheduleFleet(1)
  fleet.accounts[0]!.usageLimits = [
    {
      id: 'old',
      kind: 'rolling',
      periodSeconds: 3600,
      unit: 'requests',
      remaining: 0,
      allowance: 1,
      resetsAt: '2026-01-01T00:00:00.000Z',
      timeZone: 'UTC',
    },
  ]
  return fleet
}

/** Seventeen slots across twelve accounts where only the last admits work. */
function crowdedAccountsFleet(): FleetSnapshot {
  const fleet = scheduleFleet(17)
  const account = fleet.accounts[0]!
  fleet.accounts = Array.from({ length: 12 }, (_, index) => ({
    ...structuredClone(account),
    id: `account-${String(index).padStart(2, '0')}`,
    requestsPerMinute: index === 11 ? account.requestsPerMinute : 0,
  }))
  for (const [index, slot] of fleet.slots.entries())
    slot.accountId = fleet.accounts[Math.min(index, 11)]!.id
  return fleet
}

describe('M117 resource list scheduling', () => {
  it.each(dags)('matches the $name golden nonpreemptive schedule', (fixture) => {
    const lanes = fixture.lanes.map((lane) => estimateLaneSchema.parse(lane))
    const fleet = fixture.name === 'affinity-bound' ? fakeFleet() : scheduleFleet()
    const scheduler = prepareEstimateSchedule(lanes, fleet)
    const result = scheduler.run()
    expect(scheduler.trial()).toEqual({
      finishHours: result.finishHours,
      unknownLimits: result.unknownLimits,
    })
    expect(result.schedule.map(({ laneId, start, end }) => ({ laneId, start, end }))).toEqual(
      fixture.golden.schedule,
    )
    expect(result.finishHours).toBe(fixture.golden.finishHoursWithTwoSlots)
    expect(result.criticalPath).toEqual(fixture.golden.criticalPath)
    expect(result.criticalPathHours).toBe(fixture.golden.criticalPathHours)
  })

  it('keeps sampled trial timing and evidence refusals identical to a full schedule', () => {
    const scheduler = prepareEstimateSchedule([scheduleLane('A')], scheduleFleet())
    const durations = new Map([['A', new Map([['linux-x64-builder', sampledHours(3)]])]])
    const result = scheduler.run(durations)
    expect(scheduler.trial(durations)).toEqual({
      finishHours: result.finishHours,
      unknownLimits: result.unknownLimits,
    })
    expect(result.finishHours).toBe(3)
    for (const method of ['run', 'trial'] as const) {
      expect(() => scheduler[method](new Map())).toThrow('duration-coverage')
      durations.get('A')!.set('linux-x64-builder', sampledHours(-1))
      expect(() => scheduler[method](durations)).toThrow('invalid-duration')
      durations.get('A')!.set('linux-x64-builder', sampledHours(3))
      durations.get('A')!.set('unknown-class', sampledHours(3))
      expect(() => scheduler[method](durations)).toThrow('duration-class')
      durations.get('A')!.delete('unknown-class')
    }
  })

  it('prioritizes the longest downstream path before stable ID ties', () => {
    const result = prepareEstimateSchedule(
      [
        scheduleLane('A'),
        scheduleLane('Z'),
        scheduleLane('ZZ', { dependencies: ['Z'], estimatedHours: 2 }),
      ],
      scheduleFleet(1),
    ).run()
    expect(result.schedule.map((entry) => entry.laneId)).toEqual(['Z', 'ZZ', 'A'])
    expect(result.finishHours).toBe(4)
  })

  it('reserves governor slots, per-kind capacity and role compatibility', () => {
    const fleet = scheduleFleet(2)
    fleet.machines[0]!.capacityByKind[0]!.slots = 1
    expect(
      prepareEstimateSchedule([scheduleLane('A'), scheduleLane('B')], fleet).run().finishHours,
    ).toBe(2)
    fleet.roles[0]!.laneKinds = ['host']
    expect(() => prepareEstimateSchedule([scheduleLane('A')], fleet).run()).toThrow(
      'unschedulable:A',
    )
    const lane = scheduleLane('A')
    lane.resources.slots = amount(2)
    expect(() => prepareEstimateSchedule([lane], scheduleFleet(1)).run()).toThrow('unschedulable:A')
  })

  it('holds actual slots even when the governor permits more than the fleet has', () => {
    const fleet = scheduleFleet(2)
    fleet.slots = [fleet.slots[0]!]
    expect(
      prepareEstimateSchedule([scheduleLane('A'), scheduleLane('B')], fleet).run().finishHours,
    ).toBe(2)
  })

  it('enforces OS, architecture, class and GPU affinity', () => {
    for (const affinity of [
      { os: ['macos'], architectures: [], machineClassIds: [], gpuRequired: false },
      { os: [], architectures: ['arm64'], machineClassIds: [], gpuRequired: false },
      { os: [], architectures: [], machineClassIds: ['other'], gpuRequired: false },
      { os: [], architectures: [], machineClassIds: [], gpuRequired: true },
    ]) {
      const lane = estimateLaneSchema.parse({ ...scheduleLane('A'), affinity })
      expect(() => prepareEstimateSchedule([lane], scheduleFleet()).run()).toThrow(
        'unschedulable:A',
      )
    }
  })

  it('shares request and token rates across every slot using the same account', () => {
    for (const resource of ['requests', 'tokens']) {
      const fleet = scheduleFleet()
      if (resource === 'requests') fleet.accounts[0]!.requestsPerMinute = 1 / 60
      else fleet.accounts[0]!.tokensPerMinute = 10 / 60
      expect(
        prepareEstimateSchedule([scheduleLane('A'), scheduleLane('B')], fleet).run().finishHours,
      ).toBe(2)
    }
  })

  it('tries an independent account when the first account cannot admit the lane', () => {
    const fleet = scheduleFleet()
    const account = structuredClone(fleet.accounts[0]!)
    account.id = 'account-2'
    fleet.accounts.push(account)
    fleet.accounts[0]!.requestsPerMinute = 0
    fleet.slots[1]!.accountId = account.id
    expect(
      prepareEstimateSchedule([scheduleLane('A')], fleet).run().schedule[0]!.accountIds,
    ).toEqual(['account-2'])
  })

  it('finds the feasible two-account combination beyond an exhausted first account', () => {
    const fleet = scheduleFleet(3)
    const first = fleet.accounts[0]!
    fleet.accounts = Array.from({ length: 3 }, (_, index) => ({
      ...structuredClone(first),
      id: `account-${String(index + 1)}`,
      requestsPerMinute: index === 0 ? 0 : first.requestsPerMinute,
    }))
    for (const [index, slot] of fleet.slots.entries()) slot.accountId = fleet.accounts[index]!.id
    const lane = scheduleLane('A')
    lane.resources.slots = amount(2)
    const result = prepareEstimateSchedule([lane], fleet).run()
    expect(result.finishHours).toBe(1)
    expect(result.schedule[0]!.accountIds).toEqual(['account-2', 'account-3'])
    expect(result.schedule[0]!.slotIds).toEqual(['slot-1', 'slot-2'])
  })

  it('labels bounded account-selection fallback instead of claiming exact search', () => {
    const fleet = crowdedAccountsFleet()
    const lane = scheduleLane('A')
    lane.resources.slots = amount(6)
    const scheduler = prepareEstimateSchedule([lane], fleet)
    const result = scheduler.run()
    expect(scheduler.trial()).toEqual({
      finishHours: result.finishHours,
      unknownLimits: result.unknownLimits,
    })
    expect(result.finishHours).toBe(1)
    expect(result.schedule[0]!.accountIds).toEqual(['account-11'])
    expect(result.unknownLimits).toContain('A:account-selection-approximate')
    fleet.accounts.at(-1)!.requestsPerMinute = 0
    expect(() => prepareEstimateSchedule([lane], fleet).run()).toThrow('account-selection-limit:A')
  })

  it('splits a multi-slot lane rate across its allocated accounts', () => {
    const fleet = scheduleFleet()
    fleet.accounts[0]!.requestsPerMinute = 0.5 / 60
    const second = { ...structuredClone(fleet.accounts[0]!), id: 'account-2' }
    fleet.accounts.push(second)
    fleet.slots[1]!.accountId = second.id
    const lane = scheduleLane('A')
    lane.resources.slots = amount(2)
    expect(prepareEstimateSchedule([lane], fleet).run().schedule[0]!.accountIds).toEqual([
      'account-1',
      'account-2',
    ])
  })

  it('reserves CI jobs including occupied jobs and refuses an exhausted minutes budget', () => {
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    for (const lane of lanes) {
      lane.resources.ciId = 'ci-1'
      lane.resources.ciJobs = amount(1)
      lane.resources.ciMinutes = amount(10)
    }
    const fleet = scheduleFleet()
    fleet.ci[0]!.occupiedJobs = 1
    expect(prepareEstimateSchedule(lanes, fleet).run().finishHours).toBe(2)
    fleet.ci[0]!.minutesRemaining = 19
    expect(() => prepareEstimateSchedule(lanes, fleet).run()).toThrow('unschedulable:B')
    fleet.ci = []
    expect(() => prepareEstimateSchedule(lanes, fleet).run()).toThrow('unschedulable:A')
  })

  it('does not assume a new CI allowance after its reported period ends', () => {
    const lane = scheduleLane('A')
    lane.resources.ciId = 'ci-1'
    lane.resources.ciMinutes = amount(1)
    const fleet = scheduleFleet()
    fleet.ci[0]!.periodEndsAt = '2026-10-06T12:30:00.000Z'
    expect(() => prepareEstimateSchedule([lane], fleet).run()).toThrow('unschedulable:A')
  })

  it('reserves concurrent disk peaks and retained bytes on the physical volume', () => {
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    for (const lane of lanes)
      lane.resources.disk = [{ role: 'workspace', peakBytes: amount(8), steadyBytes: amount(2) }]
    const fleet = scheduleFleet()
    const disk = fleet.machines[0]!.disks[0]!
    if (disk.status !== 'known') throw new Error('fixture')
    disk.totalBytes = 12
    disk.freeBytes = 12
    disk.floorBytes = 0
    disk.headroomBytes = 12
    expect(prepareEstimateSchedule(lanes, fleet).run().finishHours).toBe(2)
    lanes[0]!.resources.disk[0]!.steadyBytes = amount(8)
    expect(() => prepareEstimateSchedule(lanes, fleet).run()).toThrow('unschedulable:B')
    lanes[0]!.resources.disk[0]!.steadyBytes = amount(2)
    lanes[0]!.resources.disk.push({ role: 'temp', peakBytes: amount(8), steadyBytes: amount(2) })
    expect(() => prepareEstimateSchedule(lanes, fleet).run()).toThrow('unschedulable:A')
  })

  it('refuses missing disk roles and unknown admission demand', () => {
    const lane = scheduleLane('A')
    lane.resources.disk[0]!.role = 'missing'
    expect(() => prepareEstimateSchedule([lane], scheduleFleet()).run()).toThrow('unschedulable:A')
    for (const field of [
      'slots',
      'accountRequestsPerHour',
      'accountTokensPerHour',
      'ciJobs',
      'ciMinutes',
    ]) {
      const unknown = estimateLaneSchema.parse({
        ...scheduleLane('A'),
        resources: {
          ...scheduleLane('A').resources,
          [field]: {
            status: 'unknown',
            value: null,
            basis: 'unknown',
            samples: 0,
            uncertainty: { kind: 'unknown' },
          },
        },
      })
      expect(() => prepareEstimateSchedule([unknown], scheduleFleet()).run()).toThrow(
        'unknown-demand',
      )
    }
  })

  it('ignores unknown disk headroom on unused alternatives and volumes', () => {
    const fleet = fakeFleet()
    fleet.machines[0]!.disks = [{ status: 'unknown', volumeId: 'primary', roles: ['workspace'] }]
    const result = prepareEstimateSchedule([scheduleLane('A')], fleet).run()
    expect(result.finishHours).toBe(1)
    expect(result.schedule[0]!.machineId).toBe('mac')
    expect(result.unknownLimits).toEqual([])
    const single = scheduleFleet()
    single.machines[0]!.disks.push({
      status: 'unknown',
      volumeId: 'archive',
      roles: ['archive'],
    })
    expect(prepareEstimateSchedule([scheduleLane('A')], single).run().unknownLimits).toEqual([])
  })

  it('prefers measured headroom when a waiting alternative finishes at the same time', () => {
    const fleet = fakeFleet()
    fleet.machines[0]!.disks = [{ status: 'unknown', volumeId: 'primary', roles: ['workspace'] }]
    const macLane = scheduleLane('A')
    macLane.affinity.os = ['macos']
    const lanes = [
      macLane,
      scheduleLane('B', { affinity: { ...macLane.affinity, os: ['linux', 'macos'] } }),
    ]
    const durations = new Map([
      ['A', new Map([['macos-arm64-builder', planHours(1)]])],
      [
        'B',
        new Map([
          ['linux-x64-builder', planHours(2)],
          ['macos-arm64-builder', planHours(1)],
        ]),
      ],
    ])
    const result = prepareEstimateSchedule(lanes, fleet).run(durations)
    expect(result.finishHours).toBe(2)
    expect(result.schedule[1]!.machineId).toBe('mac')
    expect(result.schedule[1]!.start).toBe('2026-10-06T13:00:00.000Z')
    expect(result.unknownLimits).toEqual([])
  })

  it('qualifies only selected lanes whose required disk headroom is unknown', () => {
    const fleet = scheduleFleet()
    fleet.machines[0]!.disks = [{ status: 'unknown', volumeId: 'primary', roles: ['workspace'] }]
    const scheduler = prepareEstimateSchedule([scheduleLane('A')], fleet)
    const result = scheduler.run()
    expect(result.finishHours).toBe(1)
    expect(result.unknownLimits).toEqual(['A:disk:linux:primary'])
    expect(scheduler.run()).toEqual(result)
  })

  it('ignores quota renewals on accounts no remaining lane can use', () => {
    const fleet = scheduleFleet(2)
    const unused = structuredClone(fleet.accounts[0]!)
    unused.id = 'unused'
    unused.usageLimits = [
      {
        id: 'minute',
        kind: 'rolling',
        periodSeconds: 60,
        unit: 'requests',
        remaining: 1,
        allowance: 1,
        resetsAt: '2026-10-06T12:01:00.000Z',
        timeZone: 'UTC',
      },
    ]
    fleet.accounts.push(unused)
    // Its slot exists, but this role cannot take either core lane.
    fleet.roles.push({ id: 'unused-role', laneKinds: ['host'] })
    fleet.slots[1] = {
      ...fleet.slots[0]!,
      id: 'unused-slot',
      roleId: 'unused-role',
      accountId: unused.id,
    }
    const lanes = [
      scheduleLane('A', { estimatedHours: 10 }),
      scheduleLane('B', { dependencies: ['A'] }),
    ]
    const result = prepareEstimateSchedule(lanes, fleet).run()
    expect(result.finishHours).toBe(11)
    fleet.accounts.pop()
    fleet.slots.pop()
    expect(prepareEstimateSchedule(lanes, fleet).run()).toEqual(result)
  })

  it('keeps unreported supply limits explicit and inputs byte unchanged', () => {
    const fleet = scheduleFleet()
    delete fleet.accounts[0]!.usageLimits
    delete fleet.accounts[0]!.tokensPerMinute
    delete fleet.ci[0]!.minutesRemaining
    const before = JSON.stringify(fleet)
    const result = prepareEstimateSchedule([scheduleLane('A')], fleet).run()
    expect(result.unknownLimits).toEqual([
      'account-1:tokensPerMinute',
      'account-1:usageLimits',
      'ci-1:minutesRemaining',
    ])
    expect(JSON.stringify(fleet)).toBe(before)
  })

  it.each(['requests', 'tokens', 'usd', 'percent'] as const)(
    'charges %s quotas and waits for rolling renewal',
    (unit) => {
      const fleet = scheduleFleet()
      fleet.accounts[0]!.usageLimits = [
        {
          id: 'quota',
          kind: 'rolling',
          periodSeconds: 7200,
          unit,
          remaining: 0,
          allowance: 100,
          resetsAt: '2026-10-06T14:00:00.000Z',
          timeZone: 'UTC',
        },
      ]
      const lane = scheduleLane('A')
      lane.resources.accountPercentPerHour = amount(1)
      lane.resources.accountUsdPerHour = amount(1)
      const result = prepareEstimateSchedule([lane], fleet).run()
      expect(result.schedule[0]!.start).toBe('2026-10-06T14:00:00.000Z')
      expect(result.finishHours).toBe(3)
    },
  )

  it('charges both daily and weekly windows and reserves earlier inserted work', () => {
    const fleet = scheduleFleet()
    const limits = fleet.accounts[0]!.usageLimits!
    limits[0]!.remaining = 1
    limits[0]!.allowance = 1
    limits[1]!.remaining = 1
    limits[1]!.allowance = 100
    const result = prepareEstimateSchedule([scheduleLane('A'), scheduleLane('B')], fleet).run()
    expect(result.schedule[1]!.start).toBe('2026-10-12T00:00:00.000Z')
    expect(result.finishHours).toBe(133)
    // A can use current quota while Z waits for its explicit prerequisite.
    limits[0]!.remaining = 1
    limits[0]!.allowance = 100
    limits[1]!.remaining = 100
    const wait = scheduleLane('wait', { estimatedHours: 12 })
    wait.resources.accountRequestsPerHour = amount(0)
    const lanes = [
      scheduleLane('A'),
      wait,
      scheduleLane('Z', { estimatedHours: 2, dependencies: ['wait'] }),
    ]
    expect(
      prepareEstimateSchedule(lanes, fleet)
        .run()
        .schedule.filter((entry) => entry.laneId !== 'wait')
        .map(({ laneId, start }) => ({ laneId, start })),
    ).toEqual([
      { laneId: 'A', start: ESTIMATOR_AS_OF },
      { laneId: 'Z', start: '2026-10-07T00:00:00.000Z' },
    ])
  })

  it('allows a lane across renewals only when each period can pay its share', () => {
    const fleet = scheduleFleet(1)
    fleet.accounts[0]!.usageLimits = [
      {
        id: 'quota',
        kind: 'rolling',
        periodSeconds: 3600,
        unit: 'requests',
        remaining: 0.5,
        allowance: 1,
        resetsAt: '2026-10-06T12:30:00.000Z',
        timeZone: 'UTC',
      },
    ]
    expect(
      prepareEstimateSchedule([scheduleLane('A', { estimatedHours: 2 })], fleet).run().finishHours,
    ).toBe(2)
    fleet.accounts[0]!.usageLimits[0]!.allowance = 0.5
    expect(() =>
      prepareEstimateSchedule([scheduleLane('A', { estimatedHours: 2 })], fleet).run(),
    ).toThrow('unschedulable:A')
  })

  it('renews a weekly quota again after its first renewal is consumed', () => {
    const fleet = scheduleFleet(1)
    fleet.accounts[0]!.usageLimits = [
      {
        id: 'week',
        kind: 'calendar',
        period: 'week',
        unit: 'requests',
        remaining: 1,
        allowance: 1,
        resetsAt: '2026-10-12T00:00:00.000Z',
        timeZone: 'UTC',
      },
    ]
    const result = prepareEstimateSchedule(
      [scheduleLane('A'), scheduleLane('B'), scheduleLane('C')],
      fleet,
    ).run()
    expect(result.schedule.map((entry) => entry.start)).toEqual([
      ESTIMATOR_AS_OF,
      '2026-10-12T00:00:00.000Z',
      '2026-10-19T00:00:00.000Z',
    ])
  })

  it('finds a feasible start between staggered renewal events', () => {
    const fleet = scheduleFleet(1)
    fleet.accounts[0]!.usageLimits = [
      {
        id: 'first',
        kind: 'rolling',
        periodSeconds: 7200,
        unit: 'requests',
        remaining: 1,
        allowance: 1,
        resetsAt: '2026-10-06T14:00:00.000Z',
        timeZone: 'UTC',
      },
      {
        id: 'second',
        kind: 'rolling',
        periodSeconds: 7200,
        unit: 'requests',
        remaining: 1,
        allowance: 1,
        resetsAt: '2026-10-06T14:30:00.000Z',
        timeZone: 'UTC',
      },
    ]
    expect(
      prepareEstimateSchedule([scheduleLane('A', { estimatedHours: 1.5 })], fleet).run()
        .schedule[0]!.start,
    ).toBe('2026-10-06T13:30:00.000Z')
  })

  it.each([
    ['day', '2026-03-07T17:00:00.000Z', '2026-03-08T16:00:00.000Z', 'America/New_York'],
    ['day', '2026-10-31T16:00:00.000Z', '2026-11-01T17:00:00.000Z', 'America/New_York'],
    ['month', '2026-01-31T12:00:00.000Z', '2026-03-31T12:00:00.000Z', 'UTC'],
  ])('renews calendar %s at anchored local time from %s', (period, anchor, expected, zone) => {
    const fleet = scheduleFleet(1)
    fleet.asOf = period === 'month' ? '2026-03-01T12:00:00.000Z' : anchor
    fleet.accounts[0]!.usageLimits = [
      {
        id: 'quota',
        kind: 'calendar',
        period: period === 'month' ? 'month' : 'day',
        unit: 'requests',
        remaining: 1,
        allowance: 1,
        resetsAt: anchor,
        timeZone: zone,
      },
    ]
    const result = prepareEstimateSchedule([scheduleLane('A'), scheduleLane('B')], fleet).run()
    expect(result.schedule[1]!.start).toBe(expected)
  })

  it('recomputes quota windows and slot reservations for each sampled run', () => {
    const fleet = scheduleFleet(1)
    fleet.accounts[0]!.usageLimits = [
      {
        id: 'quota',
        kind: 'rolling',
        periodSeconds: 7200,
        unit: 'requests',
        remaining: 1,
        allowance: 1,
        resetsAt: '2026-10-06T14:00:00.000Z',
        timeZone: 'UTC',
      },
    ]
    const scheduler = prepareEstimateSchedule([scheduleLane('A')], fleet)
    const run = (hours: number) =>
      scheduler.run(new Map([['A', new Map([['linux-x64-builder', planHours(hours)]])]]))
    const short = run(0.5)
    expect(short.finishHours).toBe(0.5)
    const long = run(2)
    expect(long.finishHours).toBe(3)
    expect(long.schedule[0]!.start).toBe('2026-10-06T13:00:00.000Z')
    expect(run(0.5)).toEqual(short)
  })

  it('schedules evidenced samples by their hours and refuses dishonest evidence', () => {
    const fleet = scheduleFleet()
    const sampled = new Map([['A', new Map([['linux-x64-builder', sampledHours(1, 20)]])]])
    expect(prepareEstimateSchedule([scheduleLane('A')], fleet).run(sampled).finishHours).toBe(1)
    const zeroSampleCalibration = new Map([
      ['A', new Map([['linux-x64-builder', { ...sampledHours(1, 20), samples: 0 }]])],
    ])
    expect(() =>
      prepareEstimateSchedule([scheduleLane('A')], fleet).run(zeroSampleCalibration),
    ).toThrow('invalid-duration-evidence')
    const fractionalSamples = new Map([
      ['A', new Map([['linux-x64-builder', { ...sampledHours(1, 20), samples: 0.5 }]])],
    ])
    expect(() =>
      prepareEstimateSchedule([scheduleLane('A')], fleet).run(fractionalSamples),
    ).toThrow('invalid-duration-evidence')
    const sampledAssumption = new Map([
      ['A', new Map([['linux-x64-builder', { ...planHours(1), samples: 5 }]])],
    ])
    expect(() =>
      prepareEstimateSchedule([scheduleLane('A')], fleet).run(sampledAssumption),
    ).toThrow('invalid-duration-evidence')
  })

  it('validates boundaries, sampled durations, floors and date overflow', () => {
    for (const duration of [NaN, Infinity, -1])
      expect(() => runSample(duration)).toThrow('invalid-duration')
    expect(() => runSample(1, scheduleLane('A', { state: 'merged' }))).toThrow('merged-duration')
    expect(() =>
      runSample(0.1, scheduleLane('A', { state: 'running', minimumRemainingHours: 0.5 })),
    ).toThrow('minimum-duration')
    expect(() => runSample(Number.MAX_VALUE)).toThrow('schedule-date-overflow')
    expect(() =>
      prepareEstimateSchedule([scheduleLane('A')], scheduleFleet()).run(new Map()),
    ).toThrow('duration-coverage')
    expect(() =>
      prepareEstimateSchedule([scheduleLane('A')], { ...scheduleFleet(), asOf: 'invalid' }),
    ).toThrow()
    expect(() =>
      prepareEstimateSchedule(
        Array.from({ length: ESTIMATE_MAX_ITEMS + 1 }, (_, index) =>
          scheduleLane(`L${String(index)}`),
        ),
        scheduleFleet(),
      ),
    ).toThrow('lane-limit')
  })

  it('refuses dates outside the frozen four-digit ISO wire format', () => {
    const fleet = scheduleFleet(1)
    fleet.asOf = '9999-12-31T23:30:00.000Z'
    fleet.accounts[0]!.usageLimits = []
    expect(() => prepareEstimateSchedule([scheduleLane('A')], fleet).run()).toThrow(
      'schedule-date-overflow',
    )
  })

  it('requires exact duration coverage and a valid projected fleet boundary', () => {
    const map = new Map([
      ['A', new Map([['linux-x64-builder', planHours(1)]])],
      ['extra', new Map([['linux-x64-builder', planHours(1)]])],
    ])
    expect(() => prepareEstimateSchedule([scheduleLane('A')], scheduleFleet()).run(map)).toThrow(
      'duration-coverage',
    )
    const fleet = scheduleFleet()
    fleet.slots[1] = structuredClone(fleet.slots[0]!)
    expect(() => prepareEstimateSchedule([scheduleLane('A')], fleet)).toThrow()
  })

  it('validates every sampled class even when it cannot be selected', () => {
    const durations = new Map([
      [
        'A',
        new Map([
          ['linux-x64-builder', planHours(1)],
          ['unrelated', planHours(1)],
        ]),
      ],
    ])
    expect(() =>
      prepareEstimateSchedule([scheduleLane('A')], scheduleFleet()).run(durations),
    ).toThrow('duration-class')
    durations.get('A')!.delete('unrelated')
    durations.get('A')!.set('macos-arm64-builder', planHours(NaN))
    expect(() =>
      prepareEstimateSchedule(
        [
          scheduleLane('A', {
            affinity: { os: ['linux'], architectures: [], machineClassIds: [], gpuRequired: false },
          }),
        ],
        fakeFleet(),
      ).run(durations),
    ).toThrow('invalid-duration')
  })

  it('bounds an expired quota recurrence rather than freezing the estimator', () => {
    const fleet = expiredQuotaFleet()
    expect(() => prepareEstimateSchedule([scheduleLane('A')], fleet).run()).toThrow('quota-horizon')
  })

  it('reports placement refusals as scheduling errors so R can rank other candidates', () => {
    const quota = expiredQuotaFleet()
    expect(() => prepareEstimateSchedule([scheduleLane('A')], quota).run()).toThrow(
      EstimateSchedulingError,
    )
    expect(() => runSample(Number.MAX_VALUE)).toThrow(EstimateSchedulingError)
    const crowded = crowdedAccountsFleet()
    const lane = scheduleLane('A')
    lane.resources.slots = amount(6)
    crowded.accounts.at(-1)!.requestsPerMinute = 0
    expect(() => prepareEstimateSchedule([lane], crowded).run()).toThrow(EstimateSchedulingError)
  })

  it('recomputes sampled priorities, critical paths and slack without dividing lane time', () => {
    const lanes = [scheduleLane('A'), scheduleLane('Z')]
    const durations = new Map([
      ['A', new Map([['linux-x64-builder', planHours(1)]])],
      ['Z', new Map([['linux-x64-builder', planHours(4)]])],
    ])
    const result = prepareEstimateSchedule(lanes, scheduleFleet(1)).run(durations)
    expect(
      result.schedule.map((entry) => [entry.laneId, entry.slackHours, entry.critical]),
    ).toEqual([
      ['Z', 0, true],
      ['A', 3, false],
    ])
    expect(result.criticalPath).toEqual(['Z'])
    expect(result.criticalPathHours).toBe(4)
  })

  it('omits completed work and never shortens a dependency path with more slots', () => {
    const lanes = [
      scheduleLane('done', { state: 'merged' }),
      scheduleLane('A', { dependencies: ['done'] }),
      scheduleLane('B', { dependencies: ['A'] }),
    ]
    const result = prepareEstimateSchedule(lanes, scheduleFleet(1)).run()
    expect(result.schedule.map((entry) => entry.laneId)).toEqual(['A', 'B'])
    expect(result.criticalPathHours).toBe(2)
    expect(prepareEstimateSchedule(lanes, scheduleFleet(8)).run().finishHours).toBe(
      result.finishHours,
    )
    expect(prepareEstimateSchedule([], scheduleFleet()).run().finishHours).toBe(0)
  })

  it.each(['M103', 'M104'])(
    'schedules captured %s topology with unit-hour test assumptions',
    (milestone) => {
      const rows = repository.lanes.filter((lane) => lane.laneId.startsWith(`${milestone}:`))
      expect(rows.map((row) => row.estimatedHours)).toEqual(rows.map(() => null))
      const lanes = rows.map((row) => scheduleLane(row.laneId, { dependencies: row.dependencies }))
      const result = prepareEstimateSchedule(lanes, scheduleFleet(2)).run()
      expect(result.schedule).toHaveLength(rows.length)
      for (const entry of result.schedule) {
        const dependencies = lanes.find((lane) => lane.id === entry.laneId)!.dependencies
        for (const parent of dependencies)
          expect(Date.parse(entry.start)).toBeGreaterThanOrEqual(
            Date.parse(result.schedule.find((entry) => entry.laneId === parent)!.end),
          )
      }
      expect(result.schedule[0]!.start).toBe(ESTIMATOR_AS_OF)
    },
  )
})

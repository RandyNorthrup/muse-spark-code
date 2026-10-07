import { describe, expect, it, vi } from 'vitest'
import { parseEstimateGoal, type EstimateLane } from '../../src/shared/estimate'
import { remainingHours, resolveEstimateGoal } from '../../src/core/estimator/goal'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { ESTIMATE_MAX_ITEMS } from '../../src/shared/constants'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'
import {
  goalChain,
  goalLane,
  goalSnapshot,
  resolveGoalSnapshot,
} from './helpers/estimatorGoalFixtures'

describe('M117 goal resolution', () => {
  it.each([
    ['M112', ['M112:0', 'M112:Q', 'M112:U']],
    ['112', ['M112:0', 'M112:Q', 'M112:U']],
    ['m110A0', []],
    ['M112:U', ['M112:0', 'M112:Q', 'M112:U']],
    ['M112:Q,U', ['M112:0', 'M112:Q', 'M112:U']],
    ['pr:12', ['M112:0', 'M112:Q']],
    ['pr:13', ['M112:0', 'M113:S']],
    ['issues:7,2', ['M112:0', 'M112:Q', 'M112:U', 'M113:S']],
    ['label:good first issue', ['M112:0', 'M112:Q', 'M112:U']],
    ['label:bug', ['M112:0', 'M112:Q', 'M112:U', 'M113:S']],
    ['release:0.16.0', ['M112:0', 'M112:Q', 'M112:U', 'M113:S']],
    ['release:empty', []],
  ])('resolves %s with its transitive prerequisites', async (text, ids) => {
    const goal = parseEstimateGoal(text)!
    const sources = { snapshot: vi.fn().mockResolvedValue(goalSnapshot()) }
    const lanes = await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, sources)
    expect(lanes.map((lane) => lane.id)).toEqual(ids)
    expect(sources.snapshot).toHaveBeenCalledExactlyOnceWith(goal, ESTIMATOR_AS_OF)
  })

  it.each(['M999', 'M112:missing', 'pr:99', 'issues:2,99', 'label:missing', 'release:missing'])(
    'rejects unknown goal %s instead of estimating a partial success',
    async (text) => {
      const sources = { snapshot: vi.fn().mockResolvedValue(goalSnapshot()) }
      await expect(
        resolveEstimateGoal(parseEstimateGoal(text)!, ESTIMATOR_AS_OF, sources),
      ).rejects.toThrow(/Goal not found/)
    },
  )

  it('uses merged PR evidence and stops traversing satisfied prerequisites', async () => {
    const snapshot = goalSnapshot()
    snapshot.pullRequests[0]!.state = 'merged'
    const lanes = await resolveEstimateGoal(parseEstimateGoal('M112:U')!, ESTIMATOR_AS_OF, {
      snapshot: vi.fn().mockResolvedValue(snapshot),
    })
    expect(lanes.map((lane) => lane.id)).toEqual(['M112:Q', 'M112:U'])
    expect(lanes[0]!.state).toBe('merged')
    expect(lanes[0]!.dependencies).toEqual([])
    expect(remainingHours(lanes[0]!)).toBe(0)
    expect(lanes[1]!.dependencies).toEqual(['M112:Q'])
    expect(snapshot.lanes[1]!.lane.state).toBe('planned')
    snapshot.lanes[1]!.lane.state = 'merged'
    snapshot.pullRequests[0]!.state = 'open'
    const fromGit = await resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
      snapshot: vi.fn().mockResolvedValue(snapshot),
    })
    expect(fromGit.map((lane) => lane.id)).toEqual(['M112:Q'])
    expect(remainingHours(fromGit[0]!)).toBe(0)
  })

  it.each(['git', 'pullRequest'])(
    'does not require scheduling affinity for already merged %s work',
    async (evidence) => {
      const snapshot = goalSnapshot()
      const lane = snapshot.lanes[1]!.lane
      if (evidence === 'git') lane.state = 'merged'
      else snapshot.pullRequests[0]!.state = 'merged'
      lane.files = ['native/windows/**', 'native/darwin/**', 'os/**']
      const lanes = await resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
        snapshot: vi.fn().mockResolvedValue(snapshot),
      })
      expect(lanes).toHaveLength(1)
      expect(remainingHours(lanes[0]!)).toBe(0)
      expect(lanes[0]!.affinity).toEqual(lane.affinity)
    },
  )

  it('preserves running progress, resources and module review evidence without mutation', async () => {
    const snapshot = goalSnapshot()
    const lane = snapshot.lanes[1]!.lane
    lane.state = 'running'
    lane.estimatedHours = 8
    lane.elapsedAgentHours = 3
    lane.minimumRemainingHours = 0.5
    lane.resources.accountTokensPerHour = {
      status: 'unknown',
      value: null,
      basis: 'unknown',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    }
    lane.review = {
      status: 'known',
      rounds: 2,
      modules: [{ familyId: 'core', strikes: 2, classes: [{ class: 'testsGates', strikes: 2 }] }],
      redesigns: [],
    }
    const before = JSON.stringify(snapshot)
    const lanes = await resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
      snapshot: vi.fn().mockResolvedValue(snapshot),
    })
    expect(remainingHours(lanes[1]!)).toBe(5)
    expect(lanes[1]!.resources).toEqual(lane.resources)
    expect(lanes[1]!.review).toEqual(lane.review)
    lanes[1]!.resources.disk[0]!.role = 'changed'
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it.each([
    ['planned', 0, 8],
    ['planned', 10, 8],
    ['running', 3, 5],
    ['running', 8, 0.5],
    ['running', 10, 0.5],
    ['merged', 0, 0],
  ] satisfies [EstimateLane['state'], number, number][])(
    'computes remaining %s work with %s active hours',
    (state, elapsedAgentHours, expected) => {
      const lane = goalLane('A', {
        state,
        elapsedAgentHours,
        estimatedHours: 8,
        minimumRemainingHours: 0.5,
      })
      expect(remainingHours(lane)).toBe(expected)
    },
  )

  it.each([
    ['native/windows/job.cs', 'windows', 'x64'],
    [String.raw`.\native\windows\job.cs`, 'windows', 'x64'],
    ['native/darwin/**', 'macos', 'arm64'],
    [String.raw`.\native\darwin\Dictation.swift`, 'macos', 'arm64'],
    ['os/x64/**', 'linux', 'x64'],
    [String.raw`os\aarch64\kernel`, 'linux', 'arm64'],
  ] satisfies [
    string,
    EstimateLane['affinity']['os'][number],
    EstimateLane['affinity']['architectures'][number],
  ][])('combines rig facts and the normalized path %s', async (file, os, architecture) => {
    const snapshot = goalSnapshot()
    snapshot.lanes[1]!.lane.files = [file]
    snapshot.rigs[0]!.affinity = {
      os: [os],
      architectures: [architecture],
      machineClassIds: ['builder'],
      gpuRequired: false,
    }
    const lanes = await resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
      snapshot: vi.fn().mockResolvedValue(snapshot),
    })
    expect(lanes[1]!.affinity).toEqual(snapshot.rigs[0]!.affinity)
    expect(lanes[1]!.files[0]).not.toContain('\\')
  })

  it('infers OS and architecture from files without a rig and requires GPUs for GPU kinds', async () => {
    const snapshot = goalSnapshot()
    delete snapshot.lanes[1]!.rigId
    snapshot.lanes[1]!.lane = goalLane('M112:Q', { kind: 'gpu-training', files: ['os/arm64/**'] })
    const lanes = await resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
      snapshot: vi.fn().mockResolvedValue(snapshot),
    })
    expect(lanes[0]!.affinity).toEqual({
      os: ['linux'],
      architectures: ['arm64'],
      machineClassIds: [],
      gpuRequired: true,
    })
  })

  it.each([
    [String.raw`native\windows\**`, 'windows', []],
    ['native//./windows/**', 'windows', []],
    [String.raw`.\native\darwin\**`, 'macos', []],
    ['os/x64/**', 'linux', ['x64']],
    [String.raw`os\amd64\**`, 'linux', ['x64']],
    ['os/arm64/**', 'linux', ['arm64']],
    [String.raw`os\aarch64\**`, 'linux', ['arm64']],
  ] satisfies [
    string,
    EstimateLane['affinity']['os'][number],
    EstimateLane['affinity']['architectures'],
  ][])('derives file affinity without rig hints for %s', async (file, os, architectures) => {
    const snapshot = goalSnapshot()
    delete snapshot.lanes[1]!.rigId
    snapshot.lanes[1]!.lane.files = [file]
    const lanes = await resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
      snapshot: vi.fn().mockResolvedValue(snapshot),
    })
    expect(lanes[1]!.affinity.os).toEqual([os])
    expect(lanes[1]!.affinity.architectures).toEqual(architectures)
  })

  it('rejects contradictory architecture hints in a single builder path', async () => {
    const snapshot = goalSnapshot()
    delete snapshot.lanes[1]!.rigId
    snapshot.lanes[1]!.lane.files = ['os/x64/arm64/**']
    await expect(
      resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
        snapshot: vi.fn().mockResolvedValue(snapshot),
      }),
    ).rejects.toThrow(UI_TEXT.estimateNoCapacity)
  })

  it.each(['os/**', String.raw`os\kernel.c`])(
    'refuses unknown builder architecture for %s',
    async (file) => {
      const snapshot = goalSnapshot()
      delete snapshot.lanes[1]!.rigId
      snapshot.lanes[1]!.lane.files = [file]
      await expect(resolveGoalSnapshot(snapshot, 'pr:12')).rejects.toThrow(
        'unknown-os-architecture',
      )
    },
  )

  it.each(['os/x64/arm64/**', 'native/darwin/**', String.raw`native\darwin\**`])(
    'refuses incompatible file/rig affinity for %s',
    async (file) => {
      const snapshot = goalSnapshot()
      snapshot.lanes[1]!.lane.files = [file]
      snapshot.rigs[0]!.affinity.os = ['windows']
      await expect(
        resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
          snapshot: vi.fn().mockResolvedValue(snapshot),
        }),
      ).rejects.toThrow(UI_TEXT.estimateNoCapacity)
    },
  )

  it('intersects explicit OS, architecture, class and GPU constraints rather than broadening them', async () => {
    const snapshot = goalSnapshot()
    const lane = snapshot.lanes[1]!.lane
    lane.affinity = {
      os: ['macos', 'linux'],
      architectures: ['x64', 'arm64'],
      machineClassIds: ['builder', 'large'],
      gpuRequired: true,
    }
    snapshot.rigs[0]!.affinity.machineClassIds = ['builder']
    const sources = { snapshot: vi.fn().mockResolvedValue(snapshot) }
    const resolved = await resolveEstimateGoal(
      parseEstimateGoal('pr:12')!,
      ESTIMATOR_AS_OF,
      sources,
    )
    expect(resolved[1]!.affinity).toEqual({
      os: ['macos'],
      architectures: ['arm64'],
      machineClassIds: ['builder'],
      gpuRequired: true,
    })
    for (const constraint of [
      { ...lane.affinity, architectures: ['x64'] },
      { ...lane.affinity, machineClassIds: ['other'] },
    ] satisfies EstimateLane['affinity'][]) {
      lane.affinity = constraint
      await expect(
        resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, sources),
      ).rejects.toThrow(UI_TEXT.estimateNoCapacity)
    }
  })

  it('does not infer native or builder affinity from unrelated nested directories', async () => {
    const snapshot = goalSnapshot()
    delete snapshot.lanes[1]!.rigId
    snapshot.lanes[1]!.lane.files = ['docs/native/windows/**', String.raw`test\fixtures\os\kernel`]
    const lanes = await resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, {
      snapshot: vi.fn().mockResolvedValue(snapshot),
    })
    expect(lanes[1]!.affinity.os).toEqual([])
    expect(lanes[1]!.affinity.architectures).toEqual([])
  })

  it('preserves GPU requirements from the rig and refuses contradictory native file constraints', async () => {
    const snapshot = goalSnapshot()
    snapshot.rigs[0]!.affinity.gpuRequired = true
    const sources = { snapshot: vi.fn().mockResolvedValue(snapshot) }
    const lanes = await resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, sources)
    expect(lanes[1]!.affinity.gpuRequired).toBe(true)
    delete snapshot.lanes[1]!.rigId
    snapshot.lanes[1]!.lane.files = ['native/windows/**', 'native/darwin/**']
    await expect(
      resolveEstimateGoal(parseEstimateGoal('pr:12')!, ESTIMATOR_AS_OF, sources),
    ).rejects.toThrow(UI_TEXT.estimateNoCapacity)
  })

  it('returns stable goal bytes when source row and association order changes', async () => {
    const first = goalSnapshot()
    first.lanes[1]!.lane.files = ['src/z.ts', 'src/A.ts']
    const second = structuredClone(first)
    for (const rows of [
      second.lanes,
      second.milestones,
      second.pullRequests,
      second.issues,
      second.releases,
      second.rigs,
    ])
      rows.reverse()
    for (const row of second.milestones) row.laneIds.reverse()
    for (const row of second.releases) row.milestoneIds.reverse()
    for (const row of second.lanes) {
      row.lane.dependencies.reverse()
      row.lane.files.reverse()
    }
    const sources = { snapshot: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) }
    const goal = parseEstimateGoal('release:0.16.0')!
    const expected = JSON.stringify(await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, sources))
    expect(JSON.stringify(await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, sources))).toBe(expected)
  })

  it.each(['/Users/example/file', String.raw`C:\work\file`, '../native/windows/a', 'src/../../a'])(
    'rejects nonrelative file %s instead of retaining a profile path',
    async (file) => {
      const snapshot = goalSnapshot()
      snapshot.lanes[1]!.lane.files = [file]
      await expect(resolveGoalSnapshot(snapshot, 'pr:12')).rejects.toThrow('nonrelative-file')
    },
  )

  it('rejects stale snapshots, unavailable reads and malformed projected data', async () => {
    const goal = parseEstimateGoal('M112')!
    const snapshot = goalSnapshot()
    snapshot.asOf = '2026-10-05T12:00:00.000Z'
    await expect(
      resolveEstimateGoal(goal, ESTIMATOR_AS_OF, { snapshot: vi.fn().mockResolvedValue(snapshot) }),
    ).rejects.toThrow('snapshot-asOf')
    await expect(
      resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
        snapshot: vi.fn().mockRejectedValue(new Error('unavailable')),
      }),
    ).rejects.toThrow('unavailable')
    await expect(
      resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
        snapshot: vi.fn().mockResolvedValue({ ...goalSnapshot(), credential: 'forbidden-field' }),
      }),
    ).rejects.toThrow()
  })

  it('validates unique identities and all references across plan/source projections', async () => {
    const base = goalSnapshot()
    const invalid = [
      { ...base, lanes: [...base.lanes, base.lanes[0]] },
      { ...base, milestones: [...base.milestones, base.milestones[0]] },
      { ...base, rigs: [...base.rigs, base.rigs[0]] },
      { ...base, releases: [...base.releases, base.releases[0]] },
      { ...base, pullRequests: [...base.pullRequests, base.pullRequests[0]] },
      { ...base, issues: [...base.issues, base.issues[0]] },
    ]
    for (const snapshot of invalid) {
      await expect(
        resolveEstimateGoal(parseEstimateGoal('M112')!, ESTIMATOR_AS_OF, {
          snapshot: vi.fn().mockResolvedValue(snapshot),
        }),
      ).rejects.toThrow()
    }
  })

  it.each([
    'milestone-lane',
    'pr-lane',
    'issue-lane',
    'release-milestone',
    'prerequisite',
    'rig',
    'milestone-namespace',
  ])('refuses an invalid %s association in isolation', async (association) => {
    const snapshot = goalSnapshot()
    switch (association) {
      case 'milestone-lane': {
        snapshot.milestones[0]!.laneIds.push('M112:missing')
        break
      }
      case 'pr-lane': {
        snapshot.pullRequests[0]!.laneIds.push('unknown-lane')
        break
      }
      case 'issue-lane': {
        snapshot.issues[0]!.laneIds.push('unknown-lane')
        break
      }
      case 'release-milestone': {
        snapshot.releases[0]!.milestoneIds.push('M999')
        break
      }
      case 'prerequisite': {
        snapshot.lanes[0]!.lane.dependencies.push('unknown-prerequisite')
        break
      }
      case 'rig': {
        snapshot.lanes[1]!.rigId = 'unknown-rig'
        break
      }
      case 'milestone-namespace': {
        snapshot.milestones[0]!.laneIds.push('M113:S')
        break
      }
    }
    await expect(
      resolveEstimateGoal(parseEstimateGoal('M110a0')!, ESTIMATOR_AS_OF, {
        snapshot: vi.fn().mockResolvedValue(snapshot),
      }),
    ).rejects.toThrow()
  })

  it('refuses missing hour estimates and malformed goals before using a source', async () => {
    const snapshot = goalSnapshot()
    const source = { snapshot: vi.fn().mockResolvedValue(snapshot) }
    const malformed = { kind: 'milestone', milestoneId: 'M112:Q' }
    await expect(resolveEstimateGoal(malformed, ESTIMATOR_AS_OF, source)).rejects.toThrow()
    expect(source.snapshot).not.toHaveBeenCalled()
    const missingHours = {
      ...snapshot,
      lanes: [{ ...snapshot.lanes[0], lane: { ...snapshot.lanes[0]!.lane, estimatedHours: null } }],
    }
    source.snapshot.mockResolvedValue(missingHours)
    await expect(
      resolveEstimateGoal(parseEstimateGoal('M112')!, ESTIMATOR_AS_OF, source),
    ).rejects.toThrow()
  })

  it.each(['milestone', 'pullRequest', 'issue', 'release'])(
    'rejects duplicate references inside a %s association',
    async (kind) => {
      const snapshot = goalSnapshot()
      switch (kind) {
        case 'milestone': {
          snapshot.milestones[0]!.laneIds.push('M112:0')
          break
        }
        case 'pullRequest': {
          snapshot.pullRequests[0]!.laneIds.push('M112:Q')
          break
        }
        case 'issue': {
          snapshot.issues[0]!.laneIds.push('M112:U')
          break
        }
        case 'release': {
          snapshot.releases[0]!.milestoneIds.push('M112')
          break
        }
      }
      await expect(
        resolveEstimateGoal(parseEstimateGoal('M110a0')!, ESTIMATOR_AS_OF, {
          snapshot: vi.fn().mockResolvedValue(snapshot),
        }),
      ).rejects.toThrow()
    },
  )

  it('bounds association lists even when the selected goal is empty', async () => {
    const snapshot = goalSnapshot()
    snapshot.lanes = Array.from({ length: ESTIMATE_MAX_ITEMS + 1 }, (_, index) => ({
      lane: goalLane(`M112:L${String(index)}`),
    }))
    snapshot.milestones = [
      { id: 'M112', laneIds: snapshot.lanes.map((entry) => entry.lane.id) },
      { id: 'M110a0', laneIds: [] },
    ]
    snapshot.pullRequests = []
    snapshot.issues = []
    snapshot.releases = []
    await expect(
      resolveEstimateGoal(parseEstimateGoal('M110a0')!, ESTIMATOR_AS_OF, {
        snapshot: vi.fn().mockResolvedValue(snapshot),
      }),
    ).rejects.toThrow()
  })

  it('bounds the resolved graph without silently truncating lanes', async () => {
    const snapshot = goalSnapshot()
    snapshot.lanes = goalChain(ESTIMATE_MAX_ITEMS + 1)
    snapshot.milestones[0]!.laneIds = [snapshot.lanes.at(-1)!.lane.id]
    snapshot.milestones = [snapshot.milestones[0]!]
    snapshot.pullRequests = []
    snapshot.issues = []
    snapshot.releases = []
    await expect(
      resolveEstimateGoal(parseEstimateGoal('M112')!, ESTIMATOR_AS_OF, {
        snapshot: vi.fn().mockResolvedValue(snapshot),
      }),
    ).rejects.toThrow('lane-limit')
  })
})

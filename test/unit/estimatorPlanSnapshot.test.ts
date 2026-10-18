import { describe, expect, it } from 'vitest'
import { buildPlanSnapshot, type PlanSnapshotEvidence } from '../../src/core/estimator/planSnapshot'
import { parseEstimateGoal } from '../../src/shared/estimate'
import {
  ESTIMATE_ASSUMED_PEAK_BYTES,
  ESTIMATE_ASSUMED_STEADY_BYTES,
  ESTIMATE_ASSUMED_TOKENS_PER_HOUR,
} from '../../src/shared/constants'
import { resolveEstimateGoal, type EstimateGoalSnapshot } from '../../src/core/estimator/goal'
import { ESTIMATOR_AS_OF } from './helpers/estimator/sectionVectors'

const PLAN = `## 3. Questions

- **Q-plan-1** First question. M112.

### 6.0 Standard certification checklist (2026-10-10)

## 6. Milestones

### M112 — Widget work (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Ship widgets.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
| 0 | all | \`src/shared/l10n/en.ts\` | First | Kubuntu | 8 |
| Q | 1 | \`native/windows/job.cs\` | after 0 | Win11 VM | 5 |
| U | 2 | \`src/core/u.ts\` | after Q and 0 (contract) | Mac mini | 3 |

### M113 — Follow-ups (2026-10-10)

**Status 2026-10-10: planned.**

- **Goal.** More widgets.
- **Depends on.** M112.
- **Gates.** The full gate.

| Lane | Items | Own files | Starts | Rig | Hours |
| ---- | ----- | --------- | ------ | --- | ----- |
| S | 1 | \`src/s.ts\` | after M112:U and M112 | Kubuntu | 4 |
| T | 2 | \`os/arm64/kernel.c\` | after S | Kubuntu | 2 |

### Delivery order (2026-10-10)

1. **M112** — First. Needs: main only.
2. **M113** — Second. Needs: M112.
3. **0.16.0: M112 and M113** — Release. Needs: M112 and M113.

## 10. Releases

### 0.16.0 — 2026-10-01

Release notes.

### 0.17.0 — 2026-10-09

Later notes.
`

const EVIDENCE: PlanSnapshotEvidence = {
  branches: [
    { name: 'm112/0', merged: false },
    { name: 'm112/q', merged: false },
  ],
  pullRequests: [{ branch: 'm112/q', number: 12, state: 'open' }],
  issues: [{ number: 7, labels: ['bug'], laneIds: ['M112:U'] }],
}

function snapshotFor(
  text: string,
  evidence: PlanSnapshotEvidence = EVIDENCE,
): EstimateGoalSnapshot {
  const goal = parseEstimateGoal(text)
  if (goal === undefined) throw new Error(`unparseable goal: ${text}`)
  return buildPlanSnapshot(PLAN, goal, ESTIMATOR_AS_OF, evidence)
}

async function resolve(text: string, evidence: PlanSnapshotEvidence = EVIDENCE) {
  const goal = parseEstimateGoal(text)
  if (goal === undefined) throw new Error(`unparseable goal: ${text}`)
  return await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
    snapshot: () => Promise.resolve(snapshotFor(text, evidence)),
  })
}

describe('M117 plan snapshot adapter', () => {
  it.each([
    ['M112', ['M112:0', 'M112:Q', 'M112:U']],
    ['M112:U', ['M112:0', 'M112:Q', 'M112:U']],
    ['M112:Q,U', ['M112:0', 'M112:Q', 'M112:U']],
    ['pr:12', ['M112:0', 'M112:Q']],
    ['issues:7', ['M112:0', 'M112:Q', 'M112:U']],
    ['label:bug', ['M112:0', 'M112:Q', 'M112:U']],
  ])('resolves every goal kind %s from the plan', async (text, ids) => {
    const lanes = await resolve(text)
    expect(lanes.map((lane) => lane.id)).toEqual(ids)
  })

  it('takes release membership from delivery-order titles, never prerequisites', async () => {
    const goal = parseEstimateGoal('release:0.16.0')
    if (goal === undefined) throw new Error('unparseable goal')
    const plan = `## 6. Milestones

### M112 — Widget work (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Ship widgets.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
| 0 | all | \`src/a.ts\` | First | Kubuntu | 8 |

### M113 — Follow-ups (2026-10-10)

**Status 2026-10-10: planned.**

- **Goal.** More widgets.
- **Depends on.** M112.
- **Gates.** The full gate.

| Lane | Items | Own files | Starts | Rig | Hours |
| ---- | ----- | --------- | ------ | --- | ----- |
| S | 1 | \`src/s.ts\` | First | Kubuntu | 4 |

### Delivery order (2026-10-10)

1. **M112** — First. Needs: main only.
2. **0.16.0: M113** — Second. Needs: M112.
`
    // The Needs clause names M112, but the title assigns only M113.
    const snapshot = buildPlanSnapshot(plan, goal, ESTIMATOR_AS_OF, {})
    expect(snapshot.releases.find((entry) => entry.id === '0.16.0')?.milestoneIds).toEqual(['M113'])
    const lanes = await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
      snapshot: () => Promise.resolve(snapshot),
    })
    expect(lanes.map((lane) => lane.id)).toEqual(['M113:S'])
  })

  it('marks open PR lanes running and keeps their remaining work', async () => {
    const lanes = await resolve('M112')
    expect(lanes[1]).toMatchObject({ id: 'M112:Q', state: 'running', estimatedHours: 5 })
  })

  it('merges git merged lanes and clears their satisfied edges', async () => {
    const evidence: PlanSnapshotEvidence = {
      ...EVIDENCE,
      branches: [{ name: 'm112/0', merged: true }],
    }
    const lanes = await resolve('M112', evidence)
    expect(lanes[0]).toMatchObject({ id: 'M112:0', state: 'merged', dependencies: [] })
    expect(lanes[1]).toMatchObject({ id: 'M112:Q', dependencies: ['M112:0'] })
  })

  it('merges milestones with a terminal status', () => {
    const terminal = PLAN.replace(
      '**Status 2026-10-10: building.**',
      '**Status 2026-10-10: merged.**',
    )
    const goal = parseEstimateGoal('M112')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = buildPlanSnapshot(terminal, goal, ESTIMATOR_AS_OF, EVIDENCE)
    expect(snapshot.lanes.map((entry) => [entry.lane.id, entry.lane.state])).toEqual([
      ['M112:0', 'merged'],
      ['M112:Q', 'merged'],
      ['M112:U', 'merged'],
    ])
  })

  it.each(['M999', 'M112:missing', 'pr:99', 'issues:2', 'label:missing', 'release:9.9.9'])(
    'rejects unknown goal %s instead of a partial success',
    async (text) => {
      await expect(resolve(text)).rejects.toThrow(/Goal not found/)
    },
  )

  it('refuses a goal whose closure needs an hour-less lane, naming it', () => {
    const plan = PLAN.replace(
      '| U | 2 | `src/core/u.ts` | after Q and 0 (contract) | Mac mini | 3 |',
      '| U | 2 | `src/core/u.ts` | after Q and 0 (contract) | Mac mini | — |',
    )
    const goal = parseEstimateGoal('M112')
    if (goal === undefined) throw new Error('unparseable goal')
    expect(() => buildPlanSnapshot(plan, goal, ESTIMATOR_AS_OF, EVIDENCE)).toThrow(
      /missing-estimate: M112:U/,
    )
  })

  it('resolves a release with no assigned milestones empty, like the goal fixtures', async () => {
    const lanes = await resolve('release:0.17.0')
    expect(lanes.map((lane) => lane.id)).toEqual([])
  })

  it('discloses undisclosed demands as zero-sample assumptions, review as unknown', () => {
    const snapshot = snapshotFor('M112')
    expect(snapshot.lanes.length).toBeGreaterThan(0)
    for (const entry of snapshot.lanes) {
      // The schedule refuses unknowns here, so the snapshot assumes the
      // engine fixtures' scale — disclosed, with nothing invented as fact.
      const resources = entry.lane.resources
      for (const quantity of [
        resources.slots,
        resources.accountRequestsPerHour,
        resources.accountTokensPerHour,
        resources.accountUsdPerHour,
        resources.ciJobs,
        resources.ciMinutes,
      ]) {
        expect(quantity.status).toBe('known')
        expect(quantity.basis).toBe('assumption')
        expect(quantity.samples).toBe(0)
      }
      expect(resources.accountRequestsPerHour.value).toBe(1)
      expect(resources.accountTokensPerHour.value).toBe(ESTIMATE_ASSUMED_TOKENS_PER_HOUR)
      expect(resources.accountPercentPerHour.status).toBe('unknown')
      expect(resources.disk).toHaveLength(1)
      expect(resources.disk[0]?.peakBytes).toMatchObject({
        status: 'known',
        basis: 'assumption',
        samples: 0,
        value: ESTIMATE_ASSUMED_PEAK_BYTES,
      })
      expect(resources.disk[0]?.steadyBytes).toMatchObject({
        status: 'known',
        basis: 'assumption',
        samples: 0,
        value: ESTIMATE_ASSUMED_STEADY_BYTES,
      })
      expect(entry.lane.review.status).toBe('unknown')
      expect(entry.lane.elapsedAgentHours).toBe(0)
      expect(entry.lane.minimumRemainingHours).toBe(0)
    }
  })

  it('returns byte-identical snapshots when evidence order changes', () => {
    const goal = parseEstimateGoal('M112')
    if (goal === undefined) throw new Error('unparseable goal')
    const ordered: PlanSnapshotEvidence = {
      ...EVIDENCE,
      pullRequests: [
        { branch: 'm112/q', number: 12, state: 'open' },
        { branch: 'm112/q', number: 15, state: 'closed' },
        { branch: 'm112/u', number: 15, state: 'closed' },
      ],
      issues: [
        { number: 7, labels: ['bug'], laneIds: ['M112:U'] },
        { number: 9, labels: ['bug', 'polish'], laneIds: ['M113:S', 'M112:U'] },
      ],
    }
    const shuffled: PlanSnapshotEvidence = {
      branches: [...(EVIDENCE.branches ?? [])].toReversed(),
      pullRequests: [...(ordered.pullRequests ?? [])].toReversed(),
      issues: [...(ordered.issues ?? [])]
        .toReversed()
        .map((issue) => ({ ...issue, laneIds: [...issue.laneIds].toReversed() })),
    }
    const first = JSON.stringify(buildPlanSnapshot(PLAN, goal, ESTIMATOR_AS_OF, ordered))
    const second = JSON.stringify(buildPlanSnapshot(PLAN, goal, ESTIMATOR_AS_OF, shuffled))
    expect(second).toBe(first)
  })

  it('reads rigs as named affinities', () => {
    const snapshot = snapshotFor('M112')
    const rigs = new Map(snapshot.rigs.map((rig) => [rig.id, rig.affinity]))
    expect(rigs.get('kubuntu')).toMatchObject({ os: ['linux'] })
    expect(rigs.get('win11-vm')).toMatchObject({ os: ['windows'] })
    expect(rigs.get('mac-mini')).toMatchObject({ os: ['macos'], architectures: ['arm64'] })
  })

  it('refuses an unknown rig instead of scheduling it locally', () => {
    const goal = parseEstimateGoal('M113:T')
    if (goal === undefined) throw new Error('unparseable goal')
    expect(() =>
      buildPlanSnapshot(
        PLAN.replace('| after S | Kubuntu |', '| after S | Buildertown |'),
        goal,
        ESTIMATOR_AS_OF,
        EVIDENCE,
      ),
    ).toThrow(/unknown-rig:.*buildertown/)
  })

  it('keeps current work when an old merged PR shares the lane', async () => {
    const evidence: PlanSnapshotEvidence = {
      branches: [
        { name: 'm112/q-old', merged: true },
        { name: 'm112/q-new', merged: false },
      ],
      pullRequests: [
        { branch: 'm112/q-old', number: 12, state: 'merged' },
        { branch: 'm112/q-new', number: 13, state: 'open' },
      ],
      issues: [],
    }
    // The current open PR wins over the older merged one: Q stays running
    // with its remaining work and dependencies, never merged by history.
    const lanes = await resolve('M112:Q', evidence)
    expect(lanes.map((lane) => lane.id)).toEqual(['M112:0', 'M112:Q'])
    expect(lanes[1]).toMatchObject({
      id: 'M112:Q',
      state: 'running',
      estimatedHours: 5,
      dependencies: ['M112:0'],
    })
  })

  it('estimates unfinished work past a merged prerequisite without hours', async () => {
    const goal = parseEstimateGoal('M114:Q')
    if (goal === undefined) throw new Error('unparseable goal')
    const plan = `## 6. Milestones

### M114 — Polish (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Polish.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
| 0 | all | \`src/a.ts\` | First | Kubuntu | — |
| Q | 1 | \`src/q.ts\` | after 0 | Kubuntu | 5 |
`
    const evidence: PlanSnapshotEvidence = {
      branches: [{ name: 'm114/0', merged: true }],
    }
    // Lane 0 is done with zero remaining work: its unknown past must not
    // block Q, and the lane retains its prerequisite identity.
    const snapshot = buildPlanSnapshot(plan, goal, ESTIMATOR_AS_OF, evidence)
    expect(snapshot.lanes.map((entry) => entry.lane.id)).toEqual(['M114:0', 'M114:Q'])
    const lanes = await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
      snapshot: () => Promise.resolve(snapshot),
    })
    expect(lanes.map((lane) => lane.id)).toEqual(['M114:0', 'M114:Q'])
    expect(lanes[1]).toMatchObject({ dependencies: ['M114:0'] })
  })

  it('refuses a named prerequisite the plan does not contain', () => {
    const missing = PLAN.replace(
      '| Q | 1 | `native/windows/job.cs` | after 0 | Win11 VM | 5 |',
      '| Q | 1 | `native/windows/job.cs` | after M999 | Win11 VM | 5 |',
    )
    const goal = parseEstimateGoal('M112')
    if (goal === undefined) throw new Error('unparseable goal')
    expect(() => buildPlanSnapshot(missing, goal, ESTIMATOR_AS_OF, EVIDENCE)).toThrow(
      /unknown-prerequisite: M999/,
    )
    const qualified = PLAN.replace(
      '| Q | 1 | `native/windows/job.cs` | after 0 | Win11 VM | 5 |',
      '| Q | 1 | `native/windows/job.cs` | after M999:X | Win11 VM | 5 |',
    )
    expect(() => buildPlanSnapshot(qualified, goal, ESTIMATOR_AS_OF, EVIDENCE)).toThrow(
      /unknown-prerequisite: M999:X/,
    )
  })

  it('refuses a milestone whose lane table drifts from the reader grammar', () => {
    const drifted = PLAN.replace(
      '| Lane | Items | Files it owns | Starts | Rig | Hours |',
      '| Lane | Items | Owner | Starts | Rig | Hours |',
    )
    const goal = parseEstimateGoal('M112')
    if (goal === undefined) throw new Error('unparseable goal')
    expect(() => buildPlanSnapshot(drifted, goal, ESTIMATOR_AS_OF, EVIDENCE)).toThrow(
      /plan-drift: lanes-columns/,
    )
  })

  it('starts a last lane after every other unfinished lane of its milestone', async () => {
    const goal = parseEstimateGoal('M114')
    if (goal === undefined) throw new Error('unparseable goal')
    const plan = `## 6. Milestones

### M114 — Polish (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Polish.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
| 0 | all | \`src/a.ts\` | First | Kubuntu | 2 |
| Q | 1 | \`src/q.ts\` | after 0 | Kubuntu | 5 |
| Z | 2 | \`src/z.ts\` | last | Kubuntu | 3 |
`
    const snapshot = buildPlanSnapshot(plan, goal, ESTIMATOR_AS_OF, {})
    const lanes = await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
      snapshot: () => Promise.resolve(snapshot),
    })
    expect(lanes.find((lane) => lane.id === 'M114:Z')?.dependencies).toEqual(['M114:0', 'M114:Q'])
  })

  it('canonicalizes plan punctuation in lane ids to protocol ids', async () => {
    const goal = parseEstimateGoal('M114')
    if (goal === undefined) throw new Error('unparseable goal')
    const plan = `## 6. Milestones

### M114 — Polish (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Polish.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
| 0 | all | \`src/a.ts\` | First | Kubuntu | 2 |
| Integration, done | 1 | \`src/done.ts\` | after 0 | Kubuntu | 3 |
`
    const snapshot = buildPlanSnapshot(plan, goal, ESTIMATOR_AS_OF, {})
    expect(snapshot.lanes.map((entry) => entry.lane.id)).toEqual(['M114:0', 'M114:Integration'])
    const lanes = await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
      snapshot: () => Promise.resolve(snapshot),
    })
    expect(lanes.map((lane) => lane.id)).toEqual(['M114:0', 'M114:Integration'])
    expect(lanes[1]).toMatchObject({ kind: 'integration' })
  })

  it('combines file and rig affinity at resolution without inventing capacity', async () => {
    const lanes = await resolve('M112')
    expect(lanes.find((lane) => lane.id === 'M112:Q')?.affinity).toMatchObject({ os: ['windows'] })
    expect(lanes.find((lane) => lane.id === 'M112:U')?.affinity.os).toEqual(['macos'])
  })

  it('normalises Windows separators in file cells and drops nonrelative paths', () => {
    const windowsPath = '`' + String.raw`src\core\u.ts` + '`'
    const plan = PLAN.replace(
      '`src/core/u.ts`',
      () => `${windowsPath} \`/abs/drop.ts\` \`../drop.ts\``,
    )
    const goal = parseEstimateGoal('M112:U')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = buildPlanSnapshot(plan, goal, ESTIMATOR_AS_OF, EVIDENCE)
    const files = snapshot.lanes.find((entry) => entry.lane.id === 'M112:U')?.lane.files ?? []
    expect(files).toContain('src/core/u.ts')
    expect(files.some((file) => file.includes('\\'))).toBe(false)
    expect(files.some((file) => file.includes('drop'))).toBe(false)
  })

  it('expands milestone Starts refs while retaining completed prerequisite identity', async () => {
    const lanes = await resolve('M113:S')
    const ids = lanes.map((lane) => lane.id)
    expect(ids).toContain('M112:U')
    // Finished lanes bind nothing further: with M112:0 merged, S depends on
    // every named lane, with merged lanes carrying no remaining work.
    const mergedEvidence: PlanSnapshotEvidence = {
      ...EVIDENCE,
      branches: [{ name: 'm112/0', merged: true }],
    }
    const merged = await resolve('M113:S', mergedEvidence)
    expect(merged.find((lane) => lane.id === 'M113:S')?.dependencies).toEqual([
      'M112:0',
      'M112:Q',
      'M112:U',
    ])
    expect(merged.find((lane) => lane.id === 'M112:0')).toMatchObject({
      state: 'merged',
      dependencies: [],
    })
  })

  it('maps merged PR evidence to merged lanes with no remaining work', async () => {
    const evidence: PlanSnapshotEvidence = {
      ...EVIDENCE,
      branches: [{ name: 'm112/0', merged: false }],
      pullRequests: [{ branch: 'm112/q', number: 12, state: 'merged' }],
    }
    const lanes = await resolve('pr:12', evidence)
    expect(lanes.map((lane) => lane.id)).toEqual(['M112:Q'])
    expect(lanes[0]).toMatchObject({ state: 'merged', dependencies: [] })
  })
})

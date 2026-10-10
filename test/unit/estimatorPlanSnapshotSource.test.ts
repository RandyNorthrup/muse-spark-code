import { describe, expect, it } from 'vitest'
import {
  createPlanSnapshotSource,
  type PlanSnapshotSourceIo,
} from '../../src/host/estimator/planSnapshotSource'
import { parseEstimateGoal } from '../../src/shared/estimate'
import { resolveEstimateGoal } from '../../src/core/estimator/goal'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'

const PLAN = `## 6. Milestones

### M112 — Widget work (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Ship widgets.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
| 0 | all | \`src/a.ts\` | First | Kubuntu | 8 |
| Q | 1 | \`src/q.ts\` | after 0 | Kubuntu | 5 |
`

const PULLS = JSON.stringify([{ number: 12, headRefName: 'm112/q', state: 'OPEN', mergedAt: null }])
const ISSUES = JSON.stringify([{ number: 7, labels: [{ name: 'bug' }] }])

function ioWith(overrides: Partial<PlanSnapshotSourceIo> = {}): PlanSnapshotSourceIo {
  return {
    readPlanFile: () => Promise.resolve(PLAN),
    runGit: (args) => Promise.resolve(args.includes('--merged') ? 'm112/0\n' : 'm112/0\nm112/q\n'),
    runGh: (args) => Promise.resolve(args.includes('pr') ? PULLS : ISSUES),
    ...overrides,
  }
}

function settleSoon(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 50)
  })
}

async function resolveThrough(
  io: PlanSnapshotSourceIo,
  text: string,
  root = '/workspace',
  options: { networkAllowed?: boolean; signal?: AbortSignal } = {},
): Promise<string[]> {
  const goal = parseEstimateGoal(text)
  if (goal === undefined) throw new Error(`unparseable goal: ${text}`)
  const snapshot = createPlanSnapshotSource({ root, io, ...options })
  const lanes = await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
    snapshot: (snapshotGoal, asOf, signal) =>
      snapshot(snapshotGoal, asOf, signal ?? options.signal),
  })
  return lanes.map((lane) => `${lane.id}:${lane.state}`)
}

describe('M117 plan snapshot source', () => {
  it('resolves the workspace plan with git and gh evidence', async () => {
    const seen: string[] = []
    const io = ioWith({
      readPlanFile: (file) => {
        seen.push(file)
        return Promise.resolve(PLAN)
      },
    })
    expect(await resolveThrough(io, 'M112', '/workspace', { networkAllowed: true })).toEqual([
      'M112:0:merged',
      'M112:Q:running',
    ])
    expect(seen[0]?.endsWith('PLAN.md')).toBe(true)
  })

  it('refuses without reading when the root is empty', async () => {
    let calls = 0
    const io = ioWith({
      readPlanFile: () => {
        calls += 1
        return Promise.resolve(PLAN)
      },
    })
    await expect(resolveThrough(io, 'M112', '', { networkAllowed: true })).rejects.toThrow(
      /missing-plan/,
    )
    expect(calls).toBe(0)
  })

  it('refuses an unreadable plan instead of an empty estimate', async () => {
    const io = ioWith({ readPlanFile: () => Promise.reject(new Error('denied')) })
    await expect(
      resolveThrough(io, 'M112', '/workspace', { networkAllowed: true }),
    ).rejects.toThrow(/missing-plan/)
  })

  it('counts lanes planned when git is unavailable, never merged', async () => {
    const io = ioWith({ runGit: () => Promise.reject(new Error('no git')) })
    expect(await resolveThrough(io, 'M112', '/workspace', { networkAllowed: true })).toEqual([
      'M112:0:planned',
      'M112:Q:running',
    ])
  })

  it('resolves without PRs when gh is unavailable or malformed', async () => {
    // Q stays running from its branch; only the PR link is gone.
    const down = ioWith({ runGh: () => Promise.reject(new Error('no gh')) })
    expect(await resolveThrough(down, 'M112', '/workspace', { networkAllowed: true })).toEqual([
      'M112:0:merged',
      'M112:Q:running',
    ])
    const garbage = ioWith({ runGh: () => Promise.resolve('not json') })
    expect(await resolveThrough(garbage, 'M112', '/workspace', { networkAllowed: true })).toEqual([
      'M112:0:merged',
      'M112:Q:running',
    ])
  })

  it('maps mergedAt PR evidence to merged lanes', async () => {
    const pulls = JSON.stringify([
      { number: 12, headRefName: 'm112/q', state: 'MERGED', mergedAt: '2026-10-09T00:00:00.000Z' },
    ])
    const io = ioWith({ runGh: (args) => Promise.resolve(args.includes('pr') ? pulls : ISSUES) })
    expect(await resolveThrough(io, 'pr:12', '/workspace', { networkAllowed: true })).toEqual([
      'M112:Q:merged',
    ])
  })

  it('never runs gh while the host network is off', async () => {
    let ghCalls = 0
    let gitCalls = 0
    const io = ioWith({
      runGit: (args) => {
        gitCalls += 1
        return Promise.resolve(args.includes('--merged') ? 'm112/0\n' : 'm112/0\nm112/q\n')
      },
      runGh: () => {
        ghCalls += 1
        return Promise.resolve(PULLS)
      },
    })
    expect(await resolveThrough(io, 'M112')).toEqual(['M112:0:merged', 'M112:Q:running'])
    expect(gitCalls).toBeGreaterThan(0)
    expect(ghCalls).toBe(0)
  })

  it('refuses issue and label goals naming the missing lane associations', async () => {
    const io = ioWith()
    const goal = parseEstimateGoal('issues:7')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = createPlanSnapshotSource({ root: '/workspace', io, networkAllowed: true })
    await expect(snapshot(goal, ESTIMATOR_AS_OF)).rejects.toThrow(/missing-associations: issues/)
    const label = parseEstimateGoal('label:bug')
    if (label === undefined) throw new Error('unparseable goal')
    await expect(snapshot(label, ESTIMATOR_AS_OF)).rejects.toThrow(/missing-associations: label/)
  })

  it('refuses a PR goal when gh is unavailable instead of reporting not found', async () => {
    const down = ioWith({ runGh: () => Promise.reject(new Error('no gh')) })
    const goal = parseEstimateGoal('pr:12')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = createPlanSnapshotSource({
      root: '/workspace',
      io: down,
      networkAllowed: true,
    })
    await expect(snapshot(goal, ESTIMATOR_AS_OF)).rejects.toThrow(
      /source-unavailable: pull-requests/,
    )
  })

  it('refuses a PR goal when gh output is malformed', async () => {
    const garbage = ioWith({ runGh: () => Promise.resolve('not json') })
    const goal = parseEstimateGoal('pr:12')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = createPlanSnapshotSource({
      root: '/workspace',
      io: garbage,
      networkAllowed: true,
    })
    await expect(snapshot(goal, ESTIMATOR_AS_OF)).rejects.toThrow(
      /source-unavailable: pull-requests/,
    )
  })

  it('refuses a PR goal while the host network is off', async () => {
    const goal = parseEstimateGoal('pr:12')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = createPlanSnapshotSource({ root: '/workspace', io: ioWith() })
    await expect(snapshot(goal, ESTIMATOR_AS_OF)).rejects.toThrow(
      /source-unavailable: pull-requests/,
    )
  })

  it('aborts without starting further reads once the estimate is canceled', async () => {
    const started: string[] = []
    const io = ioWith({
      readPlanFile: async () => {
        started.push('plan')
        await settleSoon()
        return PLAN
      },
      runGit: () => {
        started.push('git')
        return Promise.resolve('')
      },
      runGh: () => {
        started.push('gh')
        return Promise.resolve('[]')
      },
    })
    const controller = new AbortController()
    const goal = parseEstimateGoal('M112')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = createPlanSnapshotSource({ root: '/workspace', io, networkAllowed: true })
    const pending = snapshot(goal, ESTIMATOR_AS_OF, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(started).toEqual(['plan'])
  })
})

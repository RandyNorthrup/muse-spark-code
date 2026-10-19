import { describe, expect, it } from 'vitest'
import {
  createPlanCheckSource,
  createPlanSnapshotSource,
  type PlanSnapshotSourceIo,
} from '../../src/host/estimator/planSnapshotSource'
import { parseEstimateGoal } from '../../src/shared/estimate'
import { resolveEstimateGoal } from '../../src/core/estimator/goal'
import { ESTIMATOR_AS_OF } from './helpers/estimator/sectionVectors'
import { m112Repo, planWorkspace, type PlanWorkspace } from './helpers/estimator/planWorkspace'

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

const NETWORK = {
  networkPolicy: () =>
    Promise.resolve({
      surface: 'editor' as const,
      mode: 'always' as const,
      githubSignedIn: true,
      allowEgress: () => Promise.resolve(true),
    }),
}

/** The workspace io with plan reads counted, for the refuses-without-reading cases. */
function countingIo(ws: PlanWorkspace): { io: PlanSnapshotSourceIo; reads(): number } {
  let calls = 0
  return {
    io: {
      ...ws.io,
      readPlanFile: (file, signal) => {
        calls += 1
        return ws.io.readPlanFile(file, signal)
      },
    },
    reads: () => calls,
  }
}

async function resolveThrough(
  io: PlanSnapshotSourceIo,
  text: string,
  root: string,
  options: { networkAllowed?: boolean; signal?: AbortSignal } = {},
): Promise<string[]> {
  const goal = parseEstimateGoal(text)
  if (goal === undefined) throw new Error(`unparseable goal: ${text}`)
  const snapshot = createPlanSnapshotSource({
    root,
    io,
    ...(options.networkAllowed && NETWORK),
  })
  const lanes = await resolveEstimateGoal(goal, ESTIMATOR_AS_OF, {
    snapshot: (snapshotGoal, asOf, signal) =>
      snapshot(snapshotGoal, asOf, signal ?? options.signal),
  })
  return lanes.map((lane) => `${lane.id}:${lane.state}`)
}

describe('M117 plan snapshot source', () => {
  it('resolves the workspace plan with git evidence', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      const seen: string[] = []
      const io: PlanSnapshotSourceIo = {
        ...ws.io,
        readPlanFile: (file, signal) => {
          seen.push(file)
          return ws.io.readPlanFile(file, signal)
        },
        // The honest empty answer: no pull requests open.
        runGh: () => Promise.resolve('[]'),
      }
      expect(await resolveThrough(io, 'M112', ws.root, { networkAllowed: true })).toEqual([
        'M112:0:merged',
        'M112:Q:running',
      ])
      expect(seen[0]?.endsWith('PLAN.md')).toBe(true)
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses without reading when the root is empty', async () => {
    const ws = await planWorkspace(PLAN)
    try {
      const { io, reads } = countingIo(ws)
      await expect(resolveThrough(io, 'M112', '', { networkAllowed: true })).rejects.toThrow(
        /missing-plan/,
      )
      expect(reads()).toBe(0)
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses an unreadable plan instead of an empty estimate', async () => {
    const ws = await planWorkspace(PLAN, undefined, { repo: false })
    try {
      // No repository here either: the plan read fails first, for real.
      await expect(
        resolveThrough(ws.io, 'M112', `${ws.root}/no-such-dir`, { networkAllowed: true }),
      ).rejects.toThrow(/missing-plan/)
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses unavailable git evidence for every goal', async () => {
    // A real directory that is not a repository: the machine's own git
    // fails for real, and the source names branches unavailable.
    const ws = await planWorkspace(PLAN, undefined, { repo: false })
    try {
      await expect(resolveThrough(ws.io, 'M112', ws.root)).rejects.toThrow(
        /source-unavailable: branches/,
      )
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses unavailable or malformed enabled PR evidence for every goal', async () => {
    // Malformed bytes asserting refusal, like malformed file bodies
    // elsewhere: never parsed as content. The unavailable case is a plain
    // `gh` failure, as on a machine without a sign-in.
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      const mergedWithoutTimestamp = JSON.stringify([
        { number: 12, headRefName: 'm112/q', state: 'MERGED', mergedAt: null },
      ])
      for (const output of ['not json', '{}', mergedWithoutTimestamp]) {
        const io: PlanSnapshotSourceIo = { ...ws.io, runGh: () => Promise.resolve(output) }
        await expect(resolveThrough(io, 'M112', ws.root, { networkAllowed: true })).rejects.toThrow(
          /source-unavailable: pull-requests/,
        )
      }
      const down: PlanSnapshotSourceIo = {
        ...ws.io,
        runGh: () => Promise.reject(new Error('no gh')),
      }
      await expect(resolveThrough(down, 'M112', ws.root, { networkAllowed: true })).rejects.toThrow(
        /source-unavailable: pull-requests/,
      )
    } finally {
      await ws.cleanup()
    }
  })

  // NOTE (MSM113FIX): the mergedAt-mapping case is gone. It needed pull
  // request content from `gh`, which has no real positive path offline; the
  // mapping itself stays proven through inline evidence (F2 in
  // estimatorSnapshotStrict). Withdrawn in docs/certification/msm113.md.

  it('never runs gh while the host network is off', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      // With no network, a `gh` that ran would fail for real and refuse the
      // source; resolving proves it never ran.
      expect(await resolveThrough(ws.io, 'M112', ws.root)).toEqual([
        'M112:0:merged',
        'M112:Q:running',
      ])
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses issue and label goals naming the missing lane associations', async () => {
    const ws = await planWorkspace(PLAN)
    try {
      const goal = parseEstimateGoal('issues:7')
      if (goal === undefined) throw new Error('unparseable goal')
      const snapshot = createPlanSnapshotSource({ root: ws.root, io: ws.io, ...NETWORK })
      await expect(snapshot(goal, ESTIMATOR_AS_OF)).rejects.toThrow(/missing-associations: issues/)
      const label = parseEstimateGoal('label:bug')
      if (label === undefined) throw new Error('unparseable goal')
      await expect(snapshot(label, ESTIMATOR_AS_OF)).rejects.toThrow(/missing-associations: label/)
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses a PR goal when gh is unavailable instead of reporting not found', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      const down: PlanSnapshotSourceIo = {
        ...ws.io,
        runGh: () => Promise.reject(new Error('no gh')),
      }
      const goal = parseEstimateGoal('pr:12')
      if (goal === undefined) throw new Error('unparseable goal')
      const snapshot = createPlanSnapshotSource({
        root: ws.root,
        io: down,
        ...NETWORK,
      })
      await expect(snapshot(goal, ESTIMATOR_AS_OF)).rejects.toThrow(
        /source-unavailable: pull-requests/,
      )
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses a PR goal when gh output is malformed', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      const garbage: PlanSnapshotSourceIo = {
        ...ws.io,
        runGh: () => Promise.resolve('not json'),
      }
      const goal = parseEstimateGoal('pr:12')
      if (goal === undefined) throw new Error('unparseable goal')
      const snapshot = createPlanSnapshotSource({
        root: ws.root,
        io: garbage,
        ...NETWORK,
      })
      await expect(snapshot(goal, ESTIMATOR_AS_OF)).rejects.toThrow(
        /source-unavailable: pull-requests/,
      )
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses a PR goal while the host network is off', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      const goal = parseEstimateGoal('pr:12')
      if (goal === undefined) throw new Error('unparseable goal')
      const snapshot = createPlanSnapshotSource({ root: ws.root, io: ws.io })
      await expect(snapshot(goal, ESTIMATOR_AS_OF)).rejects.toThrow(
        /source-unavailable: pull-requests/,
      )
    } finally {
      await ws.cleanup()
    }
  })

  it('aborts without starting further reads once the estimate is canceled', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      const started: string[] = []
      const io: PlanSnapshotSourceIo = {
        ...ws.io,
        readPlanFile: async (file, signal) => {
          started.push('plan')
          await new Promise((resolve) => setTimeout(resolve, 50))
          return await ws.io.readPlanFile(file, signal)
        },
        runGit: (args, signal) => {
          started.push('git')
          return ws.io.runGit(args, signal)
        },
        runGh: (args, signal) => {
          started.push('gh')
          return ws.io.runGh(args, signal)
        },
      }
      const controller = new AbortController()
      const goal = parseEstimateGoal('M112')
      if (goal === undefined) throw new Error('unparseable goal')
      const snapshot = createPlanSnapshotSource({ root: ws.root, io, ...NETWORK })
      const pending = snapshot(goal, ESTIMATOR_AS_OF, controller.signal)
      controller.abort()
      await expect(pending).rejects.toThrow()
      expect(started).toEqual(['plan'])
    } finally {
      await ws.cleanup()
    }
  })

  it('lists every plan problem without git or gh evidence', async () => {
    const ws = await planWorkspace(PLAN)
    try {
      const check = createPlanCheckSource({ root: ws.root, io: ws.io })
      await expect(check()).resolves.toEqual([])
      const broken = await planWorkspace(PLAN.replace('after 0', 'after 0 and X'))
      try {
        const brokenCheck = createPlanCheckSource({ root: broken.root, io: broken.io })
        await expect(brokenCheck()).resolves.toEqual(['unknown-prerequisite: M112:X'])
      } finally {
        await broken.cleanup()
      }
    } finally {
      await ws.cleanup()
    }
  })

  it('refuses the check without reading when the plan is missing', async () => {
    const ws = await planWorkspace(PLAN)
    try {
      const { io, reads } = countingIo(ws)
      // A root that really has no PLAN.md fails the read for real.
      await expect(createPlanCheckSource({ root: `${ws.root}/no-such-dir`, io })()).rejects.toThrow(
        /missing-plan: PLAN.md/,
      )
      expect(reads()).toBe(1)
      await expect(createPlanCheckSource({ root: '', io })()).rejects.toThrow(/missing-plan/)
      expect(reads()).toBe(1)
    } finally {
      await ws.cleanup()
    }
  })
})

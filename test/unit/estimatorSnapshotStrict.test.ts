import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stderrLogger } from '../../src/runtime/stderrLog'
import {
  buildPlanSnapshot,
  checkPlan,
  type PlanSnapshotEvidence,
} from '../../src/core/estimator/planSnapshot'
import { resolveEstimateGoal, remainingHours } from '../../src/core/estimator/goal'
import {
  createPlanSnapshotSource,
  type PlanSnapshotSourceIo,
} from '../../src/host/estimator/planSnapshotSource'
import { planSnapshotLoader } from '../../src/host/estimator/planSnapshotBundle'
import { createAcpEstimate } from '../../src/acp/estimate'
import { m112Repo, planWorkspace } from './helpers/estimator/planWorkspace'
import { EstimateViewSession } from '../../src/runtime/estimator/session'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { registerSecretValue } from '../../src/core/redact'
import { estimateFailureText, runEstimateCommand } from '../../src/runtime/estimator/command'
import { parseEstimateGoal, estimateLaneSchema } from '../../src/shared/estimate'
import type { ReportNetworkPolicy } from '../../src/core/reporting/sources/cache'

const AS_OF = '2026-10-10T12:00:00.000Z'
const PLAN = `## 6. Milestones

### M112 — Work (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Work.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Own files | Starts | Rig | Hours |
| ---- | ----- | --------- | ------ | --- | ----- |
| 0 | 1 | \`src/a.ts\` | First | Kubuntu | 8 |
| Q | 1 | \`src/q.ts\` | after 0 | Kubuntu | 5 |

### Delivery order (2026-10-10)

1. **0.16.0: M112** — Release. Needs: main only.
`
function goal(text = 'M112:Q') {
  const parsed = parseEstimateGoal(text)
  if (parsed === undefined) throw new Error('bad test goal')
  return parsed
}
async function resolve(plan = PLAN, evidence: PlanSnapshotEvidence = {}, text = 'M112:Q') {
  return await resolveEstimateGoal(goal(text), AS_OF, {
    snapshot: () => Promise.resolve(buildPlanSnapshot(plan, goal(text), AS_OF, evidence)),
  })
}
// The agent's own logger (src/runtime/stderrLog.ts), its lines kept here.
const snapshotContext = () => ({ asOf: AS_OF, optimize: 'cost' as const })
const unsubscribe = () => undefined

function agentLog() {
  const logged: string[] = []
  return stderrLogger((line) => {
    logged.push(line)
  }, 'warn')
}
function policy(overrides: Partial<ReportNetworkPolicy> = {}): ReportNetworkPolicy {
  return {
    surface: 'editor',
    mode: 'always',
    githubSignedIn: true,
    allowEgress: () => Promise.resolve(true),
    ...overrides,
  }
}

describe('M117 R3 strict snapshot regressions', () => {
  it('F1 rechecks Reports mode sign-in trust and revocation through the cached loader', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      let mode: ReportNetworkPolicy['mode'] = 'always'
      let isSignedIn = true
      let isTrusted = true
      let calls = 0
      const io: PlanSnapshotSourceIo = {
        ...ws.io,
        runGh: (args) => {
          if (args[0] === 'pr') calls += 1
          return Promise.resolve('[]')
        },
      }
      const options = {
        root: ws.root,
        io,
        networkPolicy: () =>
          Promise.resolve(
            policy({
              mode,
              githubSignedIn: isSignedIn,
              allowEgress: () => Promise.resolve(isTrusted),
            }),
          ),
      }
      const source = planSnapshotLoader({
        root: ws.root,
        bundlePath: 'snapshot.js',
        log: agentLog(),
        networkPolicy: options.networkPolicy,
        loadBundle: () => ({
          installPlanSnapshotText: () => undefined,
          createPlanSnapshotSource: () => createPlanSnapshotSource(options),
        }),
      })
      await source(goal(), AS_OF)
      expect(calls).toBe(1)
      mode = 'off'
      await source(goal(), AS_OF)
      mode = 'whenSignedIn'
      isSignedIn = false
      await source(goal(), AS_OF)
      isSignedIn = true
      isTrusted = false
      await source(goal(), AS_OF)
      expect(calls).toBe(1)
    } finally {
      await ws.cleanup()
    }
    const extension = readFileSync('src/extension.ts', 'utf8')
    const binding = extension.slice(
      extension.indexOf('const networkPolicy = estimatorNetworkPolicy('),
      extension.indexOf(
        'return estimatorSourcePorts(',
        extension.indexOf('const snapshot = planSnapshotLoader('),
      ),
    )
    expect(binding).toContain("['reports.network']")
    expect(binding).toContain('getSession')
    expect(binding).toContain('isTrusted')
  })
  it('F2 current replacement branch vetoes a historical merged PR without an open PR', async () => {
    const lanes = await resolve(PLAN, {
      branches: [{ name: 'm112/q-new', merged: false }],
      pullRequests: [{ branch: 'm112/q-old', number: 12, state: 'merged' }],
    })
    expect(lanes.map((lane) => lane.id)).toEqual(['M112:0', 'M112:Q'])
    expect(lanes[1]).toMatchObject({ state: 'running', dependencies: ['M112:0'] })
    const replacement = await resolve(PLAN, {
      branches: [
        { name: 'm112/q-old', merged: true },
        { name: 'm112/q-new', merged: false },
      ],
      pullRequests: [{ branch: 'm112/q-old', number: 12, state: 'merged' }],
    })
    expect(replacement[1]?.state).toBe('running')
  })
  it('F3 determines merged branches from origins default base rather than checked-out HEAD', async () => {
    // The origin default is trunk (lane Q open against it) while HEAD sits
    // on m112/q itself: running proves the merged check used the origin
    // default, which would report merged under HEAD.
    const ws = await planWorkspace(PLAN, async (git) => {
      await git(['branch', '-M', 'main'])
      await git(['branch', 'trunk', 'main'])
      await git(['branch', 'm112/q', 'main'])
      await git(['checkout', 'm112/q'])
      await git(['commit', '--allow-empty', '-m', 'q work'])
      await git(['update-ref', 'refs/remotes/origin/trunk', 'trunk'])
      await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
    })
    try {
      const source = createPlanSnapshotSource({ root: ws.root, io: ws.io })
      const lanes = await resolveEstimateGoal(goal(), AS_OF, { snapshot: source })
      expect(lanes.find((lane) => lane.id === 'M112:Q')?.state).toBe('running')
    } finally {
      await ws.cleanup()
    }
  })
  it('F4 lists every unresolved local self-qualified and foreign-qualified prerequisite', () => {
    const bad = PLAN.replace('after 0', 'after X; after M112:Y; after M999:Z')
    expect(() => buildPlanSnapshot(bad, goal(), AS_OF)).toThrow(
      /unknown-prerequisite:.*M112:X.*M112:Y.*M999:Z/,
    )
    // Lane 0's own closure is clean: the broken Q row outside it does not block.
    expect(
      buildPlanSnapshot(bad, goal('M112:0'), AS_OF).lanes.map((entry) => entry.lane.id),
    ).toEqual(['M112:0'])
    expect(() => buildPlanSnapshot(PLAN.replace('after 0', 'after M999'), goal(), AS_OF)).toThrow(
      /unknown-prerequisite: M999/,
    )
  })
  it('validates strict colon and keyword prerequisite declarations', async () => {
    for (const starts of ['after 0', 'after lane 0', 'after M112:0']) {
      const lanes = await resolve(PLAN.replace('after 0', () => starts))
      expect(lanes[1]?.dependencies).toEqual(['M112:0'])
    }
    {
      const lanes = await resolve(PLAN.replace('after 0', () => 'day 0 (first, kept as a note)'))
      expect(lanes.map((lane) => lane.id)).toEqual(['M112:Q'])
      expect(lanes[0]?.dependencies).toEqual([])
    }
    for (const starts of ['after 0 + X', 'after M112:missing']) {
      expect(() =>
        buildPlanSnapshot(
          PLAN.replace('after 0', () => starts),
          goal(),
          AS_OF,
        ),
      ).toThrow(/unknown-prerequisite:.*M112:/)
    }
    for (const starts of [
      "after 0's interface",
      "after M112's lane missing",
      'after 0, with M112 merged',
      'with M112',
      'throughout',
      'now',
      'after the 0 interface',
    ]) {
      expect(() =>
        buildPlanSnapshot(
          PLAN.replace('after 0', () => starts),
          goal(),
          AS_OF,
        ),
      ).toThrow(/malformed-starts: M112:Q line 14/)
    }
    const duplicate = PLAN.replace('| Q |', '| 0 |')
    expect(() => buildPlanSnapshot(duplicate, goal('M112'), AS_OF)).toThrow(
      /duplicate-lane: M112:0/,
    )
  })
  it('F5 refuses every missing release member even in mixed known membership', () => {
    const bad = PLAN.replace('0.16.0: M112', '0.16.0: M112, M998 and M999')
    expect(() => buildPlanSnapshot(bad, goal('release:0.16.0'), AS_OF)).toThrow(
      /unknown-release-member:.*M998.*M999/,
    )
  })
  it('F6 keeps hour-less completed lanes addressable as lane and PR goals', async () => {
    const plan = PLAN.replace('Kubuntu | 8', 'Kubuntu | —')
    const evidence: PlanSnapshotEvidence = {
      branches: [{ name: 'm112/0', merged: true }],
      pullRequests: [{ number: 12, branch: 'm112/0', state: 'merged' }],
    }
    for (const text of ['M112:0', 'pr:12']) {
      const lanes = await resolve(plan, evidence, text)
      expect(lanes).toHaveLength(1)
      expect(lanes[0]).toMatchObject({ id: 'M112:0', state: 'merged', estimatedHours: 0 })
      expect(remainingHours(lanes[0]!)).toBe(0)
      expect(estimateLaneSchema.safeParse({ ...lanes[0], state: 'planned' }).success).toBe(false)
    }
  })
  it('F7 refuses unknown rig members hidden beside a known rig', () => {
    const bad = PLAN.replace('after 0 | Kubuntu', 'after 0 | Kubuntu + Buildertown')
    expect(() => buildPlanSnapshot(bad, goal(), AS_OF)).toThrow(/unknown-rig:.*buildertown/)
  })
  it('F8 keeps completed prerequisite identity without requiring old rig placement', async () => {
    const plan = PLAN.replace('First | Kubuntu', 'First | Buildertown')
    const lanes = await resolve(plan, { branches: [{ name: 'm112/0', merged: true }] })
    expect(lanes.map((lane) => lane.id)).toEqual(['M112:0', 'M112:Q'])
    expect(lanes[0]).toMatchObject({ state: 'merged', affinity: { os: [] } })
    expect(lanes[1]?.dependencies).toEqual(['M112:0'])
  })
  it('F9 uses the same punctuated lane identity for git state and dependencies', async () => {
    const plan = PLAN.replace('| Q |', '| Integration, done |')
    const lanes = await resolve(
      plan,
      { branches: [{ name: 'm112/integration', merged: true }] },
      'M112:Integration',
    )
    expect(lanes).toHaveLength(1)
    expect(lanes[0]).toMatchObject({ state: 'merged', dependencies: [] })
  })
  it('F10 refuses missing git and malformed enabled PR evidence for ordinary goals', async () => {
    const pull = { number: 12, headRefName: 'm112/q', state: 'OPEN', mergedAt: null }
    // Malformed bytes asserting refusal, like malformed file bodies
    // elsewhere: never parsed as content.
    const malformed = [
      'malformed',
      JSON.stringify([{ ...pull, number: 12.5 }]),
      JSON.stringify([{ ...pull, number: 0 }]),
      JSON.stringify([{ ...pull, state: 'UNKNOWN' }]),
      JSON.stringify([pull, pull]),
      JSON.stringify([{ ...pull, headRefName: '' }]),
      JSON.stringify([{ ...pull, state: 'MERGED', mergedAt: 'yesterday' }]),
    ]
    // No repository: the machine's own git fails for real.
    const bare = await planWorkspace(PLAN, undefined, { repo: false })
    try {
      await expect(
        createPlanSnapshotSource({
          root: bare.root,
          io: bare.io,
          networkPolicy: () => Promise.resolve(policy()),
        })(goal(), AS_OF),
      ).rejects.toThrow(/source-unavailable:/)
    } finally {
      await bare.cleanup()
    }
    // An origin default of bare HEAD: the real symbolic-ref answers a ref
    // the source cannot use as a merge base.
    const odd = await planWorkspace(PLAN, async (git) => {
      await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'HEAD'])
    })
    try {
      await expect(
        createPlanSnapshotSource({ root: odd.root, io: odd.io })(goal(), AS_OF),
      ).rejects.toThrow(/source-unavailable:/)
    } finally {
      await odd.cleanup()
    }
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      for (const output of malformed) {
        const options = {
          root: ws.root,
          io: { ...ws.io, runGh: () => Promise.resolve(output) },
          networkPolicy: () => Promise.resolve(policy()),
        }
        await expect(createPlanSnapshotSource(options)(goal(), AS_OF)).rejects.toThrow(
          /source-unavailable:/,
        )
      }
    } finally {
      await ws.cleanup()
    }
  })
  it('F11 refuses truncated branch evidence rather than claiming not found', async () => {
    // NOTE (MSM113FIX): the capped-PR half is gone. It served 512 pull
    // objects through the `gh` seam, which has no real positive path
    // offline; the capped-PR refusal is withdrawn in
    // docs/certification/msm113.md.
    const many = Array.from({ length: 513 }, (_, index) => `other-${String(index)}`)
    const ws = await planWorkspace(PLAN, async (git, root) => {
      await git(['branch', '-M', 'main'])
      // One spawn for all 513 branches: the same real ref objects, without
      // 513 process starts stalling the repository's own test deadline.
      const revision = await git(['rev-parse', 'HEAD'])
      const head = revision.trim()
      const { execFile } = await import('node:child_process')
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          'git',
          ['update-ref', '--stdin'],
          { cwd: root },
          (error, _stdout, stderr) => {
            if (error === null) resolve()
            else reject(new Error(`batch branches failed: ${stderr}`))
          },
        )
        if (child.stdin === null) reject(new Error('batch branches stdin unavailable'))
        else {
          child.stdin.write(many.map((name) => `create refs/heads/${name} ${head}\n`).join(''))
          child.stdin.end()
        }
      })
      await git(['update-ref', 'refs/remotes/origin/main', 'main'])
      await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
    })
    try {
      await expect(
        createPlanSnapshotSource({ root: ws.root, io: ws.io })(goal(), AS_OF),
      ).rejects.toThrow(/source-incomplete: branches/)
      await expect(
        createPlanSnapshotSource({ root: ws.root, io: ws.io })(goal('pr:1'), AS_OF),
      ).rejects.toThrow(/source-incomplete: branches/)
    } finally {
      await ws.cleanup()
    }
  })
  it('F12 preserves named source diagnostics in ACP and CLI while scrubbing arbitrary failures', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      const snapshot = createPlanSnapshotSource({ root: ws.root, io: ws.io })
      const runner = {
        estimate: async (request: { goal: ReturnType<typeof goal>; asOf: string }) =>
          await snapshot(request.goal, request.asOf),
      }
      const money = { price: () => '' }
      const acp = createAcpEstimate({ context: snapshotContext, runner: () => runner, money })
      const signal = new AbortController().signal
      expect(await acp.run('/estimate M999', '/workspace', signal)).toContain('unknown-goal: M999')
      expect(await acp.run('/estimate issues:7', '/workspace', signal)).toContain(
        'missing-associations: issues',
      )
      const errors: string[] = []
      expect(
        await runEstimateCommand(['pr:12'], {
          context: snapshotContext,
          runner,
          money,
          signal,
          write: () => undefined,
          error: (text) => {
            errors.push(text)
          },
        }),
      ).toBe(1)
      expect(errors.join(', ')).toContain('source-unavailable: pull-requests')
      const view = new EstimateViewSession(
        { goal: goal('pr:12'), fleet: 'current', format: 'text' },
        snapshotContext(),
        runner,
        { subscribe: () => unsubscribe },
        (state) => {
          if (state.status === 'failed') errors.push(estimateFailureText(state.diagnostic))
        },
      )
      await view.refresh()
      view.dispose()
      expect(errors.at(-1)).toContain('source-unavailable: pull-requests')

      const unsafe = createAcpEstimate({
        context: snapshotContext,
        runner: () => ({ estimate: () => Promise.reject(new Error('/private/account')) }),
        money,
      })
      expect(await unsafe.run('/estimate M112', '/workspace', signal)).not.toContain('/private')
      const markerError = Object.assign(new Error('unsafe marker'), {
        estimateDiagnostic: '/private/account',
      })
      const unsafeMarker = createAcpEstimate({
        context: snapshotContext,
        runner: () => ({
          estimate: () => Promise.reject(markerError),
        }),
        money,
      })
      expect(await unsafeMarker.run('/estimate M112', '/workspace', signal)).not.toContain(
        '/private',
      )
      const release = registerSecretValue('sensitive-fixture-value')
      try {
        expect(
          estimateFailureText({
            estimateDiagnostic: 'source-unavailable: sensitive-fixture-value',
          }),
        ).not.toContain('sensitive-fixture-value')
      } finally {
        release()
      }
    } finally {
      await ws.cleanup()
    }
  })
  it('R4 scopes strictness to the goal closure: outside rows never block a forecast', async () => {
    const other = `

### M113 — Elsewhere (2026-10-10)

**Status 2026-10-10: planned.**

- **Goal.** Elsewhere.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Own files | Starts | Rig | Hours |
| ---- | ----- | --------- | ------ | --- | ----- |
| S | 1 | \`src/s.ts\` | after the prose interface | Buildertown | 4 |
| S | 1 | \`src/s.ts\` | after S | Kubuntu | 4 |
`
    const plan = `${PLAN}${other}`
    // M112's own closure is clean: the broken M113 rows do not block it.
    const lanes = await resolve(plan, {}, 'M112:Q')
    expect(lanes.map((lane) => lane.id)).toEqual(['M112:0', 'M112:Q'])
    // The broken milestone still refuses with every problem named at once.
    expect(() => buildPlanSnapshot(plan, goal('M113:S'), AS_OF)).toThrow(
      /duplicate-lane: M113:S.*malformed-starts: M113:S line 31.*unknown-rig: M113:S:buildertown/s,
    )
    // checkPlan lists the whole plan's problems; the clean plan lists none.
    expect(checkPlan(PLAN)).toEqual([])
    expect(checkPlan(plan)).toEqual([
      'duplicate-lane: M113:S',
      expect.stringMatching(/^malformed-starts: M113:S line \d+$/),
      'unknown-rig: M113:S:buildertown',
    ])
  })
  it('R4 refuses a planned lane with Hours 0 as a missing estimate', () => {
    const zero = PLAN.replace(
      '| Q | 1 | `src/q.ts` | after 0 | Kubuntu | 5 |',
      '| Q | 1 | `src/q.ts` | after 0 | Kubuntu | 0 |',
    )
    expect(() => buildPlanSnapshot(zero, goal(), AS_OF)).toThrow(/missing-estimate: M112:Q/)
    expect(estimateFailureText({ estimateDiagnostic: 'missing-estimate: M112:Q' })).toContain(
      'missing-estimate: M112:Q',
    )
    const merged = buildPlanSnapshot(zero, goal(), AS_OF, {
      branches: [{ name: 'm112/q', merged: true }],
    })
    expect(merged.lanes.find((entry) => entry.lane.id === 'M112:Q')?.lane.state).toBe('merged')
  })
  it('R4 lists every plan problem through /estimate --check-plan', async () => {
    const money = { price: () => '' }
    const signal = new AbortController().signal
    const port = createAcpEstimate({
      context: snapshotContext,
      runner: () => ({ estimate: () => Promise.reject(new Error('unused')) }),
      money,
      checkPlan: () =>
        Promise.resolve(['duplicate-lane: M91:S', 'unknown-rig: M113:S:buildertown']),
    })
    expect(await port.run('/estimate --check-plan', '/workspace', signal)).toBe(
      'duplicate-lane: M91:S\nunknown-rig: M113:S:buildertown',
    )
    const clean = createAcpEstimate({
      context: snapshotContext,
      runner: () => ({ estimate: () => Promise.reject(new Error('unused')) }),
      money,
      checkPlan: () => Promise.resolve([]),
    })
    expect(await clean.run('/estimate --check-plan', '/workspace', signal)).toBe('')
    const missing = createAcpEstimate({
      context: snapshotContext,
      runner: () => ({ estimate: () => Promise.reject(new Error('unused')) }),
      money,
    })
    expect(await missing.run('/estimate --check-plan', '/workspace', signal)).toContain(
      'estimate-unavailable',
    )
    expect(await port.run('/estimate M112 --check-plan', '/workspace', signal)).toBe(
      UI_TEXT.estimateUsage,
    )
  })
  it('F15 collects no unusable issue evidence for supported goals', async () => {
    const ws = await planWorkspace(PLAN, m112Repo)
    try {
      const calls: string[][] = []
      const options = {
        root: ws.root,
        io: {
          ...ws.io,
          runGh: (args: readonly string[]) => {
            calls.push([...args])
            return Promise.resolve('[]')
          },
        },
        networkPolicy: () => Promise.resolve(policy()),
      }
      await createPlanSnapshotSource(options)(goal(), AS_OF)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.[0]).toBe('pr')
    } finally {
      await ws.cleanup()
    }
  })
})

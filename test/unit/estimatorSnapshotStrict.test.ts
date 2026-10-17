import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
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
import { fakePlanSourceIo } from './helpers/estimator/kindFakes'
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
function io(overrides: Partial<PlanSnapshotSourceIo> = {}): PlanSnapshotSourceIo {
  return fakePlanSourceIo(PLAN, '[]', '', overrides)
}

/** Git refs answering symbolic-ref plus caller-chosen merged/unmerged lists. */
function gitRefs(merged: string, unmerged: string): (args: readonly string[]) => Promise<string> {
  return (args) => {
    if (args.includes('symbolic-ref')) return Promise.resolve('refs/remotes/origin/main')
    return Promise.resolve(args.includes('--merged') ? merged : unmerged)
  }
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
    let mode: ReportNetworkPolicy['mode'] = 'always'
    let isSignedIn = true
    let isTrusted = true
    let calls = 0
    const options = {
      root: '/workspace',
      io: io({
        runGh: (args) => {
          if (args[0] === 'pr') calls += 1
          return Promise.resolve('[]')
        },
      }),
      networkAllowed: true,
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
      root: '/workspace',
      bundlePath: 'snapshot.js',
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      networkPolicy: options.networkPolicy,
      loadBundle: () => ({
        installPlanSnapshotText: vi.fn(),
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
    const extension = readFileSync('src/extension.ts', 'utf8')
    const binding = extension.slice(
      extension.indexOf('const snapshot = planSnapshotLoader('),
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
    const seen: string[][] = []
    const source = createPlanSnapshotSource({
      root: '/workspace',
      io: io({
        runGit: (args) => {
          seen.push([...args])
          if (args.includes('symbolic-ref')) return Promise.resolve('refs/remotes/origin/trunk\n')
          if (args.includes('--merged'))
            return Promise.resolve(args.includes('HEAD') ? 'm112/q\n' : '')
          return Promise.resolve('m112/q\n')
        },
      }),
    })
    const lanes = await resolveEstimateGoal(goal(), AS_OF, { snapshot: source })
    expect(lanes.find((lane) => lane.id === 'M112:Q')?.state).toBe('running')
    expect(
      seen.some((args) => args.includes('refs/remotes/origin/trunk') && args.includes('--merged')),
    ).toBe(true)
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
    const malformed = [
      'malformed',
      JSON.stringify([{ ...pull, number: 12.5 }]),
      JSON.stringify([{ ...pull, number: 0 }]),
      JSON.stringify([{ ...pull, state: 'UNKNOWN' }]),
      JSON.stringify([pull, pull]),
      JSON.stringify([{ ...pull, headRefName: '' }]),
      JSON.stringify([{ ...pull, state: 'MERGED', mergedAt: 'yesterday' }]),
    ]
    for (const evidenceIo of [
      io({ runGit: () => Promise.reject(new Error('git failed')) }),
      io({ runGit: (args) => Promise.resolve(args.includes('symbolic-ref') ? 'HEAD' : '') }),
      ...malformed.map((output) => io({ runGh: () => Promise.resolve(output) })),
    ]) {
      const options = {
        root: '/workspace',
        io: evidenceIo,
        networkAllowed: true,
        networkPolicy: () => Promise.resolve(policy()),
      }
      await expect(createPlanSnapshotSource(options)(goal(), AS_OF)).rejects.toThrow(
        /source-unavailable:/,
      )
    }
  })
  it('F11 refuses capped PR and truncated branch evidence rather than claiming not found', async () => {
    const pulls = Array.from({ length: 512 }, (_, index) => ({
      number: index + 2,
      headRefName: 'unrelated',
      state: 'OPEN',
      mergedAt: null,
    }))
    const options = {
      root: '/workspace',
      io: io({ runGh: () => Promise.resolve(JSON.stringify(pulls)) }),
      networkAllowed: true,
      networkPolicy: () => Promise.resolve(policy()),
    }
    await expect(createPlanSnapshotSource(options)(goal('pr:1'), AS_OF)).rejects.toThrow(
      /source-incomplete: pull-requests/,
    )
    const branches = Array.from({ length: 513 }, (_, index) => `other-${String(index)}`).join('\n')
    await expect(
      createPlanSnapshotSource({
        root: '/workspace',
        io: io({ runGit: gitRefs('', branches) }),
      })(goal(), AS_OF),
    ).rejects.toThrow(/source-incomplete: branches/)
    await expect(
      createPlanSnapshotSource({
        root: '/workspace',
        io: io({ runGit: gitRefs(branches, 'm112/q') }),
      })(goal(), AS_OF),
    ).rejects.toThrow(/source-incomplete: merged-branches/)
  })
  it('F12 preserves named source diagnostics in ACP and CLI while scrubbing arbitrary failures', async () => {
    const snapshot = createPlanSnapshotSource({ root: '/workspace', io: io() })
    const runner = {
      estimate: async (request: { goal: ReturnType<typeof goal>; asOf: string }) =>
        await snapshot(request.goal, request.asOf),
    }
    const context = vi.fn(() => ({ asOf: AS_OF, optimize: 'cost' as const }))
    const money = { price: () => '' }
    const acp = createAcpEstimate({ context, runner: () => runner, money })
    const signal = new AbortController().signal
    expect(await acp.run('/estimate M999', '/workspace', signal)).toContain('unknown-goal: M999')
    expect(await acp.run('/estimate issues:7', '/workspace', signal)).toContain(
      'missing-associations: issues',
    )
    const errors: string[] = []
    expect(
      await runEstimateCommand(['pr:12'], {
        context,
        runner,
        money,
        signal,
        write: vi.fn(),
        error: (text) => {
          errors.push(text)
        },
      }),
    ).toBe(1)
    expect(errors.join(', ')).toContain('source-unavailable: pull-requests')
    const view = new EstimateViewSession(
      { goal: goal('pr:12'), fleet: 'current', format: 'text' },
      context(),
      runner,
      { subscribe: () => vi.fn() },
      (state) => {
        if (state.status === 'failed') errors.push(estimateFailureText(state.diagnostic))
      },
    )
    await view.refresh()
    view.dispose()
    expect(errors.at(-1)).toContain('source-unavailable: pull-requests')

    const unsafe = createAcpEstimate({
      context,
      runner: () => ({ estimate: () => Promise.reject(new Error('/private/account')) }),
      money,
    })
    expect(await unsafe.run('/estimate M112', '/workspace', signal)).not.toContain('/private')
    const markerError = Object.assign(new Error('unsafe marker'), {
      estimateDiagnostic: '/private/account',
    })
    const unsafeMarker = createAcpEstimate({
      context,
      runner: () => ({
        estimate: () => Promise.reject(markerError),
      }),
      money,
    })
    expect(await unsafeMarker.run('/estimate M112', '/workspace', signal)).not.toContain('/private')
    const release = registerSecretValue('sensitive-fixture-value')
    try {
      expect(
        estimateFailureText({ estimateDiagnostic: 'source-unavailable: sensitive-fixture-value' }),
      ).not.toContain('sensitive-fixture-value')
    } finally {
      release()
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
    const context = vi.fn(() => ({ asOf: AS_OF, optimize: 'cost' as const }))
    const money = { price: () => '' }
    const signal = new AbortController().signal
    const port = createAcpEstimate({
      context,
      runner: () => ({ estimate: () => Promise.reject(new Error('unused')) }),
      money,
      checkPlan: () =>
        Promise.resolve(['duplicate-lane: M91:S', 'unknown-rig: M113:S:buildertown']),
    })
    expect(await port.run('/estimate --check-plan', '/workspace', signal)).toBe(
      'duplicate-lane: M91:S\nunknown-rig: M113:S:buildertown',
    )
    const clean = createAcpEstimate({
      context,
      runner: () => ({ estimate: () => Promise.reject(new Error('unused')) }),
      money,
      checkPlan: () => Promise.resolve([]),
    })
    expect(await clean.run('/estimate --check-plan', '/workspace', signal)).toBe('')
    const missing = createAcpEstimate({
      context,
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
    const calls: string[][] = []
    const options = {
      root: '/workspace',
      io: io({
        runGh: (args) => {
          calls.push([...args])
          return Promise.resolve('[]')
        },
      }),
      networkAllowed: true,
      networkPolicy: () => Promise.resolve(policy()),
    }
    await createPlanSnapshotSource(options)(goal(), AS_OF)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('pr')
  })
})

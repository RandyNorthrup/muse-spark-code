import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildHistory,
  collectHistory,
  type HistoryLane,
} from '../../src/core/estimator/calibration/builders'
import { EstimateHistoryJournal } from '../../src/core/estimator/calibration/journal'
import {
  ciDurationSource,
  gitDurationSource,
  playbookReviewSource,
} from '../../src/core/estimator/calibration/sources'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'

const LANE = 'M117:C'
const BRANCH = 'm117/c'
const TIP = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const FOREIGN = 'c'.repeat(40)
const FIRST = '2026-10-01T08:00:00.000Z'
const MERGED = '2026-10-05T10:00:00.000Z'

function lane(laneId = LANE): HistoryLane {
  return { laneId, kind: 'core', estimatedHours: 2, state: 'merged' }
}

interface GitScenario {
  branches?: readonly string[]
  tip?: string | undefined
  base?: string | undefined
  first?: string | undefined
  merged?: string | undefined
  fail?: readonly string[]
}

/** A git that answers the history queries; commands in `fail` reject like a nonzero exit. */
function fakeGit(scenario: GitScenario = {}): (args: readonly string[]) => Promise<string> {
  // Explicit undefined means absent: destructuring defaults would revive it.
  const branches = scenario.branches ?? [BRANCH, 'main']
  const tip = 'tip' in scenario ? scenario.tip : TIP
  const base = 'base' in scenario ? scenario.base : BASE
  const first = 'first' in scenario ? scenario.first : FIRST
  const merged = 'merged' in scenario ? scenario.merged : MERGED
  const fail = scenario.fail ?? []
  return (args) => {
    const command = args.join(' ')
    const failWith = (code: number): Promise<never> =>
      Promise.reject(Object.assign(new Error(`exit ${String(code)}: ${command}`), { code }))
    if (fail.some((entry) => command.startsWith(entry))) return failWith(1)
    if (args[0] === 'for-each-ref') return Promise.resolve(`${branches.join('\n')}\n`)
    if (args[0] === 'symbolic-ref') return Promise.resolve('refs/remotes/origin/main\n')
    if (args[0] === 'rev-parse') return Promise.resolve(tip === undefined ? '' : `${tip}\n`)
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return failWith(1)
    if (args[0] === 'merge-base')
      return base === undefined ? failWith(1) : Promise.resolve(`${base}\n`)
    if (args[0] === 'log' && args.includes('--reverse'))
      return Promise.resolve(first === undefined ? '' : `${first}\n`)
    if (args[0] === 'log') return Promise.resolve(merged === undefined ? '' : `${merged}\n`)
    return Promise.reject(new Error(`unexpected git call: ${command}`))
  }
}

function git(scenario: GitScenario = {}): {
  duration: (laneId: string, asOf: string) => Promise<unknown>
} {
  return gitDurationSource({
    root: '/repo',
    runGit: fakeGit(scenario),
    machineClassFor: () => 'linux-x64-builder',
  })
}

interface RoundScenario {
  laneId?: string
  round?: number
  phase?: 'build' | 'fix' | 'redesign'
  findings?: readonly { id: string; file: string; severity: 'P1' | 'P2'; class?: 'validation' }[]
  answers?: readonly { findingId: string; status: 'fixed' }[]
  at?: number
  moduleId?: string
}

function roundRecord(scenario: RoundScenario = {}): unknown {
  const {
    laneId = LANE,
    round = 1,
    phase = 'build',
    findings = [],
    answers = [],
    at = Date.parse('2026-10-02T00:00:00.000Z'),
    moduleId = 'm117-c',
  } = scenario
  return {
    kind: 'round',
    value: {
      module: {
        id: moduleId,
        key: 'src/core/estimator/calibration/sources.ts',
        files: ['src/a.ts'],
        source: 'lane',
      },
      implementerId: 'implementer',
      reviewerId: 'reviewer',
      implementerSessionId: 'session-a',
      reviewerSessionId: 'session-b',
      lease: { moduleId, laneId, ownerId: 'owner', generation: '1' },
      round,
      phase,
      findings: findings.map((finding) => ({ ...finding })),
      answers: answers.map((answer) => ({ ...answer })),
      at,
    },
  }
}

function review(records: readonly unknown[]): {
  review: (laneId: string, asOf: string) => Promise<unknown>
} {
  return playbookReviewSource({ read: () => records })
}

function checkRuns(): { duration: (laneId: string, asOf: string) => Promise<unknown> } {
  return ciDurationSource({
    root: '/repo',
    runGit: (args: readonly string[]) => {
      const command = args.join(' ')
      if (args[0] === 'for-each-ref') return Promise.resolve(`${BRANCH}\nmain\n`)
      if (args[0] === 'rev-parse') return Promise.resolve(`${TIP}\n`)
      if (args[0] === 'merge-base')
        return args[2] === FOREIGN
          ? Promise.reject(Object.assign(new Error('exit 1'), { code: 1 }))
          : Promise.resolve(`${TIP}\n`)
      return Promise.reject(new Error(`unexpected git call: ${command}`))
    },
    readCheckRuns: () => [
      { check: 'unit', outcome: 'passed', durationMs: 3_600_000, commit: TIP, at: FIRST },
      { check: 'lint', outcome: 'failed', durationMs: 1_800_000, commit: TIP, at: FIRST },
      { check: 'other', outcome: 'passed', durationMs: 7_200_000, commit: FOREIGN, at: FIRST },
    ],
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  setUiText(EN, BASE_LOCALE)
})

describe('M117 git history source', () => {
  it('builds elapsed time from the lane branch first commit to its merge', async () => {
    const built = await buildHistory([lane()], { git: git() }, ESTIMATOR_AS_OF)
    expect(built.excluded).toEqual([])
    expect(built.records).toHaveLength(1)
    expect(built.records[0]).toMatchObject({
      laneId: LANE,
      durationBasis: 'gitElapsed',
      source: 'git',
      machineClassId: 'linux-x64-builder',
      startedAt: FIRST,
      finishedAt: MERGED,
      actualHours: 98,
      review: { status: 'unknown' },
    })
  })

  it('stays missing without a branch, with an ambiguous branch or without a tip', async () => {
    for (const scenario of [
      { branches: ['main'] },
      { branches: [BRANCH, 'm117/c-retry', 'main'] },
      { tip: undefined },
      { merged: undefined },
      { first: undefined },
    ]) {
      const built = await buildHistory([lane()], { git: git(scenario) }, ESTIMATOR_AS_OF)
      expect(built).toEqual({
        records: [],
        excluded: [{ laneId: LANE, reason: 'missingDuration' }],
      })
    }
  })

  it('stays missing when git is unavailable instead of failing the build', async () => {
    const failing = gitDurationSource({
      root: '/repo',
      runGit: () => Promise.reject(new Error('exit 127')),
      machineClassFor: () => 'linux-x64-builder',
    })
    const built = await buildHistory([lane()], { git: failing }, ESTIMATOR_AS_OF)
    expect(built).toEqual({ records: [], excluded: [{ laneId: LANE, reason: 'missingDuration' }] })
  })

  it('stays missing without a machine class rather than guessing one', async () => {
    const built = await buildHistory(
      [lane()],
      {
        git: gitDurationSource({
          root: '/repo',
          runGit: fakeGit(),
          machineClassFor: () => undefined,
        }),
      },
      ESTIMATOR_AS_OF,
    )
    expect(built).toEqual({ records: [], excluded: [{ laneId: LANE, reason: 'missingDuration' }] })
  })

  it('fails loudly on malformed git output', async () => {
    const built = buildHistory([lane()], { git: git({ first: 'not a date' }) }, ESTIMATOR_AS_OF)
    await expect(built).rejects.toMatchObject({ code: 'invalidHistorySource' })
  })
})

describe('M117 playbook history source', () => {
  it('projects complete rounds with module strikes once per lane', async () => {
    const source = review([
      roundRecord({
        findings: [
          { id: 'f1', file: 'src/a.ts', severity: 'P2' },
          { id: 'f2', file: 'src/a.ts', severity: 'P1' },
        ],
        answers: [{ findingId: 'f1', status: 'fixed' }],
      }),
      roundRecord({ round: 2, phase: 'fix', findings: [], answers: [] }),
    ])
    const built = await buildHistory([lane()], { git: git(), playbook: source }, ESTIMATOR_AS_OF)
    expect(built.excluded).toEqual([])
    expect(built.records[0]?.review).toEqual({
      status: 'known',
      rounds: 2,
      modules: [{ familyId: 'm117-c', strikes: 1, classes: [] }],
      redesigns: [],
    })
  })

  it('counts class strikes and redesign rounds per family', async () => {
    const source = review([
      roundRecord({
        findings: [{ id: 'f1', file: 'src/a.ts', severity: 'P2', class: 'validation' }],
        answers: [],
      }),
      roundRecord({ round: 2, phase: 'redesign', findings: [], answers: [] }),
    ])
    const result = await source.review(LANE, ESTIMATOR_AS_OF)
    expect(result).toEqual({
      status: 'known',
      rounds: 2,
      modules: [
        {
          familyId: 'm117-c',
          strikes: 1,
          classes: [{ class: 'validationSecurity', strikes: 1 }],
        },
      ],
      redesigns: [{ moduleFamilyId: 'm117-c', afterRound: 2, outcome: 'caught' }],
    })
  })

  it('keeps unattributed and future rounds out of the projection', async () => {
    const source = review([
      roundRecord({ laneId: 'M117:other' }),
      roundRecord({ at: Date.parse('2026-10-20T00:00:00.000Z') }),
      {
        kind: 'note',
        value: {
          rule: 'threeStrikes',
          code: 'checksPassed',
          at: Date.parse('2026-10-02T00:00:00.000Z'),
          needsUser: false,
        },
      },
    ])
    expect(await source.review(LANE, ESTIMATOR_AS_OF)).toEqual({ status: 'unknown' })
  })

  it('reports an unreadable journal loudly instead of projecting unknown', async () => {
    const source = playbookReviewSource({
      read: () => [{ kind: 'round', value: { round: 'first' } }],
    })
    await expect(source.review(LANE, ESTIMATOR_AS_OF)).rejects.toMatchObject({
      code: 'historySourceUnavailable',
    })
  })
})

describe('M117 CI history source', () => {
  it('sums ancestor check durations as job-hours, never wall time', async () => {
    const built = await buildHistory([lane()], { git: git(), ci: checkRuns() }, ESTIMATOR_AS_OF)
    expect(built.excluded).toEqual([])
    // 60 job-minutes plus 30 job-minutes on the lane tip; the foreign commit stays out.
    expect(built.records[0]).toMatchObject({ ciHours: 1.5 })
  })

  it('stays missing without runs and fails loudly on malformed runs', async () => {
    const empty = ciDurationSource({
      root: '/repo',
      runGit: fakeGit(),
      readCheckRuns: () => [],
    })
    const built = await buildHistory([lane()], { git: git(), ci: empty }, ESTIMATOR_AS_OF)
    expect(built.records[0]).not.toHaveProperty('ciHours')
    const malformed = ciDurationSource({
      root: '/repo',
      runGit: fakeGit(),
      readCheckRuns: () => [
        { check: 'unit', outcome: 'passed', durationMs: -1, commit: TIP, at: FIRST },
      ],
    })
    // A throwing source reaches buildHistory as historySourceUnavailable;
    // direct callers see the structural code.
    await expect(
      buildHistory([lane()], { git: git(), ci: malformed }, ESTIMATOR_AS_OF),
    ).rejects.toMatchObject({
      code: 'historySourceUnavailable',
    })
    await expect(malformed.duration(LANE, ESTIMATOR_AS_OF)).rejects.toMatchObject({
      code: 'invalidHistorySource',
    })
  })
})

describe('M117 history collection with concrete sources', () => {
  let directory: string
  beforeEach(async () => {
    await mkdir(path.resolve('temp/m117-c'), { recursive: true })
    directory = await mkdtemp(path.resolve('temp/m117-c/sources-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('collects git durations with playbook review and CI hours into the journal', async () => {
    const journal = new EstimateHistoryJournal(path.join(directory, 'history'))
    const source = review([
      roundRecord({
        findings: [{ id: 'f1', file: 'src/a.ts', severity: 'P2' }],
        answers: [{ findingId: 'f1', status: 'fixed' }],
      }),
    ])
    const built = await collectHistory(
      journal,
      [lane()],
      { git: git(), playbook: source, ci: checkRuns() },
      ESTIMATOR_AS_OF,
    )
    expect(built.excluded).toEqual([])
    expect(built.records).toHaveLength(1)
    expect(await journal.list()).toEqual(built.records)
    expect(built.records[0]).toMatchObject({
      source: 'git',
      durationBasis: 'gitElapsed',
      ciHours: 1.5,
      review: { status: 'known', rounds: 1 },
    })
  })
})

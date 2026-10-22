// The estimator history's concrete sources over real inputs: a real temp
// git repository (fixed dates, origin refs crafted locally, no network) for
// lane elapsed time and CI ancestry, and the real M116 file journal for
// review rounds. Missing measurements stay missing with their reason;
// malformed store rows fail loudly, never silently.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
import {
  FilePlaybookJournal,
  validatedRecords,
} from '../../src/core/orchestration/playbook/journal'
import { ESTIMATOR_AS_OF } from './helpers/estimator/sectionVectors'

const LANE = 'M117:C'
const FIRST_ISO = '2026-10-01T08:00:00.000Z'
const MERGED_ISO = '2026-10-05T10:00:00.000Z'

function lane(): HistoryLane {
  return { laneId: LANE, kind: 'core', estimatedHours: 2, state: 'merged' }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function scratch(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/** The machine's own git in a root, rejecting with the real exit code. */
function runGitIn(root: string) {
  return (args: readonly string[], env?: NodeJS.ProcessEnv): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(
        'git',
        [...args],
        { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } },
        (error, stdout) => {
          if (error === null) {
            resolve(stdout)
            return
          }
          // Keep the real exit code: the CI source tells a non-ancestor
          // (exit 1) from an unreadable repository by it.
          reject(Object.assign(new Error(`git ${args.join(' ')} failed`), { code: error.code }))
        },
      )
    })
}

const at = (date: string): NodeJS.ProcessEnv => ({
  GIT_AUTHOR_DATE: date,
  GIT_COMMITTER_DATE: date,
})

type RepoShape = 'full' | 'open' | 'single' | 'none' | 'ambiguous' | 'broken' | 'noOrigin'

interface HistoryRepo {
  readonly root: string
  readonly tip: string
  readonly foreign: string | undefined
}

/** A real repository shaped like a finished lane: branch m117/c cut from
main, one lane commit, merged back with --no-ff. All stamps carry an
explicit +00:00 offset, so the instants hold across time zones. The origin
refs are crafted locally, exactly as a clone would record them. */
async function historyRepo(shape: RepoShape): Promise<HistoryRepo> {
  const root = await scratch('m117-history-')
  const git = runGitIn(root)
  await git(['init'])
  await git(['config', 'user.email', 'vector@example.com'])
  await git(['config', 'user.name', 'vector'])
  await git(['commit', '--allow-empty', '-m', 'base'], at('2026-09-30T00:00:00+00:00'))
  await git(['branch', '-M', 'main'])
  if (shape === 'none') return { root, tip: '', foreign: undefined }
  await git(['branch', 'm117/c', 'main'])
  if (shape === 'ambiguous') await git(['branch', 'm117/c-retry', 'main'])
  if (shape === 'broken') {
    // A corrupt lane ref: listed by for-each-ref, pointing at no object, so
    // the history reads fail and the lane stays missing. Written to the
    // loose ref directly: the porcelain refuses non-commit branch tips.
    await git(['checkout', '--quiet', 'main'])
    await writeFile(path.join(root, '.git', 'refs', 'heads', 'm117', 'c'), `${'f'.repeat(40)}\n`)
  } else {
    await git(['checkout', 'm117/c'])
    if (shape !== 'single') {
      await git(['commit', '--allow-empty', '-m', 'lane work'], at('2026-10-01T08:00:00+00:00'))
    }
    await git(['checkout', 'main'])
  }
  if (shape === 'full' || shape === 'noOrigin') {
    await git(['merge', '--no-ff', '-m', 'merge lane', 'm117/c'], at('2026-10-05T10:00:00+00:00'))
    await git(['commit', '--allow-empty', '-m', 'unrelated'], at('2026-10-06T00:00:00+00:00'))
  }
  if (['full', 'open', 'single', 'ambiguous', 'broken'].includes(shape)) {
    await git(['update-ref', 'refs/remotes/origin/main', 'main'])
    await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
  }
  const tipRef = shape === 'broken' ? '' : await git(['rev-parse', 'm117/c'])
  const foreignRef = shape === 'full' ? await git(['rev-parse', 'main']) : undefined
  return { root, tip: tipRef.trim(), foreign: foreignRef?.trim() }
}

function gitSource(
  repo: HistoryRepo,
  machineClassFor: (laneId: string) => string | undefined = () => 'linux-x64-builder',
): { duration: (laneId: string, asOf: string) => Promise<unknown> } {
  // No runGit override: the source shells the machine's own git in the root.
  return gitDurationSource({ root: repo.root, machineClassFor })
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

/** The rounds through the real file journal: validated on the way in by the
journal's own schema, read back from disk by the source. */
async function review(records: readonly unknown[]): Promise<{
  review: (laneId: string, asOf: string) => Promise<unknown>
}> {
  const journal = new FilePlaybookJournal(
    await scratch('m117-playbook-agent-'),
    await scratch('m117-playbook-work-'),
  )
  journal.replace(validatedRecords(records), [])
  return playbookReviewSource({ read: () => journal.read() })
}

/** Check runs from the lane store's own rows, keyed by the repo's real SHAs:
only ancestors of the lane tip count, never concurrent wall time. */
function checkRuns(repo: HistoryRepo): {
  duration: (laneId: string, asOf: string) => Promise<unknown>
} {
  if (repo.foreign === undefined) throw new Error('checkRuns needs the full repo')
  const tip = repo.tip
  const foreign = repo.foreign
  return ciDurationSource({
    root: repo.root,
    readCheckRuns: () => [
      { check: 'unit', outcome: 'passed', durationMs: 3_600_000, commit: tip, at: FIRST_ISO },
      { check: 'lint', outcome: 'failed', durationMs: 1_800_000, commit: tip, at: FIRST_ISO },
      { check: 'other', outcome: 'passed', durationMs: 7_200_000, commit: foreign, at: FIRST_ISO },
    ],
  })
}

describe('M117 git history source', () => {
  it('builds elapsed time from the lane branch first commit to its merge', async () => {
    const repo = await historyRepo('full')
    const built = await buildHistory([lane()], { git: gitSource(repo) }, ESTIMATOR_AS_OF)
    expect(built.excluded).toEqual([])
    expect(built.records).toHaveLength(1)
    expect(built.records[0]).toMatchObject({
      laneId: LANE,
      durationBasis: 'gitElapsed',
      source: 'git',
      machineClassId: 'linux-x64-builder',
      startedAt: FIRST_ISO,
      finishedAt: MERGED_ISO,
      actualHours: 98,
      review: { status: 'unknown' },
    })
  })

  it('stays missing without a branch, an ambiguous branch, a corrupt tip, no origin, no merge or no first commit', async () => {
    for (const shape of ['none', 'ambiguous', 'broken', 'noOrigin', 'open', 'single'] as const) {
      const repo = await historyRepo(shape)
      const built = await buildHistory([lane()], { git: gitSource(repo) }, ESTIMATOR_AS_OF)
      expect(built).toEqual({
        records: [],
        excluded: [{ laneId: LANE, reason: 'missingDuration' }],
      })
    }
  })

  it('stays missing outside a repository instead of failing the build', async () => {
    const root = await scratch('m117-history-plain-')
    const missing = gitDurationSource({
      root,
      machineClassFor: () => 'linux-x64-builder',
    })
    const built = await buildHistory([lane()], { git: missing }, ESTIMATOR_AS_OF)
    expect(built).toEqual({ records: [], excluded: [{ laneId: LANE, reason: 'missingDuration' }] })
  })

  it('stays missing without a machine class rather than guessing one', async () => {
    const repo = await historyRepo('full')
    const built = await buildHistory(
      [lane()],
      { git: gitSource(repo, () => undefined) },
      ESTIMATOR_AS_OF,
    )
    expect(built).toEqual({ records: [], excluded: [{ laneId: LANE, reason: 'missingDuration' }] })
  })
})

describe('M117 playbook history source', () => {
  it('projects complete rounds with module strikes once per lane', async () => {
    const repo = await historyRepo('full')
    const source = await review([
      roundRecord({
        findings: [
          { id: 'f1', file: 'src/a.ts', severity: 'P2' },
          { id: 'f2', file: 'src/a.ts', severity: 'P1' },
        ],
        answers: [{ findingId: 'f1', status: 'fixed' }],
      }),
      roundRecord({ round: 2, phase: 'fix', findings: [], answers: [] }),
    ])
    const built = await buildHistory(
      [lane()],
      { git: gitSource(repo), playbook: source },
      ESTIMATOR_AS_OF,
    )
    expect(built.excluded).toEqual([])
    expect(built.records[0]?.review).toEqual({
      status: 'known',
      rounds: 2,
      modules: [{ familyId: 'm117-c', strikes: 1, classes: [] }],
      redesigns: [],
    })
  })

  it('counts class strikes and redesign rounds per family', async () => {
    const source = await review([
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
    const source = await review([
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

  it('reports a damaged journal file loudly instead of projecting unknown', async () => {
    const agentData = await scratch('m117-playbook-agent-')
    const journal = new FilePlaybookJournal(agentData, await scratch('m117-playbook-work-'))
    await mkdir(path.dirname(journal.file), { recursive: true })
    await writeFile(journal.file, '{\n', 'utf8')
    const source = playbookReviewSource({ read: () => journal.read() })
    await expect(source.review(LANE, ESTIMATOR_AS_OF)).rejects.toMatchObject({
      code: 'historySourceUnavailable',
    })
  })
})

describe('M117 CI history source', () => {
  it('sums ancestor check durations as job-hours, never wall time', async () => {
    const repo = await historyRepo('full')
    const built = await buildHistory(
      [lane()],
      { git: gitSource(repo), ci: checkRuns(repo) },
      ESTIMATOR_AS_OF,
    )
    expect(built.excluded).toEqual([])
    // 60 job-minutes plus 30 job-minutes on the lane tip; the foreign commit stays out.
    expect(built.records[0]).toMatchObject({ ciHours: 1.5 })
  })

  it('stays missing without runs and fails loudly on malformed runs', async () => {
    const repo = await historyRepo('full')
    const empty = ciDurationSource({ root: repo.root, readCheckRuns: () => [] })
    const built = await buildHistory([lane()], { git: gitSource(repo), ci: empty }, ESTIMATOR_AS_OF)
    expect(built.records[0]).not.toHaveProperty('ciHours')
    const malformed = ciDurationSource({
      root: repo.root,
      readCheckRuns: () => [
        { check: 'unit', outcome: 'passed', durationMs: -1, commit: repo.tip, at: FIRST_ISO },
      ],
    })
    // A throwing source reaches buildHistory as historySourceUnavailable;
    // direct callers see the structural code.
    await expect(
      buildHistory([lane()], { git: gitSource(repo), ci: malformed }, ESTIMATOR_AS_OF),
    ).rejects.toMatchObject({
      code: 'historySourceUnavailable',
    })
    await expect(malformed.duration(LANE, ESTIMATOR_AS_OF)).rejects.toMatchObject({
      code: 'invalidHistorySource',
    })
  })
})

describe('M117 history collection with concrete sources', () => {
  it('collects git durations with playbook review and CI hours into the journal', async () => {
    const repo = await historyRepo('full')
    const journal = new EstimateHistoryJournal(`${await scratch('m117-history-collect-')}/history`)
    const source = await review([
      roundRecord({
        findings: [{ id: 'f1', file: 'src/a.ts', severity: 'P2' }],
        answers: [{ findingId: 'f1', status: 'fixed' }],
      }),
    ])
    const built = await collectHistory(
      journal,
      [lane()],
      { git: gitSource(repo), playbook: source, ci: checkRuns(repo) },
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

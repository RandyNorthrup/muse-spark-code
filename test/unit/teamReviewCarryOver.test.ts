// M96d review carry-over: real git worktrees, real oids, real patch
// IDs. A review carries a change to its branch only for files whose
// exact delta is unchanged since the review read them.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { TaskBoard } from '../../src/core/team/scheduler/board'
import {
  decideReviewCarryOver,
  selectChangedByPatchId,
  type CarryFileDelta,
  type CarryFileVerdict,
} from '../../src/core/team/scheduler/reviewCarryOver'
import {
  ReviewFlow,
  type ReviewDependencies,
  type ReviewRequest,
} from '../../src/core/team/scheduler/reviewFlow'
import { resolveWorkingGit } from './helpers/realGit'
import {
  boardAttempt,
  retireAttempt,
  submitTasks,
  taskSubmission,
  testBoard,
  testBoardContext,
} from './helpers/teamBoard'

const workingGit: Promise<string> = resolveWorkingGit()

function delta(
  path: string,
  baseOid: string,
  headOid: string,
  headMode = '100644',
): CarryFileDelta {
  return { path, baseOid, baseMode: '100644', headOid, headMode }
}

function verdict(
  over: CarryFileDelta,
  isClean: boolean,
  findings: readonly string[] = [],
): CarryFileVerdict<string> {
  return { delta: over, verdict: isClean ? 'clean' : 'findings', findings }
}

describe('M96d carry-over decision', () => {
  it('carries only exact deltas and drops removed files silently', () => {
    const prior = [
      verdict(delta('a.ts', 'base-a', 'head-a'), true),
      verdict(delta('b.ts', 'base-b', 'head-b'), true),
      verdict(delta('gone.ts', 'base-g', 'head-g'), true),
    ]
    const current = [
      delta('a.ts', 'base-a', 'head-a'),
      delta('b.ts', 'base-b', 'head-b2'),
      delta('new.ts', '0'.repeat(40), 'head-n'),
    ]
    const decision = decideReviewCarryOver(prior, current, {
      integrationChanged: [],
      readSets: new Map(),
    })
    expect(decision.carried.map((entry) => entry.delta.path)).toEqual(['a.ts'])
    expect(decision.reReview).toEqual(['b.ts', 'new.ts'])
  })

  it('treats base, mode and whitespace-only head changes as changed', () => {
    const prior = [
      verdict(delta('base.ts', 'base-1', 'head-1'), true),
      verdict(delta('mode.ts', 'base-2', 'head-2'), true),
      verdict(delta('ws.ts', 'base-3', 'head-3'), true),
    ]
    const current = [
      delta('base.ts', 'base-1b', 'head-1'),
      delta('mode.ts', 'base-2', 'head-2', '100755'),
      delta('ws.ts', 'base-3', 'head-3b'),
    ]
    const decision = decideReviewCarryOver(prior, current, {
      integrationChanged: [],
      readSets: new Map(),
    })
    expect(decision.carried).toEqual([])
    expect(decision.reReview).toEqual(['base.ts', 'mode.ts', 'ws.ts'])
  })

  it('re-reviews an unchanged delta when the context touches what it reads', () => {
    const prior = [
      verdict(delta('a.ts', 'base-a', 'head-a'), true),
      verdict(delta('b.ts', 'base-b', 'head-b'), true),
    ]
    const current = [delta('a.ts', 'base-a', 'head-a'), delta('b.ts', 'base-b', 'head-b')]
    const readSets = new Map([
      ['a.ts', ['lib.ts']],
      ['b.ts', []],
    ])
    const touched = decideReviewCarryOver(prior, current, {
      integrationChanged: ['lib.ts'],
      readSets,
    })
    expect(touched.carried.map((entry) => entry.delta.path)).toEqual(['b.ts'])
    expect(touched.reReview).toEqual(['a.ts'])
    const missed = decideReviewCarryOver(prior, current, {
      integrationChanged: ['other.ts'],
      readSets,
    })
    expect(missed.carried.map((entry) => entry.delta.path)).toEqual(['a.ts', 'b.ts'])
    expect(missed.reReview).toEqual([])
  })

  it('carries nothing on an unknown context and preserves carried findings', () => {
    const prior = [
      verdict(delta('a.ts', 'base-a', 'head-a'), false, ['finding-1']),
      verdict(delta('b.ts', 'base-b', 'head-b'), true),
    ]
    const current = [delta('a.ts', 'base-a', 'head-a'), delta('b.ts', 'base-b', 'head-b')]
    expect(decideReviewCarryOver(prior, current, { readSets: new Map() }).reReview).toEqual([
      'a.ts',
      'b.ts',
    ])
    expect(decideReviewCarryOver(prior, current, { integrationChanged: [] }).reReview).toEqual([
      'a.ts',
      'b.ts',
    ])
    expect(decideReviewCarryOver(prior, current).reReview).toEqual(['a.ts', 'b.ts'])
    const known = decideReviewCarryOver(prior, current, {
      integrationChanged: [],
      readSets: new Map(),
    })
    expect(known.carried).toEqual(prior)
    expect(known.reReview).toEqual([])
  })

  it('partitions by patch ID but never accepts on it', () => {
    expect(
      selectChangedByPatchId(['a.ts', 'b.ts', 'c.ts'], {
        before: new Map([['a.ts', 'p1']]),
        after: new Map([['a.ts', 'p2']]),
      }),
    ).toEqual({ definitelyChanged: ['a.ts'], needsCompare: ['b.ts', 'c.ts'] })
    expect(selectChangedByPatchId(['a.ts'], undefined)).toEqual({
      definitelyChanged: [],
      needsCompare: ['a.ts'],
    })
    // Equal patch IDs with differing bytes still re-review: the hint
    // ignores whitespace, even inside strings.
    const prior = [verdict(delta('ws.ts', 'base', 'head-1'), true)]
    const current = [delta('ws.ts', 'base', 'head-2')]
    const hints = {
      before: new Map([['ws.ts', 'same-patch']]),
      after: new Map([['ws.ts', 'same-patch']]),
    }
    const decision = decideReviewCarryOver(prior, current, {
      patchHints: hints,
      integrationChanged: [],
      readSets: new Map(),
    })
    expect(decision.carried).toEqual([])
    expect(decision.reReview).toEqual(['ws.ts'])
  })
})

interface CarryRepo {
  root: string
  base: string
}

const GIT = await workingGit

function git(args: readonly string[], cwd: string, input?: string): string {
  return execFileSync(GIT, [...args], {
    cwd,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function scratchRepo(): CarryRepo {
  const root = mkdtempSync(path.join(tmpdir(), 'm96d-carry-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  git(['init', '-b', 'main'], root)
  git(['config', 'user.name', 'Carry'], root)
  git(['config', 'user.email', 'carry@example.invalid'], root)
  writeFileSync(path.join(root, 'a.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'b.ts'), 'export const b = 1\n')
  writeFileSync(path.join(root, 'lib.ts'), 'export const lib = 1\n')
  git(['add', '.'], root)
  git(['commit', '-m', 'base'], root)
  return { root, base: git(['rev-parse', 'HEAD'], root).trim() }
}

function commitChange(repo: CarryRepo, files: Record<string, string>): string {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(repo.root, name), content)
  }
  git(['add', '.'], repo.root)
  git(['commit', '-m', 'change'], repo.root)
  return git(['rev-parse', 'HEAD'], repo.root).trim()
}

/** A harness with its head on a fresh change, before any round runs. */
function harnessOnChange(files: Record<string, string>): {
  repo: CarryRepo
  harness: CarryHarness
} {
  const repo = scratchRepo()
  const harness = carryHarness(repo, repo.base, {
    integrationChanged: [],
    readSets: new Map(),
  })
  harness.setHead(commitChange(repo, files))
  return { repo, harness }
}

/** An empty commit adopted as the head: same bytes, new head. */
function advanceEmptyHead(repo: CarryRepo, harness: CarryHarness): void {
  git(['commit', '--allow-empty', '-m', 'empty'], repo.root)
  harness.setHead(git(['rev-parse', 'HEAD'], repo.root).trim())
}

/** The second round re-reviewed exactly one file, after six class requests. */
async function expectSingleFileSecondRound(harness: CarryHarness, file: string): Promise<void> {
  expect(await retireAndReview(harness, 2)).toBe('reviewed')
  expect(harness.requests).toHaveLength(6)
  expect(harness.requests[3]?.files).toEqual([file])
}

/** This diff's real stable patch ID, or empty when the file is unchanged. */
function patchId(repo: CarryRepo, base: string, head: string, file: string): string {
  const diff = git(['diff', `${base}..${head}`, '--', file], repo.root)
  return diff === '' ? '' : (git(['patch-id', '--stable'], repo.root, diff).split(' ', 1)[0] ?? '')
}

function parseRawDiff(raw: string): CarryFileDelta[] {
  const deltas: CarryFileDelta[] = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    const match = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\t(.+)$/.exec(line)
    if (!match) throw new Error(`unexpected diff-tree line: ${line}`)
    const [, baseMode, headMode, baseOid, headOid, kind, rest] = match
    if (
      baseMode === undefined ||
      headMode === undefined ||
      baseOid === undefined ||
      headOid === undefined ||
      kind === undefined ||
      rest === undefined
    )
      throw new Error(`unexpected diff-tree line: ${line}`)
    if (kind === 'R') {
      const [from, to] = rest.split('\t', 2)
      if (from === undefined || to === undefined) throw new Error(`unexpected rename: ${line}`)
      deltas.push(
        { path: from, baseOid, baseMode, headOid: '0'.repeat(40), headMode: '000000' },
        { path: to, baseOid: '0'.repeat(40), baseMode: '000000', headOid, headMode },
      )
    } else {
      deltas.push({ path: rest, baseOid, baseMode, headOid, headMode })
    }
  }
  return deltas
}

function readDeltasFor(
  repo: CarryRepo,
  baseOf: () => string,
): (taskId: string, head: string) => CarryFileDelta[] {
  return (_taskId, head) =>
    parseRawDiff(git(['diff-tree', '--no-commit-id', '--raw', baseOf(), head], repo.root))
}

interface CarryHarness {
  flow: ReviewFlow
  board: TaskBoard
  requests: ReviewRequest[]
  rounds: { head: string; round: number }[]
  enqueued: { head: string; isReviewed: boolean }[]
  readonly reworks: number
  readonly releases: number
  setHead(head: string): void
  setReply(findings: readonly { file: string; title: string; severity?: string }[]): void
  setIntegrationChanged(changed: readonly string[] | undefined): void
}

function carryHarness(
  repo: CarryRepo,
  base: string,
  options?: {
    readDeltas?: boolean
    integrationChanged?: readonly string[]
    readSets?: ReadonlyMap<string, readonly string[]>
    patchHints?: (priorHead: string, head: string) => CarryHarnessHints | undefined
    /** The moving integration head: drives the board provider and the delta base. */
    integration?: { current: string }
  },
): CarryHarness {
  const integration = options?.integration
  const board =
    integration === undefined
      ? testBoard()
      : new TaskBoard('workspace', 'window', {
          ...testBoardContext(),
          integrationHead: () => integration.current,
        })
  submitTasks(board, [taskSubmission('task', {})])
  let head = base
  let reply: readonly { file: string; title: string; severity?: string }[] = []
  let integrationChanged = options?.integrationChanged
  const readSets = options?.readSets
  const requests: ReviewRequest[] = []
  const rounds: { head: string; round: number }[] = []
  const enqueued: { head: string; isReviewed: boolean }[] = []
  let reworks = 0
  let releases = 0
  const deps: ReviewDependencies = {
    head: () => head,
    authors: () => ['model-a'],
    reviewers: () => [{ id: 'rev', modelId: 'model-b', freeLanes: 3 }],
    sameModel: (left, right) => left === right,
    claims: () => [],
    executed: () => [],
    isCurrent: () => true,
    admit: (admitted) => {
      requests.push(...admitted)
      return {
        run: (request: ReviewRequest) =>
          Promise.resolve({
            head: request.head,
            groups: request.classes.map((reviewClass) => ({
              reviewClass,
              findingsJson: JSON.stringify({ findings: reply }),
            })),
          }),
        release: () => {
          releases += 1
        },
      }
    },
    rework: () => {
      reworks += 1
      return Promise.resolve(true)
    },
    enqueue: (_taskId, at, isReviewed) => {
      enqueued.push({ head: at, isReviewed })
      return Promise.resolve()
    },
    record: (_taskId, at, round) => {
      rounds.push({ head: at, round })
      return Promise.resolve()
    },
    redesign: () => {
      throw new Error('unexpected redesign: no blocker finding was reviewed')
    },
    ...(options?.readDeltas !== false && {
      readDeltas: readDeltasFor(repo, () => integration?.current ?? base),
    }),
    ...(options?.patchHints !== undefined && {
      patchHints: (_taskId: string, priorHead: string, at: string) =>
        options.patchHints?.(priorHead, at),
    }),
    ...(options !== undefined &&
      'integrationChanged' in options && { integrationChanged: () => integrationChanged }),
    ...(options !== undefined && 'readSets' in options && { readSets: () => readSets }),
  }
  const flow = new ReviewFlow(deps, {
    flow: 'full',
    loopBackSeverity: 'high',
    requiresDifferentModel: false,
  })
  return {
    flow,
    board,
    requests,
    rounds,
    enqueued,
    get reworks(): number {
      return reworks
    },
    get releases(): number {
      return releases
    },
    setHead(next: string): void {
      head = next
    },
    setReply(findings: readonly { file: string; title: string; severity?: string }[]): void {
      reply = findings
    },
    setIntegrationChanged(changed: readonly string[] | undefined): void {
      integrationChanged = changed
    },
  }
}

interface CarryHarnessHints {
  before: ReadonlyMap<string, string>
  after: ReadonlyMap<string, string>
}

/** Retire the next attempt on the board and run the flow against it. */
async function retireAndReview(harness: CarryHarness, attempt: number): Promise<string> {
  const board = harness.board
  if (attempt > 1) {
    expect(board.transition('task', attempt - 1, 'review', attempt)).toBe(true)
    expect(board.transition('task', attempt - 1, 'ready', attempt)).toBe(true)
  }
  expect(board.begin('task', boardAttempt(attempt))).toBe(true)
  retireAttempt(board, 'task', attempt)
  return await harness.flow.afterRetirement(board.task('task'), true)
}

describe('M96d review carry-over on real worktrees', () => {
  it('scopes re-review to the changed file and carries the rest', async () => {
    const { repo, harness } = harnessOnChange({
      'a.ts': 'export const a = 2\n',
      'b.ts': 'export const b = 2\n',
    })
    expect(await retireAndReview(harness, 1)).toBe('reviewed')
    expect(harness.requests).toHaveLength(3)
    expect(harness.requests[0]?.files).toBeUndefined()
    harness.setHead(commitChange(repo, { 'b.ts': 'export const b = 3\n' }))
    // The second round scoped to the changed file only; the first
    // round's three class requests plus the second's three.
    await expectSingleFileSecondRound(harness, 'b.ts')
    expect(harness.rounds).toHaveLength(2)
    expect(harness.releases).toBe(2)
  })

  it('carries an empty commit with no new round', async () => {
    const { repo, harness } = harnessOnChange({ 'a.ts': 'export const a = 2\n' })
    expect(await retireAndReview(harness, 1)).toBe('reviewed')
    advanceEmptyHead(repo, harness)
    expect(await retireAndReview(harness, 2)).toBe('reviewed')
    // No new round ran: the record moved to the new head and its
    // standing verdict dispatched again.
    expect(harness.requests).toHaveLength(3)
    expect(harness.rounds).toHaveLength(1)
    expect(harness.enqueued.at(-1)).toMatchObject({ isReviewed: true })
    expect(harness.flow.reviewed('task')).toBe(true)
  })

  it('re-reviews a whitespace-only change the patch ID cannot see', async () => {
    const repo = scratchRepo()
    const head1 = commitChange(repo, { 'a.ts': 'export const a = 2\n' })
    const head2 = commitChange(repo, { 'a.ts': 'export const a = 2  \n' })
    // Real stable patch IDs: equal, because the hint ignores whitespace.
    const before = patchId(repo, repo.base, head1, 'a.ts')
    const after = patchId(repo, repo.base, head2, 'a.ts')
    expect(before).not.toBe('')
    expect(after).toBe(before)
    // An unchanged file has no diff and no patch ID at all.
    expect(patchId(repo, repo.base, head2, 'b.ts')).toBe('')
    const harness = carryHarness(repo, repo.base, {
      integrationChanged: [],
      readSets: new Map(),
      patchHints: (priorHead, head) =>
        priorHead === head1 && head === head2
          ? { before: new Map([['a.ts', before]]), after: new Map([['a.ts', after]]) }
          : undefined,
    })
    harness.setHead(head1)
    expect(await retireAndReview(harness, 1)).toBe('reviewed')
    harness.setHead(head2)
    // The bytes differ, so the file re-reviews despite the equal hint.
    await expectSingleFileSecondRound(harness, 'a.ts')
  })

  it('re-reviews an unchanged file the context touches, and only it', async () => {
    const repo = scratchRepo()
    const harness = carryHarness(repo, repo.base, {
      integrationChanged: [],
      readSets: new Map([
        ['a.ts', ['lib.ts']],
        ['b.ts', []],
      ]),
    })
    harness.setHead(
      commitChange(repo, { 'a.ts': 'export const a = 2\n', 'b.ts': 'export const b = 2\n' }),
    )
    expect(await retireAndReview(harness, 1)).toBe('reviewed')
    // Same bytes, new head, but the integration moved under lib.ts,
    // which only a.ts reads.
    advanceEmptyHead(repo, harness)
    harness.setIntegrationChanged(['lib.ts'])
    await expectSingleFileSecondRound(harness, 'a.ts')
  })

  it('re-reviews everything on an unknown context or unreadable deltas', async () => {
    const repo = scratchRepo()
    const head1 = commitChange(repo, { 'a.ts': 'export const a = 2\n' })
    const cases: { name: string; options: Parameters<typeof carryHarness>[2] }[] = [
      { name: 'unknown movement', options: { readSets: new Map() } },
      { name: 'unknown reads', options: { integrationChanged: [] } },
      {
        name: 'unreadable deltas',
        options: { readDeltas: false, integrationChanged: [], readSets: new Map() },
      },
    ]
    for (const { options } of cases) {
      const harness = carryHarness(repo, repo.base, options)
      harness.setHead(head1)
      expect(await retireAndReview(harness, 1)).toBe('reviewed')
      advanceEmptyHead(repo, harness)
      // Unknown context, or unreadable deltas: a full new round.
      expect(await retireAndReview(harness, 2)).toBe('reviewed')
      expect(harness.requests).toHaveLength(6)
      expect(harness.rounds).toHaveLength(2)
    }
  })

  it('records no verdict for a findings round and keeps reviewing it', async () => {
    const { repo, harness } = harnessOnChange({ 'a.ts': 'export const a = 2\n' })
    harness.setReply([{ file: 'a.ts', title: 'blocking finding', severity: 'high' }])
    expect(await retireAndReview(harness, 1)).toBe('rework')
    expect(harness.reworks).toBe(1)
    // Same bytes, new head: without a verdict the file re-reviews.
    advanceEmptyHead(repo, harness)
    harness.setReply([])
    await expectSingleFileSecondRound(harness, 'a.ts')
  })

  it('refreshes the waiting branch on a moved integration and carries exact deltas', async () => {
    const repo = scratchRepo()
    const integration = { current: repo.base }
    const harness = carryHarness(repo, repo.base, {
      integrationChanged: [],
      readSets: new Map([
        ['a.ts', ['lib.ts']],
        ['b.ts', []],
      ]),
      integration,
    })
    // The task branches from the integration head and is reviewed clean.
    git(['checkout', '-b', 'task'], repo.root)
    const branch1 = commitChange(repo, {
      'a.ts': 'export const a = 2\n',
      'b.ts': 'export const b = 2\n',
    })
    harness.setHead(branch1)
    const board = harness.board
    expect(board.acknowledgeIntegrationRefresh('task', integration.current)).toBe(true)
    expect(await retireAndReview(harness, 1)).toBe('reviewed')
    expect(harness.requests).toHaveLength(3)
    // Another task lands on the integration branch, touching lib.ts.
    git(['checkout', 'main'], repo.root)
    const landed = commitChange(repo, { 'lib.ts': 'export const lib = 2\n' })
    integration.current = landed
    // The waiting branch refreshes onto the moved head: a real rebase.
    git(['checkout', 'task'], repo.root)
    git(['rebase', 'main'], repo.root)
    const branch2 = git(['rev-parse', 'HEAD'], repo.root).trim()
    expect(branch2).not.toBe(branch1)
    harness.setHead(branch2)
    harness.setIntegrationChanged(['lib.ts'])
    // The next attempt waits for the refresh acknowledgement.
    expect(board.transition('task', 1, 'review', 2)).toBe(true)
    expect(board.transition('task', 1, 'ready', 2)).toBe(true)
    expect(board.begin('task', boardAttempt(2))).toBe(false)
    expect(board.integrationRefreshDue('task')).toEqual({ base: landed })
    expect(board.acknowledgeIntegrationRefresh('task', landed)).toBe(true)
    expect(board.begin('task', boardAttempt(2))).toBe(true)
    retireAttempt(board, 'task', 2)
    expect(await harness.flow.afterRetirement(board.task('task'), true)).toBe('reviewed')
    // Same task bytes, new branch head: b.ts carries its clean verdict
    // while a.ts re-reviews, because it reads the moved lib.ts.
    expect(harness.requests).toHaveLength(6)
    expect(harness.requests[3]?.files).toEqual(['a.ts'])
    expect(harness.rounds).toHaveLength(2)
  })
})

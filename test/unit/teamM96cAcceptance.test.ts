// M96c acceptance proofs on the fitted team core (RLF-M96CREC): the real
// TaskBoard, TaskPicker, SchedulerSlots, stall and retirement policy,
// merge queue and check slots, over real temporary git repositories and
// real child processes. These replace the lane-S suites deleted with the
// fake tests (33150b3cf); every port below either is the production class
// itself or does real filesystem/git/process work in a temp folder.
import { execFile, execFileSync, type ExecFileException } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  TEAM_AGING_MS,
  TEAM_BOARD_MAX,
  TEAM_DIVERGE_REPEATS,
  TEAM_DIVERGE_SIZE_FACTOR,
  TEAM_HANDOFF_TOOL_CALLS,
  TEAM_PRIORITY_WEIGHTS,
  TEAM_STALL_MS,
  TEAM_STALL_RATE_LIMIT_MS,
  TEAM_START_STAGGER_MS,
} from '../../src/shared/constants'
import { BoardRefusal } from '../../src/core/team/scheduler/board'
import { inheritedPriorities, TaskPicker } from '../../src/core/team/scheduler/pick'
import { SchedulerSlots, type SlotRequest } from '../../src/core/team/scheduler/slots'
import {
  detectStall,
  DivergenceWatch,
  handoffEntry,
  StallRecovery,
  type StallActivity,
} from '../../src/core/team/scheduler/stalls'
import {
  AttemptRetirement,
  type RetirementDependencies,
  type RetirementEvidence,
} from '../../src/core/team/scheduler/retire'
import { checkClaims } from '../../src/core/team/scheduler/reviewFlow'
import {
  admitMergeBatch,
  nextMergeBatch,
  orderMergeQueue,
  type MergeCandidate,
} from '../../src/core/team/mergeQueue'
import { runnerSshArgs } from '../../src/host/runners/sshRunner'
import { runnerEnvironment } from '../../src/core/runners/runnerConfig'
import { CheckSlots, type CheckProcess } from '../../src/host/team/checkSlots'
import type { Runner } from '../../src/shared/team'
import {
  boardAttempt,
  makeBoard,
  pickContext,
  readyTask,
  schedulerEntry,
  submission,
} from './helpers/teamFixtures'

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function scratchRepo(prefix: string): string {
  const root = tempRoot(prefix)
  git(['init', '-b', 'main'], root)
  git(['config', 'user.name', 'M96c'], root)
  git(['config', 'user.email', 'm96c@example.invalid'], root)
  return root
}

/** Drive one board task from ready to the named terminal state. */
function finishTask(
  board: ReturnType<typeof makeBoard>['board'],
  id: string,
  end: 'done' | 'merged' | 'failed',
): void {
  expect(board.begin(id, boardAttempt(1))).toBe(true)
  expect(
    board.finishAttempt(id, 1, {
      state: 'retired',
      endedAt: 10,
      retirement: { kind: 'proved', method: 'linuxCgroup' },
    }),
  ).toBe(true)
  if (end === 'failed') {
    expect(board.transition(id, 1, 'failed', 11)).toBe(true)
    return
  }
  expect(board.transition(id, 1, 'review', 11)).toBe(true)
  if (end === 'done') return
  expect(board.transition(id, 1, 'merge', 12)).toBe(true)
  expect(board.transition(id, 1, 'merged', 13)).toBe(true)
}

describe('M96c acceptance 2-3: the board and its dependencies', () => {
  it('refuses a cycle, an unknown task and another workspace task, naming the edge', () => {
    const { board } = makeBoard()
    expect(() => {
      board.submit(
        [
          submission('a', {
            fields: {
              priority: 'normal',
              size: 'M',
              overlap: 'serialize',
              depends_on: [{ task: 'b' }],
            },
          }),
          submission('b', {
            fields: {
              priority: 'normal',
              size: 'M',
              overlap: 'serialize',
              depends_on: [{ task: 'a' }],
            },
          }),
        ],
        0,
      )
    }).toThrow(BoardRefusal)
    try {
      board.submit(
        [
          submission('c', {
            fields: {
              priority: 'normal',
              size: 'M',
              overlap: 'serialize',
              depends_on: [{ task: 'missing' }],
            },
          }),
        ],
        0,
      )
      expect.unreachable()
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BoardRefusal)
      expect((error as BoardRefusal).code).toBe('unknownTask')
      expect((error as BoardRefusal).edge).toEqual(['c', 'missing'])
    }
    try {
      board.submit(
        [
          submission('d', {
            fields: {
              priority: 'normal',
              size: 'M',
              overlap: 'serialize',
              depends_on: [{ task: 'foreign' }],
            },
          }),
        ],
        0,
      )
      expect.unreachable()
    } catch (error: unknown) {
      expect((error as BoardRefusal).code).toBe('crossWorkspace')
      expect((error as BoardRefusal).edge).toEqual(['d', 'foreign'])
    }
    expect(board.snapshot().tasks).toHaveLength(0)
  })

  it('holds at most TEAM_BOARD_MAX open tasks', () => {
    const { board } = makeBoard()
    const batch = Array.from({ length: TEAM_BOARD_MAX + 1 }, (_, index) =>
      submission(`task-${String(index)}`),
    )
    expect(() => {
      board.submit(batch, 0)
    }).toThrow(BoardRefusal)
    expect(board.snapshot().tasks).toHaveLength(0)
    board.submit(batch.slice(0, TEAM_BOARD_MAX), 0)
    expect(board.snapshot().tasks).toHaveLength(TEAM_BOARD_MAX)
  })

  it('a failed dependency blocks its dependents and cancels none', () => {
    const { board } = makeBoard()
    board.submit(
      [
        submission('base'),
        submission('child', {
          fields: {
            priority: 'normal',
            size: 'M',
            overlap: 'serialize',
            depends_on: [{ task: 'base', on: 'merged' }],
          },
        }),
      ],
      0,
    )
    expect(board.task('child').state).toBe('queued')
    finishTask(board, 'base', 'failed')
    board.refresh(20)
    const child = board.task('child')
    expect(child.state).toBe('blocked')
    expect(child.blockedReason).toContain('base')
  })

  it('merged hands over integration work and done hands the report over as data', () => {
    const { board } = makeBoard()
    board.submit(
      [
        submission('writer'),
        submission('reader', { workspaceMode: 'read-only' }),
        submission('next', {
          fields: {
            priority: 'normal',
            size: 'M',
            overlap: 'serialize',
            depends_on: [
              { task: 'writer', on: 'merged' },
              { task: 'reader', on: 'done' },
            ],
          },
        }),
      ],
      0,
    )
    finishTask(board, 'writer', 'merged')
    board.refresh(20)
    expect(board.task('next').state).toBe('queued')
    // The read-only dependency finishes as done without a merge.
    expect(board.begin('reader', boardAttempt(1))).toBe(true)
    expect(
      board.finishAttempt('reader', 1, {
        state: 'retired',
        endedAt: 10,
        retirement: { kind: 'proved', method: 'linuxCgroup' },
      }),
    ).toBe(true)
    expect(board.transition('reader', 1, 'done', 11)).toBe(true)
    board.refresh(21)
    expect(board.task('next').state).toBe('ready')
    const input = board.dependencyInput('next')
    expect(input.integrationTasks).toEqual(['writer'])
    expect(input.reports).toEqual([{ taskId: 'reader', kind: 'data', text: 'untrusted report' }])
  })

  it('a late event from an earlier attempt charges usage and changes nothing else', () => {
    const { board } = makeBoard()
    board.submit([submission('task')], 0)
    expect(board.begin('task', boardAttempt(1))).toBe(true)
    expect(
      board.finishAttempt('task', 1, {
        state: 'retired',
        endedAt: 10,
        retirement: { kind: 'proved', method: 'linuxCgroup' },
      }),
    ).toBe(true)
    expect(board.prepareNext('task', 1, 11, 'stall')).toBe(true)
    expect(board.begin('task', boardAttempt(2))).toBe(true)
    const charged: unknown[] = []
    const usage = boardAttempt(1).usage
    expect(
      board.applyEvent(
        { workspaceId: 'workspace', taskId: 'task', attempt: 1, at: 12, kind: 'usage', usage },
        (event) => {
          charged.push(event)
        },
      ),
    ).toBe(true)
    expect(charged).toHaveLength(1)
    expect(
      board.applyEvent(
        { workspaceId: 'workspace', taskId: 'task', attempt: 1, at: 13, kind: 'landed' },
        (event) => {
          charged.push(event)
        },
      ),
    ).toBe(false)
    expect(charged).toHaveLength(1)
    expect(board.task('task').state).toBe('running')
    expect(board.task('task').currentAttempt).toBe(2)
  })

  it('after a reload the restored board waits paused with its attempts interrupted', () => {
    const first = makeBoard()
    first.board.submit([submission('task')], 0)
    expect(first.board.begin('task', boardAttempt(1))).toBe(true)
    const second = makeBoard()
    second.board.restore(first.board.snapshot())
    expect(second.board.paused).toBe(true)
    const task = second.board.task('task')
    expect(task.state).toBe('blocked')
    expect(task.attempts[0]?.state).toBe('interrupted')
    expect(second.board.begin('task', boardAttempt(2))).toBe(false)
  })
})

describe('M96c acceptance 4-8: the pick, stealing and staggered starts', () => {
  it('the critical path goes first and ties go to the task ready first', () => {
    const picker = new TaskPicker()
    const chain = [
      readyTask('a'),
      readyTask('b', { state: 'queued', depends_on: [{ task: 'a', on: 'merged' }] }),
      readyTask('c', { state: 'queued', depends_on: [{ task: 'b', on: 'merged' }] }),
      readyTask('d'),
    ]
    const ranked = picker.rank(chain, pickContext())
    expect(ranked[0]?.task.id).toBe('a')
    expect(ranked[0]?.criticalPathFactor).toBeGreaterThan(ranked[1]?.criticalPathFactor ?? 0)
    const tied = picker.rank(
      [readyTask('late', { readyAt: 9 }), readyTask('early', { readyAt: 5 })],
      pickContext(),
    )
    expect(tied.map((item) => item.task.id)).toEqual(['early', 'late'])
  })

  it('aging raises a waiting task and the starvation bound picks it first', () => {
    const picker = new TaskPicker()
    const aged = picker.rank(
      [
        readyTask('fresh-high', { priority: 'high', readyAt: 3 * TEAM_AGING_MS }),
        readyTask('aged-normal', { priority: 'normal', readyAt: 0 }),
      ],
      pickContext({ now: 3 * TEAM_AGING_MS }),
    )
    expect(aged[0]?.task.id).toBe('aged-normal')
    expect(aged[0]?.priorityWeight).toBe(TEAM_PRIORITY_WEIGHTS.urgent)
    const starved = picker.pick(
      [
        readyTask('urgent-new', { priority: 'urgent', readyAt: 4900 }),
        readyTask('low-old', { priority: 'low', readyAt: 0 }),
      ],
      pickContext({
        now: 5000,
        starvationMs: 1000,
        youngerStarted: (task) => task.id === 'low-old',
      }),
    )
    expect(starved?.task.id).toBe('low-old')
    expect(starved?.starved).toBe(true)
  })

  it('priority inheritance lifts what an urgent task waits for, transitively', () => {
    const tasks = [
      readyTask('urgent', { priority: 'urgent' }),
      readyTask('middle', { priority: 'normal' }),
      readyTask('holder', { priority: 'low' }),
    ]
    const lifted = inheritedPriorities(
      tasks,
      [
        { waiter: 'urgent', holder: 'middle' },
        { waiter: 'middle', holder: 'holder' },
      ],
      0,
    )
    expect(lifted.get('holder')).toBe('urgent')
    expect(lifted.get('middle')).toBe('urgent')
    const unwaited = inheritedPriorities(tasks, [], 0)
    expect(unwaited.get('holder')).toBe('low')
  })

  it('fair share alternates between conversations instead of draining one queue', () => {
    const picker = new TaskPicker()
    const tasks = [
      readyTask('a1', { parentSessionId: 'session-a', readyAt: 0 }),
      readyTask('b1', { parentSessionId: 'session-b', readyAt: 1 }),
    ]
    const first = picker.pick(tasks, pickContext())
    const second = picker.pick(tasks, pickContext())
    expect(first?.task.parentSessionId).not.toBe(second?.task.parentSessionId)
  })

  it('a free lane takes only its own role and process starts stagger', () => {
    const picker = new TaskPicker()
    const docsEntry = schedulerEntry({ id: 'docs-entry', roleId: 'docs' })
    expect(picker.rank([readyTask('code')], pickContext({ entries: [docsEntry] }))).toHaveLength(0)
    const processEntry = schedulerEntry({
      id: 'proc',
      kind: 'museCode',
      agentProfileId: 'proc-agent',
    })
    picker.started(processEntry, 0)
    expect(
      picker.rank(
        [readyTask('code')],
        pickContext({ now: TEAM_START_STAGGER_MS - 1, entries: [processEntry] }),
      ),
    ).toHaveLength(0)
    expect(
      picker.rank(
        [readyTask('code')],
        pickContext({ now: TEAM_START_STAGGER_MS, entries: [processEntry] }),
      ),
    ).toHaveLength(1)
    const engineEntry = schedulerEntry({ id: 'eng', kind: 'engine', agentProfileId: 'eng-agent' })
    picker.started(engineEntry, 0)
    expect(
      picker.rank([readyTask('code')], pickContext({ now: 1, entries: [engineEntry] })),
    ).toHaveLength(1)
  })

  it("a child's slot is reserved at delegate time or refused at once, never queued behind its parent", () => {
    const parent: SlotRequest = {
      taskId: 'parent',
      attempt: 1,
      workspaceId: 'workspace',
      roleId: 'engineering',
      entryId: 'entry',
      agentProfileId: 'agent',
      kind: 'engine',
    }
    const child: SlotRequest = {
      ...parent,
      taskId: 'child',
      entryId: 'entry-2',
      agentProfileId: 'agent-2',
    }
    const one = new SchedulerSlots('workspace', () => ({
      workers: 1,
      processWorkers: 1,
      role: () => 2,
      entry: () => 1,
      agent: () => 1,
    }))
    expect(one.reserve(parent)).toEqual({ ok: true })
    one.mark(parent, 'running')
    expect(one.reserveChildren(parent, [child])).toEqual({
      ok: false,
      reason: 'workers',
      recovery: 'selfOrRaiseLimit',
    })
    expect(one.snapshot()).toHaveLength(1)
    const two = new SchedulerSlots('workspace', () => ({
      workers: 2,
      processWorkers: 2,
      role: () => 2,
      entry: () => 1,
      agent: () => 1,
    }))
    expect(two.reserve(parent)).toEqual({ ok: true })
    two.mark(parent, 'running')
    expect(two.reserveChildren(parent, [child])).toEqual({ ok: true })
    expect(two.snapshot()).toHaveLength(2)
    const idle = new SchedulerSlots('workspace', () => ({
      workers: 2,
      processWorkers: 2,
      role: () => 2,
      entry: () => 1,
      agent: () => 1,
    }))
    expect(idle.reserveChildren(parent, [child]).ok).toBe(false)
  })
})

function activity(patch: Partial<StallActivity> = {}): StallActivity {
  return {
    lastEventAt: 0,
    requestCount: 1,
    requestCeiling: 100,
    isWorkLeft: false,
    isOwnStepLimit: false,
    isUsageLimited: false,
    isRetryBudgetSpent: false,
    isProcessExited: false,
    hasReport: false,
    ...patch,
  }
}

describe('M96c acceptance 9-12: retirement, stalls, divergence and claims', () => {
  it('each stall kind is detected and a command inside its timeout is not a stall', () => {
    expect(
      detectStall(activity({ commandDeadline: TEAM_STALL_MS + 1000 }), TEAM_STALL_MS),
    ).toBeUndefined()
    expect(detectStall(activity(), TEAM_STALL_MS - 1)).toBeUndefined()
    expect(detectStall(activity(), TEAM_STALL_MS)).toBe('noProgress')
    expect(detectStall(activity({ isProcessExited: true }), 0)).toBe('crashed')
    expect(detectStall(activity({ isProcessExited: true, hasReport: true }), 0)).toBeUndefined()
    expect(detectStall(activity({ isRetryBudgetSpent: true }), 0)).toBe('providerDown')
    expect(detectStall(activity({ isUsageLimited: true }), 0)).toBe('usageLimited')
    expect(detectStall(activity({ rateLimitedSince: 0 }), TEAM_STALL_RATE_LIMIT_MS)).toBe(
      'rateLimited',
    )
    expect(
      detectStall(activity({ isWorkLeft: true, requestCount: 100, requestCeiling: 100 }), 0),
    ).toBe('outOfSteps')
  })

  it('divergence stops on repeated rewrites or an oversized diff, at the named bounds', () => {
    const watch = new DivergenceWatch()
    expect(watch.rewrite('src/a.ts:1', 'one\n')).toBe(false)
    for (let round = 0; round < TEAM_DIVERGE_REPEATS - 1; round += 1) {
      expect(watch.rewrite('src/a.ts:1', 'one\n')).toBe(false)
    }
    expect(watch.rewrite('src/a.ts:1', 'one\n')).toBe(true)
    expect(watch.oversized(TEAM_DIVERGE_SIZE_FACTOR * 10, 10)).toBe(false)
    expect(watch.oversized(TEAM_DIVERGE_SIZE_FACTOR * 10 + 1, 10)).toBe(true)
  })

  it('the next entry follows the stall kind: another agent for its fault, another model for the model', () => {
    const previous = boardAttempt(1)
    const entries = [
      {
        id: 'same',
        agentProfileId: previous.agentProfileId,
        modelId: previous.modelId,
        isKey: false,
        hasHeadroom: true,
      },
      {
        id: 'other-agent',
        agentProfileId: 'agent-2',
        modelId: previous.modelId,
        isKey: false,
        hasHeadroom: true,
      },
      {
        id: 'other-model',
        agentProfileId: previous.agentProfileId,
        modelId: 'model-2',
        isKey: false,
        hasHeadroom: true,
      },
    ]
    expect(handoffEntry(entries, previous, 'rateLimited')?.id).toBe('other-agent')
    expect(handoffEntry(entries, previous, 'noProgress')?.id).toBe('other-model')
  })

  it('a stalled task is checkpointed only after retirement and handed off with its brief', async () => {
    const repo = scratchRepo('m96c-stall-')
    writeFileSync(path.join(repo, 'work.ts'), 'export const before = 1\n')
    git(['add', '.'], repo)
    git(['commit', '-m', 'base'], repo)
    // The worker's uncommitted edit, as its working copy holds it at the stall.
    writeFileSync(path.join(repo, 'work.ts'), 'export const after = 2\n')
    const order: string[] = []
    const { board } = makeBoard()
    board.submit([submission('task')], 0)
    expect(board.begin('task', boardAttempt(1))).toBe(true)
    const task = board.task('task')
    let handedCommit = ''
    let handedTools = 0
    const recovery = new StallRecovery({
      isCurrent: () => true,
      retire: () => {
        order.push('retire')
        return Promise.resolve({
          state: 'retired' as const,
          endedAt: 1,
          retirement: { kind: 'proved' as const, method: 'linuxCgroup' as const },
        })
      },
      settleUsage: () => {
        order.push('settle')
        return Promise.resolve()
      },
      checkpoint: () => {
        order.push('checkpoint')
        git(['add', '.'], repo)
        git(['commit', '--allow-empty', '-m', 'checkpoint'], repo)
        const commit = git(['rev-parse', 'HEAD'], repo).trim()
        return Promise.resolve({ commit, files: ['work.ts'], diffStat: 'work.ts | 2 +-' })
      },
      entries: () => [
        {
          id: 'next',
          agentProfileId: 'agent-2',
          modelId: 'model-2',
          isKey: false,
          hasHeadroom: true,
        },
      ],
      consent: () => Promise.resolve(true),
      reassign: (_ref, _entry, handoff) => {
        order.push('reassign')
        handedCommit = handoff.checkpoint.commit
        handedTools = handoff.data.toolCalls.length
        expect(handoff.originalBrief).toBe('the brief')
        expect(handoff.data.kind).toBe('untrustedData')
        return Promise.resolve(true)
      },
      switchRow: () => {
        order.push('switch')
      },
      block: () => {
        order.push('block')
      },
    })
    const toolCalls = Array.from({ length: TEAM_HANDOFF_TOOL_CALLS + 5 }, (_, index) => ({
      name: `call-${String(index)}`,
      outcome: 'ok',
    }))
    const outcome = await recovery.recover(task, 'rateLimited', {
      policy: 'reassign',
      brief: 'the brief',
      lastMessage: 'still working',
      toolCalls,
    })
    expect(outcome).toBe('reassigned')
    expect(order).toEqual(['retire', 'settle', 'checkpoint', 'reassign', 'switch'])
    expect(git(['show', `${handedCommit}:work.ts`], repo)).toBe('export const after = 2\n')
    expect(handedTools).toBe(TEAM_HANDOFF_TOOL_CALLS)
    const diverging = await recovery.recover(task, 'diverging', {
      policy: 'reassign',
      brief: 'the brief',
      lastMessage: 'looping',
      toolCalls: [],
    })
    expect(diverging).toBe('blocked')
    expect(order.at(-1)).toBe('block')
  })

  it('retirement needs window evidence per kind; an unproved attempt keeps its slot counted', async () => {
    const request: SlotRequest = {
      taskId: 'task',
      attempt: 1,
      workspaceId: 'workspace',
      roleId: 'engineering',
      entryId: 'entry',
      agentProfileId: 'agent',
      kind: 'engine',
    }
    const slots = new SchedulerSlots('workspace', () => ({
      workers: 2,
      processWorkers: 2,
      role: () => 2,
      entry: () => 2,
      agent: () => 2,
    }))
    expect(slots.reserve(request)).toEqual({ ok: true })
    slots.mark(request, 'running')
    let isStopped = false
    const quarantined: string[] = []
    const evidence = (): RetirementEvidence => ({
      windowInstanceId: 'window',
      ref: { taskId: 'task', attempt: 1 },
      kind: 'engine',
      loopStopped: isStopped,
      turnTerminal: false,
      itemsTerminal: false,
      promptAnswered: false,
      isReadOnlyMuse: false,
      hostExited: false,
      processes: isStopped
        ? [{ childExited: true, descendantsEnded: true, method: 'linuxCgroup' }]
        : [],
      containerMethod: isStopped ? 'linuxCgroup' : 'unproved',
    })
    const deps: RetirementDependencies = {
      windowInstanceId: 'window',
      now: () => 42,
      evidence,
      cancel: () => Promise.resolve(),
      // The test's clock for the bounded waits: real timers, shortened so
      // the 30 s production bound does not run in real time twice over.
      changed: (_ref, signal) =>
        new Promise((resolve) => {
          if (signal.aborted) resolve()
          else setTimeout(resolve, 1)
        }),
      escalate: () => Promise.resolve(),
      delay: (_ms, signal) =>
        new Promise((resolve) => {
          if (signal.aborted) resolve()
          else setTimeout(resolve, 10)
        }),
      markUncertain: () => undefined,
      quarantine: (ref) => {
        quarantined.push(ref.taskId)
        return Promise.resolve()
      },
      canQuarantine: () => true,
      prepareReplacement: () => Promise.resolve(true),
      exclusiveResourcesFree: () => true,
      teamHostWorkers: () => [{ taskId: 'task', attempt: 1 }],
      restartTeamHost: () => Promise.resolve(),
      recordDecision: () => Promise.resolve(),
    }
    const retirement = new AttemptRetirement(deps, slots)
    const uncertain = await retirement.retire({ taskId: 'task', attempt: 1 })
    expect(uncertain.state).toBe('uncertain')
    expect(slots.snapshot()).toHaveLength(1)
    expect(slots.snapshot()[0]?.state).toBe('uncertain')
    expect(quarantined).toEqual(['task'])
    isStopped = true
    const retired = await retirement.retire({ taskId: 'task', attempt: 1 })
    expect(retired.state).toBe('retired')
    expect(slots.snapshot()).toHaveLength(0)
  })

  it('a claimed check with no matching command is unverified, a contradicted one named', () => {
    const claims = checkClaims(
      [
        { command: 'npm run test:unit', passed: true },
        { command: 'npm run build', passed: true },
        { command: 'npm run lint', passed: true },
      ],
      [
        { command: 'npm run test:unit', exitCode: 0 },
        { command: 'npm run build', exitCode: 1 },
      ],
    )
    expect(claims.map((item) => item.verification)).toEqual([
      'verified',
      'contradicted',
      'unverified',
    ])
  })
})

function candidate(id: string, patch: Partial<MergeCandidate> = {}): MergeCandidate {
  return {
    id,
    dependsOn: [],
    priority: 'normal',
    conflictsWith: [],
    changedLines: 1,
    files: [],
    finishedAt: 1,
    onConflict: 'rework',
    ...patch,
  }
}

describe('M96c acceptance 18-21: the merge queue', () => {
  it('orders by dependencies, inherited priority, conflicts, blast and finish, with reasons', () => {
    const { ordered, held, reasons } = orderMergeQueue(
      [
        candidate('child', { dependsOn: ['base'], priority: 'urgent', finishedAt: 1 }),
        candidate('free', { priority: 'high', finishedAt: 50 }),
        candidate('base', { priority: 'low', finishedAt: 100 }),
        candidate('stuck', { dependsOn: ['missing'] }),
      ],
      new Set(),
    )
    expect(ordered.map((item) => item.id)).toEqual(['base', 'child', 'free'])
    expect(held.map((item) => item.id)).toEqual(['stuck'])
    expect(reasons.get('base')?.priorityWeight).toBe(TEAM_PRIORITY_WEIGHTS.urgent)
    expect(reasons.get('child')?.dependencies).toEqual(['base'])
    const batch = nextMergeBatch(
      [
        candidate('one'),
        candidate('two'),
        candidate('big', { changedLines: 500 }),
        candidate('three'),
      ],
      new Set(),
    )
    expect(batch.map((item) => item.id)).toEqual(['one', 'two'])
  })

  it('backs out the culprit: serial cumulative admission lands exactly what passed', async () => {
    const root = tempRoot('m96c-queue-')
    const initial = path.join(root, 'tree')
    mkdirSync(initial, { recursive: true })
    writeFileSync(path.join(initial, 'keep.txt'), 'keep\n')
    let trialCount = 0
    const reworked: string[] = []
    const deps = {
      merge: (tree: string, item: MergeCandidate) => {
        const next = path.join(root, `trial-${String(trialCount++)}`)
        cpSync(tree, next, { recursive: true })
        writeFileSync(path.join(next, `${item.id}.txt`), item.id === 'c' ? 'BAD\n' : `${item.id}\n`)
        return Promise.resolve({ status: 'merged' as const, tree: next })
      },
      check: (tree: string) => {
        const isBad = ['a', 'b', 'c', 'd'].some((id) => {
          const file = path.join(tree, `${id}.txt`)
          return existsSync(file) && readFileSync(file, 'utf8').includes('BAD')
        })
        return Promise.resolve(isBad ? [{ id: 'content', output: 'BAD marker present' }] : [])
      },
      rework: (item: MergeCandidate) => {
        reworked.push(item.id)
        return Promise.resolve()
      },
    }
    const admission = await admitMergeBatch(
      initial,
      [candidate('a'), candidate('b'), candidate('c'), candidate('d', { dependsOn: ['c'] })],
      new Set(),
      deps,
    )
    expect(admission.admitted).toEqual(['a', 'b'])
    expect(admission.returned).toEqual(['c'])
    expect(admission.held).toEqual(['d'])
    expect(reworked).toEqual(['c'])
    expect(admission.checkRuns).toBeGreaterThan(0)
    expect(existsSync(path.join(admission.tree, 'a.txt'))).toBe(true)
    expect(existsSync(path.join(admission.tree, 'b.txt'))).toBe(true)
    expect(existsSync(path.join(admission.tree, 'c.txt'))).toBe(false)
    expect(readFileSync(path.join(admission.tree, 'keep.txt'), 'utf8')).toBe('keep\n')
  })

  it('an interaction passes alone and fails together: the later candidate goes back', async () => {
    const root = tempRoot('m96c-interact-')
    const initial = path.join(root, 'tree')
    mkdirSync(initial, { recursive: true })
    let trialCount = 0
    const admission = await admitMergeBatch(initial, [candidate('a'), candidate('b')], new Set(), {
      merge: (tree: string, item: MergeCandidate) => {
        const next = path.join(root, `trial-${String(trialCount++)}`)
        cpSync(tree, next, { recursive: true })
        writeFileSync(path.join(next, `${item.id}.txt`), `${item.id}\n`)
        return Promise.resolve({ status: 'merged' as const, tree: next })
      },
      check: (tree: string) => {
        const isTogether =
          existsSync(path.join(tree, 'a.txt')) && existsSync(path.join(tree, 'b.txt'))
        return Promise.resolve(isTogether ? [{ id: 'combo', output: 'a and b together fail' }] : [])
      },
      rework: () => Promise.resolve(),
    })
    expect(admission.admitted).toEqual(['a'])
    expect(admission.returned).toEqual(['b'])
    expect(existsSync(path.join(admission.tree, 'b.txt'))).toBe(false)
  })

  it('a check that passes on the rerun is marked flaky and the batch lands', async () => {
    const root = tempRoot('m96c-flaky-')
    const initial = path.join(root, 'tree')
    mkdirSync(initial, { recursive: true })
    const counter = path.join(root, 'counter')
    writeFileSync(counter, '0')
    let trialCount = 0
    const admission = await admitMergeBatch(initial, [candidate('a'), candidate('b')], new Set(), {
      merge: (tree: string, item: MergeCandidate) => {
        const next = path.join(root, `trial-${String(trialCount++)}`)
        cpSync(tree, next, { recursive: true })
        writeFileSync(path.join(next, `${item.id}.txt`), `${item.id}\n`)
        return Promise.resolve({ status: 'merged' as const, tree: next })
      },
      check: () => {
        const runs = Number(readFileSync(counter, 'utf8')) + 1
        writeFileSync(counter, String(runs))
        return Promise.resolve(runs === 1 ? [{ id: 'content', output: 'first run fails' }] : [])
      },
      rework: () => Promise.resolve(),
    })
    expect(admission.admitted).toEqual(['a', 'b'])
    expect(admission.flaky).toEqual(['content'])
    expect(admission.checkRuns).toBe(2)
  })
})

const runProcess: CheckProcess = (request) =>
  new Promise((resolve) => {
    execFile(
      request.file,
      [...request.args],
      { cwd: request.cwd, env: request.env, timeout: request.timeoutMs },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        resolve({
          exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
          output: stdout,
          descendantsEnded: true,
          stderr,
        })
      },
    )
  })

describe('M96c acceptance 25-26: check slots and runners', () => {
  it('every SSH connection carries the fixed options and no credential reaches the remote env', () => {
    const runner: Runner = {
      id: 'r1',
      destination: 'user@rig.example.invalid',
      os: 'linux',
      workFolder: '/tmp/work',
      maxJobs: 2,
      labels: [],
      commandClasses: ['tests'],
      setupCommand: 'true',
      cacheKey: 'c1',
      environmentNames: [],
    }
    const args = runnerSshArgs(runner)
    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('StrictHostKeyChecking=yes')
    expect(args).toContain('ForwardAgent=no')
    expect(args.some((arg) => arg.startsWith('ConnectTimeout='))).toBe(true)
    const env = runnerEnvironment({
      PATH: '/usr/bin',
      META_API_KEY: 'must-not-travel',
      OPENAI_API_KEY: 'must-not-travel',
      GIT_DIR: '/tmp/repo/.git',
      KEEP_ME: 'yes',
    })
    expect(env['META_API_KEY']).toBeUndefined()
    expect(env['OPENAI_API_KEY']).toBeUndefined()
    expect(env['GIT_DIR']).toBeUndefined()
    expect(env['KEEP_ME']).toBe('yes')
  })

  it('a check runs in a slot against a snapshot of the copy, setup once per lockfile', async () => {
    const repo = scratchRepo('m96c-slot-src-')
    writeFileSync(path.join(repo, 'package.json'), '{"name":"slot"}\n')
    writeFileSync(path.join(repo, 'lock.txt'), 'lock-v1\n')
    writeFileSync(path.join(repo, 'check.txt'), 'committed\n')
    git(['add', '.'], repo)
    git(['commit', '-m', 'base'], repo)
    // The worker's own copy of the repository, never the user's root.
    const copyParent = tempRoot('m96c-slot-copy-')
    const copy = path.join(copyParent, 'copy')
    git(['clone', '--no-hardlinks', repo, copy], copyParent)
    git(['config', 'user.name', 'M96c'], copy)
    git(['config', 'user.email', 'm96c@example.invalid'], copy)
    // Uncommitted work is part of the snapshot the check must see.
    writeFileSync(path.join(copy, 'check.txt'), 'uncommitted\n')
    const root = tempRoot('m96c-slot-root-')
    const setups = path.join(root, 'setups')
    writeFileSync(setups, '')
    const slots = new CheckSlots({
      file: 'git',
      run: runProcess,
      env: process.env,
      root,
      repositoryRoot: repo,
      platform: process.platform,
      count: 1,
      setupCommand: `printf x >> '${setups.replaceAll("'", String.raw`'\''`)}'`,
      cacheKey: 'm96c',
      installPaths: [],
      shell: '/bin/sh',
      shellArgs: (command) => ['-c', command],
      isTrusted: () => true,
      isHostBusy: () => false,
    })
    const job = (runId: string) => ({
      runId,
      cwd: copy,
      command: 'cat check.txt',
      timeoutMs: 30_000,
      commandClass: 'tests' as const,
      labels: [],
      preferredRunners: [],
      lockfiles: ['lock.txt'],
      signal: new AbortController().signal,
      onOutput: () => undefined,
    })
    const first = await slots.run(job('run-1'))
    expect(first.exitCode).toBe(0)
    expect(first.output).toContain('uncommitted')
    const second = await slots.run(job('run-2'))
    expect(second.exitCode).toBe(0)
    expect(readFileSync(setups, 'utf8')).toBe('x')
    expect(slots.states()).toEqual([{ id: 0, busy: false, uncertain: false }])
    // The user's own root is refused as a check copy (acceptance 24's guard).
    await expect(slots.run({ ...job('run-3'), cwd: repo })).rejects.toThrow()
  }, 30_000)
})

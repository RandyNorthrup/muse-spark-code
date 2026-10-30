import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWindowTeamScheduler } from '../../src/core/team/scheduler/window'
import type {
  TeamAttemptRef,
  TeamRetirementPort,
  TeamSchedulingDeps,
  TeamSchedulingPort,
} from '../../src/core/team/teamScheduling'
import type { TeamStatePort } from '../../src/core/team/teamHostService'
import { fixtureGit } from './helpers/teamLandingFixture'

// Real-process recovery proofs (M96c): every worker below is a real child
// process, the board journal is a real JSON file on disk, and a "crash" is a
// kill -9 of the child plus a scheduler abandoned without release. Only the
// host's port adapters (admission, launch, evidence) are supplied here, the
// same boundary the production host supplies.

const rootHolder: { root: string } = { root: '' }
const children = new Map<string, { child: ChildProcess; exited: boolean }>()

function stateFile(file: string): TeamStatePort {
  let values: Record<string, unknown> = {}
  const load = (): void => {
    try {
      values = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      values = {}
    }
  }
  load()
  return {
    get: (key) => values[key],
    update: async (key, value) => {
      values =
        value === undefined
          ? Object.fromEntries(Object.entries(values).filter(([name]) => name !== key))
          : { ...values, [key]: value }
      await writeFile(file, JSON.stringify(values))
    },
  }
}

function launchChild(
  taskId: string,
  script = 'setTimeout(() => {}, 600000)',
  args: readonly string[] = [],
): ChildProcess {
  const child = spawn(process.execPath, ['-e', script, '--', ...args], {
    stdio: 'ignore',
  })
  const record = { child, exited: false }
  children.set(taskId, record)
  child.on('exit', () => {
    record.exited = true
  })
  return child
}

function hasExited(ref: TeamAttemptRef): boolean {
  return children.get(ref.taskId)?.exited ?? false
}

function retirementPort(kind: 'engine' | 'external'): TeamRetirementPort {
  return {
    evidence: (ref) => ({
      windowInstanceId: 'window-a',
      ref,
      kind,
      loopStopped: hasExited(ref),
      turnTerminal: hasExited(ref),
      itemsTerminal: hasExited(ref),
      promptAnswered: hasExited(ref),
      isReadOnlyMuse: false,
      hostExited: false,
      processes: [{ childExited: hasExited(ref), descendantsEnded: false, method: 'unproved' }],
      containerMethod: 'unproved',
    }),
    cancel: (ref) => {
      children.get(ref.taskId)?.child.kill('SIGTERM')
      return Promise.resolve()
    },
    changed: (ref, signal) =>
      new Promise((resolve) => {
        const timer = setInterval(() => {
          if (!(hasExited(ref) || signal.aborted)) {
            return
          }

          clearInterval(timer)
          resolve()
        }, 5)
      }),
    escalate: (ref) => {
      children.get(ref.taskId)?.child.kill('SIGKILL')
      return Promise.resolve()
    },
    quarantine: () => Promise.resolve(),
    canQuarantine: () => true,
    restartWorkers: () => {
      for (const { child } of children.values()) child.kill('SIGKILL')
      return Promise.resolve()
    },
    checkpoint: () => Promise.resolve({ commit: 'abc123', files: ['a.ts'], diffStat: '1 file' }),
    settleUsage: () => Promise.resolve(),
    isKeyEntry: () => false,
    consentEntry: () => Promise.resolve(true),
    stallBrief: () => ({ brief: 'do it', lastMessage: '', toolCalls: [] }),
    applyReassignment: () => Promise.resolve(true),
    applyReplacement: () => Promise.resolve(true),
  }
}

function makeScheduler(
  state: TeamStatePort,
  options: {
    windowInstanceId?: string
    kind?: 'engine' | 'external'
    processStart?: string
    onLaunch?: (taskId: string) => void
    childFor?: (taskId: string) => { script: string; args: readonly string[] }
  } = {},
): TeamSchedulingPort {
  const deps: TeamSchedulingDeps = {
    workspaceId: 'ws',
    windowInstanceId: options.windowInstanceId ?? 'window-a',
    state,
    now: () => Date.now(),
    sharedFiles: () => [],
    ownerBirth: {
      windowStartedAt: Date.now(),
      pid: process.pid,
      processStart: options.processStart ?? 'test-start-a',
    },
    probeOwner: () => Promise.resolve(false),
    limits: () => ({
      workers: 4,
      processWorkers: 4,
      role: () => 4,
      entry: () => 4,
      agent: () => 4,
    }),
    entries: () => [
      {
        id: 'e1',
        roleId: 'engineering',
        agentProfileId: 'agent-1',
        modelId: 'model-1',
        kind: options.kind ?? 'engine',
        poolFit: 1,
        remainingDayTokens: Number.MAX_SAFE_INTEGER,
        eligible: () => true,
      },
    ],
    mode: () => 'copy',
    report: () => '',
    canStart: () => true,
    admit: () => true,
    refund: () => undefined,
    authorize: () => Promise.resolve(true),
    // The launch contract is start-only: resolve once the worker process exists.
    launch: (task) => {
      options.onLaunch?.(task.id)
      const child = options.childFor?.(task.id)
      launchChild(task.id, child?.script, child?.args)
      return Promise.resolve()
    },
    changed: () => undefined,
    failure: () => undefined,
    retirement: retirementPort(options.kind ?? 'engine'),
  }
  return createWindowTeamScheduler(deps)
}

async function start(scheduler: TeamSchedulingPort): Promise<void> {
  await scheduler.takeoverBoard()
  await scheduler.resume()
}

const submission = (id: string) => ({
  id,
  sessionId: 's1',
  roleId: 'engineering',
  fields: { priority: 'normal' as const, size: 'M' as const, overlap: 'serialize' as const },
})

beforeAll(async () => {
  rootHolder.root = await mkdtemp(path.join(tmpdir(), 'muse-m96c-recovery-'))
})

afterAll(async () => {
  for (const { child } of children.values()) child.kill('SIGKILL')
  await rm(rootHolder.root, { recursive: true, force: true })
})

describe('window scheduler crash recovery (real processes)', () => {
  it('kill -9 mid-task, then a fresh window resumes the attempt from the journal', async () => {
    const file = path.join(rootHolder.root, 'crash.json')
    const launched: string[] = []
    const first = makeScheduler(stateFile(file), {
      onLaunch: (id) => {
        launched.push(`a:${id}`)
      },
    })
    await start(first)
    await first.submit([submission('task-crash')])
    await first.wake()
    expect(launched).toEqual(['a:task-crash'])
    const pid = children.get('task-crash')?.child.pid
    expect(pid).toBeGreaterThan(0)

    // The worker dies hard and the window dies with it: dispose stops its
    // timers (a dead process has none) but never releases ownership.
    process.kill(pid ?? 0, 'SIGKILL')
    first.dispose()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(children.get('task-crash')?.exited).toBe(true)
    const journalled = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(JSON.stringify(journalled)).toContain('task-crash')

    // A fresh window over the same journal takes over (owner proven gone)
    // and drives the interrupted attempt again.
    const second = makeScheduler(stateFile(file), {
      windowInstanceId: 'window-b',
      processStart: 'test-start-b',
      onLaunch: (id) => {
        launched.push(`b:${id}`)
      },
    })
    await start(second)
    const isReopened = await second.reopenInterrupted('task-crash')
    await second.wake()
    // The interrupted attempt reported no usage, so reopen un-counts it and
    // the fresh window drives the task again from the same journal.
    expect(isReopened).toBe(true)
    expect(launched).toContain('b:task-crash')
    const board = second.snapshot()
    const task = board.tasks.find((item) => item.id === 'task-crash')
    expect(task?.attempts).toHaveLength(1)
    expect(task?.attempts[0]?.state).toBe('running')
    second.dispose()
  })

  // This platform proves no containment (no Windows job, no Linux cgroup),
  // so retirement is honestly unprovable here: the attempt stays counted
  // and uncertain through both bounded waits, and only the person's
  // recorded decision (Hand off anyway) starts the replacement.
  it('an unprovable attempt stays uncertain until Hand off anyway', async () => {
    const file = path.join(rootHolder.root, 'uncertain.json')
    const launched: string[] = []
    const scheduler = makeScheduler(stateFile(file), {
      kind: 'external',
      onLaunch: (id) => {
        launched.push(id)
      },
    })
    await start(scheduler)
    await scheduler.submit([submission('task-uncertain')])
    await scheduler.wake()
    expect(launched).toEqual(['task-uncertain'])
    // The child dies, but a direct exit proves nothing about descendants.
    children.get('task-uncertain')?.child.kill('SIGKILL')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(children.get('task-uncertain')?.exited).toBe(true)
    const outcome = await scheduler.retireAttempt('task-uncertain', 1)
    expect(outcome).toBe('uncertain')
    const blocked = scheduler.snapshot().tasks.find((item) => item.id === 'task-uncertain')
    expect(blocked?.state).toBe('blocked')
    // The recorded decision starts the replacement from the checkpoint.
    const isHandedOff = await scheduler.handOffAnyway('task-uncertain', 1, 'e1')
    expect(isHandedOff).toBe(true)
    await scheduler.wake()
    expect(launched).toEqual(['task-uncertain', 'task-uncertain'])
    scheduler.dispose()
    // Two real TEAM_RETIRE_WAIT_MS bounds (cancel, then escalate) elapse
    // before an unprovable retirement may settle as uncertain.
  }, 90_000)
})

describe('window scheduler throughput (real worktrees)', () => {
  it('fills every lane, never exceeds it, and lands real commits in each copy', async () => {
    const root = rootHolder.root
    const source = path.join(root, 'throughput-source')
    await fixtureGit(root, ['init', '-b', 'main', source])
    await writeFile(path.join(source, 'base.txt'), 'base\n')
    await fixtureGit(source, ['add', '-A'])
    await fixtureGit(source, ['commit', '-m', 'base'])

    const taskIds = Array.from({ length: 8 }, (_unused, index) => `tp-${String(index + 1)}`)
    const launchedHere: string[] = []
    let maxActive = 0
    const scheduler = makeScheduler(stateFile(path.join(root, 'throughput.json')), {
      onLaunch: (id) => {
        launchedHere.push(id)
        const exited = launchedHere.filter((item) => children.get(item)?.exited === true).length
        maxActive = Math.max(maxActive, launchedHere.length - exited)
      },
      childFor: (taskId) => {
        const dest = path.join(root, `copy-${taskId}`)
        const name = `work-${taskId}.txt`
        // A real worker copy: clone, write and commit with the real git.
        const script = [
          "const { execFileSync } = require('node:child_process')",
          "const { writeFileSync } = require('node:fs')",
          "const path = require('node:path')",
          `const source = ${JSON.stringify(source)}`,
          `const dest = ${JSON.stringify(dest)}`,
          `const name = ${JSON.stringify(name)}`,
          "const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd })",
          "git(path.dirname(dest), ['clone', '--no-hardlinks', source, dest])",
          String.raw`writeFileSync(path.join(dest, name), name + '\n')`,
          "git(dest, ['add', '-A'])",
          "git(dest, ['commit', '-m', name])",
        ].join('\n')
        return { script, args: [] }
      },
    })
    await start(scheduler)
    await scheduler.submit(taskIds.map((id) => submission(id)))
    await scheduler.wake()

    const finished = new Set<string>()
    const deadline = Date.now() + 90_000
    while (finished.size < taskIds.length && Date.now() < deadline) {
      let isProgressed = false
      for (const id of taskIds) {
        if (finished.has(id) || children.get(id)?.exited !== true) {
          continue
        }

        finished.add(id)
        await scheduler.finish(id, 'done', { kind: 'userDecision' })
        isProgressed = true
      }
      if (isProgressed) await scheduler.wake()
      else await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(finished.size).toBe(taskIds.length)
    // The person's four-worker lane count is the ceiling and it is used.
    expect(maxActive).toBe(4)
    const board = scheduler.snapshot()
    for (const id of taskIds) {
      const task = board.tasks.find((item) => item.id === id)
      expect(task?.state).toBe('done')
      const name = `work-${id}.txt`
      const shown = await fixtureGit(path.join(root, `copy-${id}`), ['show', `HEAD:${name}`])
      expect(shown).toBe(`${name}\n`)
    }
    scheduler.dispose()
    // Eight real clones and commits through four lanes exceed the 5 s default.
  }, 120_000)
})

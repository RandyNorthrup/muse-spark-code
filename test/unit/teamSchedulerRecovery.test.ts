import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { createTeamWindowRuntime } from '../../src/core/team/scheduler/teamWindowEntry'
import {
  TEAM_BOARD_STATE_KEY,
  createWindowTeamScheduler,
} from '../../src/core/team/scheduler/window'
import type {
  TeamAttemptRef,
  TeamRetirementPort,
  TeamSchedulingPort,
} from '../../src/core/team/teamScheduling'
import type { TeamStatePort } from '../../src/core/team/teamHostService'
import { runProgram } from '../../src/host/processTree'
import {
  createNativeTeamProcessDriver,
  type ContainedTeamChild,
  type Retirement,
  type TeamProcessDriver,
} from '../../src/host/team/processLifetime'
import { EN } from '../../src/shared/l10n/en'
import { teamBoardSchema } from '../../src/shared/team'
import { readJobSource } from './helpers/jobSource'
import { expectEnded, isRunning, killLaunched, markedPid } from './helpers/processes'
import { buildShellJobHelper } from './helpers/shellJobBuild'
import { fixtureGit } from './helpers/teamLandingFixture'
import {
  launchInTeamJob,
  stateFile,
  submission,
  windowSchedulerDeps,
} from './helpers/teamWindowRig'
import { removeFolder } from './helpers/temporaryFolders'

// Real-process recovery proofs (M96c): every worker below is a real child
// process, the board journal is a real JSON file on disk, and a crash is a real
// window process running the product's scheduler, killed (SIGKILL; on Windows
// Node's kill is TerminateProcess, as abrupt) with its worker running. Only the
// host's port adapters (admission, launch, evidence) are supplied here, the
// same boundary the production host supplies.

const rootHolder: { root: string; windowBundle: string } = { root: '', windowBundle: '' }
const children = new Map<string, { child: ChildProcess; exited: boolean }>()
const windows = new Set<ChildProcess>()
const SYSTEM_ROOT = process.env['SystemRoot'] ?? String.raw`C:\Windows`

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

/** Once the task's child has exited. A kill only starts the end: on Windows
TerminateProcess returns before the process is gone, so no fixed wait does. */
function exitOf(taskId: string): Promise<void> {
  const record = children.get(taskId)
  if (record === undefined) return Promise.reject(new Error('the task has no child'))
  if (record.exited) return Promise.resolve()
  return new Promise((resolve) => {
    record.child.once('exit', () => {
      resolve()
    })
  })
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
    kind?: 'engine' | 'external'
    onLaunch?: (taskId: string) => void
    childFor?: (taskId: string) => { script: string; args: readonly string[] }
    /** Another launch and its evidence: the Windows job case below. */
    contained?: { launch: (ref: TeamAttemptRef) => Promise<void>; retirement: TeamRetirementPort }
  } = {},
): TeamSchedulingPort {
  return createWindowTeamScheduler(
    windowSchedulerDeps({
      windowInstanceId: 'window-a',
      state,
      kind: options.kind ?? 'engine',
      launch: async (ref) => {
        options.onLaunch?.(ref.taskId)
        if (options.contained !== undefined) {
          await options.contained.launch(ref)
          return
        }
        const child = options.childFor?.(ref.taskId)
        launchChild(ref.taskId, child?.script, child?.args)
      },
      retirement: options.contained?.retirement ?? retirementPort(options.kind ?? 'engine'),
    }),
  )
}

async function start(scheduler: TeamSchedulingPort): Promise<void> {
  await scheduler.takeoverBoard()
  await scheduler.resume()
}

const readySchema = z.object({ workerPid: z.number() })

/** A real window process over the journal `file`, once its worker is launched. */
async function startWindow(input: {
  readonly file: string
  readonly taskId: string
  readonly worker: readonly string[]
  readonly jobHelperFolder?: string
}) {
  const readyFile = `${input.file}.ready`
  const planFile = `${input.file}.plan`
  await writeFile(
    planFile,
    JSON.stringify({
      windowInstanceId: 'window-a',
      stateFile: input.file,
      readyFile,
      taskId: input.taskId,
      worker: input.worker,
      cwd: rootHolder.root,
      systemRoot: SYSTEM_ROOT,
      ...(input.jobHelperFolder !== undefined && { jobHelperFolder: input.jobHelperFolder }),
    }),
  )
  const child = spawn(process.execPath, [rootHolder.windowBundle, planFile], { stdio: 'ignore' })
  windows.add(child)
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      windows.delete(child)
      resolve()
    })
  })
  const ready = await vi.waitFor(
    async () => readySchema.parse(JSON.parse(await readFile(readyFile, 'utf8'))),
    // A cold birth reader, and the job helper's self-test when it has one.
    { timeout: 60_000, interval: 50 },
  )
  return {
    workerPid: ready.workerPid,
    kill: async () => {
      const isAliveAtKill = child.exitCode === null && child.signalCode === null
      child.kill('SIGKILL')
      await exited
      return { isAliveAtKill, signal: child.signalCode }
    },
  }
}

/** The journal as the killed window left it: its claim standing, its attempt running. */
async function expectStandingClaim(file: string, taskId: string): Promise<void> {
  const stored = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(file, 'utf8')))[
    TEAM_BOARD_STATE_KEY
  ]
  const board = teamBoardSchema.parse(stored)
  expect(board.owner).toMatchObject({ windowInstanceId: 'window-a', released: false })
  expect(board.tasks.map(({ id, state }) => ({ id, state }))).toEqual([
    { id: taskId, state: 'running' },
  ])
  expect(board.tasks[0]?.attempts.map((attempt) => attempt.state)).toEqual(['running'])
}

beforeAll(async () => {
  rootHolder.root = await mkdtemp(path.join(tmpdir(), 'muse-m96c-recovery-'))
  rootHolder.windowBundle = path.join(rootHolder.root, 'teamWindowChild.mjs')
  await build({
    entryPoints: [path.resolve('test/unit/teamWindowChild.entry.ts')],
    outfile: rootHolder.windowBundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })
}, 120_000)

afterAll(async () => {
  for (const child of windows) child.kill('SIGKILL')
  for (const { child } of children.values()) child.kill('SIGKILL')
  await rm(rootHolder.root, { recursive: true, force: true })
})

describe('window scheduler crash recovery (real processes)', () => {
  it('a window killed mid-task: the next proves it gone and resumes from the journal', async () => {
    const file = path.join(rootHolder.root, 'crash.json')
    const first = await startWindow({
      file,
      taskId: 'task-crash',
      worker: [process.execPath, '-e', 'setTimeout(() => {}, 600000)'],
    })
    const runtime = await createTeamWindowRuntime(EN, 'en')
    const launched: string[] = []
    const nextWindow = () =>
      runtime.createWindowTeamScheduler(
        windowSchedulerDeps({
          windowInstanceId: 'window-b',
          state: stateFile(file),
          kind: 'engine',
          launch: (ref) => {
            launched.push(ref.taskId)
            launchChild(ref.taskId)
            return Promise.resolve()
          },
          retirement: retirementPort('engine'),
        }),
      )

    // A live owner keeps its board, whoever reads it.
    const early = nextWindow()
    expect(await early.takeoverBoard()).toBe(false)
    early.dispose()

    // The window dies hard, without releasing anything. A plain worker has no
    // job of ours to die with: on Windows libuv's own job for a Node process's
    // children takes it (ESRCH here), elsewhere this test ends it.
    expect(await first.kill()).toEqual({ isAliveAtKill: true, signal: 'SIGKILL' })
    try {
      process.kill(first.workerPid, 'SIGKILL')
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'ESRCH' })
    }
    await expectEnded(first.workerPid)
    await expectStandingClaim(file, 'task-crash')

    // The next window finds it interrupted, takes the board on the real proof
    // of the owner's death, and drives the task again from the same journal.
    const second = nextWindow()
    const restored = second.snapshot().tasks.find((item) => item.id === 'task-crash')
    expect(restored?.state).toBe('blocked')
    expect(restored?.attempts.map((attempt) => attempt.state)).toEqual(['interrupted'])
    expect(await second.takeoverBoard()).toBe(true)
    await second.resume()
    // The interrupted attempt reported no usage, so reopen un-counts it.
    expect(await second.reopenInterrupted('task-crash')).toBe(true)
    await second.wake()
    expect(launched).toEqual(['task-crash'])
    const task = second.snapshot().tasks.find((item) => item.id === 'task-crash')
    expect(task?.attempts.map((attempt) => attempt.state)).toEqual(['running'])
    second.dispose()
    // A real window process, its cold birth reader, and the next window's.
  }, 120_000)

  // This launch proves no containment (a plain child, in no Windows job or
  // Linux cgroup), so retirement is honestly unprovable here: the attempt
  // stays counted and uncertain through both bounded waits, and only the
  // person's recorded decision (Hand off anyway) starts the replacement.
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
    await exitOf('task-uncertain')
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

// On Windows the product's team launch holds each worker in a job (the job
// helper's `run-team`, src/host/team/processLifetime.ts): when the worker
// dies, its kill-on-close inner job ends everything it started, and the
// helper reports `END proved` only once the job holds the helper alone.
// That is the proof the plain child above cannot give, so a worker killed
// mid-task (TerminateProcess, Node's SIGKILL on Windows) retires proved and
// its replacement starts with no decision of the person's.
const JOB_WORKER = `const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true })
grandchild.unref()
writeFileSync(process.argv[2], String(grandchild.pid))
setInterval(() => {}, 1000)
`

function keyOf(ref: TeamAttemptRef): string {
  return `${ref.taskId}#${String(ref.attempt)}`
}

describe.runIf(process.platform === 'win32')(
  'window scheduler crash recovery in a Windows job (the real job helper)',
  () => {
    const job: { storage: string; worker: string; driver?: TeamProcessDriver } = {
      storage: '',
      worker: '',
    }
    const jobs = new Map<
      string,
      { launch: ContainedTeamChild; pid: number; marker: string; ended?: Retirement }
    >()

    beforeAll(async () => {
      job.worker = path.join(rootHolder.root, 'job-worker.cjs')
      await writeFile(job.worker, JOB_WORKER)
      const built = await buildShellJobHelper('muse-m96c-job-', SYSTEM_ROOT)
      job.storage = built.storageDir
      job.driver = await createNativeTeamProcessDriver({
        killGraceMs: 2000,
        windows: {
          storageDir: built.storageDir,
          systemRoot: SYSTEM_ROOT,
          log: () => undefined,
          readJobSource,
          run: runProgram,
        },
      })
      // Building the helper through the product's builder compiles C#.
    }, 120_000)

    afterAll(async () => {
      // A helper still running is killed; its kill-on-close job takes the rest.
      await killLaunched(Array.from(jobs.values(), (item) => item.launch))
      await removeFolder(job.storage)
    })

    /** The product's Windows launch: confirmed in its job, then released. */
    const launchInJob = async (ref: TeamAttemptRef): Promise<void> => {
      if (job.driver === undefined) throw new Error('the team driver did not start')
      const marker = path.join(rootHolder.root, `${keyOf(ref).replace('#', '-')}.grandchild`)
      const { launch, confirmation } = await launchInTeamJob(job.driver, {
        command: process.execPath,
        args: [job.worker, marker],
        cwd: rootHolder.root,
        taskId: ref.taskId,
        systemRoot: SYSTEM_ROOT,
      })
      const record: {
        launch: ContainedTeamChild
        pid: number
        marker: string
        ended?: Retirement
      } = { launch, pid: confirmation.pid, marker }
      jobs.set(keyOf(ref), record)
      void launch.ended.then((ended) => {
        record.ended = ended
      })
    }

    /** The evidence the production host builds, from the job's own proof. */
    const jobRetirement: TeamRetirementPort = {
      ...retirementPort('external'),
      evidence: (ref) => {
        const ended = jobs.get(keyOf(ref))?.ended
        const isProved = ended?.childExited === true && ended.descendants === 'proved'
        const method = isProved ? ('windowsJob' as const) : ('unproved' as const)
        return {
          windowInstanceId: 'window-a',
          ref,
          kind: 'external',
          loopStopped: ended !== undefined,
          turnTerminal: ended !== undefined,
          itemsTerminal: ended !== undefined,
          promptAnswered: ended !== undefined,
          isReadOnlyMuse: false,
          hostExited: isProved,
          processes: [
            { childExited: ended?.childExited ?? false, descendantsEnded: isProved, method },
          ],
          containerMethod: method,
        }
      },
      // The killed worker has nothing left to ask; STOP is the escalation.
      cancel: () => Promise.resolve(),
      changed: (ref, signal) =>
        new Promise((resolve) => {
          const timer = setInterval(() => {
            if (jobs.get(keyOf(ref))?.ended === undefined && !signal.aborted) return
            clearInterval(timer)
            resolve()
          }, 5)
        }),
      escalate: async (ref) => {
        await jobs.get(keyOf(ref))?.launch.retire()
      },
    }

    it('a worker killed mid-task retires proved by its job, and its replacement starts', async () => {
      const launched: string[] = []
      const scheduler = makeScheduler(stateFile(path.join(rootHolder.root, 'job.json')), {
        kind: 'external',
        onLaunch: (id) => {
          launched.push(id)
        },
        contained: { launch: launchInJob, retirement: jobRetirement },
      })
      await start(scheduler)
      await scheduler.submit([submission('task-job')])
      await scheduler.wake()
      const first = jobs.get('task-job#1')
      if (first === undefined) throw new Error('the first attempt did not launch in its job')
      const grandchild = await markedPid(first.marker)

      // The worker dies hard mid-task; what it started is still in its job.
      process.kill(first.pid, 'SIGKILL')
      expect(await scheduler.reassignAttempt('task-job', 1, 'e1')).toBe('reassigned')

      // The job ended the worker's descendants and proved it.
      await expectEnded(grandchild)
      expect(first.ended).toEqual({ childExited: true, descendants: 'proved' })
      expect(
        scheduler.snapshot().tasks.find((item) => item.id === 'task-job')?.attempts[0],
      ).toMatchObject({ state: 'retired', retirement: { kind: 'proved', method: 'windowsJob' } })
      // Nothing waits on the person: no attempt is left uncertain to hand off.
      expect(await scheduler.handOffAnyway('task-job', 1, 'e1')).toBe(false)

      // Process workers start staggered (TEAM_START_STAGGER_MS): the sweep
      // launches the replacement, in a job of its own, once that has passed.
      await vi.waitFor(
        () => {
          expect(jobs.has('task-job#2')).toBe(true)
        },
        { timeout: 30_000 },
      )
      const task = scheduler.snapshot().tasks.find((item) => item.id === 'task-job')
      expect(task?.attempts.map((attempt) => attempt.state)).toEqual(['retired', 'running'])
      expect(launched).toEqual(['task-job', 'task-job'])
      scheduler.dispose()
      // A cold job helper, two real launches and the stagger exceed the default.
    }, 90_000)

    it('a window killed mid-task takes its worker tree with it, and the next window relaunches', async () => {
      const file = path.join(rootHolder.root, 'window-job.json')
      const marker = path.join(rootHolder.root, 'window-job.grandchild')
      const first = await startWindow({
        file,
        taskId: 'task-window-job',
        worker: [process.execPath, job.worker, marker],
        jobHelperFolder: job.storage,
      })
      const grandchild = await markedPid(marker)
      expect(isRunning(first.workerPid)).toBe(true)
      expect(isRunning(grandchild)).toBe(true)

      // Workers die with their window: its job ends them, and nothing else does.
      expect(await first.kill()).toEqual({ isAliveAtKill: true, signal: 'SIGKILL' })
      await expectEnded(first.workerPid)
      await expectEnded(grandchild)
      await expectStandingClaim(file, 'task-window-job')

      const runtime = await createTeamWindowRuntime(EN, 'en')
      const second = runtime.createWindowTeamScheduler(
        windowSchedulerDeps({
          windowInstanceId: 'window-b',
          state: stateFile(file),
          kind: 'external',
          launch: launchInJob,
          retirement: jobRetirement,
        }),
      )
      expect(await second.takeoverBoard()).toBe(true)
      await second.resume()
      expect(await second.reopenInterrupted('task-window-job')).toBe(true)
      await second.wake()
      const relaunched = jobs.get('task-window-job#1')
      if (relaunched === undefined) throw new Error('the next window did not relaunch in a job')
      expect(isRunning(relaunched.pid)).toBe(true)
      const task = second.snapshot().tasks.find((item) => item.id === 'task-window-job')
      expect(task?.attempts.map((attempt) => attempt.state)).toEqual(['running'])
      second.dispose()
      // A real window process, its job helper's self-test and two launches.
    }, 120_000)
  },
)

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

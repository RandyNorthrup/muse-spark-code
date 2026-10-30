// A later headless run sweeps exactly what dead runs left: folders under
// the run prefix whose owner is proven gone go with their owned refs, live
// and foreign folders stay. Real folders, a real repository and the real git
// binary only; the liveness predicate is the sweep's own parameter.
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EXEC_TEAM_CLEANUP_FILE,
  EXEC_TEAM_LEDGER_LOCK_FILE,
  EXEC_TEAM_RUN_PREFIX,
} from '../../src/shared/constants'
import { acquireFileLease, type FileLeaseEnv } from '../../src/core/locks/fileLease'
import { execLedgerLeaseEnv } from '../../src/runtime/exec/execLedgerLeaseEntry'
import { setTimeout as delay } from 'node:timers/promises'
import { processTeamGit } from '../../src/core/team/workers/workerOps'
import {
  currentOwner,
  holdRefFor,
  preserveFailedMerge,
  predictedAgentsRef,
  recordCleanupOwner,
  recordCleanupRef,
  sweepStaleTeamRuns,
} from '../../src/runtime/exec/execTeamRecovery'
import { configureRuntimeGovernor, type RuntimeGovernor } from './helpers/resources/runtimeGovernor'
import { realTeamGit } from './helpers/realTeamGit'

const execFileAsync = promisify(execFile)

// Real git workloads (init, commit, branch, ref checks) share one ceiling:
// complete native runs take seconds on a loaded rig, never minutes.
const REAL_GIT_TIMEOUT_MS = 30_000

/**
This rig's /usr/bin/git is an Xcode shim the sandbox cannot launch; the
CommandLineTools binary beside it is the real Git. Prefer it when the
plain name does not run, so these suites use real Git here and the
ambient one everywhere else.
*/
async function preferRealGitOnDarwin(): Promise<void> {
  if (process.platform !== 'darwin') return
  try {
    await execFileAsync('git', ['--version'], { timeout: 10_000 })
  } catch {
    const dir = '/Library/Developer/CommandLineTools/usr/bin'
    process.env['PATH'] = `${dir}${path.delimiter}${process.env['PATH'] ?? ''}`
    await execFileAsync('git', ['--version'], { timeout: 10_000 })
  }
}

/** A scratch repository under `root` with one seed commit. */
async function seedRepo(root: string): Promise<string> {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await git(['init', '-q'], repo)
  await git(
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'seed'],
    repo,
  )
  return repo
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    timeout: REAL_GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  })
  return stdout
}

describe('exec team sweep over the real runs root', () => {
  let root = ''
  let repo = ''
  let deadFolder = ''
  let liveFolder = ''
  let orphanFolder = ''
  let agentsRef = ''
  let gitImpl: ReturnType<typeof processTeamGit> | undefined
  let governor: RuntimeGovernor | undefined

  beforeAll(async () => {
    await preferRealGitOnDarwin()
    // The sweep's git is the governed contained launch, so the governor is
    // configured as the runtime process configures it for a headless run.
    governor = await configureRuntimeGovernor('exec-team-sweep-jobs-')
    gitImpl = processTeamGit(process.platform)
    root = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}sweep-`))
    repo = await seedRepo(root)
    const branch = 'agents/reviewer/task-sweep'
    await git(['branch', branch], repo)
    agentsRef = `refs/heads/${branch}`
    expect(predictedAgentsRef('reviewer', 'task-sweep')).toBe(agentsRef)

    deadFolder = path.join(root, `${EXEC_TEAM_RUN_PREFIX}dead`)
    await mkdir(deadFolder, { recursive: true })
    await recordCleanupOwner(deadFolder, { pid: 2 ** 22 - 1, startedAt: 1 })
    await recordCleanupRef(deadFolder, {
      repo,
      role: 'reviewer',
      taskId: 'task-sweep',
      ref: agentsRef,
    })

    liveFolder = path.join(root, `${EXEC_TEAM_RUN_PREFIX}live`)
    await mkdir(liveFolder, { recursive: true })
    await recordCleanupOwner(liveFolder, currentOwner())

    orphanFolder = path.join(root, `${EXEC_TEAM_RUN_PREFIX}orphan`)
    await mkdir(orphanFolder, { recursive: true })
    const past = new Date(Date.now() - 600_000)
    await utimes(orphanFolder, past, past)
  }, REAL_GIT_TIMEOUT_MS)

  afterAll(async () => {
    await governor?.dispose()
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  }, REAL_GIT_TIMEOUT_MS)

  it(
    'removes the dead run with its owned ref and keeps the live one',
    { timeout: REAL_GIT_TIMEOUT_MS },
    async () => {
      await expect(git(['rev-parse', '--verify', agentsRef], repo)).resolves.toMatch(
        /^[0-9a-f]{40}\n$/,
      )
      const result = await sweepStaleTeamRuns({
        tmpRoot: root,
        git: gitImpl ?? processTeamGit(process.platform),
        isAlive: (pid) => pid === process.pid,
      })
      expect(result.sweptFolders).toContain(deadFolder)
      expect(result.sweptRefs).toContain(`${repo}:${agentsRef}`)
      expect(result.skipped).toContain(liveFolder)
      expect(result.failed).toEqual([])
      await expect(stat(deadFolder)).rejects.toThrow()
      await expect(stat(liveFolder)).resolves.toBeDefined()
      await expect(stat(orphanFolder)).rejects.toThrow()
      await expect(git(['rev-parse', '--verify', agentsRef], repo)).rejects.toThrow()
      const liveLedger = JSON.parse(
        await readFile(path.join(liveFolder, EXEC_TEAM_CLEANUP_FILE), 'utf8'),
      ) as { refs: unknown[] }
      expect(liveLedger.refs).toEqual([])
    },
  )
})

describe('preserveFailedMerge over real git (finding 5)', () => {
  let root = ''
  let repo = ''
  let copy = ''
  let runFolder = ''
  let head = ''

  beforeAll(async () => {
    await preferRealGitOnDarwin()
    root = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}preserve-`))
    repo = await seedRepo(root)
    copy = path.join(root, 'copy')
    await git(['clone', '-q', '--shared', repo, copy], root)
    await git(
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'work'],
      copy,
    )
    const headText = await git(['rev-parse', 'HEAD'], copy)
    head = headText.trim()
    runFolder = path.join(root, `${EXEC_TEAM_RUN_PREFIX}run`)
    await mkdir(runFolder, { recursive: true })
    await recordCleanupOwner(runFolder, currentOwner())
  }, REAL_GIT_TIMEOUT_MS)

  afterAll(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  }, REAL_GIT_TIMEOUT_MS)

  it(
    'holds the branch in the repo and records the hold in the ledger',
    { timeout: REAL_GIT_TIMEOUT_MS },
    async () => {
      const preserved = await preserveFailedMerge({
        git: realTeamGit,
        repo,
        runFolder,
        copyFolder: copy,
        role: 'reviewer',
        taskId: 'task-preserve',
        head,
      })
      expect(preserved.kind).toBe('held')
      if (preserved.kind !== 'held') throw new Error('expected a held branch')
      await expect(git(['rev-parse', '--verify', preserved.ref], repo)).resolves.toBe(`${head}\n`)
      const ledger = JSON.parse(
        await readFile(path.join(runFolder, EXEC_TEAM_CLEANUP_FILE), 'utf8'),
      ) as { holds: { ref: string }[] }
      expect(ledger.holds.map((entry) => entry.ref)).toContain(preserved.ref)
    },
  )

  it(
    'keeps the work in place when the head names nothing holdable',
    { timeout: REAL_GIT_TIMEOUT_MS },
    async () => {
      const preserved = await preserveFailedMerge({
        git: realTeamGit,
        repo,
        runFolder,
        copyFolder: copy,
        role: 'reviewer',
        taskId: 'task-kept-head',
        head: 'not-a-commit',
      })
      expect(preserved).toEqual({ kind: 'kept' })
    },
  )

  it(
    'keeps the work in place when git cannot fetch the branch',
    { timeout: REAL_GIT_TIMEOUT_MS },
    async () => {
      const preserved = await preserveFailedMerge({
        git: realTeamGit,
        repo,
        runFolder,
        copyFolder: path.join(root, 'missing-copy'),
        role: 'reviewer',
        taskId: 'task-kept-fetch',
        head,
      })
      expect(preserved).toEqual({ kind: 'kept' })
      await expect(stat(copy)).resolves.toBeDefined()
    },
  )

  it(
    'names the hold in the ledger before the fetch creates it (pre-creation tombstone)',
    { timeout: REAL_GIT_TIMEOUT_MS },
    async () => {
      // The fetch cannot run (the copy is gone), so the ref was never
      // created: only a record written ahead of the fetch can name it, which
      // is what lets a later sweep find a ref a killed run half-created.
      await preserveFailedMerge({
        git: realTeamGit,
        repo,
        runFolder,
        copyFolder: path.join(root, 'missing-copy'),
        role: 'reviewer',
        taskId: 'task-tombstone',
        head,
      })
      const ledger = JSON.parse(
        await readFile(path.join(runFolder, EXEC_TEAM_CLEANUP_FILE), 'utf8'),
      ) as { holds: { ref: string }[] }
      expect(ledger.holds.map((entry) => entry.ref)).toContain(
        holdRefFor('reviewer', 'task-tombstone'),
      )
      await expect(
        git(['rev-parse', '--verify', holdRefFor('reviewer', 'task-tombstone')], repo),
      ).rejects.toThrow()
    },
  )
})

async function ledgerLeaseTestEnv(): Promise<FileLeaseEnv> {
  // The production environment with test-scale waits.
  const base = await execLedgerLeaseEnv()
  return {
    ...base,
    leaseMs: 30_000,
    honoredLeaseMs: 30_000,
    unreadableMs: 2000,
    timeoutMs: 10_000,
    pollMs: 10,
    watches: new Map(),
  }
}

describe('cleanup ledger cross-process lease (M96b file lease)', () => {
  it(
    'a ledger write waits for another holder of the folder lease, then lands',
    { timeout: REAL_GIT_TIMEOUT_MS },
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}lease-`))
      try {
        await recordCleanupOwner(root, currentOwner())
        const holder = await acquireFileLease(
          path.join(root, EXEC_TEAM_LEDGER_LOCK_FILE),
          await ledgerLeaseTestEnv(),
        )
        const recording = recordCleanupRef(root, {
          repo: root,
          role: 'reviewer',
          taskId: 'task-lease',
          ref: 'refs/heads/agents/reviewer/task-lease',
        })
        await delay(300)
        const during = JSON.parse(
          await readFile(path.join(root, EXEC_TEAM_CLEANUP_FILE), 'utf8'),
        ) as { refs: { ref: string }[] }
        expect(during.refs).toEqual([])
        await holder.release()
        await recording
        const after = JSON.parse(
          await readFile(path.join(root, EXEC_TEAM_CLEANUP_FILE), 'utf8'),
        ) as { refs: { ref: string }[] }
        expect(after.refs.map((entry) => entry.ref)).toEqual([
          'refs/heads/agents/reviewer/task-lease',
        ])
      } finally {
        const { rm } = await import('node:fs/promises')
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it(
    'concurrent records under contention lose no update',
    { timeout: REAL_GIT_TIMEOUT_MS },
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}lease2-`))
      try {
        await recordCleanupOwner(root, currentOwner())
        const holder = await acquireFileLease(
          path.join(root, EXEC_TEAM_LEDGER_LOCK_FILE),
          await ledgerLeaseTestEnv(),
        )
        const first = recordCleanupRef(root, {
          repo: root,
          role: 'reviewer',
          taskId: 'task-a',
          ref: 'refs/heads/agents/reviewer/task-a',
        })
        const second = recordCleanupRef(root, {
          repo: root,
          role: 'reviewer',
          taskId: 'task-b',
          ref: 'refs/heads/agents/reviewer/task-b',
        })
        await delay(200)
        await holder.release()
        await Promise.all([first, second])
        const ledger = JSON.parse(
          await readFile(path.join(root, EXEC_TEAM_CLEANUP_FILE), 'utf8'),
        ) as { refs: { ref: string }[] }
        expect(
          ledger.refs.map((entry) => entry.ref).toSorted((a, b) => a.localeCompare(b)),
        ).toEqual(['refs/heads/agents/reviewer/task-a', 'refs/heads/agents/reviewer/task-b'])
      } finally {
        const { rm } = await import('node:fs/promises')
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})

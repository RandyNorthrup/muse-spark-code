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
import { EXEC_TEAM_CLEANUP_FILE, EXEC_TEAM_RUN_PREFIX } from '../../src/shared/constants'
import { processTeamGit } from '../../src/core/team/workers/workerOps'
import {
  currentOwner,
  predictedAgentsRef,
  recordCleanupOwner,
  recordCleanupRef,
  sweepStaleTeamRuns,
} from '../../src/runtime/exec/execTeamRecovery'
import { configureRuntimeGovernor, type RuntimeGovernor } from './helpers/resources/runtimeGovernor'

const execFileAsync = promisify(execFile)

// Real git workloads (init, commit, branch, ref checks) share one ceiling:
// complete native runs take seconds on a loaded rig, never minutes.
const REAL_GIT_TIMEOUT_MS = 30_000

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
    // This rig's /usr/bin/git is an Xcode shim the sandbox cannot launch;
    // the CommandLineTools binary beside it is the real Git. Prefer it when
    // the plain name does not run, so the sweep below uses real Git here and
    // the ambient one everywhere else.
    if (process.platform === 'darwin') {
      try {
        await execFileAsync('git', ['--version'], { timeout: 10_000 })
      } catch {
        const dir = '/Library/Developer/CommandLineTools/usr/bin'
        process.env['PATH'] = `${dir}${path.delimiter}${process.env['PATH'] ?? ''}`
        await execFileAsync('git', ['--version'], { timeout: 10_000 })
      }
    }
    // The sweep's git is the governed contained launch, so the governor is
    // configured as the runtime process configures it for a headless run.
    governor = await configureRuntimeGovernor('exec-team-sweep-jobs-')
    gitImpl = processTeamGit(process.platform)
    root = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}sweep-`))
    repo = path.join(root, 'repo')
    await mkdir(repo, { recursive: true })
    await git(['init', '-q'], repo)
    await git(
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'seed'],
      repo,
    )
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

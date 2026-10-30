// Real-git landing fixture shared by the M96c landing proofs: a real
// repository, a worker clone with one committed change published back as
// the agents ref, and the real git binary behind the `TeamGit` contract.
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TeamGitError, type TeamGit } from '../../../src/core/team/teamGit'
import type { TeamMergePort } from '../../../src/core/team/teamHostService'
import type { TeamLandingPolicy } from '../../../src/host/team/teamLandingEntry'
import type { WindowIdentity } from '../../../src/host/team/windowIdentity'

export function fixtureGit(cwd: string, args: readonly string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'core.autocrlf=false',
        ...args,
      ],
      { cwd },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(new Error('git fixture command failed', { cause: error }))
      },
    )
    child.stdin?.end(input)
  })
}

/** The real git binary behind the `TeamGit` contract, honouring the
explicit environment (staging supplies a temporary GIT_INDEX_FILE). */
export const landingRunGit: TeamGit = (args, cwd, input, env) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'core.autocrlf=false',
        ...args,
      ],
      { cwd, ...(env !== undefined && { env }) },
      (error, stdout, stderr) => {
        if (error === null) resolve(Buffer.from(stdout))
        else {
          const code = typeof error.code === 'number' ? error.code : 128
          reject(new TeamGitError(code, stderr, args.join(' ')))
        }
      },
    )
    child.stdin?.end(input)
  })

export interface LandingFixture {
  readonly root: string
  readonly storage: string
  readonly workerCopy: string
  readonly baseCommit: string
  readonly head: string
  readonly agentsRef: string
  readonly taskId: string
  dispose(): Promise<void>
}

/** A user tree at "before" and a worker branch at "after" on file.txt. */
export async function makeLandingFixture(taskId: string): Promise<LandingFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'muse-m96c-landing-'))
  const storage = await mkdtemp(path.join(tmpdir(), 'muse-m96c-landing-store-'))
  await fixtureGit(root, ['init', '-b', 'main'])
  await writeFile(path.join(root, 'file.txt'), 'before\n')
  await fixtureGit(root, ['add', '-A'])
  await fixtureGit(root, ['commit', '-m', 'base'])
  const baseOut = await fixtureGit(root, ['rev-parse', 'HEAD'])
  const baseCommit = baseOut.trim()
  const workerCopy = path.join(storage, 'worker-copy')
  await fixtureGit(storage, ['clone', '--no-hardlinks', root, workerCopy])
  await writeFile(path.join(workerCopy, 'file.txt'), 'after\n')
  await fixtureGit(workerCopy, ['add', '-A'])
  await fixtureGit(workerCopy, ['commit', '-m', 'work'])
  const headOut = await fixtureGit(workerCopy, ['rev-parse', 'HEAD'])
  const head = headOut.trim()
  const agentsRef = `refs/muse-agents/${taskId}`
  await fixtureGit(root, ['fetch', '--no-tags', '--', workerCopy, `${head}:${agentsRef}`])
  return {
    root,
    storage,
    workerCopy,
    baseCommit,
    head,
    agentsRef,
    taskId,
    dispose: async () => {
      await rm(root, { recursive: true, force: true })
      await rm(storage, { recursive: true, force: true })
    },
  }
}

/** One passing `true` workspace check; suites override one port at a time. */
export function landingPolicy(
  owner: WindowIdentity,
  overrides: Partial<TeamLandingPolicy> = {},
): TeamLandingPolicy {
  return {
    owner,
    checks: () => ({
      commands: [{ name: 'check', command: 'true', timeoutSeconds: 60 }],
      platform: process.platform,
      setupCommand: '',
      cacheKey: '',
    }),
    runChecks: () => Promise.resolve({ passed: true }),
    confirmWithoutChecks: () => Promise.resolve(false),
    validateTarget: () => Promise.resolve(),
    hints: () => Promise.resolve([]),
    ...overrides,
  }
}

/** The merge-port task shape `landTeamTask` consumes for this fixture. */
export function landingTask(fixture: LandingFixture): Parameters<TeamMergePort['merge']>[0] {
  return {
    taskId: fixture.taskId,
    role: { role: 'engineering', pool: [] },
    outcome: {
      report: { status: 'done' as const, summary: 'done' },
      usage: {
        input: 0,
        cachedInput: 0,
        output: 0,
        reasoning: 0,
        modelCalls: 0,
        estimated: false,
      },
      folder: fixture.workerCopy,
      agentsRef: fixture.agentsRef,
      baseCommit: fixture.baseCommit,
      head: fixture.head,
      changedFiles: ['file.txt'],
    },
  }
}

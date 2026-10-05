// Real-git helpers for M96 lane I tests: disposable repositories under the
// OS temp directory (never under the checkout), a binary-safe git runner
// that surfaces exit codes as `TeamGitError`, and fixture programs owned
// here, never inherited from a developer's global git configuration.

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import { TeamGitError, type TeamGit } from '../../../src/core/team/teamWorkspaces'

const roots: string[] = []

/** Fixture programs/configuration are owned here, never inherited. */
export const teamGitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
}

export function trackTeamRoot(root: string): void {
  roots.push(root)
}

export function cleanupTeamRoots(): void {
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    }
  })
}

/** Binary-safe `git`: stdout as bytes, non-zero exits as `TeamGitError`. */
/** execFile's exit code, or 1 when it ended without one. */
function exitCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = Number(error.code)
    if (Number.isSafeInteger(code)) {
      return code
    }
  }
  return 1
}

/** Binary-safe `git`: stdout as bytes, non-zero exits as `TeamGitError`. */
export function teamGitRunner(env: NodeJS.ProcessEnv = teamGitEnv): TeamGit {
  return (args, cwd, input) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const child = execFile(
        'git',
        [...args],
        {
          cwd,
          env,
          timeout: 30_000,
          maxBuffer: 64 * 1024 * 1024,
          encoding: 'buffer',
        },
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(
              new TeamGitError(
                exitCodeOf(error),
                Buffer.from(stderr).toString('utf8'),
                args[0] ?? 'git',
              ),
            )
            return
          }
          resolve(new Uint8Array(stdout))
        },
      )
      if (input !== undefined) {
        child.stdin?.write(input)
      }
      child.stdin?.end()
    })
}

export interface TeamFixtureRepo {
  readonly root: string
  readonly head: string
}

/** A repository with one commit (`tracked.txt`, `shared.txt`), branch `main`. */
export async function teamFixtureRepo(
  runGit: TeamGit,
  tracked = 'before\n',
  shared = 'one\ntwo\nthree\n',
): Promise<TeamFixtureRepo> {
  const requested = await mkdtemp(path.join(tmpdir(), 'muse-team-i-'))
  const temp = realpathSync.native(requested)
  trackTeamRoot(temp)
  const root = path.join(temp, 'app')
  await mkdir(root)
  await runGit(['init', '-b', 'main'], root)
  await runGit(['config', 'user.name', 'Offline test'], root)
  await runGit(['config', 'user.email', 'offline@example.invalid'], root)
  await writeFile(path.join(root, 'tracked.txt'), tracked)
  await writeFile(path.join(root, 'shared.txt'), shared)
  await runGit(['add', '--all'], root)
  await runGit(['commit', '-m', 'fixture'], root)
  const head = Buffer.from(await runGit(['rev-parse', 'HEAD^{commit}'], root))
    .toString('utf8')
    .trim()
  return { root, head }
}

export async function teamRealPath(candidate: string): Promise<string> {
  return await realpath(candidate)
}

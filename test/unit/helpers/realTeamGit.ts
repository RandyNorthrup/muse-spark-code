// The real git binary behind the `TeamGit` contract, for suites that prove
// team git behavior against real repositories: standard input included
// (`cat-file --batch` reads its names there; a Buffer, since a string with
// a Buffer encoding is refused). Shared so the suites cannot drift apart.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished } from 'vitest'
import { TeamGitError, type TeamGit } from '../../../src/core/team/teamGit'
import { createEngineTeamPorts } from '../../../src/host/team/teamEnginePorts'
import { silentCoreLog } from './memoryLogs'

export const realTeamGit: TeamGit = (args, cwd, input, env) => {
  try {
    const out = execFileSync('git', [...args], {
      cwd,
      encoding: 'buffer',
      ...(input !== undefined && { input: Buffer.from(input, 'utf8') }),
      // The adapter contract: an explicit environment replaces the inherited one.
      ...(env !== undefined && { env }),
    })
    return Promise.resolve(new Uint8Array(out))
  } catch (error: unknown) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : 128
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''
    return Promise.reject(new TeamGitError(status, stderr, args.join(' ')))
  }
}

/** A port call a suite proves unreachable: it fails loudly if ever made. */
export function tripwireError(name: string): Error {
  return new Error(`test: the ports never call ${name} here`)
}

/**
The real engine ports for suites that never reach a model conversation:
`listModels` and `startWorker` are tripwires, so a call the behaviour must
not make fails the suite instead of passing silently.
*/
export function enginePortsWithoutWorker(input: {
  readonly repositoryRoot: () => string | undefined
  readonly storageRoot: string
  readonly isTrusted: () => boolean
}): ReturnType<typeof createEngineTeamPorts> {
  return createEngineTeamPorts({
    repositoryRoot: input.repositoryRoot,
    storageRoot: input.storageRoot,
    platform: process.platform,
    isTrusted: input.isTrusted,
    listModels: () => Promise.reject(tripwireError('listModels')),
    startWorker: () => Promise.reject(tripwireError('startWorker')),
    runGit: realTeamGit,
    now: () => Date.now(),
    log: silentCoreLog(),
  })
}

/**
A scratch repository with one empty commit on `main`, removed when the test
finishes. Its root is the path the file system resolves (macOS's temporary
folder sits behind a link), because the team merge refuses a linked root.
*/
export function scratchTeamRepo(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'base',
    ],
    { cwd: root },
  )
  return root
}

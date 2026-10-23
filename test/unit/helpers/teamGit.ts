// Real git behind the `TeamGit` contract, plus scratch team repositories:
// the binary runs, and its failures come back as the product's own team
// error with real codes. Shared so the team suites cannot drift apart.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished } from 'vitest'
import { TeamGitError, type TeamGit } from '../../../src/core/team/teamGit'

/** The real git binary behind the `TeamGit` contract. */
export const realTeamGit: TeamGit = (args, cwd, input, env) => {
  try {
    const out = execFileSync('git', [...args], {
      cwd,
      encoding: 'buffer',
      // A string input makes Node validate `encoding: 'buffer'` and throw;
      // bytes go to stdin as they are.
      ...(input !== undefined && { input: Buffer.from(input) }),
      ...(env !== undefined && { env }),
    })
    return Promise.resolve(new Uint8Array(out))
  } catch (error) {
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

/** A scratch repository with one empty commit on `main`, removed when the test finishes. */
export function scratchTeamRepo(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix))
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

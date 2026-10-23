// The real git binary behind the `TeamGit` contract, for suites that prove
// team git behavior against real repositories: standard input included
// (`cat-file --batch` reads its names there; a Buffer, since a string with
// a Buffer encoding is refused). Shared so the suites cannot drift apart.
import { execFileSync } from 'node:child_process'
import { TeamGitError, type TeamGit } from '../../../src/core/team/teamGit'

export const realTeamGit: TeamGit = (args, cwd, input) => {
  try {
    const out = execFileSync('git', [...args], {
      cwd,
      encoding: 'buffer',
      ...(input !== undefined && { input: Buffer.from(input, 'utf8') }),
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

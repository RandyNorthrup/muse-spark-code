// Real git for the suites that drive an injected `runGit` port: the binary
// runs, and its failures come back as the product's own exit error with
// real codes. Shared so the suites cannot drift apart.
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { GitExitError } from '../../../src/host/git'

const runFile = promisify(execFile)

/**
A git binary that actually answers on this machine: the PATH git
where it works, the Command Line Tools git where Apple's shim is
broken (its `git` dies spawning a missing xcodebuild). Each
candidate is asked its real version; the first that answers wins.
*/
export async function resolveWorkingGit(): Promise<string> {
  const candidates =
    process.platform === 'darwin'
      ? ['/Library/Developer/CommandLineTools/usr/bin/git', 'git']
      : ['git']
  for (const candidate of candidates) {
    try {
      await runFile(candidate, ['--version'])
      return candidate
    } catch {
      continue
    }
  }
  throw new Error('no working git for the drill')
}

/**
A synchronous git runner bound to this machine's working binary:
`const git = await syncGitRunner()`. Suites that shell git directly
share this instead of repeating the resolution.
*/
export async function syncGitRunner(): Promise<(args: readonly string[], cwd: string) => string> {
  const git = await resolveWorkingGit()
  return (args, cwd) =>
    execFileSync(git, [...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

export const realGit = async (
  args: readonly string[],
  cwd: string,
  timeoutMs?: number,
): Promise<string> => {
  try {
    // The product passes Infinity for unbounded calls; execFile only takes
    // an unsigned integer, so unbounded stays unset.
    const finished = await runFile('git', [...args], {
      cwd,
      ...(timeoutMs !== undefined && Number.isFinite(timeoutMs) && { timeout: timeoutMs }),
    })
    return finished.stdout
  } catch (error: unknown) {
    // execFile rejects with code/stderr fields; the cast names them for the GitExitError mapping.
    const failure = error as { readonly code?: unknown; readonly stderr?: unknown }
    throw new GitExitError(
      typeof failure.code === 'number' ? failure.code : -1,
      typeof failure.stderr === 'string' ? failure.stderr : '',
      [...args].join(' '),
    )
  }
}

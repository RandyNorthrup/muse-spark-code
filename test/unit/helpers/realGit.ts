// Real git for the suites that drive an injected `runGit` port: the binary
// runs, and its failures come back as the product's own exit error with
// real codes. Shared so the suites cannot drift apart.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GitExitError } from '../../../src/host/git'

const runFile = promisify(execFile)

export const realGit = async (
  args: readonly string[],
  cwd: string,
  timeoutMs?: number,
): Promise<string> => {
  try {
    const finished = await runFile('git', [...args], { cwd, timeout: timeoutMs })
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

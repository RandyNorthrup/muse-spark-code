import { execFile, type ExecFileException } from 'node:child_process'
import { promisify } from 'node:util'
import { runnerEnvironment } from '../../../src/core/runners/runnerConfig'
import type { CheckProcess } from '../../../src/host/team/checkSlots'
import { fixtureGitEnvironment } from './fixtureGit'

const execute = promisify(execFile)
export async function runnerTestGit(cwd: string, ...args: string[]): Promise<string> {
  const answer = await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: fixtureGitEnvironment(runnerEnvironment(process.env)),
  })
  return answer.stdout.trim()
}

// The CheckProcess transport for runner and check-slot suites: the real
// process launch, awaited to its exit. A clean exit reports its
// descendants ended (these children spawn none); a failed launch does
// not, which is the refusal shape the runner suites drive.
export const checkProcess: CheckProcess = (request) =>
  new Promise((resolve) => {
    execFile(
      request.file,
      [...request.args],
      { cwd: request.cwd, env: request.env, timeout: request.timeoutMs },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        resolve({
          exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
          output: stdout,
          descendantsEnded: error === null,
          stderr,
        })
      },
    )
  })

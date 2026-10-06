import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CheckProcess } from '../../../src/host/team/checkSlots'
import { GIT_OUTPUT_MAX_BYTES } from '../../../src/shared/constants'
import { runnerEnvironment } from '../../../src/core/runners/runnerConfig'
import { fixtureGitEnvironment } from './fixtureGit'

const execute = promisify(execFile)
// Only finite fixture children use this adapter. Production must inject lane K's launcher.
export const runnerTestProcess: CheckProcess = async (request) => {
  try {
    const answer = await execute(request.file, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      timeout: request.timeoutMs,
      encoding: 'utf8',
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
    })
    request.onOutput?.(answer.stdout)
    return { exitCode: 0, output: answer.stdout, stderr: answer.stderr, descendantsEnded: true }
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'number' &&
      'stdout' in error &&
      typeof error.stdout === 'string'
    )
      return {
        exitCode: error.code,
        output: error.stdout,
        stderr: 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '',
        descendantsEnded: true,
      }
    throw error
  }
}
export async function runnerTestGit(cwd: string, ...args: string[]): Promise<string> {
  const answer = await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: fixtureGitEnvironment(runnerEnvironment(process.env)),
  })
  return answer.stdout.trim()
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runnerEnvironment } from '../../../src/core/runners/runnerConfig'
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

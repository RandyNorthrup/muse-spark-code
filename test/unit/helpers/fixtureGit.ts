import { execFile, execFileSync } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

// Apple's /usr/bin/git launches this same installed Git through xcrun on
// every invocation. Real-repository fixtures need the binary, not that cost.
const nativeGit =
  process.platform === 'darwin'
    ? execFileSync('/usr/bin/xcrun', ['--find', 'git'], {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin' },
      }).trim()
    : undefined

export function fixtureGitEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (nativeGit === undefined) return env
  if (!path.isAbsolute(nativeGit) || path.basename(nativeGit) !== 'git')
    throw new Error('xcrun did not resolve the installed Git binary')
  return { ...env, PATH: `${path.dirname(nativeGit)}${path.delimiter}${env['PATH'] ?? ''}` }
}

const runExecFile = promisify(execFile)

/**
A git that can actually answer on this machine: the PATH git where it
works, the Command Line Tools git where Apple's shim is broken (this
rig: `git init` through /usr/bin/git dies spawning a missing xcodebuild).
Each candidate is asked its real version; the first that answers wins.
*/
export async function resolveWorkingGit(): Promise<string> {
  const candidates =
    process.platform === 'darwin'
      ? ['/Library/Developer/CommandLineTools/usr/bin/git', 'git']
      : ['git']
  for (const candidate of candidates) {
    try {
      await runExecFile(candidate, ['--version'], { env: process.env })
      return candidate
    } catch {
      continue
    }
  }
  throw new Error('no working git on this machine')
}

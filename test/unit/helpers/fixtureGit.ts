import { execFileSync } from 'node:child_process'
import path from 'node:path'

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

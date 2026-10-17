// Fixture repositories for M123's native Git (PLAN.md D104), built with
// the real `git` under a test's own folder. Each remote's configured URL is
// the captured repository's github.com address (M71,
// test/unit/helpers/githubCapture.ts), and `url.<bare>.insteadOf` sends
// the traffic to a local bare repository, so the adapter reads GitHub
// remotes while nothing leaves the machine. Read a remote's URL from the
// configuration (`git config remote.<name>.url`), as M71 does: `git remote
// get-url` applies the rewrite.
//
// - `own`: a clone of the parent, `feature` one commit ahead of its upstream.
// - `fork`: origin is the fork, `upstream` its parent (pull #51's shape).
// - `behind`: `main` one commit behind `origin/main` (the push plan refuses).
// - `detached`: HEAD detached (the push plan refuses).
// - `failingHook`: a pre-commit hook that exits 1.
// - `signer`: commits signed with an SSH key the signer cannot read, so the
//   consent names the signer and the commit fails.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PARENT_URL = 'https://github.com/RandyNorthrup/muse-spark-code.git'
const FORK_URL = 'https://github.com/Piangpi1997/muse-spark-code.git'
const FIXED_DATE = '2026-10-08T12:00:00Z'

export interface FixtureRepositories {
  /** The bare repositories standing in for GitHub. */
  readonly parentBare: string
  readonly forkBare: string
  readonly own: string
  readonly fork: string
  readonly behind: string
  readonly detached: string
  readonly failingHook: string
  readonly signer: string
  /** The environment every `git` here ran with: no user or system configuration. */
  readonly environment: NodeJS.ProcessEnv
}

/** `/` separators, which git accepts on Windows too, so the configured paths compare. */
function slashed(folder: string): string {
  return folder.replaceAll('\\', '/')
}

export function createFixtureRepositories(root: string): FixtureRepositories {
  mkdirSync(root, { recursive: true })
  const globalConfig = path.join(root, 'empty.gitconfig')
  writeFileSync(globalConfig, '')
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: FIXED_DATE,
    GIT_COMMITTER_DATE: FIXED_DATE,
  }
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, env: environment, encoding: 'utf8' }).trim()
  const parentBare = slashed(path.join(root, 'parent.git'))
  const forkBare = slashed(path.join(root, 'fork.git'))
  const routed = (folder: string) => {
    git(folder, 'config', `url.${parentBare}.insteadOf`, PARENT_URL)
    git(folder, 'config', `url.${forkBare}.insteadOf`, FORK_URL)
  }
  const commit = (folder: string, file: string, text: string) => {
    writeFileSync(path.join(folder, file), text)
    git(folder, 'add', file)
    git(folder, 'commit', '-q', '-m', `Add ${file}`)
  }
  const clone = (name: string, url: string): string => {
    const folder = path.join(root, name)
    git(root, 'init', '-q', '-b', 'main', name)
    routed(folder)
    git(folder, 'remote', 'add', 'origin', url)
    git(folder, 'fetch', '-q', 'origin')
    git(folder, 'checkout', '-q', '-b', 'main', '--track', 'origin/main')
    return folder
  }

  git(root, 'init', '-q', '--bare', '-b', 'main', parentBare)
  const seed = path.join(root, 'seed')
  git(root, 'init', '-q', '-b', 'main', 'seed')
  commit(seed, 'README.md', 'fixture\n')
  git(seed, 'push', '-q', parentBare, 'main')
  git(root, 'clone', '-q', '--bare', parentBare, forkBare)

  const own = clone('own', PARENT_URL)
  git(own, 'checkout', '-q', '-b', 'feature')
  commit(own, 'feature.txt', 'feature\n')
  git(own, 'push', '-q', '-u', 'origin', 'feature')
  commit(own, 'ahead.txt', 'ahead\n')

  const fork = clone('fork', FORK_URL)
  git(fork, 'remote', 'add', 'upstream', PARENT_URL)
  git(fork, 'fetch', '-q', 'upstream')

  const behind = clone('behind', PARENT_URL)
  commit(seed, 'later.txt', 'later\n')
  git(seed, 'push', '-q', parentBare, 'main')
  git(behind, 'fetch', '-q', 'origin')

  const detached = clone('detached', PARENT_URL)
  git(detached, 'checkout', '-q', '--detach')

  const failingHook = clone('failing-hook', PARENT_URL)
  writeFileSync(
    path.join(failingHook, '.git', 'hooks', 'pre-commit'),
    '#!/bin/sh\necho "fixture hook refuses" >&2\nexit 1\n',
    { mode: 0o755 },
  )

  const signer = clone('signer', PARENT_URL)
  git(signer, 'config', 'commit.gpgsign', 'true')
  git(signer, 'config', 'gpg.format', 'ssh')
  git(signer, 'config', 'user.signingkey', slashed(path.join(root, 'missing-signing-key.pub')))

  return {
    parentBare,
    forkBare,
    own: slashed(own),
    fork: slashed(fork),
    behind: slashed(behind),
    detached: slashed(detached),
    failingHook: slashed(failingHook),
    signer: slashed(signer),
    environment,
  }
}

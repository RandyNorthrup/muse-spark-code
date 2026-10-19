// Shared inputs for the native-git suite tests: the real git binary in an
// isolated environment, a throwing placeholder for unused ports, and the
// test credential (never validated, never sent anywhere observable). One
// copy lives here so the suites do not repeat it.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { resolveExecutable } from '../../../src/core/executables'
import type { GitHubCredential, GitHubTokenSource } from '../../../src/core/git/tokenSource'
import type { CoreLogger } from '../../../src/core/logging'

const quiet = (): void => undefined
export const silentLogger: CoreLogger = {
  trace: quiet,
  info: quiet,
  warn: quiet,
  error: quiet,
}

/** A port the test never reaches: calling it fails the test. */
export function neverCalled(name: string): () => never {
  return () => {
    throw new Error(`must not be called: ${name}`)
  }
}

export const testCredential: GitHubCredential = {
  source: 'ghLogin',
  bearer: 'untransmitted-test-bearer',
  fetch,
  expiresAt: undefined,
}

export const testCredentialSource: GitHubTokenSource = {
  kind: 'ghLogin',
  credential: () => Promise.resolve(testCredential),
  rejected: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
}

/** The isolated environment git runs in: no system or user configuration. */
export function isolatedGitEnv(scratch: string): NodeJS.ProcessEnv {
  const home = mkdtempSync(path.join(scratch, 'home-'))
  return {
    ...(process.platform === 'win32' && { SystemRoot: process.env['SystemRoot'] }),
    ...(process.env['DEVELOPER_DIR'] !== undefined && {
      DEVELOPER_DIR: process.env['DEVELOPER_DIR'],
    }),
    PATH: process.env['PATH'],
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
}

export interface TestGit {
  readonly git: string
  readonly run: (cwd: string, ...args: string[]) => string
  readonly makeRepository: () => { repo: string; sha: string }
}

/** Real git in an isolated environment: no system or user configuration. */
export function testGit(scratch: string): TestGit {
  const resolved = resolveExecutable('git', {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
  })
  if (resolved === undefined) {
    throw new Error('git is not on PATH')
  }
  const env: NodeJS.ProcessEnv = isolatedGitEnv(scratch)
  const run = (cwd: string, ...args: string[]): string =>
    execFileSync(resolved, args, { cwd, env, stdio: 'pipe' }).toString('utf8').trim()
  const makeRepository = (): { repo: string; sha: string } => {
    const repo = mkdtempSync(path.join(scratch, 'repo-'))
    run(repo, 'init', '-q', '-b', 'main')
    run(
      repo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'Base',
    )
    return { repo, sha: run(repo, 'rev-parse', 'HEAD') }
  }
  return { git: resolved, run, makeRepository }
}

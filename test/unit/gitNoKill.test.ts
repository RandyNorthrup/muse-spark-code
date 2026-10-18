import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createGitProcess, processGitRunner } from '../../src/host/git'

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'No Limits',
  GIT_AUTHOR_EMAIL: 'nolimits@localhost',
  GIT_COMMITTER_NAME: 'No Limits',
  GIT_COMMITTER_EMAIL: 'nolimits@localhost',
} as NodeJS.ProcessEnv

function repoWithSleepingHook(sleepSeconds: number): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'nolimits-git-'))
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: folder, env: GIT_ENV })
  execFileSync('git', ['commit', '--allow-empty', '--no-verify', '-m', 'base'], {
    cwd: folder,
    env: GIT_ENV,
  })
  writeFileSync(path.join(folder, 'tracked.txt'), 'change\n')
  execFileSync('git', ['add', 'tracked.txt'], { cwd: folder, env: GIT_ENV })
  // A real hook git really runs: the commit below waits in it.
  const hook = path.join(folder, '.git', 'hooks', 'pre-commit')
  writeFileSync(hook, `#!/bin/sh\nsleep ${String(sleepSeconds)}\n`)
  chmodSync(hook, 0o755)
  return folder
}

const commit = ['-c', 'commit.gpgsign=false', 'commit', '-m', 'hooked']

describe('git waits without an invented kill (NOLIMITS2 C3)', () => {
  it('a named timeout still kills a slow git past it', async () => {
    const run = processGitRunner({ env: GIT_ENV })
    const folder = repoWithSleepingHook(2)
    await expect(run(commit, folder, 100)).rejects.toThrow('timed out after 100 ms')
  })

  // A genuinely long operation: the commit below waits ~16 s in its hook,
  // past the 15 s kill the old runner default imposed. It runs once
  // against the old code to see it fail (killed at 15 s), then against the
  // fix to see the wait outlast it.
  it('an unnamed wait outlasts the old 15 s kill', { timeout: 30_000 }, async () => {
    const run = processGitRunner({ env: GIT_ENV })
    const folder = repoWithSleepingHook(16)
    await expect(run(commit, folder)).resolves.toContain('hooked')
  })

  it('the process runner names no timeout unless the caller does', async () => {
    const run = createGitProcess({
      platform: process.platform,
      env: process.env,
      fileExists: existsSync,
      spawn,
    })
    const folder = mkdtempSync(path.join(tmpdir(), 'nolimits-git-'))
    const output = await run(['--version'], { cwd: folder, env: GIT_ENV })
    expect(output.toString('utf8')).toMatch(/git version/)
  })
})

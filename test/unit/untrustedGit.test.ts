// The untrusted lane's refusals (src/host/git/untrustedGit.ts): a git that
// cannot run, or one too old for the lane's controls, is refused with the
// fixed sentence and the failure as its cause — never a raw exec failure.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { GitExecFile } from '../../src/host/git'
import { untrustedCheckoutArgs } from '../../src/host/git/untrustedGit'

const runFile = promisify(execFile)

const realExecFile: GitExecFile = async (file, args, options) => {
  const finished = await runFile(file, [...args], options)
  return finished.stdout as string
}

const ancient: GitExecFile = () => Promise.resolve('git version 2.20.1\n')

describe('untrustedCheckoutArgs', () => {
  it('runs the lane over the real git on PATH', async () => {
    const overrides = await untrustedCheckoutArgs()(realExecFile, 'git', {})
    expect(overrides).toContain('--no-replace-objects')
  })

  it('refuses a git that cannot run, carrying the failure', async () => {
    let failure: unknown
    try {
      await untrustedCheckoutArgs()(realExecFile, 'muse-spark-no-such-git', {})
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.openPullRequestFiltersUnavailable)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })

  it('refuses a git too old for the lane controls', async () => {
    let failure: unknown
    try {
      await untrustedCheckoutArgs()(ancient, 'git', {})
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.openPullRequestFiltersUnavailable)
  })

  it('carries a failing config read as the refusal cause', async () => {
    const version = await realExecFile('git', ['--version'], {})
    expect(version).toMatch(/^git version /u)
    const configFails: GitExecFile = async (file, args, options) => {
      if (args[0] === '--version') {
        return version
      }
      return await realExecFile(file, ['config', '--null', '--name-only', '--list'], {
        ...options,
        cwd: '/muse-spark-no-such-dir',
      })
    }
    let failure: unknown
    try {
      await untrustedCheckoutArgs()(configFails, 'git', {})
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(UI_TEXT.openPullRequestFiltersUnavailable)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })
})

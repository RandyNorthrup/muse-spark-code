// A best-of-N setup that git refuses (src/core/bestOfN/bestOfNRunner.ts):
// the run fails as `worktreeFailed` naming git's own words in `detail`
// (the notice renders them), keeping the failure itself as `cause`.
// Driven by the real runner and the real git binary in a directory that
// is not a repository.
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { BestOfNCoordinator } from '../../src/core/bestOfN/bestOfNCoordinator'
import { isBestOfNError } from '../../src/core/bestOfN/bestOfNError'
import type { BestOfNError } from '../../src/core/bestOfN/bestOfNError'
import { BestOfNRunner } from '../../src/core/bestOfN/bestOfNRunner'
import { billingKeyDigest } from '../../src/core/backends/modelapi/billingRoute'
import { defaultBestOfNRequest } from '../../src/shared/bestOfN'
import { fileRoots } from './helpers/tempDirs'

const runGit = promisify(execFile)
const roots = fileRoots()
const quiet = (): void => undefined

describe('best-of-N worktree setup failure', () => {
  it('refuses worktreeFailed with the failure words and its cause', async () => {
    const repositoryRoot = await roots.fresh('muse-bestofn-worktree-')
    const runner = new BestOfNRunner({
      coordinator: new BestOfNCoordinator(),
      newRunId: () => 'bon-m1-1',
      isTrusted: () => true,
      backendKind: () => 'modelApi',
      isBestOfNOn: () => true,
      allowsPaidUse: () => Promise.resolve(true),
      notePaidUse: quiet,
      runGit: async (args, cwd, _input, beforeRun) => {
        beforeRun?.()
        const { stdout } = await runGit('git', [...args], { cwd })
        return stdout
      },
      getAccountId: () => Promise.resolve(billingKeyDigest('test-account')),
      hasDirtyEditors: () => false,
      validatePaths: () => Promise.resolve(),
      validateWorktree: () => Promise.resolve(),
      realPath: (path) => realpath(path),
      repositoryRoot: () => repositoryRoot,
      platform: process.platform,
      startAttempt: () => {
        throw new Error('no attempt may launch once setup failed')
      },
      onUpdate: quiet,
      log: { trace: quiet, info: quiet, warn: quiet, error: quiet },
    })
    let failure: unknown
    try {
      await runner.start({
        ...defaultBestOfNRequest('refactor this'),
        modelId: 'muse-spark-1.3',
        approvalMode: 'default',
        isCurrent: () => true,
      })
    } catch (error: unknown) {
      failure = error
    }
    expect(isBestOfNError(failure)).toBe(true)
    const refusal = failure as BestOfNError
    expect(refusal.refusal).toBe('worktreeFailed')
    expect(typeof refusal.detail === 'string' && refusal.detail !== '').toBe(true)
    expect(refusal.detail).toContain('rev-parse')
    expect(refusal.cause).toBeInstanceOf(Error)
  })
})

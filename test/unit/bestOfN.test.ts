// Best-of-N planning (M77, PLAN.md D49): the run's bounds, its branch and
// worktree names, the paid-use shape, and the git shapes around the take.

import { describe, expect, it } from 'vitest'
import {
  BEST_OF_N_DIFF_MAX_CHARS,
  BEST_OF_N_MAX_ATTEMPTS,
  BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT,
  BEST_OF_N_MIN_ATTEMPTS,
  BEST_OF_N_MIN_REQUESTS_PER_ATTEMPT,
} from '../../src/shared/constants'
import {
  bestOfNBranch,
  bestOfNChangedLines,
  bestOfNDiffArgs,
  bestOfNDiffStatArgs,
  bestOfNPaidRequest,
  bestOfNTakeArgs,
  bestOfNWorktreeFolder,
  clipBestOfNDiff,
  isBestOfNRunId,
  parseBestOfNNumstat,
} from '../../src/core/bestOfN/bestOfN'
import { defaultBestOfNRequest, validateBestOfNRequest } from '../../src/shared/bestOfN'

describe('validateBestOfNRequest', () => {
  it('accepts the defaults', () => {
    expect(validateBestOfNRequest(defaultBestOfNRequest('refactor this'))).toEqual([])
  })

  it('refuses a blank prompt', () => {
    expect(
      validateBestOfNRequest({ prompt: ' '.repeat(3), attempts: 3, requestCeilingPerAttempt: 20 }),
    ).toEqual(['prompt'])
  })

  it('refuses attempt counts outside the bounds, in field order', () => {
    for (const attempts of [BEST_OF_N_MIN_ATTEMPTS - 1, BEST_OF_N_MAX_ATTEMPTS + 1, 2.5, NaN]) {
      expect(
        validateBestOfNRequest({ prompt: 'go', attempts, requestCeilingPerAttempt: 20 }),
      ).toEqual(['attempts'])
    }
  })

  it('refuses ceilings outside the bounds', () => {
    for (const requestCeilingPerAttempt of [
      BEST_OF_N_MIN_REQUESTS_PER_ATTEMPT - 1,
      BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT + 1,
      7.5,
    ]) {
      expect(
        validateBestOfNRequest({ prompt: 'go', attempts: 3, requestCeilingPerAttempt }),
      ).toEqual(['ceiling'])
    }
  })

  it('reports every bad field at once', () => {
    expect(
      validateBestOfNRequest({ prompt: '', attempts: 1, requestCeilingPerAttempt: 500 }),
    ).toEqual(['prompt', 'attempts', 'ceiling'])
  })
})

describe('bestOfNBranch', () => {
  it('names the attempt branch under the run', () => {
    expect(bestOfNBranch('bon-m1-1', 0)).toBe('best-of-n/bon-m1-1/0')
    expect(bestOfNBranch('bon-m1-1', 4)).toBe('best-of-n/bon-m1-1/4')
  })

  it('refuses run ids that are not one branch segment', () => {
    expect(isBestOfNRunId('bon-m1-1')).toBe(true)
    for (const runId of ['', '../escape', 'a/b', 'has space', '-leading']) {
      expect(isBestOfNRunId(runId)).toBe(false)
      expect(() => bestOfNBranch(runId, 0)).toThrow()
    }
    expect(() => bestOfNBranch('bon-m1-1', -1)).toThrow()
  })

  it('roots the worktree beside the repository like every worktree', () => {
    expect(bestOfNWorktreeFolder('/repo/app', 'bon-m1-1', 2, 'linux')).toBe(
      '/repo/app.worktrees/best-of-n-bon-m1-1-2',
    )
  })
})

describe('bestOfNPaidRequest', () => {
  it('asks once with the prompt, the rates, N and the ceiling', () => {
    expect(bestOfNPaidRequest('muse-spark-1.3', 'refactor this', 3, 20)).toEqual({
      feature: 'bestOfN',
      modelId: 'muse-spark-1.3',
      prompt: 'refactor this',
      attempts: 3,
      requestCeilingPerAttempt: 20,
    })
  })
})

describe('best-of-N git shapes', () => {
  it('compares the frozen tree directly against the captured base', () => {
    expect(bestOfNDiffStatArgs('HEAD', 'best-of-n/bon-1/0')).toEqual([
      'diff',
      '--numstat',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      'HEAD',
      'best-of-n/bon-1/0',
      '--',
    ])
    expect(bestOfNDiffArgs('HEAD', 'best-of-n/bon-1/0')).toEqual([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      'HEAD',
      'best-of-n/bon-1/0',
      '--',
    ])
  })

  it('applies and stages the selected binary patch from stdin', () => {
    expect(bestOfNTakeArgs()).toEqual(['apply', '--index', '--binary', '-'])
  })

  it('parses the numstat, counting binary files as changed without lines', () => {
    expect(parseBestOfNNumstat('3\t1\tsrc/a.ts\n-\t-\tlogo.png\n')).toEqual([
      { path: 'src/a.ts', insertions: 3, deletions: 1 },
      { path: 'logo.png', insertions: 0, deletions: 0 },
    ])
    expect(parseBestOfNNumstat('')).toEqual([])
    expect(bestOfNChangedLines(parseBestOfNNumstat('3\t1\tsrc/a.ts\n2\t0\tsrc/b.ts\n'))).toBe(6)
  })

  it('refuses a stat line that is not added, deleted and path', () => {
    expect(() => parseBestOfNNumstat('no-tabs-here\n')).toThrow()
    expect(() => parseBestOfNNumstat('x\t1\tsrc/a.ts\n')).toThrow()
  })

  it('clips the comparison text at the cap, marked', () => {
    expect(clipBestOfNDiff('short')).toEqual({ text: 'short', isClipped: false })
    const long = 'x'.repeat(BEST_OF_N_DIFF_MAX_CHARS + 1)
    const clipped = clipBestOfNDiff(long)
    expect(clipped.isClipped).toBe(true)
    expect(clipped.text).toHaveLength(BEST_OF_N_DIFF_MAX_CHARS)
  })
})

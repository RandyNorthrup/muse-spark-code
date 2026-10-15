// The rule-2 gate's pure pieces (scripts/lib/rule2Gate.mjs) decide from
// values passed in as data. A malformed wire answer must fail closed: the
// gate refuses instead of checking fewer runs, and the release door needs
// hosted evidence on every expected commit, not just on one of them.
import { describe, expect, it } from 'vitest'
import {
  assertReleaseAttempt,
  missingEvidence,
  pullOf,
  runOf,
} from '../../scripts/lib/rule2Gate.mjs'

const run = {
  id: 38_597_656_750,
  name: 'CI',
  path: '.github/workflows/ci.yml',
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  head_sha: 'fb8d0ff84672653dc9093d30118d4582a3004847',
}

const mergedPull = {
  number: 158,
  merged_at: '2026-10-14T16:00:00Z',
  merge_commit_sha: '46d971f85',
  head: { sha: 'fb8d0ff84' },
}

describe('rule2 release verification attempt', () => {
  it('admits the first execution, including a fresh recovery run', () => {
    expect(() => assertReleaseAttempt('1')).not.toThrow()
  })

  it.each(['2', '3', '', undefined, 'invalid'])(
    'refuses re-executed or unreadable verification: %s',
    (attempt) => {
      expect(() => assertReleaseAttempt(attempt)).toThrow(/nothing is started again/)
    },
  )
})

describe('rule2 gate wire parsing', () => {
  it('reads the run fields the gate decides on', () => {
    expect(runOf(run)).toEqual({
      id: 38_597_656_750,
      name: 'CI',
      path: '.github/workflows/ci.yml',
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success',
      attempt: 1,
      headSha: 'fb8d0ff84672653dc9093d30118d4582a3004847',
    })
  })

  it('reads a run whose conclusion is not set yet', () => {
    const inProgress = { ...run, status: 'in_progress', conclusion: undefined }
    expect(runOf(inProgress).conclusion).toBe('')
  })

  it.each([[null], [[]], [{ ...run, id: '38597656750' }], [{ ...run, head_sha: 42 }]])(
    'refuses a run it cannot read: %j',
    (value) => {
      expect(() => runOf(value)).toThrow(/lacks a field/)
    },
  )

  it('reads a merged pull request with its head', () => {
    expect(pullOf(mergedPull)).toEqual({
      number: 158,
      mergedAt: '2026-10-14T16:00:00Z',
      mergeSha: '46d971f85',
      headSha: 'fb8d0ff84',
    })
  })

  it('reads an unmerged pull request without dropping it silently', () => {
    const pull = pullOf({ ...mergedPull, merged_at: null, merge_commit_sha: null })
    expect(pull.mergedAt).toBeNull()
  })

  it.each([
    [null],
    [{ ...mergedPull, number: '158' }],
    [{ ...mergedPull, merged_at: 42 }],
    [{ ...mergedPull, head: null }],
    [{ ...mergedPull, head: { sha: 42 } }],
  ])('refuses a pull request it cannot read: %j', (value) => {
    expect(() => pullOf(value)).toThrow(/lacks a field/)
  })
})

describe('rule2 release evidence per commit', () => {
  const tag = '46d971f85'
  const heads = [{ number: 158, sha: 'fb8d0ff84' }]
  const onTag = { headSha: tag }
  const onHead = { headSha: 'fb8d0ff84' }

  it('asks nothing more when every expected commit has a run', () => {
    expect(missingEvidence(tag, heads, [onTag, onHead])).toEqual([])
  })

  it('names the pull request head that has no run', () => {
    const missing = missingEvidence(tag, heads, [onTag])
    expect(missing).toHaveLength(1)
    expect(missing[0]).toContain('pull request 158')
    expect(missing[0]).toContain('fb8d0ff84')
  })

  it('names the tagged commit when only the head has runs', () => {
    const missing = missingEvidence(tag, heads, [onHead])
    expect(missing).toHaveLength(1)
    expect(missing[0]).toContain(`commit ${tag}`)
  })

  it('counts a head that equals the tag once', () => {
    expect(missingEvidence(tag, [{ number: 158, sha: tag }], [onTag])).toEqual([])
    expect(missingEvidence(tag, [{ number: 158, sha: tag }], [])).toHaveLength(1)
  })

  it('refuses every expected commit when no run exists at all', () => {
    expect(missingEvidence(tag, heads, [])).toHaveLength(2)
  })
})

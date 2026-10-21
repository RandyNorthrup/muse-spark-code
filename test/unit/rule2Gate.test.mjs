// The rule-2 gate's pure pieces (scripts/lib/rule2Gate.mjs) decide from
// values passed in as data. A malformed wire answer must fail closed: the
// gate refuses instead of checking fewer runs, and the release door needs
// hosted evidence on every expected commit, not just on one of them.
import { describe, expect, it } from 'vitest'
import {
  assertReleaseAttempt,
  duplicateExecutions,
  isSuccessfulRun,
  missingEvidence,
  pullOf,
  releaseRecheck,
  runOf,
  workflowPath,
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

describe('rule2 workflow path identity', () => {
  it('matches REST ref-suffixed release paths to the hosted workflow reference', () => {
    const repository = 'RandyNorthrup/muse-spark-code'
    const hosted = workflowPath(
      `${repository}/.github/workflows/release.yml@refs/tags/v0.18.2`,
      repository,
    )
    const earlier = runOf({ ...run, path: '.github/workflows/release.yml@main' })
    expect(earlier.path).toBe('.github/workflows/release.yml')
    expect(earlier.path).toBe(hosted)
    const ci = runOf(run)
    expect([earlier, ci].filter((entry) => entry.path !== hosted)).toEqual([ci])
  })

  it('keeps plain paths and detects a duplicate across ref suffixes', () => {
    const plain = runOf(run)
    const suffixed = runOf({ ...run, id: run.id + 1, path: `${run.path}@main` })
    expect(workflowPath(run.path)).toBe(run.path)
    expect(duplicateExecutions([plain, suffixed])).toEqual([
      expect.stringContaining('distinct runs'),
    ])
  })
})

describe('rule2 distinct executions on a head', () => {
  const first = runOf(run)
  const second = { ...first, id: first.id + 1 }

  it.each(['queued', 'in_progress', 'completed'])(
    'refuses a second run id even on its first attempt, status %s',
    (status) => {
      expect(duplicateExecutions([first, { ...second, status }])).toEqual([
        expect.stringContaining(`distinct runs ${first.id} and ${second.id}`),
      ])
    },
  )

  it('allows different workflows and different heads, not repeated execution', () => {
    expect(
      duplicateExecutions([
        first,
        { ...second, path: '.github/workflows/hosts.yml' },
        { ...second, headSha: 'another-commit' },
      ]),
    ).toEqual([])
  })

  it('does not count the same run id twice when merging API pages or own identity', () => {
    expect(duplicateExecutions([first, first])).toEqual([])
  })

  it('refuses duplicate runs that arrive in the final release snapshot', () => {
    expect(releaseRecheck(first.headSha, [], [first, second])).toEqual([
      expect.stringContaining('distinct runs'),
    ])
  })
})

describe('rule2 final release recheck', () => {
  const tag = '46d971f85'
  const head = 'fb8d0ff84'
  const heads = [{ number: 158, sha: head }]
  const successful = runOf(run)
  const onTag = { ...successful, headSha: tag }
  const onHead = { ...successful, id: successful.id + 1, headSha: head }

  it('accepts a complete final snapshot of both commits', () => {
    expect(releaseRecheck(tag, heads, [onTag, onHead])).toEqual([])
  })

  it('refuses a late pending run on either commit without waiting again', () => {
    for (const headSha of [tag, head]) {
      const late = {
        ...successful,
        path: '.github/workflows/hosts.yml',
        headSha,
        status: 'queued',
        conclusion: '',
      }
      expect(releaseRecheck(tag, heads, [onTag, onHead, late])).toEqual([
        expect.stringContaining('still queued at the final release recheck'),
      ])
    }
  })

  it('refuses evidence deleted between settling and the final snapshot', () => {
    expect(releaseRecheck(tag, heads, [onTag])).toEqual([
      expect.stringContaining(`pull request 158 head ${head}`),
    ])
  })
})

describe('rule2 release evidence per commit', () => {
  const tag = '46d971f85'
  const heads = [{ number: 158, sha: 'fb8d0ff84' }]
  const onTag = { ...runOf(run), headSha: tag }
  const onHead = { ...runOf(run), headSha: 'fb8d0ff84' }

  it.each(['skipped', 'neutral', 'failure', 'cancelled', 'action_required', ''])(
    'never treats %s as green or hosted evidence',
    (conclusion) => {
      const noResult = { ...onTag, conclusion }
      expect(isSuccessfulRun(noResult)).toBe(false)
      expect(missingEvidence(tag, heads, [noResult, onHead])).toEqual([
        expect.stringContaining(`commit ${tag} has no successful workflow run`),
      ])
    },
  )

  it('requires completed success, not an in-progress success value', () => {
    expect(isSuccessfulRun({ ...onTag, status: 'in_progress' })).toBe(false)
    expect(isSuccessfulRun(onTag)).toBe(true)
  })

  it('asks nothing more when every expected commit has a successful run', () => {
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

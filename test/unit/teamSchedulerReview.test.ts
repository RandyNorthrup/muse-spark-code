import { describe, expect, it, vi } from 'vitest'
import {
  checkClaims,
  ReviewFlow,
  type ReviewDependencies,
  type ReviewRequest,
} from '../../src/core/team/scheduler/reviewFlow'
import { attempt, readyTask } from './helpers/teamScheduler'

function reviewFixture(
  flow: 'full' | 'reviewAutomatically' | 'manual' = 'full',
  lanes = 3,
  requiresDifferentModel = false,
) {
  let head = 'head-one'
  const seen: ReviewRequest[] = []
  const task = readyTask('task', {
    state: 'review',
    currentAttempt: 1,
    attempts: [
      {
        ...attempt(),
        state: 'retired',
        endedAt: 2,
        retirement: { kind: 'proved', method: 'linuxCgroup' },
      },
    ],
  })
  let findingsJson = JSON.stringify({ findings: [] })
  const deps: ReviewDependencies = {
    head: () => head,
    authors: () => ['author'],
    reviewers: () => [{ id: 'reviewer', modelId: 'reviewer-model', freeLanes: lanes }],
    sameModel: (left, right) => left === right,
    claims: () => [{ command: 'npm test', passed: true }],
    executed: () => [],
    isCurrent: () => true,
    admit: vi.fn(() => ({
      run: (request: ReviewRequest) => {
        seen.push(request)
        return Promise.resolve({
          head: request.head,
          groups: request.classes.map((reviewClass) => ({ reviewClass, findingsJson })),
        })
      },
      release: vi.fn(),
    })),
    rework: vi.fn(() => Promise.resolve(true)),
    enqueue: vi.fn(() => Promise.resolve()),
    record: vi.fn(() => Promise.resolve()),
    redesign: vi.fn(),
  }
  const review = new ReviewFlow(deps, { flow, loopBackSeverity: 'high', requiresDifferentModel })
  return {
    task,
    deps,
    review,
    seen,
    setHead: (next: string) => {
      head = next
    },
    setFindings: (next: unknown[]) => {
      findingsJson = JSON.stringify({ findings: next })
    },
  }
}

describe('whole-head integration reviews', () => {
  it('retries refused rework or failed enqueue without charging for another review', async () => {
    const rework = reviewFixture()
    rework.setFindings([{ file: 'a.ts', line: 1, severity: 'high', title: 'fix' }])
    rework.deps.rework = vi.fn(() => Promise.resolve(false))
    expect(await rework.review.afterRetirement(rework.task, true)).toBe('waiting')
    vi.mocked(rework.deps.rework).mockResolvedValue(true)
    expect(await rework.review.afterRetirement(rework.task, true)).toBe('rework')
    expect(await rework.review.afterRetirement(rework.task, true)).toBe('waiting')
    expect(rework.deps.rework).toHaveBeenCalledTimes(2)
    expect(rework.deps.admit).toHaveBeenCalledOnce()
    const enqueue = reviewFixture()
    enqueue.deps.enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('queue busy'))
      .mockResolvedValue(undefined)
    await expect(enqueue.review.afterRetirement(enqueue.task, true)).rejects.toThrow('queue busy')
    expect(await enqueue.review.afterRetirement(enqueue.task, true)).toBe('reviewed')
    expect(await enqueue.review.afterRetirement(enqueue.task, true)).toBe('reviewed')
    expect(enqueue.deps.enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue.deps.admit).toHaveBeenCalledOnce()
  })

  it('counts a retired rework that leaves the same head as another bounded review round', async () => {
    const f = reviewFixture()
    f.setFindings([{ file: 'a.ts', line: 1, severity: 'high', title: 'recurring' }])
    expect(await f.review.afterRetirement(f.task, true)).toBe('rework')
    for (const number of [2, 3]) {
      f.task.currentAttempt = number
      f.task.attempts.push({
        ...attempt(number),
        state: 'retired',
        endedAt: number + 1,
        retirement: { kind: 'proved', method: 'linuxCgroup' },
      })
      expect(await f.review.afterRetirement(f.task, true)).toBe(
        number === 3 ? 'redesign' : 'rework',
      )
    }
    expect(f.deps.admit).toHaveBeenCalledTimes(3)
    expect(f.deps.rework).toHaveBeenCalledTimes(2)
    expect(f.deps.redesign).toHaveBeenCalledOnce()
  })
  it('loops back actual failed checks even when the findings are clean', async () => {
    const f = reviewFixture()
    f.deps.executed = () => [{ command: 'npm test', exitCode: 1 }]
    expect(await f.review.afterRetirement(f.task, true)).toBe('rework')
    expect(f.deps.rework).toHaveBeenCalledWith('task', [], [{ command: 'npm test', exitCode: 1 }])
    expect(f.review.reviewed('task')).toBe(false)
    expect(f.deps.enqueue).not.toHaveBeenCalled()
  })

  it('holds class reservations until all reviews settle and refuses duplicate concurrent review', async () => {
    const f = reviewFixture()
    const gate = Promise.withResolvers<unknown>()
    const release = vi.fn()
    f.deps.admit = () => ({
      run: (request) =>
        request.classes.includes('concurrency')
          ? Promise.reject(new Error('failed review'))
          : gate.promise,
      release,
    })
    const pending = f.review.afterRetirement(f.task, true)
    const assertion = expect(pending).rejects.toThrow('failed review')
    expect(await f.review.afterRetirement(f.task, true)).toBe('waiting')
    expect(release).not.toHaveBeenCalled()
    gate.resolve({
      head: 'head-one',
      groups: [{ reviewClass: 'boundaries', findingsJson: '{"findings":[]}' }],
    })
    await assertion
    expect(release).toHaveBeenCalledOnce()
    expect(f.deps.enqueue).not.toHaveBeenCalled()
  })
  it('automatically reviews three classes on reserved lanes and merges deduplicated findings', async () => {
    const f = reviewFixture()
    f.setFindings([
      { file: 'a.ts', line: 1, severity: 'low', title: 'one' },
      { file: 'a.ts', line: 1, severity: 'high', title: 'duplicate, more severe' },
    ])
    expect(await f.review.afterRetirement(f.task, true)).toBe('rework')
    expect(f.seen.map((request) => request.classes)).toEqual([
      ['concurrency'],
      ['boundaries'],
      ['failurePaths'],
    ])
    for (const request of f.seen) expect(request.otherClasses).toHaveLength(2)
    expect(f.deps.record).toHaveBeenCalledWith(
      'task',
      'head-one',
      1,
      expect.arrayContaining([
        expect.objectContaining({ finding: expect.objectContaining({ severity: 'high' }) }),
      ]),
      false,
    )
    const records = vi.mocked(f.deps.record).mock.calls[0]!
    expect(records[3]).toHaveLength(3)
    expect(f.deps.rework).toHaveBeenCalledOnce()
    expect(f.deps.enqueue).not.toHaveBeenCalled()
  })

  it('uses one review for all classes with fewer than three lanes and clean changes enter the queue', async () => {
    const f = reviewFixture('full', 2)
    expect(await f.review.afterRetirement(f.task, true)).toBe('reviewed')
    expect(f.seen).toHaveLength(1)
    expect(f.seen[0]?.classes).toEqual(['concurrency', 'boundaries', 'failurePaths'])
    expect(f.deps.enqueue).toHaveBeenCalledWith('task', 'head-one', true)
    expect(f.review.reviewed('task')).toBe(true)
  })

  it('preserves Manual and Review automatically flow boundaries', async () => {
    const manual = reviewFixture('manual')
    expect(await manual.review.afterRetirement(manual.task, true)).toBe('manual')
    expect(manual.deps.admit).not.toHaveBeenCalled()
    expect(await manual.review.afterRetirement(manual.task, true, true)).toBe('reviewed')
    expect(manual.deps.enqueue).not.toHaveBeenCalled()
    const automatic = reviewFixture('reviewAutomatically')
    expect(await automatic.review.afterRetirement(automatic.task, true)).toBe('reviewed')
    expect(automatic.deps.enqueue).not.toHaveBeenCalled()
    const readOnly = reviewFixture()
    expect(await readOnly.review.afterRetirement(readOnly.task, false)).toBe('manual')
  })

  it('re-reviews the whole branch for any new head, including whitespace inside a literal', async () => {
    const f = reviewFixture()
    await f.review.afterRetirement(f.task, true)
    await f.review.afterRetirement(f.task, true)
    expect(f.deps.admit).toHaveBeenCalledTimes(1)
    // The caller's actual Git head changes even if git patch-id --stable is equal.
    f.setHead('head-with-string-whitespace')
    expect(f.review.reviewed('task')).toBe(false)
    expect(await f.review.afterRetirement(f.task, true)).toBe('reviewed')
    expect(f.deps.admit).toHaveBeenCalledTimes(2)
    expect(f.seen.slice(3).every((request) => request.head === 'head-with-string-whitespace')).toBe(
      true,
    )
  })

  it('stops the third failing round as redesign, hands every finding to rework, and never starts a fourth', async () => {
    const f = reviewFixture()
    f.setFindings([
      { file: 'a.ts', line: 1, severity: 'high', title: 'recurring' },
      { file: 'b.ts', line: 2, severity: 'low', title: 'also handed back' },
    ])
    for (const round of [1, 2, 3]) {
      f.setHead(`round-${String(round)}`)
      expect(await f.review.afterRetirement(f.task, true)).toBe(round === 3 ? 'redesign' : 'rework')
    }
    expect(f.deps.rework).toHaveBeenCalledTimes(2)
    expect(vi.mocked(f.deps.rework).mock.calls[0]?.[1]).toHaveLength(6)
    expect(await f.review.afterRetirement(f.task, true)).toBe('redesign')
    f.setHead('round-four')
    expect(await f.review.afterRetirement(f.task, true)).toBe('redesign')
    expect(f.deps.admit).toHaveBeenCalledTimes(3)
    expect(f.deps.enqueue).not.toHaveBeenCalled()
  })

  it('selects a different model across every author or marks/refuses a same-model review', async () => {
    const f = reviewFixture()
    f.deps.authors = () => ['author', 'continued-author']
    f.deps.reviewers = () => [
      { id: 'same', modelId: 'continued-author', freeLanes: 3 },
      { id: 'different', modelId: 'independent', freeLanes: 3 },
    ]
    await f.review.afterRetirement(f.task, true)
    expect(f.seen.every((request) => request.entry.id === 'different')).toBe(true)
    const same = reviewFixture()
    same.deps.reviewers = () => [{ id: 'same', modelId: 'author', freeLanes: 3 }]
    await same.review.afterRetirement(same.task, true)
    expect(same.seen[0]?.isSameModel).toBe(true)
    const refused = reviewFixture('full', 3, true)
    refused.deps.reviewers = same.deps.reviewers
    expect(await refused.review.afterRetirement(refused.task, true)).toBe('refused')
    expect(refused.deps.admit).not.toHaveBeenCalled()
    const absent = reviewFixture()
    absent.deps.reviewers = () => []
    expect(await absent.review.afterRetirement(absent.task, true)).toBe('notReviewed')
    expect(absent.deps.enqueue).toHaveBeenCalledWith('task', 'head-one', false)
  })

  it('marks nonexistent claimed checks unverified and contradicts false claims with actual outcomes', async () => {
    const f = reviewFixture()
    await f.review.afterRetirement(f.task, true)
    expect(f.seen[0]?.claims).toEqual([
      { claim: { command: 'npm test', passed: true }, verification: 'unverified' },
    ])
    expect(
      checkClaims(
        [
          { command: 'npm test', passed: true },
          { command: 'npm run build', passed: true },
          { command: 'running', passed: true },
        ],
        [
          { command: ' npm test ', exitCode: 0 },
          { command: 'npm run build', exitCode: 1 },
          { command: 'running', exitCode: null },
        ],
      ).map((claim) => claim.verification),
    ).toEqual(['verified', 'contradicted', 'unverified'])
  })

  it('rejects invalid reports and stale heads, and never bypasses review admission', async () => {
    const invalid = reviewFixture()
    invalid.deps.admit = () => ({
      run: () => Promise.resolve({ head: 'head-one', groups: [] }),
      release: vi.fn(),
    })
    await expect(invalid.review.afterRetirement(invalid.task, true)).rejects.toThrow(
      'reviewHeadOrClasses',
    )
    expect(invalid.deps.enqueue).not.toHaveBeenCalled()
    const stale = reviewFixture()
    stale.deps.record = () => {
      stale.setHead('changed')
      return Promise.resolve()
    }
    expect(await stale.review.afterRetirement(stale.task, true)).toBe('stale')
    expect(stale.deps.enqueue).not.toHaveBeenCalled()
    const refused = reviewFixture()
    refused.deps.admit = () => undefined
    expect(await refused.review.afterRetirement(refused.task, true)).toBe('waiting')
    expect(refused.deps.enqueue).not.toHaveBeenCalled()
    const active = reviewFixture()
    active.task.attempts = [attempt()]
    expect(await active.review.afterRetirement(active.task, true)).toBe('refused')
  })
})

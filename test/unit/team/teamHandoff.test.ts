import { describe, expect, it } from 'vitest'
import {
  captureWork,
  chainMove,
  chainRecall,
  isSafePoint,
  resumeBrief,
} from '../../../src/core/team/handoff'
import { teamHandoffRecordSchema } from '../../../src/shared/teamHandoff'

describe('M120 lane H handoff', () => {
  it('rests only at safe points, never mid-write', () => {
    expect(isSafePoint('ready')).toBe(true)
    expect(isSafePoint('blocked')).toBe(true)
    expect(isSafePoint('done')).toBe(true)
    expect(isSafePoint('retired')).toBe(true)
    expect(isSafePoint('running')).toBe(false)
    expect(isSafePoint('uncertain')).toBe(false)
  })

  it('captures work by reference, never bytes', () => {
    const captured = captureWork({
      taskId: 'coding',
      roleId: 'engineering',
      attemptNumber: 1,
      endedAtMs: 90_000,
      commits: ['abc123'],
      diffRef: 'diff:9',
      newFiles: ['src/new.ts'],
      noteRef: 'note:3',
      ending: 'safePoint',
    })
    expect(captured).toEqual({
      commits: ['abc123'],
      diffRef: 'diff:9',
      newFiles: ['src/new.ts'],
      noteRef: 'note:3',
    })
  })

  it('links a user move into the chain oldest first', () => {
    const work = captureWork({
      taskId: 'coding',
      roleId: 'engineering',
      attemptNumber: 1,
      endedAtMs: 60_000,
      commits: [],
      newFiles: [],
      ending: 'safePoint',
    })
    const record = chainMove(
      undefined,
      'coding',
      'review',
      60_000,
      'user',
      'coder',
      'reviewer',
      work,
    )
    expect(record.chain).toHaveLength(1)
    expect(record.chain[0]).toMatchObject({
      kind: 'move',
      trigger: 'user',
      fromCandidateId: 'coder',
      toCandidateId: 'reviewer',
    })
    expect(() =>
      chainMove(record, 'coding', 'review', 59_999, 'user', 'reviewer', 'coder', work),
    ).toThrow('team:chainOrder')
  })

  it('links a recall with its ending and resumes from it', () => {
    const work = captureWork({
      taskId: 'coding',
      roleId: 'engineering',
      attemptNumber: 1,
      endedAtMs: 120_000,
      commits: ['abc123'],
      newFiles: ['src/new.ts'],
      ending: 'safePoint',
    })
    const record = chainRecall(
      undefined,
      'coding',
      'engineering',
      120_000,
      'reviewer',
      'review',
      'safePoint',
      work,
    )
    const brief = resumeBrief(record, 'coder')
    expect(brief).toContain('coding')
    expect(brief).toContain('coder')
    expect(brief).toContain('safePoint')
  })

  it('briefs a borrow handoff', () => {
    const borrowed = teamHandoffRecordSchema.parse({
      taskId: 'coding',
      roleId: 'engineering',
      chain: [
        {
          kind: 'borrow',
          atMs: 1,
          candidateId: 'reviewer',
          mainRole: 'review',
          borrowingRole: 'engineering',
          loanAttempt: 1,
        },
      ],
    })
    const brief = resumeBrief(borrowed, 'reviewer')
    expect(brief).toContain('reviewer')
    expect(brief).toContain('engineering')
  })

  it('briefs an empty chain, a borrow and a move', () => {
    const empty = chainRecall(
      undefined,
      'coding',
      'engineering',
      0,
      'reviewer',
      'review',
      'finished',
    )
    expect(resumeBrief(empty, 'coder')).toContain('coder')
    const work = captureWork({
      taskId: 'coding',
      roleId: 'engineering',
      attemptNumber: 1,
      endedAtMs: 1,
      commits: [],
      newFiles: [],
      ending: 'finished',
    })
    const moved = chainMove(empty, 'coding', 'review', 1, 'cap', 'coder', 'reviewer', work)
    expect(resumeBrief(moved, 'reviewer')).toContain('cap')
  })
})

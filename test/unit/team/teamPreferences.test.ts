import { describe, expect, it } from 'vitest'
import {
  blankPreferenceList,
  moveTaskToRole,
  reorderCandidates,
  setAutoOrder,
  setBorrowTimers,
  setSecondaryRoles,
} from '../../../src/core/team/preferences'
import { boardAttempt, makeBoard, submission } from '../helpers/teamFixtures'
import { teamPreferenceListSchema } from '../../../src/shared/teamPreference'

function staffedList(role: string, ids: string[]) {
  return teamPreferenceListSchema.parse({
    role,
    pool: ids.map((id) => ({
      id,
      concurrent: 1,
      caps: [],
      agent: { kind: 'engine', agentId: id, model: `engine-${id}`, pays: 'local' },
      conditions: { platforms: ['windows'], features: ['tools.write'] },
    })),
  })
}

describe('M120 lane P preferences', () => {
  it('starts a blank list and validates every writer', () => {
    expect(blankPreferenceList('frontend')).toMatchObject({ role: 'frontend', pool: [] })
    const list = staffedList('engineering', ['a', 'b'])
    expect(reorderCandidates(list, ['b', 'a']).pool.map((item) => item.id)).toEqual(['b', 'a'])
    expect(() => reorderCandidates(list, ['a'])).toThrow('team:preferenceOrder')
    expect(() => reorderCandidates(list, ['a', 'a'])).toThrow('team:preferenceOrder')
    expect(setAutoOrder(list, true).autoOrder).toBe(true)
    expect(
      setBorrowTimers(list, {
        demandWaitMs: 60_000,
        lookaheadMs: 300_000,
        finishGraceMs: 60_000,
        recallWaitMs: 30_000,
        cooldownMs: 300_000,
      }).borrow?.demandWaitMs,
    ).toBe(60_000)
    expect(() =>
      setBorrowTimers(list, {
        demandWaitMs: 1000,
        lookaheadMs: 300_000,
        finishGraceMs: 60_000,
        recallWaitMs: 30_000,
        cooldownMs: 300_000,
      }),
    ).toThrow()
    expect(setSecondaryRoles([], 'reviewer', 'review', ['engineering'])).toEqual([
      { candidateId: 'reviewer', mainRole: 'review', secondaryRoles: ['engineering'] },
    ])
    expect(() => setSecondaryRoles([], 'reviewer', 'review', ['review'])).toThrow()
  })

  it('moves a waiting task to another role and links the chain', () => {
    const { board } = makeBoard()
    board.submit([submission('coding')], 0)
    const record = moveTaskToRole(
      board,
      [staffedList('engineering', ['coder']), staffedList('review', ['reviewer'])],
      undefined,
      'coding',
      'review',
      60_000,
    )
    expect(board.task('coding').roleId).toBe('review')
    expect(board.task('coding').state).toBe('ready')
    expect(record.chain).toHaveLength(1)
    expect(record.chain[0]).toMatchObject({
      kind: 'move',
      trigger: 'user',
      toCandidateId: 'reviewer',
    })
  })

  it('refuses a running task and an empty target role', () => {
    const { board } = makeBoard()
    board.submit([submission('coding')], 0)
    board.begin('coding', boardAttempt(1, 'engine'))
    expect(() =>
      moveTaskToRole(
        board,
        [staffedList('engineering', ['coder']), staffedList('review', ['reviewer'])],
        undefined,
        'coding',
        'review',
        0,
      ),
    ).toThrow('team:taskRunning')
    const { board: waiting } = makeBoard()
    waiting.submit([submission('coding')], 0)
    expect(() =>
      moveTaskToRole(
        waiting,
        [staffedList('engineering', ['coder'])],
        undefined,
        'coding',
        'review',
        0,
      ),
    ).toThrow('team:roleNotStaffed')
    expect(() =>
      moveTaskToRole(
        waiting,
        [staffedList('engineering', ['coder']), staffedList('review', [])],
        undefined,
        'coding',
        'review',
        0,
      ),
    ).toThrow('team:roleNotStaffed')
  })
})

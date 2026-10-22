import { describe, expect, it } from 'vitest'
import { selectTeamEntry } from '../../../src/core/team/selection'
import { dispatchRecord } from '../../../src/core/team/liveWiring'
import { captureWork, chainMove, resumeBrief } from '../../../src/core/team/handoff'
import {
  boardAttempt,
  keyAgent,
  makeBoard,
  poolEntry,
  rolePool,
  selectionSnapshot,
  submission,
} from '../helpers/teamFixtures'

// Proof (M120): a candidate dies mid-edit. The stop captures the partial
// work by reference, the chain links the move, and the next entry with
// headroom resumes from the record. No work is lost: every reference the
// dead candidate left is still named by the chain and the resume brief.

function engineer(id: string) {
  return keyAgent({ key: id, modelId: `engine-${id}` })
}

describe('M120 mid-edit kill drill', () => {
  it('loses no work: capture, chain, reselect and resume name the same references', () => {
    const { board } = makeBoard()
    board.submit([submission('coding')], 0)
    board.begin('coding', { ...boardAttempt(1, 'engine'), entryId: 'coder' })

    // The candidate dies mid-edit with partial work on disk.
    board.finishAttempt('coding', 1, { state: 'uncertain' })
    const captured = captureWork({
      taskId: 'coding',
      roleId: 'engineering',
      attemptNumber: 1,
      endedAtMs: 60_000,
      commits: ['abc123'],
      diffRef: 'diff:9',
      newFiles: ['src/half.ts'],
      noteRef: 'note:3',
      ending: 'safePoint',
    })

    // The pool reselects without the dead candidate; fallback has headroom.
    const coder = engineer('coder')
    const fallback = engineer('fallback')
    const pool = rolePool('engineering', [
      poolEntry('coder', coder, [], 1),
      poolEntry('fallback', fallback, [], 1),
    ])
    const snapshot = selectionSnapshot({ nowMs: 60_000 })
    snapshot.marks.markRateLimited('coder', 3_600_000)
    const selection = selectTeamEntry(pool, snapshot, 8)
    expect(selection.kind).toBe('selected')
    if (selection.kind !== 'selected') throw new Error('test:selection')
    expect(selection.entry.id).toBe('fallback')

    // The move links the captured work; the brief resumes from it.
    const record = chainMove(
      board.task('coding').handoff,
      'coding',
      'engineering',
      60_000,
      'stall',
      'coder',
      selection.entry.id,
      captured,
    )
    const brief = resumeBrief(record, selection.entry.id)
    for (const ref of ['abc123', 'diff:9', 'src/half.ts', 'fallback', 'coding']) {
      expect(brief).toContain(ref)
    }

    // The dispatch names the new worker; the board keeps the full history.
    const dispatch = dispatchRecord(board.task('coding'), selection, 60_000)
    expect(dispatch.candidateId).toBe('fallback')
    expect(dispatch.candidateId).not.toBe('coder')
    const attempts = board.task('coding').attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ entryId: 'coder', state: 'uncertain' })
    const work = record.chain.at(-1)
    expect(work).toMatchObject({ kind: 'move', trigger: 'stall' })
    if (work?.kind !== 'move') throw new Error('test:chain')
    expect(work.work).toEqual(captured)
    expect(work.work.noteRef).toBe('note:3')
  })
})

describe('M120 single-model golden', () => {
  it('sends byte-identical requests for single-model users', () => {
    const { board } = makeBoard()
    board.submit([submission('coding')], 0)
    // The worker input is the board's own dependency input, built on a code
    // path selection never touches: no preference, candidate or borrow fact
    // can leak into the request bytes.
    const input = board.dependencyInput('coding')
    expect(input).toEqual({ integrationTasks: [], reports: [] })
    const bytes = JSON.stringify(input)
    expect(bytes).toBe('{"integrationTasks":[],"reports":[]}')
    expect(bytes).not.toContain('preference')
    expect(bytes).not.toContain('candidate')
    expect(bytes).not.toContain('borrow')
  })
})

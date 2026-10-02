// M86 (PLAN.md D63): the pure restore engine, rule by rule
// (docs/design/m86-restore-by-tool-writes.md, sections 3, 4, 6.4, 8 and 9) and
// by the pure rows of its test matrix (section 13), then two properties over
// generated histories. The host's part (reading records, writing files) is
// tested with the store.

import { describe, expect, it } from 'vitest'
import { decideRange } from '../../src/core/checkpoints/restoreChain'
import type {
  ContentState,
  FoldedWrite,
  Owner,
  PathDecision,
  PathRefusal,
  RangeDecision,
  RangeInput,
  UnitKind,
  UnitRecord,
  WriteRecord,
} from '../../src/core/checkpoints/toolWrites'

const REGULAR = '100644'
const EXECUTABLE = '100755'
const SESSION = 'conversation-s'
const WINDOW = 'window-1'
const OTHER_WINDOW = 'window-2'
const PATH = 'src/app.ts'

const absent: ContentState = { present: false }
const bytes = (oid: string, mode = REGULAR): ContentState => ({ present: true, oid, mode })
const A = bytes('aaaa')
const B = bytes('bbbb')
const C = bytes('cccc')
const D = bytes('dddd')
const E = bytes('eeee')
const X = bytes('xxxx')

/** A write before its unit is known: the unit fills in the owner and the window. */
type WriteSpec = Pick<FoldedWrite, 'seq' | 'before' | 'after'> &
  Partial<Pick<FoldedWrite, 'path' | 'outcome' | 'isKept' | 'createdFolders'>>

const w = (
  seq: number,
  before: ContentState,
  after: ContentState,
  more: Partial<WriteSpec> = {},
): WriteSpec => ({ seq, before, after, ...more })

interface UnitOptions {
  readonly instance?: string
  readonly status?: UnitRecord['status']
  readonly ranProcesses?: boolean
}

function unit(
  unitKind: UnitKind,
  unitId: string,
  sequence: number,
  writes: readonly WriteSpec[],
  options: UnitOptions = {},
): UnitRecord {
  const owner: Owner = {
    instance: options.instance ?? WINDOW,
    sessionId: SESSION,
    unitKind,
    unitId,
  }
  return {
    owner,
    sequence,
    createdAt: sequence,
    endedAt: sequence,
    status: options.status ?? 'complete',
    ranProcesses: options.ranProcesses ?? false,
    writes: writes.map((spec, index) => ({
      id: `${unitId}#${String(index)}`,
      instance: owner.instance,
      owner,
      path: PATH,
      outcome: 'done',
      isKept: true,
      createdFolders: [],
      ...spec,
    })),
  }
}

const turn = (id: string, sequence: number, writes: readonly WriteSpec[], options?: UnitOptions) =>
  unit('turn', id, sequence, writes, options)
const batch = (id: string, sequence: number, writes: readonly WriteSpec[], options?: UnitOptions) =>
  unit('batch', id, sequence, writes, options)
const legacy = (turnId: string, sequence: number) => ({ legacy: true, sequence, turnId }) as const

/** A write by another conversation, in this window unless said otherwise. */
function foreign(
  seq: number,
  before: ContentState,
  after: ContentState,
  more: { readonly instance?: string; readonly path?: string } = {},
): WriteRecord {
  const instance = more.instance ?? WINDOW
  return {
    id: `foreign#${instance}#${String(seq)}`,
    instance,
    seq,
    owner: { instance, sessionId: 'conversation-t', unitKind: 'turn', unitId: 'other-turn' },
    path: more.path ?? PATH,
    before,
    after,
    createdFolders: [],
    isKept: true,
  }
}

type Units = RangeInput['units']

/** The transcript's turn ids from a unit on: every turn numbered from it, M72 ones included. */
function transcriptFrom(units: Units, unitId: string): string[] {
  const idOf = (entry: Units[number]) => ('legacy' in entry ? entry.turnId : entry.owner.unitId)
  const start = units.find((entry) => idOf(entry) === unitId)
  return units
    .filter((entry) => start !== undefined && entry.sequence >= start.sequence)
    .filter((entry) => 'legacy' in entry || entry.owner.unitKind === 'turn')
    .map((entry) => idOf(entry))
}

type Now = ContentState | ReadonlyMap<string, ContentState>

function decide(
  mode: RangeInput['mode'],
  from: RangeInput['from'],
  units: Units,
  now: Now,
  more: Partial<RangeInput>,
): RangeDecision {
  return decideRange({
    units,
    from,
    mode,
    transcriptTurnIds: transcriptFrom(units, from.unitId),
    foreignWrites: [],
    current: 'present' in now ? new Map([[PATH, now]]) : now,
    ...more,
  })
}

const restoreFrom = (turnId: string, units: Units, now: Now, more: Partial<RangeInput> = {}) =>
  decide('restore', { unitKind: 'turn', unitId: turnId }, units, now, more)
const redoOf = (batchId: string, units: Units, now: Now, more: Partial<RangeInput> = {}) =>
  decide('redo', { unitKind: 'batch', unitId: batchId }, units, now, more)

const restored = (
  expectNow: ContentState,
  target: ContentState,
  more: { readonly path?: string; readonly removeFolders?: readonly string[] } = {},
): PathDecision => ({
  kind: 'restore',
  path: more.path ?? PATH,
  expect: expectNow,
  target,
  removeFolders: more.removeFolders ?? [],
})
const unchanged = (path = PATH): PathDecision => ({ kind: 'unchanged', path })
const refused = (reason: PathRefusal, path = PATH): PathDecision => ({
  kind: 'refused',
  path,
  reason,
})
const decided = (...paths: PathDecision[]): RangeDecision => ({
  ok: true,
  paths,
  ranProcesses: false,
})
const writesIncomplete: RangeDecision = { ok: false, reason: 'writesIncomplete' }
const legacyInRange: RangeDecision = { ok: false, reason: 'legacyInRange' }

describe('decideRange: the range and its completeness (spec 3.1, 3.2, 7)', () => {
  it('P: units before the start are foreign, so the restore goes back to what the start turn found', () => {
    const units = [turn('t0', 1, [w(1, X, A)]), turn('t1', 2, [w(2, A, B)])]
    expect(restoreFrom('t1', units, B)).toEqual(decided(restored(B, A)))
  })

  it('P: an M72 unit in the range refuses the whole range (legacyInRange)', () => {
    const units = [turn('t1', 1, [w(1, A, B)]), legacy('t2', 2)]
    expect(restoreFrom('t1', units, B, { transcriptTurnIds: ['t1'] })).toEqual(legacyInRange)
  })

  it('P: an M72 turn the transcript lists reads as legacy, not as a turn with no record', () => {
    const units = [turn('t1', 1, [w(1, A, B)]), legacy('t2', 2)]
    expect(restoreFrom('t1', units, B)).toEqual(legacyInRange)
  })

  it('P: a restore from an M72 turn itself is refused as legacy', () => {
    const units = [legacy('t0', 1), turn('t1', 2, [w(1, A, B)])]
    expect(restoreFrom('t0', units, B)).toEqual(legacyInRange)
  })

  it('P: an M72 unit before the start is outside the range', () => {
    const units = [legacy('t0', 1), turn('t1', 2, [w(1, A, B)])]
    expect(restoreFrom('t1', units, B)).toEqual(decided(restored(B, A)))
  })

  it('Q: a listed turn with no record (setting off, or its record failed) refuses the whole range', () => {
    const units = [turn('t1', 1, [w(1, A, B)])]
    expect(restoreFrom('t1', units, B, { transcriptTurnIds: ['t1', 't2'] })).toEqual(
      writesIncomplete,
    )
  })

  it('Q: a listed child-session turn with no record refuses the whole range', () => {
    const units = [turn('t1', 1, [w(1, A, B)])]
    expect(restoreFrom('t1', units, B, { transcriptTurnIds: ['t1', 't1-child'] })).toEqual(
      writesIncomplete,
    )
  })

  it('Q: a listed turn whose record lies before the start does not count as recorded', () => {
    const units = [turn('t2', 1, []), turn('t1', 2, [w(1, A, B)])]
    expect(restoreFrom('t1', units, B, { transcriptTurnIds: ['t1', 't2'] })).toEqual(
      writesIncomplete,
    )
  })

  it('N, F: a unit in the range that is not complete refuses the whole range', () => {
    const units = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [], { status: 'incomplete' })]
    expect(restoreFrom('t1', units, B)).toEqual(writesIncomplete)
  })

  it('an incomplete unit before the start is outside the range', () => {
    const units = [turn('t0', 1, [], { status: 'incomplete' }), turn('t1', 2, [w(1, A, B)])]
    expect(restoreFrom('t1', units, B)).toEqual(decided(restored(B, A)))
  })

  it('a start unit with no record refuses the whole range', () => {
    const units = [turn('t1', 1, [w(1, A, B)])]
    expect(restoreFrom('t9', units, B)).toEqual(writesIncomplete)
  })

  it('R: the outcome notes processes run by a unit in the range, not by one before it', () => {
    const before = turn('t0', 1, [], { ranProcesses: true })
    const start = turn('t1', 2, [w(1, A, B)])
    expect(restoreFrom('t1', [before, start], B)).toEqual(decided(restored(B, A)))
    const later = turn('t2', 3, [], { ranProcesses: true })
    expect(restoreFrom('t1', [before, start, later], B)).toEqual({
      ok: true,
      paths: [restored(B, A)],
      ranProcesses: true,
    })
  })
})

describe('decideRange: the chain rule (spec 3.3 to 3.6)', () => {
  it('A: a file the turn created is deleted with its folders; a file it changed goes back', () => {
    const created = 'docs/new/a.md'
    const units = [
      turn('t1', 1, [
        w(1, absent, A, { path: created, createdFolders: ['docs', 'docs/new'] }),
        w(2, B, C, { path: 'b.ts' }),
      ]),
    ]
    const now = new Map([
      [created, A],
      ['b.ts', C],
    ])
    expect(restoreFrom('t1', units, now)).toEqual(
      decided(
        restored(A, absent, { path: created, removeFolders: ['docs/new', 'docs'] }),
        restored(C, B, { path: 'b.ts' }),
      ),
    )
  })

  it('C: bytes changed between two writes (a save, a command, a Memory view edit) break the chain', () => {
    const acrossTurns = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [w(2, C, D)])]
    expect(restoreFrom('t1', acrossTurns, D)).toEqual(decided(refused('changedBetween')))
    const withinTurn = [turn('t1', 1, [w(1, A, B), w(2, C, D)])]
    expect(restoreFrom('t1', withinTurn, D)).toEqual(decided(refused('changedBetween')))
  })

  it("C: another conversation's write in this window between two of ours breaks the chain, even with identical bytes", () => {
    const units = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [w(3, B, C)])]
    expect(restoreFrom('t1', units, C, { foreignWrites: [foreign(2, B, B)] })).toEqual(
      decided(refused('changedBetween')),
    )
  })

  it('C: a foreign write in this window before the first or after the last write leaves the chain whole', () => {
    const units = [turn('t1', 1, [w(2, A, B)]), turn('t2', 2, [w(3, B, C)])]
    const foreignWrites = [foreign(1, X, A), foreign(4, C, C)]
    expect(restoreFrom('t1', units, C, { foreignWrites })).toEqual(decided(restored(C, A)))
  })

  it("C: another window's write is judged by its bytes only (the ABA limit)", () => {
    const units = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [w(3, B, C)])]
    const foreignWrites = [foreign(2, B, B, { instance: OTHER_WINDOW })]
    expect(restoreFrom('t1', units, C, { foreignWrites })).toEqual(decided(restored(C, A)))
  })

  it('C: a formatter hook after the tool is refused; format on edit, a recorded write, restores', () => {
    const formatted = bytes('ffff')
    expect(restoreFrom('t1', [turn('t1', 1, [w(1, A, B)])], formatted)).toEqual(
      decided(refused('changedAfter')),
    )
    const formatOnEdit = [turn('t1', 1, [w(1, A, B), w(2, B, formatted)])]
    expect(restoreFrom('t1', formatOnEdit, formatted)).toEqual(decided(restored(formatted, A)))
  })

  it('B: a file changed or deleted after the last write is refused (changedAfter)', () => {
    const units = [turn('t1', 1, [w(1, A, B)])]
    expect(restoreFrom('t1', units, C)).toEqual(decided(refused('changedAfter')))
    expect(restoreFrom('t1', units, absent)).toEqual(decided(refused('changedAfter')))
  })

  it("M: a file already at the first write's before is unchanged, checked before anything else", () => {
    const brokenChain = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [w(2, C, D)])]
    expect(restoreFrom('t1', brokenChain, A)).toEqual(decided(unchanged()))
  })

  it("D: parent and child turns in one window go by seq across owners; the child's first write gives the target", () => {
    const units = [
      turn('parent', 1, [w(11, B, D)]),
      turn('parent-child', 2, [w(10, A, B), w(12, D, E)]),
    ]
    expect(restoreFrom('parent', units, E)).toEqual(decided(restored(E, A)))
  })

  it('X: a restore further back includes the restore batch made since', () => {
    const units = [
      turn('t1', 1, [w(1, A, B)]),
      turn('t2', 2, [w(2, B, C)]),
      batch('r1', 3, [w(3, C, B)]),
    ]
    expect(restoreFrom('t1', units, B)).toEqual(decided(restored(B, A)))
  })

  it("one window's writes keep their own order even where the bytes come back to an earlier state", () => {
    const units = [
      turn('t1', 1, [w(1, A, B)]),
      turn('t2', 2, [w(2, B, A)]),
      turn('t3', 3, [w(3, A, C)]),
    ]
    expect(restoreFrom('t1', units, C)).toEqual(decided(restored(C, A)))
  })

  it('a file whose bytes are not known matches nothing, not even another unknown', () => {
    const unknown: ContentState = { present: true }
    expect(restoreFrom('t1', [turn('t1', 1, [w(1, unknown, B)])], unknown)).toEqual(
      decided(refused('changedAfter')),
    )
  })

  it('aborted writes changed nothing: they neither break a chain nor list a path', () => {
    const units = [
      turn('t1', 1, [
        w(1, A, B),
        w(2, X, E, { outcome: 'aborted' }),
        w(3, B, C),
        w(4, A, D, { path: 'other.ts', outcome: 'aborted' }),
      ]),
    ]
    expect(restoreFrom('t1', units, C)).toEqual(decided(restored(C, A)))
  })

  it('a path the host read no current state for is an error, never a guess', () => {
    const units = [turn('t1', 1, [w(1, A, B)])]
    expect(() => restoreFrom('t1', units, new Map())).toThrow(PATH)
  })
})

describe('decideRange: the mode (spec 3.7, row L)', () => {
  it('L: a chmod after the write never refuses, and the file keeps its current mode', () => {
    const chmodded = bytes('bbbb', EXECUTABLE)
    expect(restoreFrom('t1', [turn('t1', 1, [w(1, A, B)])], chmodded)).toEqual(
      decided(restored(chmodded, bytes('aaaa', EXECUTABLE))),
    )
  })

  it('L: a chmod between two writes does not break the chain', () => {
    const units = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [w(2, bytes('bbbb', EXECUTABLE), C)])]
    expect(restoreFrom('t1', units, C)).toEqual(decided(restored(C, A)))
  })

  it("L: a file the restore recreates gets the first write's before mode", () => {
    const script = bytes('aaaa', EXECUTABLE)
    expect(restoreFrom('t1', [turn('t1', 1, [w(1, script, absent)])], absent)).toEqual(
      decided(restored(absent, script)),
    )
  })
})

describe('decideRange: the order across windows (spec 4, row E)', () => {
  const inOther = { instance: OTHER_WINDOW }
  // A→B, then B→C (this window) or B→X (the other): two heads match. Only
  // B→X, X→B, B→C completes, so a unique complete merge exists.
  const tieAfterFirst = [
    turn('t1', 1, [w(1, A, B), w(2, B, C)]),
    turn('t2', 2, [w(1, B, X), w(2, X, B)], inOther),
  ]

  it('E: the one merge the bytes allow restores to the first before', () => {
    const units = [turn('t1', 1, [w(5, A, B)]), turn('t2', 2, [w(1, B, C)], inOther)]
    expect(restoreFrom('t1', units, C)).toEqual(decided(restored(C, A)))
  })

  it('E: two heads matching at a step refuse (orderUnknown), even where only one choice would complete', () => {
    expect(restoreFrom('t1', tieAfterFirst, C)).toEqual(decided(refused('orderUnknown')))
  })

  it('E: two writes that could each come first refuse (orderUnknown)', () => {
    const units = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [w(1, C, D)], inOther)]
    expect(restoreFrom('t1', units, D)).toEqual(decided(refused('orderUnknown')))
  })

  it("E: no write that could come first (each before is another write's after) refuses (orderUnknown)", () => {
    const units = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [w(1, B, A)], inOther)]
    expect(restoreFrom('t1', units, B)).toEqual(decided(refused('orderUnknown')))
  })

  it('E: no head that starts from the bytes the last one left refuses (changedBetween)', () => {
    const units = [turn('t1', 1, [w(1, A, B), w(3, C, D)]), turn('t2', 2, [w(1, B, X)], inOther)]
    expect(restoreFrom('t1', units, D)).toEqual(decided(refused('changedBetween')))
  })

  it('E: only list heads merge: a matching write queued behind another in its window does not jump ahead', () => {
    // The other window wrote C→D before B→C: A→B, B→C, C→D would fit the bytes, not its order.
    const units = [turn('t1', 1, [w(1, A, B)]), turn('t2', 2, [w(1, C, D), w(2, B, C)], inOther)]
    expect(restoreFrom('t1', units, D)).toEqual(decided(refused('changedBetween')))
  })

  it('E: a file already at the first before is unchanged even when the merge then fails', () => {
    expect(restoreFrom('t1', tieAfterFirst, A)).toEqual(decided(unchanged()))
  })

  it("E: a foreign write placed between two of one window's writes breaks a merged chain", () => {
    const units = [turn('t1', 1, [w(1, A, B), w(3, X, C)]), turn('t2', 2, [w(1, B, X)], inOther)]
    expect(restoreFrom('t1', units, C, { foreignWrites: [foreign(2, X, X)] })).toEqual(
      decided(refused('changedBetween')),
    )
    expect(restoreFrom('t1', units, C, { foreignWrites: [foreign(4, C, C)] })).toEqual(
      decided(restored(C, A)),
    )
  })
})

describe('decideRange: unsettled writes (spec 6.4, row F)', () => {
  const unsettled = { outcome: 'unsettled' } as const

  it('F: an unsettled last write the file shows happened is undone with the rest', () => {
    const units = [turn('t1', 1, [w(1, A, B), w(2, B, C, unsettled)])]
    expect(restoreFrom('t1', units, C)).toEqual(decided(restored(C, A)))
  })

  it('F: an unsettled last write the file shows did not happen drops out', () => {
    const units = [turn('t1', 1, [w(1, A, B), w(2, B, C, unsettled)])]
    expect(restoreFrom('t1', units, B)).toEqual(decided(restored(B, A)))
  })

  it('F: an unsettled only write that did not happen leaves the file unchanged', () => {
    expect(restoreFrom('t1', [turn('t1', 1, [w(1, A, B, unsettled)])], A)).toEqual(
      decided(unchanged()),
    )
  })

  it('F: an unsettled last write with the file in neither of its states is refused (changedAfter)', () => {
    const units = [turn('t1', 1, [w(1, A, B), w(2, B, C, unsettled)])]
    expect(restoreFrom('t1', units, X)).toEqual(decided(refused('changedAfter')))
    // Even where the file matches the write before it: something wrote C→… then put B back.
    const gap = [turn('t1', 1, [w(1, A, B), w(2, C, D, unsettled)])]
    expect(restoreFrom('t1', gap, B)).toEqual(decided(refused('changedAfter')))
  })

  it('F: an unsettled write a later unit wrote over refuses the whole range (rename landed, done lost, a later turn reverted)', () => {
    const units = [turn('t1', 1, [w(1, A, B, unsettled)]), turn('t2', 2, [w(2, B, A)])]
    expect(restoreFrom('t1', units, A)).toEqual(writesIncomplete)
  })

  it('F: an unsettled write on a path whose order across windows cannot be told refuses the whole range', () => {
    const units = [
      turn('t1', 1, [w(1, A, B, unsettled)]),
      turn('t2', 2, [w(1, C, D)], { instance: OTHER_WINDOW }),
    ]
    expect(restoreFrom('t1', units, D)).toEqual(writesIncomplete)
  })
})

describe('decideRange: caps and folders (spec 9, row N)', () => {
  it('N: one write whose copy was not kept leaves its whole path unrestorable (notKept); other paths restore', () => {
    const units = [
      turn('t1', 1, [w(1, A, B), w(2, B, C, { isKept: false }), w(3, D, E, { path: 'ok.ts' })]),
    ]
    const now = new Map([
      [PATH, C],
      ['ok.ts', E],
    ])
    expect(restoreFrom('t1', units, now)).toEqual(
      decided(refused('notKept'), restored(E, D, { path: 'ok.ts' })),
    )
  })

  it('N: a path whose copy was not kept but which is already as before is unchanged', () => {
    expect(restoreFrom('t1', [turn('t1', 1, [w(1, A, B, { isKept: false })])], A)).toEqual(
      decided(unchanged()),
    )
  })

  it('9: a deletion removes every folder the chain created, innermost first, each once', () => {
    // t1 created new/deep in an existing new/; by t2 both were gone and t2 created both.
    const path = 'new/deep/f.txt'
    const units = [
      turn('t1', 1, [w(1, absent, A, { path, createdFolders: ['new/deep'] })]),
      batch('r1', 2, [w(2, A, absent, { path })]),
      turn('t2', 3, [w(3, absent, B, { path, createdFolders: ['new', 'new/deep'] })]),
    ]
    expect(restoreFrom('t1', units, new Map([[path, B]]))).toEqual(
      decided(restored(B, absent, { path, removeFolders: ['new/deep', 'new'] })),
    )
  })

  it('9: folders are removed only when the restore deletes the file', () => {
    const units = [
      turn('t1', 1, [w(1, A, absent)]),
      batch('r1', 2, [w(2, absent, A, { createdFolders: ['src'] })]),
      turn('t2', 3, [w(3, A, B)]),
    ]
    expect(restoreFrom('t1', units, B)).toEqual(decided(restored(B, A)))
  })
})

describe('decideRange: Redo (spec 8, rows A, U)', () => {
  it('A: tool writes, restore, Redo, Redo again: restored, redone, then nothing to do', () => {
    const created = 'notes/new.md'
    const t1 = turn('t1', 1, [
      w(1, absent, A, { path: created, createdFolders: ['notes'] }),
      w(2, B, C, { path: 'b.ts' }),
    ])
    const at = (createdNow: ContentState, changedNow: ContentState) =>
      new Map([
        [created, createdNow],
        ['b.ts', changedNow],
      ])
    expect(restoreFrom('t1', [t1], at(A, C))).toEqual(
      decided(
        restored(A, absent, { path: created, removeFolders: ['notes'] }),
        restored(C, B, { path: 'b.ts' }),
      ),
    )
    const r1 = batch('r1', 2, [w(3, A, absent, { path: created }), w(4, C, B, { path: 'b.ts' })])
    expect(redoOf('r1', [t1, r1], at(absent, B))).toEqual(
      decided(restored(absent, A, { path: created }), restored(B, C, { path: 'b.ts' })),
    )
    const r2 = batch('r2', 3, [
      w(5, absent, A, { path: created, createdFolders: ['notes'] }),
      w(6, B, C, { path: 'b.ts' }),
    ])
    expect(redoOf('r1', [t1, r1, r2], at(A, C))).toEqual(
      decided(unchanged(created), unchanged('b.ts')),
    )
  })

  it("U: a later unit's write to a path breaks its Redo (changedBetween), even when the bytes line up", () => {
    const units = [
      turn('t1', 1, [w(1, A, B)]),
      batch('r1', 2, [w(2, B, A)]),
      turn('t2', 3, [w(3, A, C), w(4, C, A)]),
    ]
    expect(redoOf('r1', units, A)).toEqual(decided(refused('changedBetween')))
  })

  it("U: a later unit's write from another window breaks a Redo too (changedBetween)", () => {
    const units = [
      turn('t1', 1, [w(1, A, B)]),
      batch('r1', 2, [w(2, B, A)]),
      turn('t2', 3, [w(1, C, D)], { instance: OTHER_WINDOW }),
    ]
    expect(redoOf('r1', units, D)).toEqual(decided(refused('changedBetween')))
  })

  it("U: a Redo decides only the batch's paths", () => {
    const units = [
      turn('t1', 1, [w(1, A, B)]),
      batch('r1', 2, [w(2, B, A)]),
      turn('t2', 3, [w(3, D, E, { path: 'later.ts' })]),
    ]
    expect(redoOf('r1', units, A)).toEqual(decided(restored(A, B)))
  })

  it("U: a Redo of a batch that is not among the conversation's units is refused whole", () => {
    const units = [turn('t1', 1, [w(1, A, B)]), batch('r1', 2, [w(2, B, A)])]
    expect(redoOf('r9', units, A)).toEqual(writesIncomplete)
  })

  it('U: a file changed after the batch is refused (changedAfter)', () => {
    const units = [turn('t1', 1, [w(1, A, B)]), batch('r1', 2, [w(2, B, A)])]
    expect(redoOf('r1', units, C)).toEqual(decided(refused('changedAfter')))
  })

  it("F, U: a later unit's unsettled write the file shows did not happen does not break a Redo", () => {
    const units = [
      turn('t1', 1, [w(1, A, B)]),
      batch('r1', 2, [w(2, B, A)]),
      turn('t2', 3, [w(3, A, C, { outcome: 'unsettled' })]),
    ]
    expect(redoOf('r1', units, A)).toEqual(decided(restored(A, B)))
  })
})

// ---------------------------------------------------------------------------
// Properties over generated histories: random units, writes, outcomes, kept
// copies, foreign writes and disk states, from a fixed seed so a failure
// repeats. Each history is checked against what any restore must satisfy.

const HISTORIES = 800
const MIN_RESTORES = 100
const CONTENTS = [absent, bytes('o1'), bytes('o2', EXECUTABLE), bytes('o3')]
const PATHS = ['p0', 'p1']
const OUTCOMES = ['done', 'done', 'done', 'done', 'aborted', 'unsettled'] as const

/** A Park–Miller generator: `next(n)` is a whole number below n. */
function seeded(seed: number): (bound: number) => number {
  let state = seed
  return (bound) => {
    state = (state * 48_271) % 2_147_483_647
    return state % bound
  }
}

function isSameBytes(left: ContentState, right: ContentState): boolean {
  return left.present === right.present && left.oid === right.oid
}

function history(seed: number, windows: number): RangeInput {
  const next = seeded(seed)
  const pick = <T>(items: readonly T[]): T => items[next(items.length)]!
  const unitCount = 1 + next(3)
  const specs: WriteSpec[][] = Array.from({ length: unitCount }, () => [])
  const latest = new Map<string, ContentState>()
  const writeCount = next(7)
  for (let seq = 1; seq <= writeCount; seq += 1) {
    const path = pick(PATHS)
    // Mostly a chain: a write usually starts from what the last one left.
    const before = next(4) === 0 ? pick(CONTENTS) : (latest.get(path) ?? pick(CONTENTS))
    const after = pick(CONTENTS)
    const outcome = pick(OUTCOMES)
    specs[next(unitCount)]!.push(w(seq, before, after, { path, outcome, isKept: next(8) !== 0 }))
    if (outcome !== 'aborted') {
      latest.set(path, after)
    }
  }
  const units = specs.map((writes, index) =>
    unit(next(3) === 0 ? 'batch' : 'turn', `u${String(index)}`, index + 1, writes, {
      instance: `w${String(next(windows))}`,
    }),
  )
  const start = pick(units)
  return {
    units,
    from: { unitKind: start.owner.unitKind, unitId: start.owner.unitId },
    mode: next(2) === 0 ? 'redo' : 'restore',
    transcriptTurnIds: [],
    foreignWrites: Array.from({ length: next(3) }, () =>
      foreign(next(writeCount + 2), pick(CONTENTS), pick(CONTENTS), {
        instance: `w${String(next(windows))}`,
        path: pick(PATHS),
      }),
    ),
    current: new Map(
      PATHS.map((path) => [path, next(2) === 0 ? pick(CONTENTS) : (latest.get(path) ?? absent)]),
    ),
  }
}

/** The writes a restore undoes on a path: the range's, or the replayed batch's for a Redo. */
function chainWrites(input: RangeInput, path: string): FoldedWrite[] {
  const records = input.units.flatMap((entry) => ('legacy' in entry ? [] : [entry]))
  const start = records.find((entry) => entry.owner.unitId === input.from.unitId)!
  const undone =
    input.mode === 'redo' ? [start] : records.filter((entry) => entry.sequence >= start.sequence)
  return undone
    .flatMap((entry) => entry.writes)
    .filter((write) => write.path === path && write.outcome !== 'aborted')
    .toSorted((left, right) => left.seq - right.seq)
}

function restoresOf(input: RangeInput) {
  const decision = decideRange(input)
  return decision.ok
    ? decision.paths.flatMap((path) => (path.kind === 'restore' ? [path] : []))
    : []
}

describe('decideRange: properties over generated histories', () => {
  it("a restore expects the last write's after and targets the first write's before (one window)", () => {
    let restores = 0
    for (let seed = 1; seed <= HISTORIES; seed += 1) {
      const input = history(seed, 1)
      for (const decision of restoresOf(input)) {
        restores += 1
        const now = input.current.get(decision.path)!
        const chain = chainWrites(input, decision.path)
        const first = chain[0]!
        const lastWrite = chain.at(-1)!
        // An unsettled last write the file shows did not happen drops out (spec 6.4).
        const last =
          lastWrite.outcome === 'unsettled' && isSameBytes(now, lastWrite.before)
            ? chain.at(-2)!
            : lastWrite
        const context = `seed ${String(seed)}, ${decision.path}`
        expect(decision.expect, context).toBe(now)
        expect(isSameBytes(now, last.after), context).toBe(true)
        expect(isSameBytes(decision.target, first.before), context).toBe(true)
        if (decision.target.present) {
          expect(decision.target.mode, context).toBe(now.present ? now.mode : first.before.mode)
        }
      }
    }
    expect(restores).toBeGreaterThan(MIN_RESTORES)
  })

  it("no decision targets bytes that no range write's before held (two windows)", () => {
    let restores = 0
    for (let seed = 1; seed <= HISTORIES; seed += 1) {
      const input = history(seed, 2)
      const records = input.units.flatMap((entry) => ('legacy' in entry ? [] : [entry]))
      const start = records.find((entry) => entry.owner.unitId === input.from.unitId)!
      const befores = records
        .filter((entry) => entry.sequence >= start.sequence)
        .flatMap((entry) => entry.writes)
        .filter((write) => write.outcome !== 'aborted')
      for (const decision of restoresOf(input)) {
        restores += 1
        const isHeld = befores.some(
          (write) => write.path === decision.path && isSameBytes(write.before, decision.target),
        )
        expect(isHeld, `seed ${String(seed)}, ${decision.path}`).toBe(true)
      }
    }
    expect(restores).toBeGreaterThan(MIN_RESTORES)
  })
})

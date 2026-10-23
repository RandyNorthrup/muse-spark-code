// M96d source-file regions: declared names lease independently while
// whole-file work still overlaps every region (M87's lane rules as a
// product). The text merge is untouched: marker-separated edits never
// share a merge hunk, so disjoint regions already merge cleanly.
import { describe, expect, it } from 'vitest'
import { SharedFiles } from '../../src/core/team/sharedFiles'
import {
  expandWriteSet,
  writeSetOverlap,
  WriteSetLeases,
  type PlannedWriteSet,
} from '../../src/core/team/writeSets'

function sharedWithRegions(): SharedFiles {
  return new SharedFiles(
    [{ pattern: 'src/en.ts', kind: 'text', regions: ['strings', 'tables'] }],
    [],
    false,
  )
}

function plan(
  writes: readonly string[],
  shared: SharedFiles,
  writePaths?: readonly string[],
): PlannedWriteSet {
  return expandWriteSet(writes, [], writePaths, false, false, shared)
}

/** A lease table over the regioned file with two holders ready. */
function leasedRegions(): {
  shared: SharedFiles
  leases: WriteSetLeases
  a: { taskId: string; attempt: number }
  b: { taskId: string; attempt: number }
} {
  const shared = sharedWithRegions()
  return {
    shared,
    leases: new WriteSetLeases('w', shared),
    a: { taskId: 'a', attempt: 1 },
    b: { taskId: 'b', attempt: 1 },
  }
}

describe('M96d region leases', () => {
  it('leases disjoint regions of one file independently', () => {
    const { shared, leases, a, b } = leasedRegions()
    expect(leases.acquire(a, plan(['src/en.ts#strings'], shared)).kind).toBe('acquired')
    // Another region of the same file does not wait.
    expect(leases.acquire(b, plan(['src/en.ts#tables'], shared)).kind).toBe('acquired')
    // The same region does.
    const c = { taskId: 'c', attempt: 1 }
    const wait = leases.acquire(c, plan(['src/en.ts#strings'], shared))
    expect(wait.kind).toBe('wait')
    if (wait.kind !== 'wait') return
    expect(wait.holder).toEqual(a)
    expect(wait.paths).toEqual(['src/en.ts#strings'])
  })

  it('overlaps whole-file work with every region', () => {
    const { shared, leases, a, b } = leasedRegions()
    expect(leases.acquire(a, plan(['src/en.ts#strings'], shared)).kind).toBe('acquired')
    expect(leases.acquire(b, plan(['src/en.ts'], shared)).kind).toBe('wait')
    expect(
      writeSetOverlap(plan(['src/en.ts'], shared), plan(['src/en.ts#tables'], shared), shared),
    ).toEqual(['src/en.ts', 'src/en.ts#tables'])
  })

  it('treats undeclared regions and #-paths as whole patterns', () => {
    const shared = sharedWithRegions()
    // No such region on the file: the whole literal pattern leases.
    expect(
      writeSetOverlap(
        plan(['src/en.ts#nope'], shared),
        plan(['src/en.ts#strings'], shared),
        shared,
      ),
    ).toEqual([])
    expect(
      writeSetOverlap(plan(['src/en.ts#nope'], shared), plan(['src/en.ts#nope'], shared), shared),
    ).toEqual(['src/en.ts#nope'])
    // A `#` inside a plain path keeps M96c's exact behaviour.
    expect(writeSetOverlap(plan(['c#lib.ts'], shared), plan(['c#lib.ts'], shared), shared)).toEqual(
      ['c#lib.ts'],
    )
    expect(writeSetOverlap(plan(['c#lib.ts'], shared), plan(['c'], shared), shared)).toEqual([])
    // Regions need literal paths: a qualified glob leases the whole glob.
    expect(
      writeSetOverlap(plan(['src/**#strings'], shared), plan(['src/en.ts#tables'], shared), shared),
    ).toEqual(['src/en.ts#tables'])
  })

  it('keeps region writes under exact permits and grows into regions', () => {
    const shared = sharedWithRegions()
    const set = plan(['src/en.ts#strings'], shared, ['src/en.ts'])
    expect(set.patterns).toEqual(['src/en.ts#strings'])
    expect(set.paths).toEqual(['src/en.ts#strings'])
    const leases = new WriteSetLeases('w', shared)
    const a = { taskId: 'a', attempt: 1 }
    expect(leases.acquire(a, set).kind).toBe('acquired')
    expect(leases.grow(a, 'src/en.ts#tables').kind).toBe('acquired')
    const b = { taskId: 'b', attempt: 1 }
    expect(leases.acquire(b, plan(['src/en.ts#strings'], shared)).kind).toBe('wait')
  })

  it('reports declared regions and covers qualified declarations', () => {
    const shared = sharedWithRegions()
    expect(shared.regionsFor('src/en.ts')).toEqual(['strings', 'tables'])
    expect(shared.regionsFor('src/other.ts')).toBeUndefined()
    expect(shared.undeclaredTextFiles(['src/en.ts'], ['src/en.ts#strings'])).toEqual([])
    expect(shared.undeclaredTextFiles(['src/en.ts'], ['src/other.ts'])).toEqual(['src/en.ts'])
  })
})

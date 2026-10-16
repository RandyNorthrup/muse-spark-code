// D121 (NOLIMITS1 A11): a rename touches as many files as the language
// service names — the removed 200-file ceiling was invented, so files past
// it merge like any other. Pure data through the real module: no mocks,
// no stand-ins.
import { describe, expect, it } from 'vitest'
import type { PlacedFile } from '../../src/core/codeIntel/codeIntelQuery'
import type { TextEdit } from '../../src/core/codeIntel/languageService'
import { mergePlacedEdits } from '../../src/core/codeIntel/rename'

function file(index: number): PlacedFile {
  const name = `f${String(index)}.ts`
  return {
    absolute: `/root/${name}`,
    relative: name,
    canonical: name,
    checkedAbsolute: `/root/${name}`,
  }
}

function edit(): TextEdit {
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    newText: 'b',
  }
}

describe('rename merge (D121 A11)', () => {
  it('merges 201 files — what the removed 200-file ceiling refused', () => {
    const placed = Array.from({ length: 201 }, (_, index) => ({
      file: file(index),
      edits: [edit()],
    }))
    const merged = mergePlacedEdits(placed)
    expect(merged).toHaveLength(201)
    expect(merged[200]?.edits).toHaveLength(1)
  })
  it('still groups the edit’s changes one entry per file', () => {
    const first = file(0)
    const merged = mergePlacedEdits([
      { file: first, edits: [edit()] },
      { file: file(1), edits: [edit()] },
      { file: first, edits: [edit(), edit()] },
      { file: undefined, edits: [edit()] },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]?.edits).toHaveLength(3)
  })
})

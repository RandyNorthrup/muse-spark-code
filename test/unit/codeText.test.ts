// The code intelligence tools' text work (M67): names found as whole words
// at VS Code's positions, a language service's edits applied, and the
// hunks a rename leaves, which Edit Review and rewind must be able to undo.

import { describe, expect, it } from 'vitest'
import {
  applyTextEdits,
  BOM,
  findName,
  patchHunks,
  textIn,
  unifiedDiff,
} from '../../src/core/codeIntel/codeText'
import { revertHunks } from '../../src/core/patchApply'

const START = { line: 0, character: 0 }

function at(line: number, character: number) {
  return { line, character }
}

function edit(line: number, from: number, to: number, newText: string) {
  return { range: { start: at(line, from), end: at(line, to) }, newText }
}

describe('findName', () => {
  it('finds whole words only, literally, from a position and within a line', () => {
    const text = 'greeting greet\r\nx.greet(a$greet)\rgreet'
    expect(findName(text, 'greet', START)).toEqual(at(0, 9))
    expect(findName(text, 'greet', at(1, 0))).toEqual(at(1, 2))
    expect(findName(text, 'greet', at(1, 3))).toEqual(at(2, 0))
    expect(findName(text, 'greet', at(1, 3), 1)).toBeUndefined()
    expect(findName('a.b(c) a.b', 'a.b', at(0, 1))).toEqual(at(0, 7))
    expect(findName(text, '', START)).toBeUndefined()
    expect(findName(text, 'greet', at(9, 0))).toBeUndefined()
    expect(findName(text, 'greet', at(0, 99))).toBeUndefined()
  })
})

describe('applyTextEdits and textIn', () => {
  it('applies edits against the original positions, whatever their order', () => {
    const text = 'let old = 1\r\nold + old\n'
    const edits = [edit(1, 6, 9, 'fresh'), edit(0, 4, 7, 'fresh'), edit(1, 0, 3, 'fresh')]
    expect(applyTextEdits(text, edits)).toBe('let fresh = 1\r\nfresh + fresh\n')
    expect(textIn(text, at(1, 6), at(1, 9))).toBe('old')
  })

  it('refuses edits outside the text or overlapping each other', () => {
    const text = 'abc\ndef'
    expect(applyTextEdits(text, [edit(5, 0, 1, 'x')])).toBeUndefined()
    expect(applyTextEdits(text, [edit(0, 0, 9, 'x')])).toBeUndefined()
    expect(applyTextEdits(text, [edit(0, 2, 1, 'x')])).toBeUndefined()
    expect(applyTextEdits(text, [edit(0, 0, 2, 'x'), edit(0, 1, 3, 'y')])).toBeUndefined()
    expect(textIn(text, at(0, 2), at(0, 1))).toBeUndefined()
  })
})

describe('patchHunks', () => {
  const before = Array.from({ length: 20 }, (_, index) => `line ${String(index)} old`).join('\n')

  it('makes one hunk per group of changed lines, which revert undoes', () => {
    const after = before.replace('line 1 old', 'line 1 new').replace('line 3 old', 'line 3 new')
    const changed = after.replace('line 15 old', 'line 15 new')
    const hunks = patchHunks(`${BOM}${before}\n`, `${BOM}${changed}\n`)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 7, newStart: 1, newLines: 7 })
    expect(hunks[0]?.lines.slice(0, 4)).toEqual([
      ' line 0 old',
      '-line 1 old',
      '+line 1 new',
      ' line 2 old',
    ])
    expect(hunks[1]).toMatchObject({ oldStart: 13, oldLines: 7 })
    expect(revertHunks(`${changed}\n`, hunks)).toEqual({
      ok: true,
      content: `${before}\n`,
      isCreatedFile: false,
    })
  })

  it('makes one hunk around the change when the line count changes', () => {
    const after = before.replace('line 10 old', 'line 10 new\nline 10b')
    const hunks = patchHunks(before, after)
    expect(hunks).toEqual([
      {
        oldStart: 8,
        oldLines: 7,
        newStart: 8,
        newLines: 8,
        lines: [
          ' line 7 old',
          ' line 8 old',
          ' line 9 old',
          '-line 10 old',
          '+line 10 new',
          '+line 10b',
          ' line 11 old',
          ' line 12 old',
          ' line 13 old',
        ],
      },
    ])
    expect(revertHunks(after, hunks)).toMatchObject({ ok: true, content: before })
    expect(patchHunks('', 'one\n')).toEqual([
      { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+one'] },
    ])
  })

  it('writes the hunks as a unified diff', () => {
    const hunks = patchHunks('a\nb\n', 'a\nc\n')
    expect(unifiedDiff('src/x.ts', hunks)).toBe(
      ['--- a/src/x.ts', '+++ b/src/x.ts', '@@ -1,2 +1,2 @@', ' a', '-b', '+c'].join('\n'),
    )
  })
})

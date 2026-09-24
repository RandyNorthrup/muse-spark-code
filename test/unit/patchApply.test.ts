import { describe, expect, it } from 'vitest'
import { revertHunks } from '../../src/core/patchApply'
import { parsePatchFiles } from '../../src/shared/patchDocument'

// The stored patch of the M4 live edit turn (`item/readOutput` of the
// edit_file item's patchRef, 2026-09-21): "first line" became two lines.
const LIVE_PATCH =
  '{"files":[{"path":"notes.md","hunks":[{"oldStart":1,"oldLines":3,"newStart":1,"newLines":4,"lines":[" # Notes"," ","-first line","+second line","+third line"]}]}]}'

describe('parsePatchFiles', () => {
  it('reads the live patch document', () => {
    const files = parsePatchFiles(LIVE_PATCH)
    expect(files).toHaveLength(1)
    expect(files?.[0]).toMatchObject({ path: 'notes.md', hunks: [{ oldStart: 1, newStart: 1 }] })
  })

  it('returns undefined for non-JSON and for JSON of another shape', () => {
    expect(parsePatchFiles('not json')).toBeUndefined()
    expect(parsePatchFiles('{"hunks":[]}')).toBeUndefined()
  })
})

describe('revertHunks', () => {
  const hunks = parsePatchFiles(LIVE_PATCH)?.[0]?.hunks ?? []

  it('rebuilds the pre-edit text from the file as the edit left it', () => {
    const result = revertHunks('# Notes\n\nsecond line\nthird line\n', hunks)
    expect(result).toEqual({
      ok: true,
      content: '# Notes\n\nfirst line\n',
      isCreatedFile: false,
    })
  })

  it('keeps CRLF line breaks and a missing trailing break', () => {
    expect(revertHunks('# Notes\r\n\r\nsecond line\r\nthird line', hunks)).toEqual({
      ok: true,
      content: '# Notes\r\n\r\nfirst line',
      isCreatedFile: false,
    })
  })

  it('refuses when the file no longer matches the hunk', () => {
    const result = revertHunks('# Notes\n\nsecond line\nsomething else\n', hunks)
    expect(result).toEqual({
      ok: false,
      reason: 'hunk 1 no longer matches the file at line 1, or anywhere else',
    })
  })

  describe('a hunk that only moved (M36)', () => {
    // The agent turned `old` into `new` between two context lines at line 3.
    const edit = [{ oldStart: 2, newStart: 2, lines: [' before', '-old', '+new', ' after'] }]
    const edited = 'top\nbefore\nnew\nafter\nend\n'
    // Two edits: `a` → `A` at line 1, `e` → `E` after `d` at line 4.
    const two = [
      { oldStart: 1, newStart: 1, lines: ['-a', '+A', ' b'] },
      { oldStart: 4, newStart: 4, lines: [' d', '-e', '+E'] },
    ]

    it('finds it below where it was when lines were added above, keeping them', () => {
      expect(revertHunks(`mine 1\nmine 2\n${edited}`, edit)).toEqual({
        ok: true,
        content: 'mine 1\nmine 2\ntop\nbefore\nold\nafter\nend\n',
        isCreatedFile: false,
      })
    })

    it('finds it above where it was when lines were removed above', () => {
      expect(revertHunks('before\nnew\nafter\nend\n', edit)).toEqual({
        ok: true,
        content: 'before\nold\nafter\nend\n',
        isCreatedFile: false,
      })
    })

    it('carries the move to the next hunk and keeps lines added between them', () => {
      expect(revertHunks('mine\nA\nb\nc\nmine too\nd\nE\n', two)).toEqual({
        ok: true,
        content: 'mine\na\nb\nc\nmine too\nd\ne\n',
        isCreatedFile: false,
      })
    })

    it('places a repeated block by the move the previous hunk showed', () => {
      // `d` / `E` occurs twice; the first hunk moved one line down, so the
      // second is looked for one line down first, where it is.
      expect(revertHunks('mine\nA\nb\nc\nd\nE\nd\nE\n', two)).toEqual({
        ok: true,
        content: 'mine\na\nb\nc\nd\ne\nd\nE\n',
        isCreatedFile: false,
      })
    })

    it('refuses when the same lines occur in more than one place', () => {
      expect(revertHunks(`x\n${edited}${edited}`, edit)).toEqual({
        ok: false,
        reason: 'hunk 1 matches 2 places in the file, so which one is not certain',
      })
    })

    it('still refuses when the hunk’s own lines were changed, moved or not', () => {
      expect(revertHunks('mine\ntop\nbefore\nnew, edited\nafter\nend\n', edit)).toEqual({
        ok: false,
        reason: 'hunk 1 no longer matches the file at line 2, or anywhere else',
      })
    })
  })

  it('applies several hunks in order and leaves the lines between them alone', () => {
    const two = [
      { oldStart: 1, newStart: 1, lines: ['-a', '+A', ' b'] },
      { oldStart: 4, newStart: 4, lines: [' d', '-e', '+E', '+E2'] },
    ]
    expect(revertHunks('A\nb\nc\nd\nE\nE2\nf\n', two)).toEqual({
      ok: true,
      content: 'a\nb\nc\nd\ne\nf\n',
      isCreatedFile: false,
    })
    expect(revertHunks('A\nb\nc\nd\nE\nE2\nf\n', [two[1] as never, two[0] as never])).toEqual({
      ok: false,
      reason: 'hunk 2 overlaps the previous one',
    })
  })

  it('recognises a created file: everything added from line 0, nothing before', () => {
    const created = [{ oldStart: 0, newStart: 1, lines: ['+hello', '+world'] }]
    expect(revertHunks('hello\nworld\n', created)).toEqual({
      ok: true,
      content: '',
      isCreatedFile: true,
    })
  })

  it('handles an empty file and no hunks', () => {
    expect(revertHunks('', [])).toEqual({ ok: true, content: '', isCreatedFile: false })
    expect(revertHunks('keep\n', [])).toEqual({ ok: true, content: 'keep\n', isCreatedFile: false })
  })
})

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
      reason: 'hunk 1 no longer matches the file at line 1',
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

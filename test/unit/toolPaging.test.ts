import { describe, expect, it } from 'vitest'
import { clipWithNote, pageNote, searchPage } from '../../src/core/backends/modelapi/tools'
import { TOOL_OUTPUT_CLIP_MARKER } from '../../src/shared/constants'
import type { SearchHit } from '../../src/core/backends/modelapi/tools'

// B5 (limits-output): capped lists stay reachable by offset. Pure logic
// through the real tool module: rows in, pages and notes out.
const hits = (count: number): SearchHit[] =>
  Array.from({ length: count }, (_, index) => ({
    file: `f${String(index % 2)}.ts`,
    line: index + 1,
    text: `hit ${String(index + 1)}`,
  }))

describe('search paging', () => {
  it('pages content hits with the total kept', () => {
    const first = searchPage(hits(5), 'content', 2, 0)
    expect(first.rows).toHaveLength(2)
    expect(first.total).toBe(5)
    expect(first.rows[0]).toContain('hit 1')
    const second = searchPage(hits(5), 'content', 2, 2)
    expect(second.rows).toHaveLength(2)
    expect(second.rows[0]).toContain('hit 3')
    const last = searchPage(hits(5), 'content', 2, 4)
    expect(last.rows).toHaveLength(1)
    expect(searchPage(hits(5), 'content', 2, 5).rows).toHaveLength(0)
  })

  it('pages aggregated rows, not hits', () => {
    const page = searchPage(hits(5), 'files_with_matches', 1, 1)
    expect(page.total).toBe(2)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]).toBe('f1.ts')
    const counts = searchPage(hits(5), 'count', 10, 0)
    expect(counts.total).toBe(2)
    expect(counts.rows).toHaveLength(2)
  })

  it('names the remainder and the next offset', () => {
    expect(pageNote('search', 0, 2, 5, false)).toBe(
      '[matches 1-2 of 5; call search again with offset 2 for the rest]',
    )
    expect(pageNote('search', 2, 2, 5, true)).toBe(
      '[matches 3-4 of at least 5; call search again with offset 4 for the rest]',
    )
    expect(pageNote('list_files', 500, 500, 1200, false, 'files')).toBe(
      '[files 501-1000 of 1200; call list_files again with offset 1000 for the rest]',
    )
  })
})

describe('clip with note', () => {
  it('keeps the listing and the note when they fit', () => {
    expect(clipWithNote('abc', 64, '\n[note]')).toBe('abc\n[note]')
  })

  it('keeps the note after the marker when the listing is cut', () => {
    const text = 'x'.repeat(100)
    const note = '\n[offset=81 for the rest]'
    const clipped = clipWithNote(text, 64, note)
    expect(clipped.endsWith(note)).toBe(true)
    expect(clipped).toContain(TOOL_OUTPUT_CLIP_MARKER)
    expect(clipped.length).toBeLessThanOrEqual(64)
  })

  it('clips plainly without a note', () => {
    const clipped = clipWithNote('x'.repeat(100), 64, '')
    expect(clipped.endsWith(TOOL_OUTPUT_CLIP_MARKER)).toBe(true)
  })
})

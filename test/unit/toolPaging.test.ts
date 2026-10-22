// Capped lists stay reachable by offset: pages in, notes out. Pure logic
// through the real tool module.
import { describe, expect, it } from 'vitest'
import { pageNote, searchPage } from '../../src/core/backends/modelapi/tools'
import type { SearchHit } from '../../src/core/backends/modelapi/tools'

const HITS: SearchHit[] = Array.from({ length: 5 }, (_, index) => ({
  file: `f${String(index % 2)}.ts`,
  line: index + 1,
  text: `hit ${String(index + 1)}`,
}))

describe('search paging', () => {
  it('pages content hits with the total kept', () => {
    const first = searchPage(HITS, 'content', 2, 0)
    expect(first.rows).toHaveLength(2)
    expect(first.total).toBe(5)
    expect(first.rows[0]).toContain('hit 1')
    const second = searchPage(HITS, 'content', 2, 2)
    expect(second.rows).toHaveLength(2)
    expect(second.rows[0]).toContain('hit 3')
    const last = searchPage(HITS, 'content', 2, 4)
    expect(last.rows).toHaveLength(1)
    expect(searchPage(HITS, 'content', 2, 5).rows).toHaveLength(0)
  })

  it('pages aggregated rows, not hits', () => {
    const page = searchPage(HITS, 'files_with_matches', 1, 1)
    expect(page.total).toBe(2)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]).toBe('f1.ts')
    const counts = searchPage(HITS, 'count', 10, 0)
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

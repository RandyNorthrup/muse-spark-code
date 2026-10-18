import { describe, expect, it } from 'vitest'
import { OutputDocumentStore } from '../../src/host/outputDocuments'

// No invented caps: every output document stays readable.
describe('OutputDocumentStore', () => {
  it('keeps more than the old twenty documents', () => {
    const store = new OutputDocumentStore()
    const ids = Array.from({ length: 25 }, (_, index) => store.add(`doc-${String(index)}`))
    expect(ids).toHaveLength(25)
    for (const [index, id] of ids.entries()) {
      expect(store.get(id)).toBe(`doc-${String(index)}`)
    }
  })

  it('keeps documents past the old 32 MiB total, oldest included', () => {
    const store = new OutputDocumentStore()
    const first = store.add('a'.repeat(1024))
    const huge = store.add('x'.repeat(40 * 1024 * 1024))
    expect(store.get(first)).toHaveLength(1024)
    expect(store.get(huge)).toHaveLength(40 * 1024 * 1024)
  })
})

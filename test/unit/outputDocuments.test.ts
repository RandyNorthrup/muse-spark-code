import { describe, expect, it } from 'vitest'
import { OutputDocumentStore } from '../../src/host/outputDocuments'

// M39: the documents live in the extension host's memory.
describe('OutputDocumentStore', () => {
  it('keeps the newest documents up to the count', () => {
    const store = new OutputDocumentStore(2, 1000)
    const ids = ['a', 'b', 'c'].map((text) => store.add(text))
    expect(ids).toEqual(['1', '2', '3'])
    expect(store.get('1')).toBeUndefined()
    expect(store.get('2')).toBe('b')
    expect(store.get('3')).toBe('c')
  })

  it('drops the oldest while the characters together pass the limit, never the newest', () => {
    const store = new OutputDocumentStore(20, 10)
    const first = store.add('aaaa')
    const second = store.add('bbbb')
    expect(store.get(first)).toBe('aaaa')
    const third = store.add('cccc')
    expect(store.get(first)).toBeUndefined()
    expect(store.get(second)).toBe('bbbb')
    // One larger than the limit on its own is still kept, alone.
    const huge = store.add('x'.repeat(50))
    expect(store.get(second)).toBeUndefined()
    expect(store.get(third)).toBeUndefined()
    expect(store.get(huge)).toHaveLength(50)
  })
})

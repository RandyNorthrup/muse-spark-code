import { describe, expect, it } from 'vitest'

import { TAB_CACHE_ENTRIES } from '../../src/shared/constants'
import { TabCache } from '../../src/core/tab/tabCache'

const DOC = 'src/a.ts'
const OTHER = 'src/b.ts'

describe('lookup', () => {
  it('serves the rest while the user types through the completion', () => {
    const cache = new TabCache()
    cache.store(DOC, 'const x = ', 'suffix', 'foo();')
    expect(cache.lookup(DOC, 'const x = ', 'suffix')).toBe('foo();')
    expect(cache.lookup(DOC, 'const x = foo', 'suffix')).toBe('();')
    expect(cache.lookup(DOC, 'const x = foo();', 'suffix')).toBe('')
  })

  it('serves nothing typed past the completion', () => {
    const cache = new TabCache()
    cache.store(DOC, 'const x = ', 'suffix', 'foo();')
    expect(cache.lookup(DOC, 'const x = bar', 'suffix')).toBeUndefined()
  })

  it('serves no stale text whose prefix only ends like the answer', () => {
    const cache = new TabCache()
    cache.store(DOC, 'ab', 's', 'abcdef')
    expect(cache.lookup(DOC, 'xxabcdef', 's')).toBeUndefined()
  })

  it('takes the longest matching prefix', () => {
    const cache = new TabCache()
    cache.store(DOC, 'const ', 'suffix', 'short;')
    cache.store(DOC, 'const x = ', 'suffix', 'foo();')
    expect(cache.lookup(DOC, 'const x = f', 'suffix')).toBe('oo();')
  })

  it('needs the same document and the same suffix', () => {
    const cache = new TabCache()
    cache.store(DOC, 'const x = ', 'suffix', 'foo();')
    expect(cache.lookup(OTHER, 'const x = f', 'suffix')).toBeUndefined()
    expect(cache.lookup(DOC, 'const x = f', 'other')).toBeUndefined()
  })

  it('reads and writes the same raw-prefix key', () => {
    const cache = new TabCache()
    cache.store(DOC, 'a', 's', 'first;')
    cache.store(DOC, 'a', 's', 'second;')
    expect(cache.lookup(DOC, 'a', 's')).toBe('second;')
    expect(cache.entryCount).toBe(1)
  })

  it('never stores an empty completion', () => {
    const cache = new TabCache()
    cache.store(DOC, 'a', 's', '')
    expect(cache.entryCount).toBe(0)
  })

  it('evicts the oldest entry past the cap', () => {
    const cache = new TabCache()
    for (let index = 0; index <= TAB_CACHE_ENTRIES; index += 1) {
      cache.store(DOC, `prefix ${String(index)}`, 's', `done ${String(index)};`)
    }
    expect(cache.entryCount).toBe(TAB_CACHE_ENTRIES)
    expect(cache.lookup(DOC, 'prefix 0', 's')).toBeUndefined()
    expect(cache.lookup(DOC, `prefix ${String(TAB_CACHE_ENTRIES)}`, 's')).toBe(
      `done ${String(TAB_CACHE_ENTRIES)};`,
    )
  })
})

describe('open requests', () => {
  it('matches a trigger extending an open request with its stream', () => {
    const cache = new TabCache()
    cache.noteOpen('gen-1', DOC, 'const x = ', 'suffix')
    expect(cache.findOpen(DOC, 'const x = fo', 'suffix', 'foo();')).toBe('gen-1')
    expect(cache.findOpen(DOC, 'const x = bar', 'suffix', 'foo();')).toBeUndefined()
    expect(cache.findOpen(DOC, 'const x = fo', 'other', 'foo();')).toBeUndefined()
  })

  it('settles an open request into the cache and forgets it', () => {
    const cache = new TabCache()
    cache.noteOpen('gen-1', DOC, 'const x = ', 'suffix')
    cache.settleOpen('gen-1', 'foo();')
    expect(cache.openCount).toBe(0)
    expect(cache.lookup(DOC, 'const x = f', 'suffix')).toBe('oo();')
    cache.noteOpen('gen-2', DOC, 'const y = ', 'suffix')
    cache.dropOpen('gen-2')
    expect(cache.openCount).toBe(0)
    expect(cache.findOpen(DOC, 'const y = ', 'suffix', '')).toBeUndefined()
  })
})

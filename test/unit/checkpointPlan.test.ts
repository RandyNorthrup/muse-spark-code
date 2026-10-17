import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  gitBlobOid,
  parseBatchCheck,
  parseCatFileBatch,
} from '../../src/core/checkpoints/gitListings'

describe('git listings (M72, M86)', () => {
  it('reads cat-file --batch output, binary bytes and a missing object included', () => {
    const output = Buffer.concat([
      Buffer.from('aaaa blob 3\n'),
      Buffer.from([0, 10, 255]),
      Buffer.from('\nbbbb missing\n'),
    ])
    const objects = parseCatFileBatch(output)
    expect([...(objects.get('aaaa') ?? [])]).toEqual([0, 10, 255])
    expect(objects.has('bbbb')).toBe(true)
    expect(objects.get('bbbb')).toBeUndefined()
  })

  it('refuses a cat-file answer that claims more bytes than it has', () => {
    expect(() => parseCatFileBatch(Buffer.from('aaaa blob 99\nshort\n'))).toThrow(/malformed/)
  })

  it('names bytes as git names a blob, and reads a batch-check answer', () => {
    // `git hash-object` of the empty blob and of "hello\n".
    expect(gitBlobOid(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(gitBlobOid(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(parseBatchCheck('aaaa blob 12\nbbbb missing\n')).toEqual(new Map([['aaaa', 12]]))
  })
})

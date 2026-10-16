// The store error-code readers: the `is` twin answers exactly what the
// code reader says, so catch handlers name their expected case through it.
import { describe, expect, it } from 'vitest'
import { isStoreErrorCode, storeErrorCode } from '../../src/host/backend/storeErrors'

function coded(code: unknown): unknown {
  return Object.assign(new Error('unavailable'), { code })
}

describe('storeErrorCode', () => {
  it('reads the code of an object failure and nothing else', () => {
    expect(storeErrorCode(coded('ENOENT'))).toBe('ENOENT')
    expect(storeErrorCode(new Error('plain'))).toBeUndefined()
    expect(storeErrorCode({ code: 'EEXIST' })).toBe('EEXIST')
    expect(storeErrorCode(null)).toBeUndefined()
    expect(storeErrorCode(undefined)).toBeUndefined()
    expect(storeErrorCode('ENOENT')).toBeUndefined()
    expect(storeErrorCode(2)).toBeUndefined()
  })
})

describe('isStoreErrorCode', () => {
  it('names the expected store condition and nothing else', () => {
    expect(isStoreErrorCode(coded('ENOENT'), 'ENOENT')).toBe(true)
    expect(isStoreErrorCode(coded('EACCES'), 'ENOENT')).toBe(false)
    expect(isStoreErrorCode(new Error('plain'), 'ENOENT')).toBe(false)
    expect(isStoreErrorCode(null, 'ENOENT')).toBe(false)
    expect(isStoreErrorCode(undefined, 'ENOENT')).toBe(false)
    expect(isStoreErrorCode('ENOENT', 'ENOENT')).toBe(false)
  })

  it('agrees with the code reader on every input', () => {
    const inputs: readonly unknown[] = [
      coded('ENOENT'),
      coded('EEXIST'),
      coded(2),
      new Error('plain'),
      { code: 'ENOENT' },
      { code: undefined },
      {},
      null,
      undefined,
      'ENOENT',
      2,
      true,
    ]
    for (const input of inputs)
      for (const code of ['ENOENT', 'EEXIST', 'EACCES'])
        expect(isStoreErrorCode(input, code)).toBe(storeErrorCode(input) === code)
  })
})

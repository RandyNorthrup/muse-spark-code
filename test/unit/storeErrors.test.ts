// The store error-code readers: the `is` twin answers exactly what the
// code reader says, so catch handlers name their expected case through it.
// The store log helper names a provider failure by fixed words/codes, never
// a message that can name a file id or name.
import { describe, expect, it } from 'vitest'
import { isModelApiError, ModelApiError } from '../../src/core/backends/modelapi/client'
import {
  isStoreErrorCode,
  storeErrorCode,
  storeErrorForLog,
} from '../../src/host/backend/storeErrors'

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

describe('storeErrorForLog', () => {
  it('names a provider failure by status and envelope words, never its message', () => {
    const error = new ModelApiError('Cannot delete file-old confidential-report.pdf', 500, 'x', 'y')
    expect(isModelApiError(error)).toBe(true)
    const logged = storeErrorForLog(error)
    expect(logged).toBe('provider failure (HTTP 500 x)')
    for (const canary of ['file-old', 'confidential', 'Cannot delete']) {
      expect(logged).not.toContain(canary)
    }
  })

  it('agrees with the client guard on provider and storage failures', () => {
    const provider = new ModelApiError('gone', 404, undefined, undefined)
    expect(isModelApiError(provider)).toBe(true)
    expect(storeErrorForLog(provider)).toBe('provider failure (HTTP 404)')
    const storage = Object.assign(new Error('busy'), { code: 'ENOSPC' })
    expect(isModelApiError(storage)).toBe(false)
    expect(storeErrorForLog(storage)).toBe('ENOSPC')
    expect(storeErrorForLog(new Error('plain'))).toBe('a storage failure')
    expect(storeErrorForLog('plain')).toBe('a storage failure')
  })
})

// The store log helper (finding 8): provider failures log fixed
// words/codes, never the message that can name a file id or name.
import { describe, expect, it } from 'vitest'
import { isModelApiError, ModelApiError } from '../../src/core/backends/modelapi/client'
import { storeErrorForLog } from '../../src/host/backend/storeErrors'

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

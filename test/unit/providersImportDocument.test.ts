// The providers import's malformed-file refusal
// (src/host/providers/importExport.ts): text that is not JSON is refused
// with the fixed sentence and the SyntaxError as its cause.
import { describe, expect, it } from 'vitest'
import { previewProvidersImport } from '../../src/host/providers/importExport'

describe('previewProvidersImport', () => {
  it('refuses text that is not JSON, carrying the SyntaxError', async () => {
    let failure: unknown
    try {
      await previewProvidersImport([], '{not json', { check: () => ({ kind: 'ok' }) })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('The providers file is not valid JSON')
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })
})

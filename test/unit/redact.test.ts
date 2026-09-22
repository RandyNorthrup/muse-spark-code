import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../../src/core/redact'

describe('redactSecrets', () => {
  it('redacts Meta Model API keys wherever they appear', () => {
    expect(redactSecrets('key=LLM|1234567890|abcDEF-123_xyz done')).toBe('key=[redacted] done')
  })

  it('redacts bearer tokens but keeps the scheme', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbGciOi.payload.sig')).toBe(
      'Authorization: Bearer [redacted]',
    )
  })

  it('redacts META_API_KEY and MODEL_API_KEY assignments', () => {
    expect(redactSecrets('env META_API_KEY=secret1 MODEL_API_KEY = secret2')).toBe(
      'env META_API_KEY=[redacted] MODEL_API_KEY = [redacted]',
    )
  })

  it('leaves ordinary text untouched', () => {
    const text = 'Activating Muse Spark 0.0.0 (VS Code 1.138.0, Node 24.20.0)'
    expect(redactSecrets(text)).toBe(text)
  })

  it('does not treat a lone LLM prefix as a key', () => {
    expect(redactSecrets('model LLM|notakey')).toBe('model LLM|notakey')
  })
})

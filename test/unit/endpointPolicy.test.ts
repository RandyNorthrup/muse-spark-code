// D119 catch burn-down: only an invalid URL reads as one. The URL
// constructor fails for real below; anything else keeps its kind.
import { describe, expect, it } from 'vitest'
import { checkEndpointUrl, originOf } from '../../src/core/providers/endpointPolicy'

describe('endpoint URL parse failures', () => {
  it('reads an invalid URL as no origin', () => {
    expect(originOf('not a url')).toBeUndefined()
  })

  it('refuses an invalid URL as invalid-url', () => {
    expect(checkEndpointUrl('not a url', [])).toEqual({ kind: 'refused', reason: 'invalid-url' })
  })

  it('still accepts a valid public endpoint', () => {
    expect(checkEndpointUrl('https://example.com', ['93.184.215.14'])).toEqual({
      kind: 'ok',
      origin: 'https://example.com',
      network: 'public',
    })
  })
})

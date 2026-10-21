import { describe, expect, it } from 'vitest'
import { resolveEndpointHost } from '../../src/runtime/providerPaths'

describe('resolveEndpointHost', () => {
  it('answers an IP literal without touching DNS', async () => {
    await expect(resolveEndpointHost('127.0.0.1')).resolves.toEqual(['127.0.0.1'])
  })

  it('answers nothing when the name cannot be resolved, so callers refuse it', async () => {
    // `.invalid` never resolves (RFC 2606): the real lookup fails and the
    // failure reads as no answers, which every consumer refuses with
    // `unresolved-address` instead of resolving an unverified name.
    await expect(resolveEndpointHost('no-such-host.invalid')).resolves.toEqual([])
  })
})

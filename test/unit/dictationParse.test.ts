import { describe, expect, it } from 'vitest'
import { parseHelperLine } from '../../src/core/voice/dictation'

describe('parseHelperLine', () => {
  it('reads a real protocol line', () => {
    expect(parseHelperLine('{"type":"listening"}')).toEqual({ type: 'listening' })
  })

  it('reads malformed bytes as absent, never as a half event', () => {
    expect(parseHelperLine('{"type":"text",')).toBeUndefined()
    expect(parseHelperLine('not json at all')).toBeUndefined()
  })
})

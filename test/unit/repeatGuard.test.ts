import { describe, expect, it } from 'vitest'
import { toolRepeatKey } from '../../src/core/backends/modelapi/repeatGuard'

describe('modelApi text-loop guard', () => {
  it('canonicalizes objects and arrays before keying repeat arguments', () => {
    const first = toolRepeatKey({
      name: 'read_file',
      arguments: '{"path":"a.txt","nested":{"x":1,"y":[1,2]}}',
    })
    const second = toolRepeatKey({
      name: 'read_file',
      arguments: '{"nested":{"y":[1,2],"x":1},"path":"a.txt"}',
    })
    expect(first).toBe(second)
  })

  it('keeps distinct arguments on distinct keys', () => {
    const first = toolRepeatKey({ name: 'read_file', arguments: '{"path":"a.txt"}' })
    const second = toolRepeatKey({ name: 'read_file', arguments: '{"path":"b.txt"}' })
    expect(first).not.toBe(second)
  })
})

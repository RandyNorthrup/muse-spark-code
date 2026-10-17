import { describe, expect, it } from 'vitest'
import { RepeatGuard, toolRepeatKey } from '../../src/core/backends/modelapi/repeatGuard'

const call = { name: 'read_file', arguments: '{"path":"a.txt","offset":1}' }
const reordered = { ...call, arguments: ' { "offset": 1, "path": "a.txt" } ' }

function twice(guard: RepeatGuard) {
  guard.observe(call, 'same bytes', 'fresh state')
  guard.observe(reordered, 'same bytes', 'fresh state')
}

describe('tool repeat guard', () => {
  it('skips the third unchanged call and stops the fourth without executing either', () => {
    const guard = new RepeatGuard()
    expect(guard.before(call, 'fresh state')).toBe('run')
    twice(guard)
    expect(guard.needsWitness(reordered)).toBe(true)
    expect(guard.before(reordered, 'fresh state')).toBe('skip')
    expect(guard.before(call, 'fresh state')).toBe('stuck')
  })

  it('canonicalizes nested objects, preserves array order and separates tool names', () => {
    expect(toolRepeatKey({ name: 'a', arguments: '{"z":{"b":2,"a":1},"arr":[1,2]}' })).toBe(
      toolRepeatKey({ name: 'a', arguments: '{"arr":[1,2],"z":{"a":1,"b":2}}' }),
    )
    expect(toolRepeatKey(call)).not.toBe(toolRepeatKey({ ...call, name: 'write_file' }))
    expect(toolRepeatKey({ name: 'a', arguments: '[1,2]' })).not.toBe(
      toolRepeatKey({ name: 'a', arguments: '[2,1]' }),
    )
    expect(toolRepeatKey({ name: 'a', arguments: 'bad json' })).not.toBe(
      toolRepeatKey({ name: 'a', arguments: 'other bad json' }),
    )
  })

  it('leaves invalid and deeply nested arguments on the tool validation path', () => {
    expect(toolRepeatKey({ name: 'a', arguments: 'bad json' })).not.toBe(
      toolRepeatKey({ name: 'a', arguments: '"bad json"' }),
    )
    const deeplyNested = '['.repeat(10_000) + '1' + ']'.repeat(10_000)
    expect(() => toolRepeatKey({ name: 'a', arguments: deeplyNested })).not.toThrow()
  })

  it('resets for a changed argument, result, intervening call or new turn', () => {
    const guard = new RepeatGuard()
    const changed = { ...call, arguments: '{"path":"b.txt"}' }
    twice(guard)
    expect(guard.before(changed, 'fresh state')).toBe('run')
    guard.observe(changed, 'same bytes', 'fresh state')
    expect(guard.before(call, 'fresh state')).toBe('run')
    twice(guard)
    guard.observe(call, 'different bytes', 'new state')
    expect(guard.needsWitness(call)).toBe(false)
    expect(guard.before(call, 'new state')).toBe('run')
    twice(guard)
    guard.reset()
    expect(guard.before(call, 'fresh state')).toBe('run')
  })

  it('never blocks a legitimate repeat with a changed or unprovable result', () => {
    for (const witness of ['new state', undefined]) {
      const guard = new RepeatGuard()
      twice(guard)
      expect(guard.before(call, witness)).toBe('run')
      expect(guard.needsWitness(call)).toBe(false)
    }
  })

  it('checks the fresh state again before stopping the fourth call', () => {
    const guard = new RepeatGuard()
    twice(guard)
    expect(guard.before(call, 'fresh state')).toBe('skip')
    expect(guard.before(call, 'changed after note')).toBe('run')
  })
})

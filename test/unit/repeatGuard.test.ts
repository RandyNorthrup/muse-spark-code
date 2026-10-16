import { describe, expect, it } from 'vitest'
import { RepeatGuard, toolRepeatKey } from '../../src/core/backends/modelapi/repeatGuard'

const call = { name: 'read_file', arguments: '{"path":"a.txt","offset":1}' }
const reordered = { ...call, arguments: ' { "offset": 1, "path": "a.txt" } ' }

function twice(guard: RepeatGuard) {
  guard.observe(call, 'same bytes', 'fresh state')
  guard.observe(reordered, 'same bytes', 'fresh state')
}

describe('tool repeat guard', () => {
  // Lane LIMITSA, D113 (A6): warn at 3, stop at 5.
  it('skips the third and fourth unchanged calls and stops the fifth without executing any', () => {
    const guard = new RepeatGuard()
    expect(guard.before(call, 'fresh state')).toBe('run')
    twice(guard)
    expect(guard.needsWitness(reordered)).toBe(true)
    expect(guard.before(reordered, 'fresh state')).toBe('skip')
    expect(guard.before(call, 'fresh state')).toBe('skip')
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

  it('never skips a call whose result cannot be proven unchanged, and never when it changed', () => {
    const changed = new RepeatGuard()
    twice(changed)
    expect(changed.before(call, 'new state')).toBe('run')
    expect(changed.needsWitness(call)).toBe(false)
    const unproven = new RepeatGuard()
    twice(unproven)
    expect(unproven.before(call, undefined)).toBe('run')
  })

  // Lane LIMITSFIX, F4 (D113): one policy for every tool class. A tool with no
  // witness (shell, search, list, MCP, goal, a failed call) runs every time,
  // and its own repeated result warns at 3 and stops at 5.
  it('warns at the third identical result and stops at the fifth for a tool with no witness', () => {
    const shell = { name: 'bash', arguments: '{"command":"npm test"}' }
    const guard = new RepeatGuard()
    const verdicts = Array.from({ length: 5 }, () =>
      guard.observe(shell, 'Error: failed', undefined),
    )
    expect(verdicts).toEqual(['ok', 'ok', 'warn', 'warn', 'stuck'])
    expect(guard.before(shell, undefined)).toBe('run')
  })

  it('never calls a poll with a changing result a repeat', () => {
    const poll = { name: 'bash', arguments: '{"command":"tail -n 1 build.log"}' }
    const guard = new RepeatGuard()
    const verdicts = Array.from({ length: 8 }, (_, index) =>
      guard.observe(poll, `line ${String(index)}`, undefined),
    )
    expect(new Set(verdicts)).toEqual(new Set(['ok']))
    guard.observe(poll, 'same', undefined)
    guard.observe(poll, 'same', undefined)
    expect(guard.observe(poll, 'changed at last', undefined)).toBe('ok')
    expect(guard.observe(poll, 'same', undefined)).toBe('ok')
  })

  it('counts only consecutive calls: an intervening different call starts over', () => {
    const search = { name: 'search', arguments: '{"pattern":"x"}' }
    const list = { name: 'list_files', arguments: '{}' }
    const guard = new RepeatGuard()
    guard.observe(search, 'none', undefined)
    guard.observe(search, 'none', undefined)
    guard.observe(list, 'a', undefined)
    expect(guard.observe(search, 'none', undefined)).toBe('ok')
  })

  it('checks the fresh state again before stopping the fifth call', () => {
    const guard = new RepeatGuard()
    twice(guard)
    expect(guard.before(call, 'fresh state')).toBe('skip')
    expect(guard.before(call, 'fresh state')).toBe('skip')
    expect(guard.before(call, 'changed after note')).toBe('run')
  })

  // D114 joined with D113: a reply continued past the output limit is the
  // call and the text it returned is its result, under the same policy.
  it('warns at the third identical continued text and stops at the fifth', () => {
    const guard = new RepeatGuard()
    const verdicts = Array.from({ length: 5 }, () =>
      guard.observeContinuation('The same paragraph again.'),
    )
    expect(verdicts).toEqual(['ok', 'ok', 'warn', 'warn', 'stuck'])
  })

  it('never calls changing continued text a repeat, and never mixes it with a tool call', () => {
    const guard = new RepeatGuard()
    const verdicts = Array.from({ length: 8 }, (_, index) =>
      guard.observeContinuation(`part ${String(index)} of the answer`),
    )
    expect(new Set(verdicts)).toEqual(new Set(['ok']))
    guard.observeContinuation('same')
    guard.observeContinuation('same')
    const lookalike = { name: 'output-continuation', arguments: '' }
    expect(guard.observe(lookalike, 'same', undefined)).toBe('ok')
    expect(guard.observeContinuation('same')).toBe('ok')
    guard.observeContinuation('same')
    guard.reset()
    expect(guard.observeContinuation('same')).toBe('ok')
  })
})

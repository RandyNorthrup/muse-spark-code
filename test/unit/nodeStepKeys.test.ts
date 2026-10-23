// M110r Y3: step keys bind the input; repeats get the recorded outcome, never a rerun.
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/shared/canonicalJson'
import { inputDigest, OutcomeTable, stepKey } from '../../src/core/devices/stepKeys'

const identity = { pair: 'p', task: 't', attempt: 'a', epoch: 3, step: 9 }

describe('step keys', () => {
  it('equal inputs digest equal whatever the key order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(
      canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }),
    )
    expect(inputDigest({ b: 1, a: 2 })).toBe(inputDigest({ a: 2, b: 1 }))
    expect(inputDigest({ a: 2 })).not.toBe(inputDigest({ a: 3 }))
  })
  it('non-JSON inputs refuse instead of colliding', () => {
    expect(() => inputDigest({ a: NaN })).toThrow('step input must be finite JSON values')
    expect(() => inputDigest([undefined])).toThrow('step input must not contain undefined')
  })
  it('the key names pair, task, attempt, epoch, step and the input digest', () => {
    const key = stepKey(identity, { path: 'x' })
    expect(key).toBe(`p/t/a/3/9/${inputDigest({ path: 'x' })}`)
    expect(stepKey(identity, { path: 'y' })).not.toBe(key)
    expect(stepKey({ ...identity, epoch: 4 }, { path: 'x' })).not.toBe(key)
    expect(stepKey({ ...identity, step: 10 }, { path: 'x' })).not.toBe(key)
  })
})

describe('outcome table', () => {
  it('a repeat gets the first record, and acks prune the tail', () => {
    const table = new OutcomeTable()
    const key = stepKey(identity, { path: 'x' })
    expect(table.lookup(key)).toBeUndefined()
    table.record({ key, task: 't', step: 9, outcome: 'wrote 3 lines' })
    table.record({ key, task: 't', step: 9, outcome: 'second write' })
    expect(table.lookup(key)?.outcome).toBe('wrote 3 lines')
    expect(table.size()).toBe(1)
    table.pruneAcknowledged('t', 8)
    expect(table.size()).toBe(1)
    table.pruneAcknowledged('t', 9)
    expect(table.size()).toBe(0)
    table.record({ key, task: 't', step: 9, outcome: 'wrote 3 lines' })
    table.pruneAcknowledged('other-task', 99)
    expect(table.size()).toBe(1)
  })
})

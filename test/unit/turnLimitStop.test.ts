import { describe, expect, it } from 'vitest'
import { repairAfterFailedSummary } from '../../src/core/backends/modelapi/turnLimitStop'
import type { InputItem } from '../../src/core/backends/modelapi/schemas'

// Lane LIMITSFIX, F5 (D113): a person-set limit whose summary request fails
// still ends cleanly, so the stored replay must be as valid as before the
// summary was asked: no summary instruction left behind, and no function call
// without its output (a provider answers that with a 400 on the next message).
interface Entry {
  readonly item: InputItem
}
const user = (text: string): Entry => ({
  item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
})
const call = (id: string): Entry => ({
  item: { type: 'function_call', call_id: id, name: 'bash', arguments: '{}' },
})
const output = (id: string): Entry => ({
  item: { type: 'function_call_output', call_id: id, output: 'ok' },
})
const answered = (id: string): Entry => ({
  item: { type: 'function_call_output', call_id: id, output: 'Error: stopped' },
})

describe('replay after a failed turn-limit summary', () => {
  it('removes the summary instruction and leaves the earlier conversation byte for byte', () => {
    const instruction = user('summarise')
    const before = [user('first'), call('a'), output('a')]
    const after = repairAfterFailedSummary([...before, instruction], instruction, (id) =>
      answered(id),
    )
    expect(after).toEqual(before)
    expect(after).not.toContain(instruction)
  })

  it('answers a call the half-finished summary reply left without an output', () => {
    const instruction = user('summarise')
    const stray = call('stray')
    const after = repairAfterFailedSummary([user('first'), instruction, stray], instruction, (id) =>
      answered(id),
    )
    const ids = (type: string) =>
      after.flatMap((entry) =>
        entry.item.type === type && 'call_id' in entry.item ? [entry.item.call_id] : [],
      )
    expect(ids('function_call')).toEqual(['stray'])
    expect(ids('function_call_output')).toEqual(['stray'])
    expect(after).not.toContain(instruction)
  })

  it('does not answer a call that already has its output', () => {
    const instruction = user('summarise')
    const after = repairAfterFailedSummary(
      [instruction, call('done'), output('done')],
      instruction,
      (id) => answered(id),
    )
    expect(after.filter((entry) => entry.item.type === 'function_call_output')).toHaveLength(1)
  })

  it('leaves the replay as it is when the instruction was never added', () => {
    const replay = [user('first'), call('a'), output('a')]
    expect(repairAfterFailedSummary(replay, user('summarise'), (id) => answered(id))).toEqual(
      replay,
    )
  })
})

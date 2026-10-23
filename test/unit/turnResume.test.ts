// M110r Y1: resume from the last consistent point of a cut stream.
import { describe, expect, it } from 'vitest'
import { resumeFromCut } from '../../src/core/backends/modelapi/resume'
import {
  outputItemSchema,
  type InputItem,
  type OutputItem,
} from '../../src/core/backends/modelapi/schemas'

function streamed(items: readonly unknown[]): OutputItem[] {
  return items.map((item) => outputItemSchema.parse(item))
}

const carried: InputItem[] = [
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go' }] },
]

describe('resumeFromCut', () => {
  it('keeps a fully confirmed stream whole', () => {
    const items = streamed([
      {
        type: 'message',
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hi' }],
      },
      { type: 'function_call', id: 'f1', call_id: 'c1', name: 'read', arguments: '{"p":1}' },
    ])
    const cut = resumeFromCut(carried, items, {
      completedIds: new Set(['m1', 'f1']),
      ranCallIds: new Set(),
    })
    expect(cut.history).toHaveLength(3)
    expect(cut.droppedTexts).toBe(0)
    expect(cut.droppedCalls).toEqual([])
  })
  it('discards trailing unconfirmed text and never shows it as final', () => {
    const items = streamed([
      {
        type: 'message',
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
      },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'half wri' }] },
    ])
    const cut = resumeFromCut(carried, items, {
      completedIds: new Set(['m1']),
      ranCallIds: new Set(),
    })
    expect(cut.history).toHaveLength(2)
    expect(JSON.stringify(cut.history)).not.toContain('half wri')
    expect(cut.droppedTexts).toBe(1)
  })
  it('never runs a tool call whose arguments arrived only in part', () => {
    const items = streamed([
      {
        type: 'message',
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'x' }],
      },
      { type: 'function_call', id: 'f1', call_id: 'c1', name: 'write', arguments: '{"p":' },
    ])
    const cut = resumeFromCut(carried, items, {
      completedIds: new Set(['m1', 'f1']),
      ranCallIds: new Set(),
    })
    expect(cut.history).toHaveLength(2)
    expect(cut.droppedCalls).toEqual(['c1'])
  })
  it('keeps a ran call and truncates at the first unconfirmed one after it', () => {
    const items = streamed([
      { type: 'function_call', id: 'f1', call_id: 'c1', name: 'read', arguments: '{}' },
      { type: 'function_call', id: 'f2', call_id: 'c2', name: 'write', arguments: '{}' },
      {
        type: 'message',
        id: 'm9',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'tail' }],
      },
    ])
    const cut = resumeFromCut(carried, items, {
      completedIds: new Set(['f1']),
      ranCallIds: new Set(['c1']),
    })
    expect(cut.history).toHaveLength(2)
    expect(cut.droppedCalls).toEqual(['c2'])
    expect(cut.droppedTexts).toBe(1)
  })
  it('replays a confirmed message as assistant input with its parts intact', () => {
    const items = streamed([
      {
        type: 'message',
        id: 'm1',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'a' },
          { type: 'refusal', refusal: 'no' },
        ],
      },
    ])
    const cut = resumeFromCut(carried, items, {
      completedIds: new Set(['m1']),
      ranCallIds: new Set(),
    })
    expect(cut.history[1]).toEqual({
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'output_text', text: 'a' },
        { type: 'input_text', text: 'no' },
      ],
    })
  })
  it('replays reasoning and confirmed searches, never unknown items', () => {
    const items = streamed([
      { type: 'reasoning', summary: [{ type: 's', text: 't' }] },
      { type: 'web_search_call', id: 'w1', action: { type: 'search', query: 'q' } },
      { type: 'future_thing', id: 'x1' },
    ])
    const cut = resumeFromCut(carried, items, {
      completedIds: new Set(['w1']),
      ranCallIds: new Set(),
    })
    expect(cut.history.map((item) => item.type)).toEqual([
      'message',
      'reasoning',
      'web_search_call',
    ])
  })
})

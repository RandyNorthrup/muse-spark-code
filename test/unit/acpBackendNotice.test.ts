import { describe, expect, it } from 'vitest'
import { UpdateTranslator } from '../../src/acp/translate'

// A status of the product is never model text where the client can show
// notices: backend notices travel on the protocol's own notice channel.
// The pinned SDK's v1 schema (the one the agent speaks, PROTOCOL_VERSION 1)
// allows a notice only when the client advertised `session.notices`;
// otherwise the SDK sanctions an agent message so the person still reads it.
describe('UpdateTranslator backendNotice', () => {
  it('sends a notice update, not an agent message, when the client advertised notices', () => {
    const translator = new UpdateTranslator('/work/acp-notice', false, 'museCode', true)
    const updates = translator.updates({
      type: 'backendNotice',
      level: 'info',
      text: 'Automatic compaction is awaiting evaluation and is inactive.',
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      sessionUpdate: 'notice',
      severity: 'info',
      title: 'Automatic compaction is awaiting evaluation and is inactive.',
    })
  })

  it('keeps warning severity on the notice', () => {
    const translator = new UpdateTranslator('/work/acp-notice', false, 'museCode', true)
    const updates = translator.updates({
      type: 'backendNotice',
      level: 'warning',
      text: 'Automatic compaction failed; continuing with the original context.',
    })
    expect(updates[0]).toMatchObject({ sessionUpdate: 'notice', severity: 'warning' })
  })

  it('drops an empty notice instead of sending blank model text', () => {
    const translator = new UpdateTranslator('/work/acp-notice', false, 'museCode', true)
    expect(translator.updates({ type: 'backendNotice', level: 'info', text: '' })).toEqual([])
    expect(translator.updates({ type: 'backendNotice', level: 'info', text: '  ' })).toEqual([])
  })

  it('surfaces the notice as an agent message when the client did not advertise notices', () => {
    const translator = new UpdateTranslator('/work/acp-notice', false)
    const [chunk] = translator.updates({
      type: 'backendNotice',
      level: 'warning',
      text: 'Automatic compaction failed; continuing with the original context.',
    })
    expect(chunk?.sessionUpdate).toBe('agent_message_chunk')
    if (chunk?.sessionUpdate !== 'agent_message_chunk') throw new Error('no fallback chunk')
    expect(chunk.content).toEqual({
      type: 'text',
      text: 'Automatic compaction failed; continuing with the original context.\n\n',
    })
    // RLF-ACPTURNS F1: the one-shot notice carries its own message id,
    // so the client starts a new message instead of running on.
    expect(typeof chunk.messageId).toBe('string')
  })
})

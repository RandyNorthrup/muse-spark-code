import { describe, expect, it } from 'vitest'
import { UpdateTranslator } from '../../src/acp/translate'

// A status of the product is never model text: backend notices travel on
// the protocol's own notice channel, never as an agent message.
describe('UpdateTranslator backendNotice', () => {
  it('sends a notice update, not an agent message', () => {
    const translator = new UpdateTranslator('/tmp/acp-notice', false)
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
    const translator = new UpdateTranslator('/tmp/acp-notice', false)
    const updates = translator.updates({
      type: 'backendNotice',
      level: 'warning',
      text: 'Automatic compaction failed; continuing with the original context.',
    })
    expect(updates[0]).toMatchObject({ sessionUpdate: 'notice', severity: 'warning' })
  })

  it('drops an empty notice instead of sending blank model text', () => {
    const translator = new UpdateTranslator('/tmp/acp-notice', false)
    expect(translator.updates({ type: 'backendNotice', level: 'info', text: '' })).toEqual([])
  })
})

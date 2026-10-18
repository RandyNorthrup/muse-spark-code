import { describe, expect, it } from 'vitest'
import { acpResourceUpdates } from '../../src/acp/resources'
import type { RuntimeResourceNotice } from '../../src/runtime/resources/port'

// F82's class, found in review: a resource-governor status is the app's own
// words. Where the client advertised `session.notices` it goes out as its
// own `notice` update, never as an agent message chunk; clients without
// notices keep the protocol's agent-message fallback.
const status = {
  level: 'pause',
  sample: null,
  settings: {},
  queued: [],
  overrideUntilMs: null,
} as unknown as RuntimeResourceNotice['status']

const pause: RuntimeResourceNotice = {
  event: { type: 'levelChanged', atMs: 1, from: 'normal', to: 'pause', reason: 'cpu' },
  status,
  text: 'Paused: the machine is busy.',
}

describe('acpResourceUpdates', () => {
  it('sends a governor pause as a notice where the client can show one', () => {
    const updates = acpResourceUpdates(pause, true)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      sessionUpdate: 'notice',
      severity: 'warning',
      title: 'Paused: the machine is busy.',
    })
  })

  it('keeps the agent-message fallback for clients without notices', () => {
    const updates = acpResourceUpdates(pause, false)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Paused: the machine is busy.' },
    })
    expect(acpResourceUpdates(pause)).toEqual(updates)
  })

  it('keeps a deferred tool call on its tool update either way', () => {
    const deferred: RuntimeResourceNotice = {
      event: { type: 'deferred', atMs: 1, kind: 'toolShell', class: 'foreground' },
      status,
      text: 'Waiting for room.',
      toolCallId: 'call-1',
    }
    for (const areNoticesSupported of [true, false]) {
      expect(acpResourceUpdates(deferred, areNoticesSupported)[0]).toMatchObject({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
      })
    }
  })
})

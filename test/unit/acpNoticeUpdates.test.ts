import { describe, expect, it } from 'vitest'
import { accountNoticeUpdate, sandboxCannotStartUpdate } from '../../src/acp/agent'
import { accountEventSchema } from '../../src/shared/accounts'
import { UI_TEXT } from '../../src/shared/constants'

// RLF-ACPTURNS F1: one-shot product notices go out as their own message.
// Where the client shows notices, the update is a `notice`; otherwise the
// agent-message fallback carries its own id, so the client starts a new
// message instead of folding the notice into the model's answer.

const swap = accountEventSchema.parse({
  provider: 'meta',
  account: 'work',
  time: '2026-10-22T00:00:00.000Z',
  type: 'swap',
  previousAccount: 'personal',
  trigger: {
    kind: 'vendorLimit',
    reason: 'rateLimited',
    resetAt: '2026-10-22T01:00:00.000Z',
  },
  coldCacheUsd: '0',
})

const stop = accountEventSchema.parse({
  provider: 'meta',
  account: 'work',
  time: '2026-10-22T00:00:00.000Z',
  type: 'stop',
  trigger: {
    kind: 'vendorLimit',
    reason: 'quota',
    resetAt: null,
  },
})

function fallbackId(update: unknown): unknown {
  return typeof update === 'object' &&
    update !== null &&
    'sessionUpdate' in update &&
    update.sessionUpdate === 'agent_message_chunk' &&
    'messageId' in update
    ? update.messageId
    : undefined
}

describe('one-shot product notices', () => {
  it('sends an account notice as a notice where the client can show one', () => {
    expect(accountNoticeUpdate('Swapped.', swap, true)).toEqual({
      sessionUpdate: 'notice',
      severity: 'info',
      title: 'Swapped.',
      _meta: { accountNotice: swap },
    })
    expect(accountNoticeUpdate('Stopped.', stop, true)).toEqual({
      sessionUpdate: 'notice',
      severity: 'warning',
      title: 'Stopped.',
      _meta: { accountNotice: stop },
    })
  })

  it('sends an account notice as its own message otherwise', () => {
    const first = accountNoticeUpdate('Swapped.', swap, false)
    expect(first).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      _meta: { accountNotice: swap },
      content: { type: 'text', text: 'Swapped.' },
    })
    const firstId = fallbackId(first)
    expect(typeof firstId).toBe('string')
    const secondId = fallbackId(accountNoticeUpdate('Stopped.', stop, false))
    expect(typeof secondId).toBe('string')
    expect(secondId).not.toBe(firstId)
  })

  it('sends the sandbox note as a notice where the client can show one', () => {
    expect(sandboxCannotStartUpdate(true)).toEqual({
      sessionUpdate: 'notice',
      severity: 'warning',
      title: UI_TEXT.sandboxCannotStartNotice,
      _meta: { sandboxCannotStartNotice: true },
    })
  })

  it('sends the sandbox note as its own message otherwise', () => {
    const first = sandboxCannotStartUpdate(false)
    expect(first).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      _meta: { sandboxCannotStartNotice: true },
      content: { type: 'text', text: UI_TEXT.sandboxCannotStartNotice },
    })
    const firstId = fallbackId(first)
    expect(typeof firstId).toBe('string')
    expect(fallbackId(sandboxCannotStartUpdate(false))).not.toBe(firstId)
  })
})

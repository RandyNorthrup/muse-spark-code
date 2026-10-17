import { describe, expect, it } from 'vitest'
import { buildChatShare, renderChatShare } from '../../src/core/sharing/chatShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import { SESSION_EXPORT_MAX_BYTES, SESSION_EXPORT_MAX_ITEMS } from '../../src/shared/constants'

const privacy = createChatSharePrivacy({
  workspaceRoots: [],
  home: '',
  userName: '',
  redactRegisteredSecrets: (text) => text,
})
const source = {
  sessionId: 's1',
  title: 'Range',
  exportedAt: '2026-10-05T12:00:00Z',
  items: [
    { itemId: 'u1', kind: 'userMessage', status: 'completed', text: 'First' },
    { itemId: 't', kind: 'toolCall', status: 'completed', visibleOutput: 'Output' },
    { itemId: 'a1', kind: 'agentMessage', status: 'completed', text: 'Second' },
    { itemId: 'u2', kind: 'userMessage', status: 'completed', text: 'Last' },
  ],
}
const request = {
  target: 'chat',
  sessionId: 's1',
  mode: 'full',
  format: 'json',
  destination: 'copy',
}

describe('M118 ranges and limits', () => {
  it('selects inclusive message endpoints in original order, then applies the mode', () => {
    const range = { from: 'u1', to: 'a1' }
    expect(
      buildChatShare(source, { ...request, range }, privacy).items.map((item) => item.id),
    ).toEqual(['u1', 't', 'a1'])
    expect(
      buildChatShare(source, { ...request, mode: 'conversation', range }, privacy).items.map(
        (item) => item.id,
      ),
    ).toEqual(['u1', 'a1'])
    expect(
      buildChatShare(source, { ...request, range: { from: 'a1', to: 'a1' } }, privacy).items.map(
        (item) => item.id,
      ),
    ).toEqual(['a1'])
    expect(buildChatShare(source, request, privacy).items).toHaveLength(4)
  })
  it('refuses missing, reversed, activity, foreign-session and ambiguous endpoints', () => {
    for (const range of [
      { from: 'missing', to: 'a1' },
      { from: 'a1', to: 'missing' },
      { from: 'a1', to: 'u1' },
      { from: 't', to: 'a1' },
      { from: 'u1', to: 't' },
    ])
      expect(() => buildChatShare(source, { ...request, range }, privacy)).toThrow('ordered range')
    expect(() => buildChatShare(source, { ...request, sessionId: 'other' }, privacy)).toThrow(
      'ordered range',
    )
    expect(() =>
      buildChatShare({ ...source, items: [...source.items, source.items[0]!] }, request, privacy),
    ).toThrow('ordered range')
  })
  it('refuses a prompt target on the chat-only entry', () => {
    expect(() =>
      buildChatShare(
        source,
        {
          target: 'prompt',
          source: { kind: 'composer' },
          mode: 'full',
          format: 'json',
          destination: 'copy',
        },
        privacy,
      ),
    ).toThrow()
  })
  it('refuses empty history, too many items and output past the UTF-8 byte cap', () => {
    expect(() => buildChatShare({ ...source, items: [] }, request, privacy)).toThrow(
      'no conversation',
    )
    expect(() =>
      buildChatShare(
        {
          ...source,
          items: Array.from({ length: SESSION_EXPORT_MAX_ITEMS + 1 }, (_, index) => ({
            ...source.items[0]!,
            itemId: String(index),
          })),
        },
        request,
        privacy,
      ),
    ).toThrow('limit')
    const huge = buildChatShare(
      {
        ...source,
        items: [{ ...source.items[0]!, text: 'é'.repeat(SESSION_EXPORT_MAX_BYTES / 2) }],
      },
      request,
      privacy,
    )
    expect(() => renderChatShare(huge, 'json')).toThrow('limit')
  })
})

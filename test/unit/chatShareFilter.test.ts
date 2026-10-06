import { describe, expect, it } from 'vitest'
import { buildChatShare } from '../../src/core/sharing/chatShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import type { ItemSnapshot } from '../../src/shared/agentEvents'
import { snapshotKindFixtures } from './helpers/sharingFixtures'

const privacy = createChatSharePrivacy({
  workspaceRoots: [],
  home: '',
  userName: '',
  redactRegisteredSecrets: (text) => text,
})
const source = {
  sessionId: 's1',
  title: 'Review',
  exportedAt: '2026-10-05T12:00:00Z',
  items: snapshotKindFixtures,
}
function share(
  mode: 'full' | 'conversation',
  items: readonly ItemSnapshot[] = source.items,
  options = {},
) {
  return buildChatShare(
    { ...source, items },
    { target: 'chat', sessionId: 's1', mode, format: 'json', destination: 'copy', options },
    privacy,
  )
}

describe('M118 portable mode projection', () => {
  it('keeps every snapshot kind in full and exactly the two named human kinds in conversation', () => {
    expect(share('full').items.map((item) => item.kind)).toEqual(
      snapshotKindFixtures.map((item) => item.kind),
    )
    expect(share('conversation').items.map((item) => item.kind)).toEqual([
      'userMessage',
      'agentMessage',
    ])
    for (const item of snapshotKindFixtures) {
      expect(share('full', [item]).items[0]?.kind).toBe(item.kind)
      if (item.kind === 'userMessage' || item.kind === 'agentMessage')
        expect(share('conversation', [item]).items[0]?.text).toBe(item.text)
      else expect(() => share('conversation', [item])).toThrow('There is no conversation')
    }
  })
  it('defaults a new unknown kind to excluded, without touching the filter', () => {
    const future = {
      itemId: 'new',
      kind: 'newKindAfterRelease',
      status: 'completed',
      text: 'Internal data',
    }
    expect(share('full', [...source.items, future]).items.at(-1)?.kind).toBe(future.kind)
    expect(
      share('conversation', [...source.items, future]).items.some((item) => item.id === 'new'),
    ).toBe(false)
  })
  it('projects explicit text fields and never copies activity or live handles into messages', () => {
    const item = {
      itemId: 'u',
      kind: 'userMessage',
      status: 'completed',
      text: 'As the tool said.',
      tool: 'tool',
      args: 'args',
      visibleOutput: 'output',
      outputRef: { id: 'output-handle', byteLen: 1 },
      patchRef: { id: 'patch-handle', byteLen: 1 },
      children: [{ text: 'child' }],
      modelVisibleContent: [{ text: 'replay' }],
    }
    expect(share('conversation', [item]).items).toEqual([
      { id: 'u', kind: 'userMessage', text: 'As the tool said.' },
    ])
    const full = share('full', [item]).items[0]
    expect(full).toMatchObject({ tool: 'tool', args: 'args', output: 'output' })
    expect(JSON.stringify(full)).not.toMatch(/handle|children|replay/)
  })
  it('removes fenced, tilde, indented and nested code blocks while keeping inline code and prose byte-exact', () => {
    const text =
      'before `inline`\n\n```ts\nsecret fenced\n```\n\n~~~\nsecret tilde\n~~~\n\n    secret indented\n\n> ```\n> secret nested\n> ```\n\nafter'
    expect(
      share('conversation', [{ itemId: 'u', kind: 'userMessage', status: 'completed', text }])
        .items[0]?.text,
    ).toBe(text)
    const clean = share(
      'conversation',
      [{ itemId: 'u', kind: 'userMessage', status: 'completed', text }],
      { codeBlocks: false },
    ).items[0]?.text
    expect(clean).toContain('before `inline`')
    expect(clean).toContain('after')
    expect(clean).not.toContain('secret')
  })
  it('honours diffs only in full mode and only when selected', () => {
    const items = [
      { itemId: 'd', kind: 'diff', status: 'completed', text: 'private diff' },
      ...source.items,
    ]
    expect(JSON.stringify(share('full', items))).not.toContain('private diff')
    expect(share('full', items, { diffs: true }).items[0]?.diff).toBe('private diff')
    expect(JSON.stringify(share('conversation', items, { diffs: true }))).not.toContain(
      'private diff',
    )
  })
  it('includes shown decisions in full mode through the display port and scrubs them', () => {
    const shown = {
      ...source,
      decisions: new Map([['u1', 'Allow fake@example.com']]),
    }
    const request = {
      target: 'chat',
      sessionId: 's1',
      mode: 'full',
      format: 'json',
      destination: 'copy',
    }
    expect(buildChatShare(shown, request, privacy).items[0]?.decision).toBe(
      'Allow [redacted account]',
    )
    expect(
      buildChatShare(shown, { ...request, mode: 'conversation' }, privacy).items[0]?.decision,
    ).toBeUndefined()
  })
  it('retains metadata-only history attachments when no stored content matches the message', () => {
    const attached = {
      ...source,
      items: [
        {
          itemId: 'u1',
          kind: 'userMessage',
          status: 'completed',
          text: 'Read the attachment',
          attachments: [{ type: 'file', mediaType: 'text/plain', name: 'history.txt' }],
        },
      ],
      attachments: [],
    }
    expect(
      buildChatShare(
        attached,
        {
          target: 'chat',
          sessionId: 's1',
          mode: 'conversation',
          format: 'json',
          destination: 'copy',
        },
        privacy,
      ).items[0]?.attachments,
    ).toEqual([{ id: 'u1:attachment:0', name: 'history.txt' }])
  })
  it('leaves attachment contents out even in full, with names controlled independently', () => {
    const attached = {
      ...source,
      attachments: [
        { messageId: 'u1', id: 'file', name: 'notes.txt', content: 'selected content' },
      ],
    }
    const request = {
      target: 'chat',
      sessionId: 's1',
      mode: 'full',
      format: 'json',
      destination: 'copy',
    }
    expect(buildChatShare(attached, request, privacy).items[0]?.attachments).toEqual([
      { id: 'file', name: 'notes.txt' },
    ])
    expect(
      buildChatShare(
        attached,
        { ...request, options: { attachmentNames: false, attachmentContents: ['file'] } },
        privacy,
      ).items[0]?.attachments,
    ).toEqual([{ id: 'file', content: 'selected content' }])
    expect(() =>
      buildChatShare(
        attached,
        { ...request, options: { attachmentContents: ['missing'] } },
        privacy,
      ),
    ).toThrow('unavailable')
    expect(() =>
      buildChatShare(
        { ...attached, attachments: [{ messageId: 'u1', id: 'file' }] },
        { ...request, options: { attachmentContents: ['file'] } },
        privacy,
      ),
    ).toThrow('unavailable')
  })
})

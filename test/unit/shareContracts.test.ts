import { describe, expect, it } from 'vitest'
import { isConversationShareItem, itemSnapshotSchema } from '../../src/shared/agentEvents'
import {
  admitShareRelease,
  confirmedShareSchema,
  scrubShareText,
  shareJsonSchema,
  shareRequestSchema,
  type ShareJson,
  type ShareRequest,
} from '../../src/shared/share'
import {
  isConversationShareEntry,
  transcriptEntrySchema,
} from '../../src/webview/state/transcriptEntries'
import { PROMPT_COMMAND_IDS, SHARE_DESTINATIONS } from '../../src/shared/constants'
import {
  savedPromptFixture,
  shareChatFixture,
  snapshotKindFixtures,
  transcriptKindFixtures,
} from './helpers/sharingFixtures'

describe('conversation-only default-deny contract', () => {
  it('allows only human/assistant messages across every current webview kind', () => {
    const entries = Object.values(transcriptKindFixtures).map((v) => transcriptEntrySchema.parse(v))
    expect(entries.filter(isConversationShareEntry).map((v) => v.kind)).toEqual([
      'user',
      'assistant',
    ])
    expect(isConversationShareEntry({ kind: 'dummyAddedLater' })).toBe(false)
    expect(entries.filter(isConversationShareEntry).map((v) => v.id)).toEqual(['u1', 'a1'])
  })
  it('excludes all internal/history kinds and a newly added dummy kind', () => {
    const items = snapshotKindFixtures.map((v) => itemSnapshotSchema.parse(v))
    expect(items.filter(isConversationShareItem).map((v) => v.kind)).toEqual([
      'userMessage',
      'agentMessage',
    ])
    expect(isConversationShareItem({ kind: 'dummyAddedLater' })).toBe(false)
  })
})

describe('share boundaries', () => {
  const request = {
    target: 'chat',
    sessionId: 's1',
    mode: 'conversation',
    format: 'md',
    destination: 'copy',
  }
  it('defaults to code and attachment names on, diffs and contents off', () => {
    const parsed: ShareRequest = shareRequestSchema.parse(request)
    expect(parsed.options).toEqual({
      codeBlocks: true,
      attachmentNames: true,
      diffs: false,
      attachmentContents: [],
    })
    expect(PROMPT_COMMAND_IDS.shareChat).toBe('museSpark.shareChat')
    expect(PROMPT_COMMAND_IDS.sharePrompt).toBe('museSpark.sharePrompt')
  })
  it.each(['copy', 'file', 'browser'])(
    'accepts phase-one destination %s only after the final button',
    (destination) => {
      const confirmed = {
        step: 'confirmed',
        previewId: 'preview-1',
        request: { ...request, destination, range: { from: 'u1', to: 'a1' } },
      }
      expect(admitShareRelease(confirmed, () => false).request.destination).toBe(destination)
      expect(confirmedShareSchema.safeParse({ ...confirmed, step: 'preview' }).success).toBe(false)
      expect(confirmedShareSchema.safeParse({ ...confirmed, previewId: '' }).success).toBe(false)
      expect(() => admitShareRelease(confirmed, () => true)).toThrow('confidential')
    },
  )
  it.each(SHARE_DESTINATIONS.filter((d) => !['copy', 'file', 'browser'].includes(d)))(
    'reserves %s without permitting release',
    (destination) => {
      const pending = { ...request, destination }
      expect(shareRequestSchema.safeParse(pending).success).toBe(true)
      expect(() =>
        admitShareRelease({ step: 'confirmed', previewId: 'p', request: pending }, () => false),
      ).toThrow()
    },
  )
  it('rechecks confidentiality after preview and propagates unavailable policy', () => {
    const confirmed = { step: 'confirmed', previewId: 'p', request }
    let isConfidential = false
    expect(admitShareRelease(confirmed, () => isConfidential).step).toBe('confirmed')
    isConfidential = true
    expect(() => admitShareRelease(confirmed, () => isConfidential)).toThrow()
    expect(() => admitShareRelease(confirmed, () => undefined)).toThrow()
    expect(() =>
      admitShareRelease(confirmed, () => {
        throw new Error('policy unavailable')
      }),
    ).toThrow('policy unavailable')
  })
  it.each([
    { target: 'other' },
    { destination: 'network' },
    { format: 'pdf' },
    { mode: 'excludeTools' },
    { range: { from: '', to: 'a1' } },
    { options: { diff: true } },
    { confirmed: true },
  ])('rejects unsupported requests %j', (patch) => {
    expect(shareRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false)
  })
  it.each([
    { kind: 'saved', promptId: 'p', scope: 'user' },
    { kind: 'message', sessionId: 's', messageId: 'u' },
    { kind: 'composer' },
    { kind: 'editorSelection' },
  ])('accepts a prompt source %j', (source) => {
    expect(
      shareRequestSchema.safeParse({ ...request, target: 'prompt', sessionId: undefined, source })
        .success,
    ).toBe(false)
    const { sessionId: _sessionId, ...fields } = request
    expect(shareRequestSchema.safeParse({ ...fields, target: 'prompt', source }).success).toBe(true)
  })
  it('round trips versioned chat and prompt share JSON', () => {
    const chat: ShareJson = shareJsonSchema.parse(shareChatFixture)
    const prompt = { ...chat, target: 'prompt', items: undefined, prompt: savedPromptFixture }
    expect(shareJsonSchema.safeParse(prompt).success).toBe(false)
    const { items: _items, ...header } = shareChatFixture
    for (const doc of [chat, { ...header, target: 'prompt', prompt: savedPromptFixture }]) {
      const encoded = JSON.stringify(doc)
      const decoded: unknown = JSON.parse(encoded)
      expect(shareJsonSchema.parse(decoded)).toEqual(doc)
    }
    expect(shareJsonSchema.safeParse({ ...chat, schemaVersion: 2 }).success).toBe(false)
    expect(shareJsonSchema.safeParse({ ...chat, scrubbed: false }).success).toBe(false)
  })
  it.each([
    'toolCall',
    'command',
    'approval',
    'diff',
    'checkpoint',
    'notice',
    'reasoning',
    'system',
    'dummyAddedLater',
  ])('refuses %s in conversation-only JSON', (kind) => {
    expect(
      shareJsonSchema.safeParse({ ...shareChatFixture, items: [{ id: 'x', kind }] }).success,
    ).toBe(false)
  })
  it.each(['tool', 'args', 'output', 'command', 'decision', 'diff', 'reasoning'])(
    'excludes activity field %s even on an allowed message',
    (field) => {
      expect(
        shareJsonSchema.safeParse({
          ...shareChatFixture,
          items: [{ id: 'u', kind: 'userMessage', [field]: 'private' }],
        }).success,
      ).toBe(false)
    },
  )
  it('requires explicit attachment content/diff selection even in full mode', () => {
    const item = {
      id: 't',
      kind: 'toolCall',
      output: 'Result',
      diff: '+line',
      attachments: [{ id: 'attach1', name: 'notes.txt', content: 'private contents' }],
    }
    const full = { ...shareChatFixture, mode: 'full', items: [item] }
    expect(shareJsonSchema.safeParse(full).success).toBe(false)
    const chosen = {
      ...full,
      options: { ...full.options, diffs: true, attachmentContents: ['attach1'] },
    }
    expect(shareJsonSchema.safeParse(chosen).success).toBe(true)
    expect(
      shareJsonSchema.safeParse({
        ...chosen,
        options: { ...chosen.options, attachmentContents: ['another'] },
      }).success,
    ).toBe(false)
    expect(
      shareJsonSchema.safeParse({
        ...chosen,
        options: { ...chosen.options, attachmentNames: false },
      }).success,
    ).toBe(false)
    expect(
      shareJsonSchema.safeParse({
        ...chosen,
        items: [{ ...item, outputRef: { id: 'ref', byteLen: 1 } }],
      }).success,
    ).toBe(false)
  })
  it('independently refuses diffs unless selected in full mode', () => {
    const full = {
      ...shareChatFixture,
      mode: 'full',
      items: [{ id: 't', kind: 'toolCall', diff: '+line' }],
    }
    expect(shareJsonSchema.safeParse(full).success).toBe(false)
    expect(
      shareJsonSchema.safeParse({ ...full, options: { ...full.options, diffs: true } }).success,
    ).toBe(true)
  })
  it('composes registered-secret, existing redaction and host path normalisation', () => {
    const calls: string[] = []
    const scrubbed = scrubShareText(
      'private-value Bearer synthetic-value /workspace/src/main.ts /home/example/file',
      {
        redactRegisteredSecrets: (text) => {
          calls.push('registered')
          return text.replaceAll('private-value', '[redacted]')
        },
        normalisePaths: (text) => {
          calls.push('paths')
          return text.replaceAll('/workspace/', '').replaceAll('/home/example', '[home]')
        },
      },
    )
    expect(scrubbed).toBe('[redacted] Bearer [redacted] src/main.ts [home]/file')
    expect(calls).toEqual(['registered', 'paths'])
  })
})

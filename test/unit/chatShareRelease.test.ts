import { describe, expect, it, vi } from 'vitest'
import {
  ChatShareRelease,
  parseChatSharePreview,
  type ChatSharePreview,
  type ChatShareReleasePort,
} from '../../src/core/sharing/shareRelease'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import {
  previewConversationShare,
  type ConversationSharing,
} from '../../src/host/conversation/exportConversation'
import type { SessionHistoryOutcome } from '../../src/core/agent/agentBackend'
import { shareRequestSchema } from '../../src/shared/share'

const source = {
  sessionId: 's1',
  title: 'Share',
  exportedAt: '2026-10-05T12:00:00Z',
  items: [{ itemId: 'u1', kind: 'userMessage', status: 'completed', text: 'User text' }],
}
const request = shareRequestSchema.parse({
  target: 'chat',
  sessionId: 's1',
  mode: 'conversation',
  format: 'md',
  destination: 'copy',
})
function harness() {
  let confidential: boolean | undefined = false
  let serial = 0
  const written: string[] = []
  const sink = vi.fn((preview: ChatSharePreview) => {
    written.push(preview.content)
    return Promise.resolve()
  })
  const prepare = vi.fn<ChatShareReleasePort['prepare']>((preview: ChatSharePreview) =>
    Promise.resolve((_admit: () => void) => sink(preview)),
  )
  const sharing = new ChatShareRelease({
    privacy: createChatSharePrivacy({
      workspaceRoots: [],
      home: '',
      userName: '',
      redactRegisteredSecrets: (text) => text,
    }),
    isConfidentialWorkspace: () => confidential,
    newPreviewId: () => `preview-${String(++serial)}`,
    prepare,
  })
  return {
    sharing,
    sink,
    prepare,
    written,
    confidential: (value: boolean | undefined) => {
      confidential = value
    },
  }
}
function historyHost(name?: string) {
  return {
    readSession: vi.fn((): Promise<SessionHistoryOutcome> =>
      Promise.resolve({ mode: 'inline', items: source.items, name, todos: [] }),
    ),
  }
}
function confirmed(preview: ChatSharePreview) {
  return { step: 'confirmed', previewId: preview.previewId, request: preview.request }
}

describe('M118 exact-preview release', () => {
  it('has no clipboard, file or browser sink before the final click, then writes the exact bytes once', async () => {
    for (const destination of ['copy', 'file', 'browser']) {
      const t = harness()
      const preview = t.sharing.preparePreview(source, { ...request, destination })
      expect(t.prepare).not.toHaveBeenCalled()
      expect(t.sink).not.toHaveBeenCalled()
      expect(parseChatSharePreview(preview)).toEqual(preview)
      expect(await t.sharing.confirm(confirmed(preview))).toBe('shared')
      expect(t.written).toEqual([preview.content])
      await expect(t.sharing.confirm(confirmed(preview))).rejects.toThrow('expired')
      expect(t.sink).toHaveBeenCalledTimes(1)
    }
  })
  it('refuses confidential or unavailable policy at preview and release, for every local destination', async () => {
    for (const destination of ['copy', 'file', 'browser'])
      for (const confidential of [true, undefined]) {
        const t = harness()
        t.confidential(confidential)
        expect(() => t.sharing.preparePreview(source, { ...request, destination })).toThrow(
          'confidential',
        )
        t.confidential(false)
        const preview = t.sharing.preparePreview(source, { ...request, destination })
        t.confidential(confidential)
        await expect(t.sharing.confirm(confirmed(preview))).rejects.toThrow('confidential')
        expect(t.prepare).not.toHaveBeenCalled()
        expect(t.sink).not.toHaveBeenCalled()
      }
  })
  it('rechecks policy after an async destination picker and before any sink invocation', async () => {
    const t = harness()
    const preview = t.sharing.preparePreview(source, request)
    t.prepare.mockImplementationOnce(() => {
      t.confidential(true)
      return Promise.resolve(() => t.sink(preview))
    })
    await expect(t.sharing.confirm(confirmed(preview))).rejects.toThrow('confidential')
    expect(t.sink).not.toHaveBeenCalled()
  })
  it('invalidates replaced/edited/closed previews, even while a destination is being prepared', async () => {
    const t = harness()
    const old = t.sharing.preparePreview(source, request)
    const fresh = t.sharing.preparePreview(source, request)
    await expect(t.sharing.confirm(confirmed(old))).rejects.toThrow('expired')
    t.sharing.invalidate()
    await expect(t.sharing.confirm(confirmed(fresh))).rejects.toThrow('expired')
    const pending = t.sharing.preparePreview(source, request)
    t.prepare.mockImplementationOnce(() => {
      t.sharing.invalidate()
      return Promise.resolve(() => t.sink(pending))
    })
    await expect(t.sharing.confirm(confirmed(pending))).rejects.toThrow('expired')
    expect(t.sink).not.toHaveBeenCalled()
  })
  it('rejects forged tokens, missing confirmation, changed options and reserved destinations', async () => {
    const t = harness()
    const preview = t.sharing.preparePreview(source, request)
    await expect(t.sharing.confirm({ ...confirmed(preview), previewId: 'forged' })).rejects.toThrow(
      'expired',
    )
    await expect(
      t.sharing.confirm({ previewId: preview.previewId, request: preview.request }),
    ).rejects.toThrow()
    await expect(
      t.sharing.confirm({ ...confirmed(preview), request: { ...preview.request, mode: 'full' } }),
    ).rejects.toThrow('expired')
    for (const destination of ['gist', 'nodeLink', 'team', 'email'])
      expect(() => t.sharing.preparePreview(source, { ...request, destination })).toThrow()
    expect(t.prepare).not.toHaveBeenCalled()
  })
  it('owns immutable preview/request bytes and returns dismissed when the picker cancels', async () => {
    const t = harness()
    const preview = t.sharing.preparePreview(source, request)
    preview.request.options.codeBlocks = false
    await expect(t.sharing.confirm(confirmed(preview))).rejects.toThrow('expired')
    const fresh = t.sharing.preparePreview(source, request)
    t.prepare.mockResolvedValueOnce(undefined)
    expect(await t.sharing.confirm(confirmed(fresh))).toBe('dismissed')
    expect(t.sink).not.toHaveBeenCalled()
  })
  it('requires a fresh preview if current registered values change before dispatch, in every format', async () => {
    for (const format of ['md', 'html', 'json']) {
      let isRegistered = false
      const sink = vi.fn(() => Promise.resolve())
      const privateValue = 'new-private-value<&>'
      const privacy = createChatSharePrivacy({
        workspaceRoots: [],
        home: '',
        userName: '',
        redactRegisteredSecrets: (text) =>
          isRegistered ? text.replaceAll(privateValue, '[redacted]') : text,
      })
      const sharing = new ChatShareRelease({
        privacy,
        isConfidentialWorkspace: () => false,
        newPreviewId: () => 'token',
        prepare: () => {
          isRegistered = true
          return Promise.resolve(sink)
        },
      })
      const preview = sharing.preparePreview(
        { ...source, items: [{ ...source.items[0]!, text: privateValue }] },
        { ...request, format },
      )
      await expect(sharing.confirm(confirmed(preview))).rejects.toThrow('expired')
      expect(sink).not.toHaveBeenCalled()
    }
  })
  it('does not resurrect a token after a closed or superseded asynchronous history read', async () => {
    const t = harness()
    const deferred = Promise.withResolvers<typeof source>()
    const preview = t.sharing.prepareFromHistory(() => deferred.promise, request)
    t.sharing.invalidate()
    deferred.resolve(source)
    await expect(preview).rejects.toThrow('expired')
    expect(t.prepare).not.toHaveBeenCalled()
    expect(t.sink).not.toHaveBeenCalled()
  })
  it('rejects malformed preview boundaries and prompt previews', () => {
    const t = harness()
    const preview = t.sharing.preparePreview(source, request)
    expect(() => parseChatSharePreview({ ...preview, content: 1 })).toThrow()
    expect(() => parseChatSharePreview({ ...preview, extra: true })).toThrow()
    expect(() =>
      parseChatSharePreview({
        ...preview,
        request: {
          target: 'prompt',
          source: { kind: 'composer' },
          mode: 'full',
          format: 'json',
          destination: 'copy',
        },
      }),
    ).toThrow('ordered range')
  })
  it('refuses confidential history reads and unavailable policy before invoking the export host', async () => {
    if (request.target !== 'chat') throw new Error('fake request')
    const t = harness()
    const host = historyHost()
    for (const confidential of [true, undefined]) {
      const port: ConversationSharing = {
        isConfidentialWorkspace: () => confidential,
        preparePreview: (selected, req) => t.sharing.prepareFromHistory(selected, req),
      }
      await expect(
        previewConversationShare(
          host,
          { sessionId: 's1' },
          request,
          new Date(source.exportedAt),
          port,
        ),
      ).rejects.toThrow('confidential')
    }
    expect(host.readSession).not.toHaveBeenCalled()
  })
  it('keeps original sink bytes even if the view changes its returned preview text', async () => {
    const t = harness()
    const preview = t.sharing.preparePreview(source, request)
    const exact = preview.content
    const release = confirmed(preview)
    Object.assign(preview, { content: 'forged bytes' })
    await t.sharing.confirm(release)
    expect(t.written).toEqual([exact])
  })
  it('uses existing backend history and refuses withheld/foreign sessions without a destination', async () => {
    if (request.target !== 'chat') throw new Error('fake request')
    const t = harness()
    const host = historyHost('Backend title')
    const port: ConversationSharing = {
      isConfidentialWorkspace: () => false,
      preparePreview: (selected, req) => t.sharing.prepareFromHistory(selected, req),
    }
    const preview = await previewConversationShare(
      host,
      { sessionId: 's1' },
      request,
      new Date(source.exportedAt),
      port,
    )
    expect(preview.content).toContain('Backend title')
    expect(t.sink).not.toHaveBeenCalled()
    host.readSession.mockResolvedValueOnce({ mode: 'none', items: [], name: undefined, todos: [] })
    await expect(
      previewConversationShare(
        host,
        { sessionId: 's1' },
        request,
        new Date(source.exportedAt),
        port,
      ),
    ).rejects.toThrow('history')
    await expect(
      previewConversationShare(
        host,
        { sessionId: 'other' },
        request,
        new Date(source.exportedAt),
        port,
      ),
    ).rejects.toThrow('ordered range')
  })
})

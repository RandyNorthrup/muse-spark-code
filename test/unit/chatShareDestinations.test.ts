import { describe, expect, it, vi } from 'vitest'
import { chatShareDestination } from '../../src/core/sharing/destinations'
import { ChatShareRelease } from '../../src/core/sharing/shareRelease'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'

const source = {
  sessionId: 's1',
  title: 'Chat',
  exportedAt: '2026-10-05T12:00:00Z',
  items: [{ itemId: 'u', kind: 'userMessage', status: 'completed', text: 'Exact bytes' }],
}
function fakes() {
  let isConfidential = false
  const copy = vi.fn(() => Promise.resolve())
  const chooseFile = vi.fn(() => Promise.resolve<string | undefined>('chosen.md'))
  const browserFile = vi.fn(() => Promise.resolve('private.html'))
  const writeFile = vi.fn(() => Promise.resolve())
  const openBrowser = vi.fn(() => Promise.resolve())
  const prepare = chatShareDestination({ copy, chooseFile, browserFile, writeFile, openBrowser })
  const sharing = new ChatShareRelease({
    privacy: createChatSharePrivacy({
      workspaceRoots: [],
      home: '',
      userName: '',
      redactRegisteredSecrets: (text) => text,
    }),
    isConfidentialWorkspace: () => isConfidential,
    newPreviewId: () => 'token',
    prepare,
  })
  return {
    sharing,
    copy,
    chooseFile,
    browserFile,
    writeFile,
    openBrowser,
    confidential: () => {
      isConfidential = true
    },
  }
}

describe('M118 local destination dispatch', () => {
  it('prepares no destination until confirmation, then dispatches exact bytes to each actual sink', async () => {
    for (const destination of ['copy', 'file', 'browser']) {
      const t = fakes()
      const preview = t.sharing.preparePreview(source, {
        target: 'chat',
        sessionId: 's1',
        mode: 'conversation',
        format: destination === 'browser' ? 'html' : 'md',
        destination,
      })
      for (const call of [t.copy, t.chooseFile, t.browserFile, t.writeFile, t.openBrowser])
        expect(call).not.toHaveBeenCalled()
      await t.sharing.confirm({
        step: 'confirmed',
        previewId: preview.previewId,
        request: preview.request,
      })
      if (destination === 'copy')
        expect(t.copy).toHaveBeenCalledWith(preview.content, expect.any(Function))
      else
        expect(t.writeFile).toHaveBeenCalledWith(
          destination === 'file' ? 'chosen.md' : 'private.html',
          preview.content,
          expect.any(Function),
        )
      if (destination === 'browser')
        expect(t.openBrowser).toHaveBeenCalledWith('private.html', expect.any(Function))
      else expect(t.openBrowser).not.toHaveBeenCalled()
    }
  })
  it('refuses reserved destinations at the dispatcher even when called without the release coordinator', async () => {
    const t = fakes()
    const request = {
      target: 'chat',
      sessionId: 's1',
      mode: 'full',
      format: 'json',
      destination: 'copy',
    }
    const preview = t.sharing.preparePreview(source, request)
    const prepare = chatShareDestination({
      copy: t.copy,
      chooseFile: t.chooseFile,
      browserFile: t.browserFile,
      writeFile: t.writeFile,
      openBrowser: t.openBrowser,
    })
    for (const destination of ['gist', 'nodeLink', 'team', 'email'] as const) {
      await expect(
        prepare({ ...preview, request: { ...preview.request, destination } }),
      ).rejects.toThrow('expired')
    }
    expect(t.copy).not.toHaveBeenCalled()
    expect(t.writeFile).not.toHaveBeenCalled()
    expect(t.openBrowser).not.toHaveBeenCalled()
  })
  it('cancels file dispatch without writing, and refuses changed policy after the file picker', async () => {
    const t = fakes()
    const request = {
      target: 'chat',
      sessionId: 's1',
      mode: 'full',
      format: 'json',
      destination: 'file',
    }
    const cancelled = t.sharing.preparePreview(source, request)
    t.chooseFile.mockResolvedValueOnce(undefined)
    expect(
      await t.sharing.confirm({
        step: 'confirmed',
        previewId: cancelled.previewId,
        request: cancelled.request,
      }),
    ).toBe('dismissed')
    const pending = t.sharing.preparePreview(source, request)
    t.chooseFile.mockImplementationOnce(() => {
      t.confidential()
      return Promise.resolve('chosen.json')
    })
    await expect(
      t.sharing.confirm({
        step: 'confirmed',
        previewId: pending.previewId,
        request: pending.request,
      }),
    ).rejects.toThrow('confidential')
    expect(t.writeFile).not.toHaveBeenCalled()
  })
  it('rechecks immediately before opening a browser after an asynchronous file write', async () => {
    const t = fakes()
    const preview = t.sharing.preparePreview(source, {
      target: 'chat',
      sessionId: 's1',
      mode: 'full',
      format: 'html',
      destination: 'browser',
    })
    t.writeFile.mockImplementationOnce(() => {
      t.confidential()
      return Promise.resolve()
    })
    await expect(
      t.sharing.confirm({
        step: 'confirmed',
        previewId: preview.previewId,
        request: preview.request,
      }),
    ).rejects.toThrow('confidential')
    expect(t.writeFile).toHaveBeenCalledOnce()
    expect(t.openBrowser).not.toHaveBeenCalled()
  })
})

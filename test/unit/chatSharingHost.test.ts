import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, Uri, window } from 'vscode'
import { createChatSharing } from '../../src/host/prompts/chatSharing'
import { parseChatSharePreview } from '../../src/core/sharing/shareRelease'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import { shareRequestSchema } from '../../src/shared/share'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function rig(isAliased = false) {
  const realRoot = await mkdtemp(path.join(os.tmpdir(), 'm118-share-host-'))
  roots.push(realRoot)
  const root = isAliased ? `${realRoot}-alias` : realRoot
  if (isAliased) {
    roots.push(root)
    await symlink(realRoot, root, 'junction')
  }
  let session = 's1'
  let confidential: boolean | undefined = false
  const service = createChatSharing({
    workspaceRoot: root,
    storageRoot: path.join(root, 'private'),
    state: { get: () => undefined, update: () => Promise.resolve() },
    currentSessionId: () => session,
    read: (_id, exportedAt) =>
      Promise.resolve({
        sessionId: 's1',
        title: 'Example',
        exportedAt,
        items: [
          { itemId: 'u1', kind: 'userMessage', status: 'completed', text: 'Exact public text' },
        ],
      }),
    privacy: createChatSharePrivacy({
      workspaceRoots: [root],
      home: '',
      userName: '',
      redactRegisteredSecrets: (text) => text,
    }),
    isConfidentialWorkspace: () => confidential,
    refreshSecrets: () => Promise.resolve(),
  })
  const request = shareRequestSchema.parse({
    target: 'chat',
    sessionId: 's1',
    mode: 'conversation',
    format: 'md',
    destination: 'file',
  })
  return {
    root,
    service,
    request,
    session: (value: string) => {
      session = value
    },
    policy: (value: boolean | undefined) => {
      confidential = value
    },
  }
}
describe('M118 real chat destinations', () => {
  it.each([false, true])(
    'writes exact reviewed bytes privately through an aliased workspace: %s',
    async (isAliased) => {
      const t = await rig(isAliased)
      const file = path.join(t.root, 'shared.md')
      vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file(file))
      const preview = parseChatSharePreview(await t.service.handle('chatPreview', t.request))
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(
        await t.service.handle('chatConfirm', {
          step: 'confirmed',
          previewId: preview.previewId,
          request: preview.request,
        }),
      ).toBe('shared')
      expect(await readFile(file, 'utf8')).toBe(preview.content)
      const written = await stat(file)
      if (process.platform !== 'win32') expect(written.mode & 0o777).toBe(0o600)
    },
  )
  it('refuses outside output, changed policy and a replacement session before any sink', async () => {
    for (const changed of ['path', 'policy', 'session']) {
      const t = await rig()
      const file = path.join(t.root, 'shared.md')
      vi.mocked(window.showSaveDialog).mockImplementation(() => {
        if (changed === 'policy') t.policy(undefined)
        else if (changed === 'session') t.session('replacement')
        return Promise.resolve(
          Uri.file(changed === 'path' ? path.join(t.root, '..', 'escaped.md') : file),
        )
      })
      const preview = parseChatSharePreview(await t.service.handle('chatPreview', t.request))
      await expect(
        t.service.handle('chatConfirm', {
          step: 'confirmed',
          previewId: preview.previewId,
          request: preview.request,
        }),
      ).rejects.toThrow()
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(env.openExternal).not.toHaveBeenCalled()
    }
  })
})

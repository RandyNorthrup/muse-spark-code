import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { PromptStore } from '../../src/core/prompts/promptStore'
import { PromptLibrary, usePrompt } from '../../src/core/prompts/promptLibrary'
import { PromptInsertion } from '../../src/host/prompts/promptInsertion'
import type { ChatSurface } from '../../src/host/views/chatSurface'

it('loads a real user prompt into a new empty workspace composer without sending', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'm118-workspaces-'))
  try {
    const user = path.join(root, 'user')
    const first = path.join(root, 'first')
    const empty = path.join(root, 'empty')
    await Promise.all([user, first, empty].map((folder) => mkdir(folder)))
    const body = '  Saved in another workspace\r\nNo automatic send.  '
    const library = new PromptLibrary(new PromptStore(user, first), {
      id: () => 'portable',
      now: () => '2026-10-06T00:00:00Z',
    })
    await library.save({ title: 'Portable', body, scope: 'user', tags: [] })
    const prompts = await new PromptStore(user, empty).list('user')
    expect(prompts[0]?.body).toBe(body)
    expect(await new PromptStore(user, empty).list('workspace')).toEqual([])
    const post = vi.fn<ChatSurface['post']>()
    const surface: ChatSurface = {
      id: 'new-empty-chat',
      documentId: 'new-empty-chat-document',
      post,
      reveal: vi.fn(),
      markUnread: vi.fn(),
      setTitle: vi.fn(),
      reload: vi.fn(),
      takeRestoredSessionId: () => undefined,
      dispose: vi.fn(),
    }
    const insertion = new PromptInsertion({
      active: () => undefined,
      open: () => Promise.resolve(surface.id),
    })
    const prompt = prompts[0]
    if (prompt === undefined) throw new Error('Missing saved fixture')
    await usePrompt(prompt, {
      valueFor: () => Promise.resolve(undefined),
      review: () => Promise.resolve(true),
      insert: (text) => insertion.insert(text),
    })
    expect(post).not.toHaveBeenCalled()
    insertion.surfaceReady(surface)
    expect(post.mock.calls.map(([message]) => message)).toEqual([
      { type: 'insertText', text: body },
      { type: 'focusInput' },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

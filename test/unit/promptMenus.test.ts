import { describe, expect, it, vi } from 'vitest'
import {
  promptContextText,
  PromptCommands,
  type PromptUiPort,
} from '../../src/host/prompts/promptCommands'
import { PromptInsertion } from '../../src/host/prompts/promptInsertion'
import { PromptLibrary } from '../../src/core/prompts/promptLibrary'
import { PromptImporter, PromptSharer } from '../../src/core/prompts/promptImport'
import type { ChatSurface } from '../../src/host/views/chatSurface'
import { serialisePromptFile } from '../../src/shared/prompts'
import { savedPromptFixture as fixture } from './helpers/sharingFixtures'

function commandRig(choices: readonly string[], isConfirmed = true) {
  let index = 0
  const rows = [fixture]
  const store = {
    list: vi.fn(() => Promise.resolve(rows)),
    write: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  }
  const library = new PromptLibrary(store, { id: () => 'fresh', now: () => '2026-10-05T12:00:00Z' })
  const ui: PromptUiPort = {
    pick: <T extends string>(
      _title: string,
      items: readonly { id: T }[],
    ): Promise<T | undefined> => {
      const choice = choices[index++]
      return Promise.resolve(items.find((item) => item.id === choice)?.id)
    },
    edit: vi.fn((draft) => Promise.resolve({ ...draft, title: 'Saved' })),
    preview: vi.fn(() => Promise.resolve(isConfirmed)),
    confirm: vi.fn(() => Promise.resolve(isConfirmed)),
    input: vi.fn(() => Promise.resolve('https://example.org/p.muse-prompt.md')),
  }
  const read = vi.fn(() => Promise.resolve(serialisePromptFile(fixture)))
  const insert = vi.fn(() => Promise.resolve())
  const release = vi.fn(() => Promise.resolve())
  const commands = new PromptCommands({
    library,
    ui,
    importer: new PromptImporter({ read, isConfidentialWorkspace: () => false }),
    sharer: new PromptSharer({
      release,
      isConfidentialWorkspace: () => false,
      normalisePaths: (text) => text,
      redactRegisteredSecrets: (text) => text,
    }),
    variables: {
      valueFor: () => Promise.resolve('reviewed'),
      review: () => Promise.resolve(isConfirmed),
      insert,
    },
    hasWorkspace: () => true,
    editorSelection: () => 'Selected\ntext',
    beforeShare: () => Promise.resolve(),
    afterShare: vi.fn(),
    canImportLinks: true,
  })
  return { store, ui, insert, release, commands, read }
}

describe('prompt menus and commands', () => {
  it('accepts exact composer/own-message text and refuses assistant/system/tool sources', () => {
    expect(
      promptContextText({ 'museSpark.promptSource': 'composer', 'museSpark.promptText': 'exact' }),
    ).toBe('exact')
    expect(
      promptContextText({
        'museSpark.promptSource': 'userMessage',
        'museSpark.promptText': 'exact',
        'museSpark.transcriptRole': 'user',
        'museSpark.messageIsOwn': true,
      }),
    ).toBe('exact')
    for (const role of ['assistant', 'system', 'tool'])
      expect(
        promptContextText({
          'museSpark.promptSource': 'userMessage',
          'museSpark.promptText': 'no',
          'museSpark.transcriptRole': role,
          'museSpark.messageIsOwn': true,
        }),
      ).toBeUndefined()
    expect(
      promptContextText({ 'museSpark.promptSource': 'userMessage', 'museSpark.promptText': 'no' }),
    ).toBeUndefined()
    expect(
      promptContextText({
        'museSpark.promptSource': 'userMessage',
        'museSpark.promptText': 'no',
        'museSpark.transcriptRole': 'user',
        'museSpark.messageIsOwn': false,
      }),
    ).toBeUndefined()
  })
  it('saves from each menu source, preserving exact body', async () => {
    const rig = commandRig([])
    await rig.commands.save()
    expect(rig.store.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: 'Selected\ntext' }),
    )
    await rig.commands.save({
      'museSpark.promptSource': 'composer',
      'museSpark.promptText': 'Composer\r\ntext',
    })
    expect(rig.store.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: 'Composer\r\ntext' }),
    )
    await rig.commands.save({
      'museSpark.promptSource': 'userMessage',
      'museSpark.promptText': 'Own',
      'museSpark.transcriptRole': 'user',
      'museSpark.messageIsOwn': true,
    })
    expect(rig.store.write).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Own' }))
    await expect(rig.commands.save({})).rejects.toThrow()
    expect(rig.insert).not.toHaveBeenCalled()
  })
  it('inserts after variable review, and cancelled imports/shares have no side effects', async () => {
    const use = commandRig(['0'])
    await use.commands.use()
    expect(use.insert).toHaveBeenCalledOnce()
    const imported = commandRig(['import', 'file'], false)
    await imported.commands.library()
    expect(imported.read).toHaveBeenCalledOnce()
    expect(imported.store.write).not.toHaveBeenCalled()
    expect(imported.insert).not.toHaveBeenCalled()
    const share = commandRig(['0', 'file'], false)
    await share.commands.share()
    expect(share.ui.preview).toHaveBeenCalledOnce()
    expect(share.release).not.toHaveBeenCalled()
    const confirmed = commandRig(['0', 'text'])
    await confirmed.commands.share()
    expect(confirmed.release).toHaveBeenCalledOnce()
  })
  it('shares exact composer or own-message text without saving it first', async () => {
    const rig = commandRig(['text'])
    await rig.commands.share({
      'museSpark.promptSource': 'composer',
      'museSpark.promptText': 'Exact body',
    })
    expect(rig.release).toHaveBeenCalledWith('copy', 'Exact body', 'Exact body')
    expect(rig.store.write).not.toHaveBeenCalled()
    expect(rig.insert).not.toHaveBeenCalled()
    await expect(
      rig.commands.share({
        'museSpark.promptSource': 'userMessage',
        'museSpark.promptText': 'foreign',
      }),
    ).rejects.toThrow()
  })
  it('confirms deletion and saves imported content without sending', async () => {
    const deleted = commandRig(['manage', '0', 'delete'], false)
    await deleted.commands.library()
    expect(deleted.store.remove).not.toHaveBeenCalled()
    const imported = commandRig(['import', 'link'])
    await imported.commands.library()
    expect(imported.store.write).toHaveBeenCalledWith(
      expect.objectContaining({ untrusted: true, id: 'fresh' }),
    )
    expect(imported.insert).not.toHaveBeenCalled()
  })
})

function surface(id: string): ChatSurface {
  return {
    id,
    post: vi.fn(),
    reveal: vi.fn(),
    markUnread: vi.fn(),
    setTitle: vi.fn(),
    reload: vi.fn(),
    takeRestoredSessionId: () => undefined,
    dispose: vi.fn(),
  }
}
describe('loads in any chat without sending', () => {
  it('holds a load until a new surface is ready, then inserts once', async () => {
    let active: ChatSurface | undefined
    const opened = surface('new')
    const insertion = new PromptInsertion({
      active: () => active,
      open: () => {
        active = opened
        return Promise.resolve()
      },
    })
    await insertion.insert('reviewed')
    expect(opened.post).not.toHaveBeenCalled()
    insertion.surfaceReady(opened)
    expect(opened.post).toHaveBeenCalledWith({ type: 'insertText', text: 'reviewed' })
    expect(opened.post).toHaveBeenCalledWith({ type: 'focusInput' })
    insertion.surfaceReady(opened)
    expect(opened.post).toHaveBeenCalledTimes(2)
  })
  it('targets the original active surface, drops a closed pending load, and rejects a failed open', async () => {
    const a = surface('a'),
      b = surface('b')
    let active = a
    const insertion = new PromptInsertion({ active: () => active, open: () => Promise.resolve() })
    await insertion.insert('a only')
    active = b
    insertion.surfaceReady(b)
    expect(b.post).not.toHaveBeenCalled()
    insertion.surfaceReady(a)
    expect(a.post).toHaveBeenCalledTimes(2)
    insertion.surfaceClosed(a)
    active = a
    await insertion.insert('discard')
    insertion.surfaceClosed(a)
    insertion.surfaceReady(a)
    expect(a.post).toHaveBeenCalledTimes(2)
    const failed = new PromptInsertion({
      active: () => undefined,
      open: () => Promise.reject(new Error('closed')),
    })
    await expect(failed.insert('lost')).rejects.toThrow('closed')
    failed.surfaceReady(b)
    expect(b.post).not.toHaveBeenCalled()
  })
})

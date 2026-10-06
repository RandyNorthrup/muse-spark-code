import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, Uri, window, workspace } from 'vscode'
import type * as VSCode from 'vscode'
import { runPromptCommand, type PromptHostDeps } from '../../src/host/prompts/promptEntry'
import { PromptStore } from '../../src/core/prompts/promptStore'
import { EN } from '../../src/shared/l10n/en'
import { fill, setUiText } from '../../src/shared/l10n/text'
import { inform, pickOne } from './helpers/vscodeViews'
import { serialisePromptFile } from '../../src/shared/prompts'
import { savedPromptFixture as fixture } from './helpers/sharingFixtures'

const editor = vi.hoisted(() => ({ isChanged: false, syncOn: false }))
vi.mock('../../src/runtime/dataFolder', () => ({
  agentDataFolder: ({ homeDir }: { homeDir: string }) => homeDir,
}))
vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof VSCode>()
  const { FakeUri } = await import('./mocks/vscode')
  class NativeUri extends FakeUri {
    public static file(file: string): NativeUri {
      return new NativeUri(file)
    }
  }
  return {
    ...actual,
    Uri: NativeUri,
    workspace: {
      ...actual.workspace,
      getConfiguration: () => ({
        get: () => true,
        inspect: () => ({ globalValue: editor.syncOn, workspaceValue: true }),
      }),
      openTextDocument: ({ content }: { content: string }) =>
        Promise.resolve({
          getText: () => (editor.isChanged ? `${content}\nChanged` : content),
        }),
    },
  }
})
const roots: string[] = []
afterEach(async () => {
  editor.isChanged = false
  editor.syncOn = false
  setUiText(EN, 'en')
  vi.resetAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function rig(hasWorkspace = false) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'prompt-native-'))
  roots.push(home)
  let isConfidential = false
  let secrets: readonly string[] = []
  const open = vi.fn(() => Promise.resolve('opened'))
  const read = vi.fn<() => unknown>(() => [])
  const update = vi.fn((_key: string, _value: unknown) => Promise.resolve())
  const deps: PromptHostDeps = {
    home,
    user: 'fixture',
    workspaceRoot: hasWorkspace ? home : undefined,
    state: { get: read, update },
    chat: { active: () => undefined, open, isReady: () => false, observe: vi.fn() },
    isConfidentialWorkspace: () => isConfidential,
    registeredSecrets: () => Promise.resolve(secrets),
  }
  return {
    home,
    deps,
    open,
    read,
    update,
    makeConfidential: () => {
      isConfidential = true
    },
    register: (value: string) => {
      secrets = [value]
    },
    run: (command: Parameters<typeof runPromptCommand>[0], input?: unknown) =>
      runPromptCommand(command, input, deps, EN, 'en'),
    chooseFile: (whenPicked: () => void) => {
      vi.mocked(pickOne).mockImplementation((items) =>
        Promise.resolve(items.find((item) => item.label === EN.shareFile)),
      )
      vi.mocked(inform).mockResolvedValue(EN.shareFile)
      vi.mocked(window.showSaveDialog).mockImplementation(() => {
        whenPicked()
        return Promise.resolve(Uri.file(path.join(home, 'export.muse-prompt.md')))
      })
    },
  }
}
const source = {
  'museSpark.promptSource': 'composer',
  'museSpark.promptText': 'Review planted-value',
}
describe('native prompt review and release', () => {
  it('keeps workspace prompts usable when the synced user scope is damaged', async () => {
    const rigged = await rig(true)
    const store = new PromptStore(rigged.home, rigged.home)
    const healthy = {
      ...fixture,
      scope: 'workspace' as const,
      body: 'Healthy workspace text',
      variables: [],
    }
    await store.write(healthy)
    await mkdir(path.join(rigged.home, 'prompts'))
    const damaged = path.join(rigged.home, 'prompts', 'broken.md')
    await writeFile(damaged, 'damaged user file')
    editor.syncOn = true
    vi.mocked(pickOne).mockImplementation((items) => Promise.resolve(items[0]))
    vi.mocked(inform).mockResolvedValue(EN.promptInsert)
    vi.mocked(window.showInputBox).mockResolvedValue('reviewed')
    await rigged.run('use')
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining(EN.promptScopeUser),
    )
    expect(rigged.open).toHaveBeenCalledOnce()
    expect(await readFile(damaged, 'utf8')).toBe('damaged user file')
    expect(await store.list('workspace')).toEqual([healthy])
    rigged.makeConfidential()
    vi.mocked(inform).mockResolvedValue(EN.promptSave)
    await rigged.run('save', source)
    expect(await store.list('workspace')).toHaveLength(2)
    expect(rigged.update).not.toHaveBeenCalled()
    expect(await readFile(damaged, 'utf8')).toBe('damaged user file')
  })
  it('imports to an explicitly reviewed scope, defaulting confidential workspaces locally', async () => {
    const rigged = await rig(true)
    rigged.makeConfidential()
    const file = path.join(rigged.home, 'source.muse-prompt.md')
    await writeFile(file, serialisePromptFile({ ...fixture, scope: 'workspace' }))
    vi.mocked(window.showOpenDialog).mockResolvedValue([Uri.file(file)])
    let isUserChosen = false
    const scopes: string[][] = []
    vi.mocked(pickOne).mockImplementation((items) => {
      if (items.some((item) => item.label === EN.promptScopeUser)) {
        scopes.push(items.map((item) => item.label))
        return Promise.resolve(
          isUserChosen ? items.find((item) => item.label === EN.promptScopeUser) : items[0],
        )
      }
      return Promise.resolve(
        items.find((item) => item.label === EN.promptImport || item.label === EN.promptFromFile),
      )
    })
    vi.mocked(inform).mockImplementation((_message, ...actions) =>
      Promise.resolve(
        actions.find(
          (action) => typeof action === 'string' && action.startsWith('Save imported prompt'),
        ),
      ),
    )
    await rigged.run('library')
    const store = new PromptStore(rigged.home, rigged.home)
    expect(scopes).toEqual([[EN.promptScopeWorkspace, EN.promptScopeUser]])
    expect(await store.list('user')).toEqual([])
    expect(await store.list('workspace')).toEqual([
      expect.objectContaining({ body: fixture.body, untrusted: true }),
    ])
    expect(inform).toHaveBeenLastCalledWith(
      EN.sharePreview,
      fill(EN.promptImportConfirmScope, { scope: EN.promptScopeWorkspace }),
      EN.goalEditCancel,
    )
    isUserChosen = true
    await rigged.run('library')
    expect(await store.list('user')).toEqual([
      expect.objectContaining({ body: fixture.body, untrusted: true }),
    ])
    expect(inform).toHaveBeenLastCalledWith(
      EN.sharePreview,
      fill(EN.promptImportConfirmScope, { scope: EN.promptScopeUser }),
      EN.goalEditCancel,
    )
  })
  it('merges the existing mirror when sync is enabled after the commands were cached', async () => {
    const rigged = await rig()
    vi.mocked(pickOne).mockResolvedValue(undefined)
    await rigged.run('library')
    const remote = { ...fixture, id: 'remote-computer' }
    rigged.read.mockReturnValue([remote])
    editor.syncOn = true
    vi.mocked(window.showInputBox).mockResolvedValue('Local prompt')
    vi.mocked(inform).mockResolvedValue(EN.promptSave)
    await rigged.run('save', source)
    expect(await new PromptStore(rigged.home).list('user')).toEqual(
      expect.arrayContaining([remote, expect.objectContaining({ title: 'Local prompt' })]),
    )
    expect(rigged.update).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.arrayContaining([remote, expect.objectContaining({ title: 'Local prompt' })]),
    )
    await rigged.run('synchronise')
    expect(rigged.read).toHaveBeenCalledTimes(2)
  })
  it('keeps cancelled edits local and rejects an edited preview before insertion', async () => {
    const rigged = await rig()
    vi.mocked(window.showInputBox).mockResolvedValue('Native prompt')
    vi.mocked(inform).mockResolvedValue(EN.goalEditCancel)
    await rigged.run('save', source)
    expect(await new PromptStore(rigged.home).list('user')).toEqual([])
    vi.mocked(inform).mockResolvedValue(EN.promptSave)
    await rigged.run('save', source)
    expect(await new PromptStore(rigged.home).list('user')).toEqual([
      expect.objectContaining({ body: source['museSpark.promptText'] }),
    ])
    vi.mocked(pickOne).mockImplementation((items) => Promise.resolve(items[0]))
    vi.mocked(inform).mockResolvedValue(EN.promptInsert)
    editor.isChanged = true
    await expect(rigged.run('use')).rejects.toThrow(EN.promptFileInvalid)
    expect(rigged.open).not.toHaveBeenCalled()
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })
  it('rechecks confidential policy after the save dialog before writing', async () => {
    const rigged = await rig()
    rigged.chooseFile(rigged.makeConfidential)
    await expect(rigged.run('sharePrompt', source)).rejects.toThrow(EN.shareConfidential)
    expect(workspace.fs.writeFile).not.toHaveBeenCalled()
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })
  it('refreshes registered values after the save dialog and requires a new preview', async () => {
    const rigged = await rig()
    rigged.chooseFile(() => {
      rigged.register('planted-value')
    })
    await expect(rigged.run('sharePrompt', source)).rejects.toThrow(EN.promptFileInvalid)
    expect(workspace.fs.writeFile).not.toHaveBeenCalled()
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })
})

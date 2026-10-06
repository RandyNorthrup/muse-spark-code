import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, Uri, window, workspace } from 'vscode'
import type * as VSCode from 'vscode'
import { runPromptCommand, type PromptHostDeps } from '../../src/host/prompts/promptEntry'
import { PromptStore } from '../../src/core/prompts/promptStore'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { inform, pickOne } from './helpers/vscodeViews'

const editor = vi.hoisted(() => ({ isChanged: false }))
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
      getConfiguration: () => ({ get: () => false }),
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
  setUiText(EN, 'en')
  vi.resetAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function rig() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'prompt-native-'))
  roots.push(home)
  let isConfidential = false
  let secrets: readonly string[] = []
  const open = vi.fn(() => Promise.resolve())
  const deps: PromptHostDeps = {
    home,
    user: 'fixture',
    workspaceRoot: undefined,
    state: { get: () => [], update: () => Promise.resolve() },
    chat: { active: () => undefined, open, isReady: () => false, observe: vi.fn() },
    isConfidentialWorkspace: () => isConfidential,
    registeredSecrets: () => Promise.resolve(secrets),
  }
  return {
    home,
    deps,
    open,
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

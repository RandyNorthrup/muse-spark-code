import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { window, Uri } from 'vscode'
import type * as VSCode from 'vscode'
import { runPromptCommand, type PromptHostDeps } from '../../src/host/prompts/promptEntry'
import { promptBundleLoader } from '../../src/host/prompts/promptBundle'
import { EN } from '../../src/shared/l10n/en'
import { PROMPT_LIMITS } from '../../src/shared/constants'
import { serialisePromptFile } from '../../src/shared/prompts'
import { savedPromptFixture } from './helpers/sharingFixtures'
import { setUiText } from '../../src/shared/l10n/text'
import { pickOne } from './helpers/vscodeViews'

vi.mock('../../src/runtime/dataFolder', () => ({
  agentDataFolder: ({ homeDir }: { homeDir: string }) => homeDir,
}))
const syncControl = vi.hoisted(() => ({ isOn: true }))
vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof VSCode>()
  return {
    ...actual,
    workspace: {
      ...actual.workspace,
      getConfiguration: () => ({
        get: () => true,
        inspect: () => ({ globalValue: syncControl.isOn, workspaceValue: true }),
      }),
    },
  }
})
const roots: string[] = []
afterEach(async () => {
  syncControl.isOn = true
  setUiText(EN, 'en')
  vi.mocked(window.showQuickPick).mockReset()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function rig() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'prompt-entry-'))
  roots.push(home)
  const read = vi.fn<() => unknown>(() => [])
  const update = vi.fn(() => Promise.resolve())
  const observe = vi.fn<PromptHostDeps['chat']['observe']>()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: PromptHostDeps = {
    home,
    user: 'fixture',
    workspaceRoot: undefined,
    state: { get: read, update },
    chat: {
      active: () => undefined,
      open: () => Promise.resolve('opened'),
      isReady: () => false,
      observe,
    },
    isConfidentialWorkspace: () => false,
    registeredSecrets: () => Promise.resolve([]),
    log,
  }
  return { home, deps, read, observe, update, log }
}
describe('prompt lazy entry', () => {
  it('never reads or writes the native mirror while sync is disabled', async () => {
    const { deps, read, update } = await rig()
    syncControl.isOn = false
    vi.mocked(pickOne).mockResolvedValue(undefined)
    await runPromptCommand('library', undefined, deps, EN, 'en')
    expect(read).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
  it('sanitises initialization failures, retries and installs the language on cached calls', async () => {
    const { deps, read, observe, log } = await rig()
    read.mockImplementationOnce(() => {
      throw new TypeError('/private/planted-path')
    })
    let failure: unknown
    try {
      await runPromptCommand('library', undefined, deps, EN, 'en')
    } catch (error: unknown) {
      failure = error
    }
    // An unexpected fault is never a prompt-file error; the log names the fault.
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(EN.actionFailed)
    expect((failure as Error).cause).toBeInstanceOf(TypeError)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'))
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('/private/planted-path')
    expect(observe).not.toHaveBeenCalled()
    vi.mocked(pickOne).mockResolvedValue(undefined)
    await runPromptCommand('library', undefined, deps, EN, 'en')
    await runPromptCommand(
      'library',
      undefined,
      deps,
      { ...EN, promptLibrary: 'Bibliothèque' },
      'fr',
    )
    expect(read).toHaveBeenCalledTimes(2)
    expect(observe).toHaveBeenCalledOnce()
    expect(window.showQuickPick).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ title: 'Bibliothèque' }),
    )
  })
  it.each([
    ['invalid UTF-8', Buffer.from([0x80])],
    ['malformed JSON', '---\n{broken\n---\nbody'],
    [
      'unsupported schema',
      serialisePromptFile(savedPromptFixture).replace('"schemaVersion": 1', '"schemaVersion": 2'),
    ],
    [
      'invalid variables',
      serialisePromptFile(savedPromptFixture).replace(savedPromptFixture.body, 'no variables'),
    ],
  ])(
    'keeps the localized invalid-file refusal for %s through the native importer',
    async (_name, file) => {
      const { home, deps, log } = await rig()
      const location = path.join(home, 'import.muse-prompt.md')
      await writeFile(location, file)
      vi.mocked(window.showOpenDialog).mockResolvedValue([Uri.file(location)])
      vi.mocked(pickOne)
        .mockImplementationOnce((items) =>
          Promise.resolve(items.find((item) => item.label === EN.promptImport)),
        )
        .mockImplementationOnce((items) =>
          Promise.resolve(items.find((item) => item.label === EN.promptFromFile)),
        )
      const table = { ...EN, promptFileInvalid: 'Fichier de prompt invalide.' }
      await expect(runPromptCommand('library', undefined, deps, table, 'fr')).rejects.toThrow(
        table.promptFileInvalid,
      )
      expect(log.warn).not.toHaveBeenCalled()
    },
  )
  it('keeps the localized limit refusal for an oversized composer prompt', async () => {
    const { deps, log } = await rig()
    const input = {
      'museSpark.promptSource': 'composer',
      'museSpark.promptText': 'x'.repeat(PROMPT_LIMITS.body + 1),
    }
    const table = { ...EN, promptLimits: 'Limites du prompt dépassées.' }
    await expect(runPromptCommand('sharePrompt', input, deps, table, 'fr')).rejects.toThrow(
      table.promptLimits,
    )
    expect(log.warn).not.toHaveBeenCalled()
  })
  it('keeps a defined prompt refusal with its own sentence and no log entry', async () => {
    const { deps, log } = await rig()
    // Blank editor text is deliberately a prompt-file error (promptCommands.share),
    // so the boundary keeps the sentence and records nothing.
    const blank = { 'museSpark.promptSource': 'composer', 'museSpark.promptText': ' '.repeat(3) }
    await expect(runPromptCommand('sharePrompt', blank, deps, EN, 'en')).rejects.toThrow(
      EN.promptFileInvalid,
    )
    expect(log.warn).not.toHaveBeenCalled()
  })
  it('keeps a variable-prompt refusal with its own sentence and no log entry', async () => {
    const { deps, read, log } = await rig()
    const variables = `${EN.promptVariables}: audience`
    read.mockImplementationOnce(() => {
      throw new Error(variables)
    })
    await expect(runPromptCommand('library', undefined, deps, EN, 'en')).rejects.toThrow(variables)
    expect(log.warn).not.toHaveBeenCalled()
  })
  it('refuses a malformed bundle, then loads the repaired lazy entry once', async () => {
    const { home } = await rig()
    const file = path.join(home, 'prompts.cjs')
    await writeFile(file, 'module.exports = {}')
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }
    const load = promptBundleLoader(file, log)
    // A bundle that cannot load is an installation fault, not a prompt-file error.
    expect(() => load()).toThrow(EN.actionFailed)
    await writeFile(file, 'module.exports = { createPromptHost() {} }')
    const bundle = load()
    expect(typeof bundle.createPromptHost).toBe('function')
    expect(load()).toBe(bundle)
  })
})

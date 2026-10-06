import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import type * as VSCode from 'vscode'
import { runPromptCommand, type PromptHostDeps } from '../../src/host/prompts/promptEntry'
import { promptBundleLoader } from '../../src/host/prompts/promptBundle'
import { EN } from '../../src/shared/l10n/en'
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
  }
  return { home, deps, read, observe, update }
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
    const { deps, read, observe } = await rig()
    read.mockImplementationOnce(() => {
      throw new Error('/private/planted-path')
    })
    let failure: unknown
    try {
      await runPromptCommand('library', undefined, deps, EN, 'en')
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toEqual(new Error(EN.promptFileInvalid))
    expect(failure).not.toHaveProperty('cause')
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
  it('refuses a malformed bundle, then loads the repaired lazy entry once', async () => {
    const { home } = await rig()
    const file = path.join(home, 'prompts.cjs')
    await writeFile(file, 'module.exports = {}')
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }
    const load = promptBundleLoader(file, log)
    expect(() => load()).toThrow(EN.promptFileInvalid)
    await writeFile(file, 'module.exports = { createPromptHost() {} }')
    const bundle = load()
    expect(typeof bundle.createPromptHost).toBe('function')
    expect(load()).toBe(bundle)
  })
})

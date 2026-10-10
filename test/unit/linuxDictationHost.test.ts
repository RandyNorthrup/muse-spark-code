import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDictationSetup } from '../../src/host/voice/dictationHost'
import type { VoiceBundle } from '../../src/host/voice/voiceBundle'
import * as voiceEntry from '../../src/host/voice/voiceEntry'
import { LINUX_DICTATION, UI_TEXT } from '../../src/shared/constants'
import { SILENT_LOG } from './helpers/captureListener'

const host = vi.hoisted(() => ({
  enabled: true,
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  onChange: vi.fn<
    (listener: (event: { affectsConfiguration: (key: string) => boolean }) => void) => {
      dispose: () => void
    }
  >(),
}))
vi.mock('vscode', () => ({
  ExtensionKind: { UI: 1, Workspace: 2 },
  env: { remoteName: undefined, appName: 'Visual Studio Code' },
  extensions: { getExtension: () => ({ extensionKind: 1 }) },
  workspace: {
    getConfiguration: () => ({ get: () => host.enabled }),
    onDidChangeConfiguration: host.onChange,
  },
  window: {
    showInformationMessage: host.showInformationMessage,
    showErrorMessage: host.showErrorMessage,
  },
}))
const state = { directory: '' }
beforeEach(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'm9-host-'))
  host.enabled = true
  host.showInformationMessage.mockReset()
  host.showErrorMessage.mockReset()
  host.onChange.mockReset().mockReturnValue({ dispose: () => undefined })
  // Nothing is bundled any more: availability never depends on files on disk.
})
afterEach(async () => {
  await rm(state.directory, { recursive: true, force: true })
})
function setup() {
  const createLinux = vi.fn<VoiceBundle['createLinuxDictation']>(() => ({
    start: () => undefined,
    stop: () => undefined,
    dispose: () => undefined,
  }))
  const remove = vi.fn<VoiceBundle['removeLinuxDictationModel']>(() => Promise.resolve())
  const load = vi.fn(() => ({
    ...voiceEntry,
    createLinuxDictation: createLinux,
    removeLinuxDictationModel: remove,
  }))
  const register = vi.fn()
  const result = createDictationSetup(
    { platform: 'linux', systemRoot: undefined, helperDir: state.directory },
    SILENT_LOG,
    load,
    { storageRoot: state.directory, register },
  )
  return { result, createLinux, remove, load, register }
}
describe('Linux editor dictation binding', () => {
  it('loads only on first use and asks a size-and-storage modal before authorizing a download', async () => {
    const test = setup()
    expect(test.result.isAvailable).toBe(true)
    expect(test.load).not.toHaveBeenCalled()
    if (!test.result.isAvailable) throw new Error('Linux helper should be available')
    const driver = test.result.create({
      onStatus: () => undefined,
      onText: () => undefined,
      onError: () => undefined,
    })
    driver.start()
    const deps = test.createLinux.mock.calls[0]?.[0]
    expect(deps).toBeDefined()
    expect(test.createLinux.mock.calls[0]?.[1]).toBe(UI_TEXT)
    expect(test.createLinux.mock.calls[0]?.[2]).toBe('en')
    if (deps === undefined) throw new Error('Missing Linux driver dependencies')
    host.showInformationMessage.mockImplementation((_title, _options, download) =>
      Promise.resolve(download),
    )
    expect(await deps.model.consent(new AbortController().signal)).toBe(true)
    // One card names both downloads with their sizes (PLAN.md D106).
    expect(host.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('77.7 MB'),
      expect.objectContaining({
        modal: true,
        detail: expect.stringContaining(path.join(state.directory, LINUX_DICTATION.directory)),
      }),
      expect.objectContaining({ title: UI_TEXT.browserRuntimeDownload }),
      expect.objectContaining({ isCloseAffordance: true }),
    )
    const title = String(host.showInformationMessage.mock.calls[0]?.[0])
    expect(title).toContain('helper')
    expect(title).toContain('~7.6 MB')
    expect(deps.helper.directory).toBe(path.join(state.directory, LINUX_DICTATION.directory))
    const answer = Promise.withResolvers<unknown>()
    host.showInformationMessage.mockReturnValue(answer.promise)
    const stop = new AbortController()
    const pending = deps.model.consent(stop.signal)
    stop.abort()
    answer.resolve(host.showInformationMessage.mock.calls[1]?.[2])
    expect(await pending).toBe(false)
    driver.dispose()
  })
  it('turning the machine setting off removes weights through the lazy owner and registers cleanup', async () => {
    const test = setup()
    expect(test.register).toHaveBeenCalledTimes(1)
    host.enabled = false
    const changed = host.onChange.mock.calls[0]?.[0]
    changed?.({ affectsConfiguration: (key) => key === 'museSpark.linuxDictationModel' })
    await vi.waitFor(() => {
      expect(test.remove).toHaveBeenCalledWith(
        path.join(state.directory, LINUX_DICTATION.directory),
      )
    })
    const disabled = setup()
    expect(disabled.result).toEqual({ isAvailable: false, reason: UI_TEXT.linuxDictationRemoved })
  })
  it('disabled startup says removed only when nothing is left, pending while files remain (RVCM9LNX P3)', async () => {
    host.enabled = false
    const absent = setup()
    expect(absent.result).toEqual({ isAvailable: false, reason: UI_TEXT.linuxDictationRemoved })
    expect(absent.remove).not.toHaveBeenCalled()
    await mkdir(path.join(state.directory, LINUX_DICTATION.directory))
    const pending = setup()
    expect(pending.result).toEqual({
      isAvailable: false,
      reason: UI_TEXT.linuxDictationRemovalPending,
    })
    await vi.waitFor(() => {
      expect(pending.remove).toHaveBeenCalledTimes(1)
    })
  })
  it('an unsuccessful removal shows the reason and never claims removal (RVCM9LNX P3)', async () => {
    await mkdir(path.join(state.directory, LINUX_DICTATION.directory))
    const test = setup()
    test.remove.mockRejectedValue(new Error('permissions'))
    host.enabled = false
    host.onChange.mock.calls[0]?.[0]({ affectsConfiguration: () => true })
    await vi.waitFor(() => {
      expect(host.showErrorMessage).toHaveBeenCalledWith(
        `${UI_TEXT.linuxDictationRemoveFailed}: permissions`,
      )
    })
    const restarted = setup()
    expect(restarted.result).toEqual({
      isAvailable: false,
      reason: UI_TEXT.linuxDictationRemovalPending,
    })
    await vi.waitFor(() => {
      expect(restarted.remove).toHaveBeenCalledTimes(1)
    })
  })
})

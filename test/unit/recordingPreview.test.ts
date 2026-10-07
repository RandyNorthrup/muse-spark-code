import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openRecordingPreview, runScreenRecordingCommand } from '../../src/host/media/previewPanel'
import {
  screenRecordLoader,
  type RecordingCommandDeps,
  type RecordingPreviewDeps,
} from '../../src/host/media/screenRecordBundle'
import type {
  ScreenRecordingDriver,
  ScreenRecordingPreview,
} from '../../src/core/media/record/driver'
import { SCREEN_RECORDING_DEFAULT_MAX_SECONDS, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel, FakeWebviewPanel, fakeHostContext } from './helpers/fakes'
import { commands, Disposable, FakeStatusBarItem, window } from './mocks/vscode'

const { selectAudio } = vi.hoisted(() => ({
  selectAudio:
    vi.fn<
      () => Promise<readonly { readonly label: string; readonly audio: string }[] | undefined>
    >(),
}))
vi.mock('vscode', async () => {
  const fake = await import('./mocks/vscode')
  return { ...fake, window: { ...fake.window, showQuickPick: selectAudio } }
})

function preview(): ScreenRecordingPreview {
  return {
    path: '/private/recording/clip.mp4',
    info: {
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: 512,
      durationSeconds: 10,
      hasSoundtrack: false,
    },
    dispose: vi.fn(() => Promise.resolve()),
  }
}
function deps(overrides: Partial<RecordingPreviewDeps> = {}): RecordingPreviewDeps {
  return {
    l10n: fakeHostContext().l10n,
    log: new FakeLogOutputChannel(),
    attach: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  }
}
function panel(): FakeWebviewPanel {
  const value: unknown = window.createWebviewPanel.mock.results.at(-1)?.value
  if (!(value instanceof FakeWebviewPanel)) throw new Error('expected preview panel')
  return value
}
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  window.createWebviewPanel
    .mockReset()
    .mockImplementation((kind, title) => new FakeWebviewPanel(kind, title))
  selectAudio.mockReset().mockResolvedValue([])
  window.showInformationMessage.mockReset().mockResolvedValue(undefined)
  window.createStatusBarItem.mockReset().mockImplementation(() => new FakeStatusBarItem())
  commands.registerCommand.mockReset().mockImplementation(() => new Disposable(() => undefined))
})

describe('M105 E1 recording preview', () => {
  it('opens a responsive nonce-secured preview with controls and no automatic attachment', () => {
    const media = preview()
    const port = deps()
    openRecordingPreview(media, port)
    expect(window.createWebviewPanel).toHaveBeenCalledExactlyOnceWith(
      'museSpark.recordingPreview',
      UI_TEXT.media.recordingPreview,
      -2,
      expect.objectContaining({
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [expect.objectContaining({ path: '/private/recording' })],
      }),
    )
    expect(panel().webview.html).toContain("default-src 'none'")
    expect(panel().webview.html).toContain("script-src 'nonce-")
    expect(panel().webview.html).not.toContain('unsafe-inline')
    expect(panel().webview.html).not.toContain('getDisplayMedia')
    expect(panel().webview.html).toContain('name="viewport"')
    expect(panel().webview.html).toContain('<video controls')
    expect(panel().webview.html).toContain(UI_TEXT.media.recordingWarning)
    expect(port.attach).not.toHaveBeenCalled()
    expect(media.dispose).not.toHaveBeenCalled()
  })

  it('rejects malformed, extra-field and chat actions before ownership changes', async () => {
    const media = preview()
    const port = deps()
    openRecordingPreview(media, port)
    for (const message of [
      null,
      { type: 'sendMessage', text: 'go' },
      { type: 'attach', path: '/other' },
      { type: 'discard', extra: true },
    ])
      panel().webview.messages.fire(message)
    await settle()
    expect(port.attach).not.toHaveBeenCalled()
    expect(media.dispose).not.toHaveBeenCalled()
  })

  it('discards on Discard or tab close, only once, and detaches the listener', async () => {
    for (const action of ['discard', 'close']) {
      const media = preview()
      const port = deps()
      openRecordingPreview(media, port)
      if (action === 'discard') panel().webview.messages.fire({ type: 'discard' })
      else panel().dispose()
      panel().dispose()
      panel().webview.messages.fire({ type: 'attach' })
      await settle()
      expect(media.dispose).toHaveBeenCalledOnce()
      expect(port.attach).not.toHaveBeenCalled()
    }
  })

  it('serializes Attach, transfers cleanup to upload ownership and handles a close during attachment', async () => {
    const media = preview()
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const attach = vi.fn(() => promise)
    openRecordingPreview(media, deps({ attach }))
    panel().webview.messages.fire({ type: 'attach' })
    panel().webview.messages.fire({ type: 'attach' })
    panel().webview.messages.fire({ type: 'discard' })
    panel().dispose()
    expect(attach).toHaveBeenCalledExactlyOnceWith(media, true)
    expect(media.dispose).not.toHaveBeenCalled()
    resolve(true)
    await settle()
    expect(media.dispose).not.toHaveBeenCalled()
  })

  it('keeps refused attachments previewable and deletes on a closed failed attachment', async () => {
    const media = preview()
    const attach = vi.fn(() => Promise.resolve(false))
    openRecordingPreview(media, deps({ attach }))
    panel().webview.messages.fire({ type: 'attach' })
    await settle()
    expect(media.dispose).not.toHaveBeenCalled()
    panel().webview.messages.fire({ type: 'attach' })
    await settle()
    expect(attach).toHaveBeenCalledTimes(2)
    const failed = preview()
    const { promise, reject } = Promise.withResolvers<boolean>()
    openRecordingPreview(failed, deps({ attach: () => promise }))
    panel().webview.messages.fire({ type: 'attach' })
    panel().dispose()
    reject(new Error('private source path'))
    await settle()
    expect(failed.dispose).toHaveBeenCalledOnce()
  })

  it('escapes localized markup and installs the caller table before rendering', () => {
    const l10n = fakeHostContext().l10n
    const table = {
      ...l10n.table,
      media: { ...l10n.table.media, recordingPreview: '<script>canary</script>' },
    }
    openRecordingPreview(preview(), deps({ l10n: { locale: 'en', table } }))
    expect(panel().webview.html).toContain('&lt;script&gt;canary&lt;/script&gt;')
    expect(panel().webview.html).not.toContain('<script>canary</script>')
    // Restore the caller state for subsequent tests, as another host factory does.
    openRecordingPreview(preview(), deps())
  })
})

function commandRig(overrides: Partial<RecordingCommandDeps> = {}) {
  const media = preview()
  const stop = vi.fn(() => Promise.resolve())
  const start = vi.fn<ScreenRecordingDriver['start']>((_options, countdown) => {
    countdown(10)
    return Promise.resolve({
      stop,
      cancel: vi.fn(() => Promise.resolve()),
      result: Promise.resolve({ ok: true, preview: media }),
    })
  })
  const driver: ScreenRecordingDriver = {
    available: vi.fn<ScreenRecordingDriver['available']>(() => Promise.resolve({ ok: true })),
    start,
  }
  const port: RecordingCommandDeps = {
    ...deps(),
    isRemote: false,
    maxSeconds: SCREEN_RECORDING_DEFAULT_MAX_SECONDS,
    driver,
    ...overrides,
  }
  return { media, stop, start, driver, port }
}

describe('M105 E1 recording command loader', () => {
  it('loads nothing before use, validates exports, retries failure and caches the real factory', async () => {
    const log = new FakeLogOutputChannel()
    const run = vi.fn(() => Promise.resolve())
    const module = vi
      .fn<() => unknown>()
      .mockReturnValueOnce({ runScreenRecordingCommand: 1 })
      .mockReturnValue({ runScreenRecordingCommand: run })
    const load = screenRecordLoader('/dist/screenRecord.js', log, module)
    expect(module).not.toHaveBeenCalled()
    expect(load).toThrow(UI_TEXT.media.recordingUserOnly)
    await load().runScreenRecordingCommand(commandRig().port, false)
    load()
    expect(module).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledOnce()
  })

  it('refuses remote, absent and unavailable native drivers before starting', async () => {
    const remote = commandRig({ isRemote: true })
    await runScreenRecordingCommand(remote.port, false)
    expect(remote.start).not.toHaveBeenCalled()
    expect(window.showInformationMessage).toHaveBeenCalledWith(UI_TEXT.media.recordingRemote)
    const { driver: _driver, ...withoutDriver } = remote.port
    await runScreenRecordingCommand({ ...withoutDriver, isRemote: false }, false)
    expect(remote.start).not.toHaveBeenCalled()
    const unavailable = commandRig({
      driver: {
        available: () => Promise.resolve({ ok: false, reason: 'permission denied' }),
        start: remote.start,
      },
    })
    await runScreenRecordingCommand(unavailable.port, false)
    expect(remote.start).not.toHaveBeenCalled()
  })

  it('keeps audio off by default, previews before sending and disposes countdown/Stop UI', async () => {
    const t = commandRig()
    await runScreenRecordingCommand(t.port, false)
    expect(t.start).toHaveBeenCalledWith(
      { maxSeconds: SCREEN_RECORDING_DEFAULT_MAX_SECONDS, microphone: false, systemAudio: false },
      expect.any(Function),
    )
    expect(t.port.attach).not.toHaveBeenCalled()
    expect(window.createWebviewPanel).toHaveBeenCalledOnce()
    const status: unknown = window.createStatusBarItem.mock.results.at(-1)?.value
    if (!(status instanceof FakeStatusBarItem)) throw new Error('expected status')
    expect(status.visible).toBe(false)
    expect(status.text).toContain('10s')
  })

  it('honors selected sound, cancellation, invalid bounds and latest-recording preview', async () => {
    const selected = [
      { label: 'Microphone', audio: 'microphone' },
      { label: 'System audio', audio: 'systemAudio' },
    ]
    selectAudio.mockResolvedValueOnce(selected)
    const t = commandRig()
    await runScreenRecordingCommand(t.port, false)
    expect(t.start).toHaveBeenCalledWith(
      expect.objectContaining({ microphone: true, systemAudio: true }),
      expect.any(Function),
    )
    selectAudio.mockResolvedValueOnce(undefined)
    const cancelled = commandRig()
    await runScreenRecordingCommand(cancelled.port, false)
    expect(cancelled.start).not.toHaveBeenCalled()
    const invalid = commandRig({ maxSeconds: 1 })
    await expect(runScreenRecordingCommand(invalid.port, false)).rejects.toThrow()
    expect(invalid.start).not.toHaveBeenCalled()
    window.createWebviewPanel.mockClear()
    await runScreenRecordingCommand(commandRig().port, true)
    expect(window.createWebviewPanel).not.toHaveBeenCalled()
    const latest = commandRig({ latest: () => Promise.resolve(preview()) })
    await runScreenRecordingCommand(latest.port, true)
    expect(latest.start).not.toHaveBeenCalled()
    expect(window.createWebviewPanel).toHaveBeenCalledOnce()
  })

  it('Stop settles the owned run and cleans its registration on success or failure', async () => {
    const { promise, resolve } = Promise.withResolvers<{
      readonly ok: false
      readonly reason: string
    }>()
    const t = commandRig()
    t.start.mockImplementation((_options, countdown) => {
      countdown(10)
      return Promise.resolve({ stop: t.stop, cancel: () => Promise.resolve(), result: promise })
    })
    const disposed = vi.fn()
    commands.registerCommand.mockReturnValue(new Disposable(disposed))
    const running = runScreenRecordingCommand(t.port, false)
    await vi.waitFor(() => {
      expect(commands.registerCommand).toHaveBeenCalled()
    })
    const registered = commands.registerCommand.mock.calls[0]?.[1]
    if (registered === undefined) throw new Error('expected Stop command')
    const result: unknown = registered()
    await result
    expect(t.stop).toHaveBeenCalledOnce()
    resolve({ ok: false, reason: 'permission denied' })
    await running
    expect(disposed).toHaveBeenCalledOnce()
    expect(window.createWebviewPanel).not.toHaveBeenCalled()
  })
})

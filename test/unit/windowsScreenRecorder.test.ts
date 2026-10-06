import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  windowsScreenRecorder,
  type WindowsRecorderDeps,
  type WindowsRecorderProcess,
} from '../../src/core/media/record/windows'
import { UI_TEXT } from '../../src/shared/l10n/text'
import {
  MILLISECONDS_PER_SECOND,
  PROCESS_TABLE_TIMEOUT_MS,
  SCREEN_RECORDING_RECENT_MAX_AGE_MS,
} from '../../src/shared/constants'
import type { MediaInfo } from '../../src/shared/media'
import type {
  ScreenRecordingDriver,
  ScreenRecordingOptions,
} from '../../src/core/media/record/driver'

const HELPER = String.raw`C:\installed\MuseSparkScreenRecord.exe`
const DIRECTORY = String.raw`C:\private\muse-spark-screen-test`
const OUTPUT = String.raw`C:\private\muse-spark-screen-test\recording.mp4`
const OPTIONS = { maxSeconds: 10, microphone: false, systemAudio: false }
const VIDEO: MediaInfo = {
  kind: 'video',
  mediaType: 'video/mp4',
  sizeBytes: 100,
  durationSeconds: 1,
  hasSoundtrack: false,
}

function setup() {
  let lineListener: (line: string) => void = vi.fn()
  let exitListener: (code: number | null) => void = vi.fn()
  let shutdown: () => void = vi.fn()
  const finish = (code = 0) => {
    lineListener(JSON.stringify({ type: 'complete' }))
    exitListener(code)
  }
  const child: WindowsRecorderProcess = {
    onLine: (listener) => {
      lineListener = listener
    },
    onExit: (listener) => {
      exitListener = listener
    },
    send: vi.fn(() => {
      finish()
    }),
    kill: vi.fn(() => {
      exitListener(1)
      return Promise.resolve()
    }),
  }
  const unsubscribe = vi.fn()
  const deps: WindowsRecorderDeps = {
    isLocal: true,
    isInteractiveUserAction: vi.fn(() => true),
    prepareHelper: vi.fn(() => Promise.resolve(HELPER)),
    probeRecording: vi.fn(() => Promise.resolve(true)),
    verifyHelper: vi.fn(() => Promise.resolve(true)),
    launch: vi.fn(() => child),
    reserveDirectory: vi.fn(() => Promise.resolve(DIRECTORY)),
    removeDirectory: vi.fn(() => Promise.resolve()),
    inspect: vi.fn(() => Promise.resolve(VIDEO)),
    onShutdown: vi.fn((cancel) => {
      shutdown = cancel
      return unsubscribe
    }),
    maxBytes: 100,
  }
  return {
    deps,
    child,
    unsubscribe,
    finish,
    line: (line: unknown) => {
      lineListener(typeof line === 'string' ? line : JSON.stringify(line))
    },
    exit: (code: number | null) => {
      exitListener(code)
    },
    shutdown: () => {
      shutdown()
    },
  }
}

async function outcomeOf(
  recorder: ScreenRecordingDriver,
  options: ScreenRecordingOptions = OPTIONS,
) {
  const run = await recorder.start(options, vi.fn())
  return await run.result
}

afterEach(() => {
  vi.useRealTimers()
})

describe('M105 R2 Windows screen recorder', () => {
  it('refuses tools, hooks and headless entry points before preparation or import', async () => {
    const harness = setup()
    const recorder = windowsScreenRecorder({
      ...harness.deps,
      isInteractiveUserAction: () => false,
    })
    expect(await outcomeOf(recorder)).toEqual({
      ok: false,
      reason: UI_TEXT.media.recordingUserOnly,
    })
    expect(await recorder.attachLatest()).toEqual({
      ok: false,
      reason: UI_TEXT.media.recordingUserOnly,
    })
    expect(harness.deps.prepareHelper).not.toHaveBeenCalled()
    expect(harness.deps.launch).not.toHaveBeenCalled()
  })

  it('refuses a remote host without launching any helper', async () => {
    const harness = setup()
    const recorder = windowsScreenRecorder({ ...harness.deps, isLocal: false })
    expect(await recorder.available()).toEqual({ ok: false, reason: UI_TEXT.media.recordingRemote })
    expect(await outcomeOf(recorder)).toEqual({
      ok: false,
      reason: UI_TEXT.media.recordingRemote,
    })
    expect(harness.deps.prepareHelper).not.toHaveBeenCalled()
  })

  it.each([
    { maxSeconds: 0, microphone: false, systemAudio: false },
    { maxSeconds: 601, microphone: false, systemAudio: false },
    { maxSeconds: 10.5, microphone: false, systemAudio: false },
  ])('refuses invalid recording bounds $maxSeconds before launch', async (options) => {
    const harness = setup()
    await expect(outcomeOf(windowsScreenRecorder(harness.deps), options)).resolves.toMatchObject({
      ok: false,
    })
    expect(harness.deps.launch).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, 1024 * 1024 * 1024 + 1])(
    'refuses an invalid byte cap %s',
    async (maxBytes) => {
      const harness = setup()
      await expect(
        outcomeOf(windowsScreenRecorder({ ...harness.deps, maxBytes })),
      ).resolves.toMatchObject({ ok: false })
      expect(harness.deps.launch).not.toHaveBeenCalled()
    },
  )

  it.each(['relative.exe', 'C:relative.exe'])(
    'requires an absolute helper path %s',
    async (helper) => {
      const harness = setup()
      const recorder = windowsScreenRecorder({
        ...harness.deps,
        prepareHelper: () => Promise.resolve(helper),
      })
      await expect(recorder.available()).resolves.toMatchObject({ ok: false })
      await expect(outcomeOf(recorder)).resolves.toMatchObject({ ok: false })
      expect(harness.deps.launch).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      title: 'revalidates the helper through the trusted-path port immediately before launch',
      isTrustFailure: true,
    },
    {
      title: 'refuses a user action which expires during asynchronous preparation',
      isTrustFailure: false,
    },
  ])('$title', async ({ isTrustFailure }) => {
    const harness = setup()
    const recorder = windowsScreenRecorder(harness.deps)
    if (isTrustFailure) {
      expect(await recorder.available()).toEqual({ ok: true })
      vi.mocked(harness.deps.verifyHelper).mockResolvedValue(false)
    } else {
      vi.mocked(harness.deps.isInteractiveUserAction)
        .mockReturnValueOnce(true)
        .mockReturnValue(false)
    }
    await expect(outcomeOf(recorder)).resolves.toMatchObject({ ok: false })
    expect(harness.deps.launch).not.toHaveBeenCalled()
    expect(harness.deps.removeDirectory).toHaveBeenCalledWith(DIRECTORY)
  })

  it('keeps latest import available when the capture service is unavailable', async () => {
    const harness = setup()
    vi.mocked(harness.deps.probeRecording).mockResolvedValue(false)
    const recorder = windowsScreenRecorder(harness.deps)
    await expect(recorder.available()).resolves.toMatchObject({ ok: false })
    const result = recorder.attachLatest()
    await vi.waitFor(() => {
      expect(harness.deps.launch).toHaveBeenCalled()
    })
    harness.finish()
    await expect(result).resolves.toMatchObject({ ok: true })
    expect(harness.deps.launch).toHaveBeenCalledWith(HELPER, [
      '--latest',
      DIRECTORY,
      '100',
      String(process.pid),
      String(SCREEN_RECORDING_RECENT_MAX_AGE_MS),
    ])
  })

  it('passes explicit per-recording sound choices, bounds and localized indicator labels', async () => {
    const harness = setup()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    expect(harness.deps.launch).toHaveBeenCalledWith(HELPER, [
      '--record',
      DIRECTORY,
      '100',
      String(process.pid),
      '10',
      'false',
      'false',
      UI_TEXT.media.recordingStart,
      UI_TEXT.media.recordingStop,
    ])
    harness.finish()
    const outcome = await run.result
    expect(outcome.ok).toBe(true)
    expect(harness.deps.inspect).toHaveBeenCalledWith(OUTPUT)
    expect(harness.deps.removeDirectory).not.toHaveBeenCalled()
    if (!outcome.ok) throw new Error('preview missing')
    await outcome.preview.dispose()
    await outcome.preview.dispose()
    expect(harness.deps.removeDirectory).toHaveBeenCalledTimes(1)
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
  })

  it('starts countdown only after capture begins, stops at the maximum and preserves the preview', async () => {
    vi.useFakeTimers()
    const harness = setup()
    const countdown = vi.fn()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, countdown)
    await vi.advanceTimersByTimeAsync(MILLISECONDS_PER_SECOND)
    expect(countdown).not.toHaveBeenCalled()
    harness.line({ type: 'recording' })
    expect(countdown).toHaveBeenLastCalledWith(10)
    await vi.advanceTimersByTimeAsync(10 * MILLISECONDS_PER_SECOND)
    expect(harness.child.send).toHaveBeenCalledWith('stop')
    await expect(run.result).resolves.toMatchObject({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles Stop early and deletes a preview on Cancel even after completion', async () => {
    const harness = setup()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    await run.stop()
    await expect(run.result).resolves.toMatchObject({ ok: true })
    await run.cancel()
    expect(harness.deps.removeDirectory).toHaveBeenCalledOnce()
  })

  it('cancels on host close or sleep and removes the private file', async () => {
    const harness = setup()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    harness.shutdown()
    expect(harness.child.send).toHaveBeenCalledWith('cancel')
    await expect(run.result).resolves.toMatchObject({ ok: false })
    expect(harness.deps.removeDirectory).toHaveBeenCalledOnce()
  })

  it('kills a helper which ignores Stop, waits for exit and refuses its unfinished output', async () => {
    vi.useFakeTimers()
    const harness = setup()
    vi.mocked(harness.child.send).mockImplementation(vi.fn())
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    const stop = run.stop()
    await vi.advanceTimersByTimeAsync(PROCESS_TABLE_TIMEOUT_MS)
    await stop
    expect(harness.child.kill).toHaveBeenCalledOnce()
    await expect(run.result).resolves.toMatchObject({ ok: false })
    expect(harness.deps.removeDirectory).toHaveBeenCalledOnce()
  })

  it.each([
    'not json',
    { type: 'complete', path: String.raw`C:\secret.mp4` },
    { type: 'surprise' },
  ])('rejects malformed or byte/path-bearing helper output', async (frame) => {
    const harness = setup()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    harness.line(frame)
    await expect(run.result).resolves.toMatchObject({ ok: false })
    expect(harness.child.send).toHaveBeenCalledWith('cancel')
    expect(harness.deps.inspect).not.toHaveBeenCalled()
  })

  it('shows permission recovery without passing arbitrary helper text through', async () => {
    const harness = setup()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    harness.line({ type: 'error', code: 'permission' })
    expect(await run.result).toEqual({ ok: false, reason: UI_TEXT.media.recordingPermissionDenied })
  })

  it('names the absence of a recent Snipping Tool recording', async () => {
    const harness = setup()
    const result = windowsScreenRecorder(harness.deps).attachLatest()
    await vi.waitFor(() => {
      expect(harness.deps.launch).toHaveBeenCalled()
    })
    harness.line({ type: 'error', code: 'noRecent' })
    expect(await result).toEqual({ ok: false, reason: UI_TEXT.media.recordingNoRecent })
  })

  it.each([
    { ...VIDEO, sizeBytes: 0 },
    { ...VIDEO, sizeBytes: 101 },
    { ...VIDEO, durationSeconds: null },
    { ...VIDEO, durationSeconds: 11 },
    { ...VIDEO, mediaType: 'video/webm' },
    { ...VIDEO, hasSoundtrack: true },
    { ...VIDEO, width: 0 },
    { kind: 'text', mediaType: 'text/plain', sizeBytes: 1 },
  ] satisfies MediaInfo[])(
    'sniffs the output and refuses invalid/capped/mismatched media %#',
    async (info) => {
      const harness = setup()
      vi.mocked(harness.deps.inspect).mockResolvedValue(info)
      const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
      harness.finish()
      await expect(run.result).resolves.toMatchObject({ ok: false })
      expect(harness.deps.removeDirectory).toHaveBeenCalledOnce()
    },
  )

  it('accepts a sniffed soundtrack only when explicitly selected', async () => {
    const harness = setup()
    vi.mocked(harness.deps.inspect).mockResolvedValue({ ...VIDEO, hasSoundtrack: true })
    const run = await windowsScreenRecorder(harness.deps).start(
      { ...OPTIONS, microphone: true, systemAudio: true },
      vi.fn(),
    )
    harness.finish()
    await expect(run.result).resolves.toMatchObject({ ok: true })
  })

  it('refuses a crashed helper even when it has emitted completion', async () => {
    const harness = setup()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    harness.finish(1)
    await expect(run.result).resolves.toMatchObject({ ok: false })
    expect(harness.deps.inspect).not.toHaveBeenCalled()
  })

  it('refuses success without a completion acknowledgement', async () => {
    const harness = setup()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    harness.exit(0)
    await expect(run.result).resolves.toMatchObject({ ok: false })
    expect(harness.deps.removeDirectory).toHaveBeenCalledOnce()
  })

  it('keeps host-close cancellation in force while the byte sniffer is still pending', async () => {
    const harness = setup()
    const controls: { resolve: (info: MediaInfo) => void } = { resolve: vi.fn() }
    const inspected = new Promise<MediaInfo>((resolve) => {
      controls.resolve = resolve
    })
    vi.mocked(harness.deps.inspect).mockReturnValue(inspected)
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    harness.finish()
    await vi.waitFor(() => {
      expect(harness.deps.inspect).toHaveBeenCalled()
    })
    harness.shutdown()
    controls.resolve(VIDEO)
    await expect(run.result).resolves.toMatchObject({ ok: false })
    expect(harness.deps.removeDirectory).toHaveBeenCalledOnce()
  })

  it('cancels a duplicate start acknowledgement instead of running a second countdown', async () => {
    const harness = setup()
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, vi.fn())
    harness.line({ type: 'recording' })
    harness.line({ type: 'recording' })
    await expect(run.result).resolves.toMatchObject({ ok: false })
    expect(harness.child.send).toHaveBeenCalledWith('cancel')
  })

  it('cancels if the visible countdown cannot be shown', async () => {
    const harness = setup()
    const countdown = vi.fn(() => {
      throw new Error('indicator unavailable')
    })
    const run = await windowsScreenRecorder(harness.deps).start(OPTIONS, countdown)
    harness.line({ type: 'recording' })
    await expect(run.result).resolves.toMatchObject({ ok: false })
  })

  it('admits one recording across asynchronous preparation and releases admission after exit', async () => {
    const harness = setup()
    const recorder = windowsScreenRecorder(harness.deps)
    const first = recorder.start(OPTIONS, vi.fn())
    const second = await recorder.start(OPTIONS, vi.fn())
    await expect(second.result).resolves.toMatchObject({ ok: false })
    const run = await first
    await run.cancel()
    expect(harness.deps.launch).toHaveBeenCalledTimes(1)
    const later = await recorder.start(OPTIONS, vi.fn())
    await later.cancel()
    expect(harness.deps.launch).toHaveBeenCalledTimes(2)
  })
})

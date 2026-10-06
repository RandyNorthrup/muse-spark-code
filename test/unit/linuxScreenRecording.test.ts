import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  linuxRecordingDriver,
  latestLinuxRecording,
  type LinuxRecordingPort,
  type LinuxLatestRecordingPort,
} from '../../src/core/media/record/linux'
import { UI_TEXT, SCREEN_RECORDING_RECENT_MAX_AGE_MS } from '../../src/shared/constants'

function deferred<T>() {
  return Promise.withResolvers<T>()
}
const OPTIONS = { maxSeconds: 10, microphone: false, systemAudio: false }
const INFO = {
  kind: 'video',
  mediaType: 'video/mp4',
  sizeBytes: 100,
  durationSeconds: 1,
  hasSoundtrack: false,
} as const
function setup() {
  const owner = new AbortController()
  const exited = deferred<boolean>()
  const closed = Promise.withResolvers<undefined>()
  const remove = vi.fn(() => Promise.resolve())
  const close = vi.fn(() => Promise.resolve())
  const stop = vi.fn(() => {
    exited.resolve(true)
    return Promise.resolve()
  })
  const cancel = vi.fn(() => {
    exited.resolve(false)
    return Promise.resolve()
  })
  const port: LinuxRecordingPort = {
    userInitiated: vi.fn(() => true),
    localScreen: vi.fn(() => true),
    signal: owner.signal,
    findEncoder: vi.fn(() => Promise.resolve('/usr/bin/gst-launch-1.0')),
    openPortal: vi.fn(() =>
      Promise.resolve({
        video: { fd: 3, nodeId: 42 },
        microphone: { fd: 4, nodeId: 43 },
        systemAudio: { fd: 5, nodeId: 44 },
        closed: closed.promise,
        close,
      }),
    ),
    createPrivateRecording: vi.fn(() =>
      Promise.resolve({ path: '/private/screen recording.mp4', remove }),
    ),
    launchVerified: vi.fn(() => Promise.resolve({ stop, cancel, result: exited.promise })),
    sniff: vi.fn(() => Promise.resolve(INFO)),
  }
  return {
    port,
    driver: linuxRecordingDriver(port),
    owner,
    exited,
    closed,
    remove,
    close,
    stop,
    cancel,
  }
}

afterEach(() => vi.useRealTimers())

describe('Linux portal recorder', () => {
  it('does nothing at construction or availability except probe verified encoder support', async () => {
    const h = setup()
    expect(h.port.findEncoder).not.toHaveBeenCalled()
    expect(await h.driver.available()).toEqual({ ok: true })
    expect(h.port.openPortal).not.toHaveBeenCalled()
    expect(h.port.launchVerified).not.toHaveBeenCalled()
  })

  it.each(['tool', 'remote', 'duration', 'missing', 'relative', 'aborted'])(
    'refuses %s before consent or launch',
    async (kind) => {
      const h = setup()
      switch (kind) {
        case 'tool': {
          vi.mocked(h.port.userInitiated).mockReturnValue(false)
          break
        }
        case 'remote': {
          vi.mocked(h.port.localScreen).mockReturnValue(false)
          break
        }
        case 'missing': {
          vi.mocked(h.port.findEncoder).mockResolvedValue(undefined)
          break
        }
        case 'relative': {
          vi.mocked(h.port.findEncoder).mockResolvedValue('gst-launch-1.0')
          break
        }
        case 'aborted': {
          {
            h.owner.abort()
            // No default
          }
          break
        }
      }
      const run = await h.driver.start(
        { ...OPTIONS, maxSeconds: kind === 'duration' ? 601 : 10 },
        vi.fn(),
      )
      expect(h.port.openPortal).not.toHaveBeenCalled()
      expect(h.port.launchVerified).not.toHaveBeenCalled()
      expect(await run.result).toMatchObject({ ok: false, reason: expect.any(String) })
      await run.stop()
      await run.cancel()
    },
  )

  it('availability refuses a failed encoder probe by name', async () => {
    const h = setup()
    vi.mocked(h.port.findEncoder).mockRejectedValue(new Error('private profile'))
    expect(await h.driver.available()).toMatchObject({
      ok: false,
      reason: expect.stringContaining('GStreamer'),
    })
  })

  it.each([3000, -3000])(
    'cancels on sleep or backwards wall clock %s without extending capture',
    async (jump) => {
      vi.useFakeTimers()
      const h = setup()
      const run = await h.driver.start({ ...OPTIONS, maxSeconds: 120 }, vi.fn())
      vi.setSystemTime(Date.now() + jump)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await run.result).toMatchObject({ ok: false })
      expect(h.cancel).toHaveBeenCalledTimes(1)
      expect(h.remove).toHaveBeenCalledTimes(1)
    },
  )

  it('starts only portal video, passes hard bounds to trusted launch, previews on Stop and disposes once', async () => {
    const h = setup()
    const countdown = vi.fn()
    const run = await h.driver.start(OPTIONS, countdown)
    expect(h.port.openPortal).toHaveBeenCalledWith(OPTIONS, expect.any(AbortSignal))
    const request = vi.mocked(h.port.launchVerified).mock.calls[0]![0]
    expect(request).toMatchObject({
      command: '/usr/bin/gst-launch-1.0',
      maxBytes: 209_715_200,
      maxSeconds: 10,
    })
    expect(request.sources).toEqual([{ fd: 3, nodeId: 42 }])
    expect(request.args).toContain('fd=3')
    expect(request.args).toContain('path=42')
    expect(request.args).toContain('location="/private/screen recording.mp4"')
    expect(request.args).not.toContain('audiomixer')
    expect(request.args).not.toContain('ximagesrc')
    expect(countdown).toHaveBeenCalledWith(10)
    await run.stop()
    await run.stop()
    expect(h.stop).toHaveBeenCalledTimes(1)
    const result = await run.result
    expect(result.ok).toBe(true)
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.remove).not.toHaveBeenCalled()
    if (!result.ok) throw new Error(result.reason)
    await result.preview.dispose()
    await result.preview.dispose()
    expect(h.remove).toHaveBeenCalledTimes(1)
  })

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])('records explicitly selected audio %s / %s', async (microphone, systemAudio) => {
    const h = setup()
    vi.mocked(h.port.sniff).mockResolvedValue({ ...INFO, hasSoundtrack: true })
    const run = await h.driver.start({ ...OPTIONS, microphone, systemAudio }, vi.fn())
    const request = vi.mocked(h.port.launchVerified).mock.calls[0]![0]
    expect(request.sources.map((source) => source.nodeId)).toEqual([
      42,
      ...(microphone ? [43] : []),
      ...(systemAudio ? [44] : []),
    ])
    expect(request.args).toContain('audiomixer')
    expect(request.args).toContain('avenc_aac')
    await run.stop()
    const result = await run.result
    expect(result.ok).toBe(true)
    if (result.ok) await result.preview.dispose()
  })

  it('honours maximum, keeps one writer at a time and cleans cancellation', async () => {
    vi.useFakeTimers()
    const h = setup()
    const run = await h.driver.start(OPTIONS, vi.fn())
    const duplicate = await h.driver.start(OPTIONS, vi.fn())
    expect(await duplicate.result).toMatchObject({ ok: false })
    expect(h.port.launchVerified).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await run.result
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    await run.cancel()
    expect(h.remove).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['cancel', 'close', 'owner', 'exit'])('cleans files and portal on %s', async (kind) => {
    const h = setup()
    const run = await h.driver.start(OPTIONS, vi.fn())
    switch (kind) {
      case 'cancel': {
        await run.cancel()
        break
      }
      case 'close': {
        h.closed.resolve(undefined)
        break
      }
      case 'owner': {
        h.owner.abort()
        break
      }
      case 'exit': {
        {
          h.exited.resolve(false)
          // No default
        }
        break
      }
    }
    expect(await run.result).toMatchObject({ ok: false })
    expect(h.remove).toHaveBeenCalledTimes(1)
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  it('deletes a completed preview when its owner closes', async () => {
    const h = setup()
    const run = await h.driver.start(OPTIONS, vi.fn())
    await run.stop()
    await run.result
    h.owner.abort()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.remove).toHaveBeenCalledTimes(1)
  })

  it.each(['fd', 'node', 'missing-audio', 'output', 'launch', 'permission', 'create'])(
    'cleans failed setup: %s',
    async (kind) => {
      const h = setup()
      if (['fd', 'node', 'missing-audio'].includes(kind)) {
        vi.mocked(h.port.openPortal).mockResolvedValue({
          video: { fd: kind === 'fd' ? -1 : 3, nodeId: kind === 'node' ? '42' : 42 },
          closed: h.closed.promise,
          close: h.close,
        })
      } else
        switch (kind) {
          case 'output': {
            vi.mocked(h.port.createPrivateRecording).mockResolvedValue({
              path: 'relative.mp4',
              remove: h.remove,
            })
            break
          }
          case 'launch': {
            vi.mocked(h.port.launchVerified).mockRejectedValue(new Error('untrusted'))
            break
          }
          case 'permission': {
            vi.mocked(h.port.openPortal).mockRejectedValue(new Error('private detail'))
            break
          }
          case 'create': {
            {
              vi.mocked(h.port.createPrivateRecording).mockRejectedValue(new Error('disk'))
              // No default
            }
            break
          }
        }
      const run = await h.driver.start(
        { ...OPTIONS, microphone: kind === 'missing-audio' },
        vi.fn(),
      )
      const result = await run.result
      expect(result).toMatchObject({ ok: false })
      expect(JSON.stringify(result)).not.toContain('private detail')
      if (kind !== 'permission') expect(h.close).toHaveBeenCalledTimes(1)
      if (kind === 'output' || kind === 'launch') expect(h.remove).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['empty', 'bytes', 'duration', 'unknown', 'sound', 'type', 'shape', 'sniff', 'kind'])(
    'rejects sniffed invalid output: %s',
    async (kind) => {
      const h = setup()
      const info = {
        ...INFO,
        sizeBytes: kind === 'empty' ? 0 : kind === 'bytes' ? 209_715_201 : 100,
        durationSeconds: kind === 'duration' ? 11 : kind === 'unknown' ? null : 1,
        hasSoundtrack: kind === 'sound',
        mediaType: kind === 'type' ? 'video/webm' : 'video/mp4',
        ...(kind === 'shape' && { bytes: 'canary' }),
      }
      vi.mocked(h.port.sniff).mockResolvedValue(
        kind === 'kind' ? { kind: 'image', mediaType: 'image/png', sizeBytes: 100 } : info,
      )
      if (kind === 'sniff') vi.mocked(h.port.sniff).mockRejectedValue(new Error('bad'))
      const run = await h.driver.start(OPTIONS, vi.fn())
      await run.stop()
      expect(await run.result).toMatchObject({ ok: false })
      expect(h.remove).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['fd-extra', 'nul-output', 'missing-system'])(
    'rejects malformed setup identities: %s',
    async (kind) => {
      const h = setup()
      if (kind === 'fd-extra')
        vi.mocked(h.port.openPortal).mockResolvedValue({
          video: { fd: 3, nodeId: 42, shell: 'injected' },
          closed: h.closed.promise,
          close: h.close,
        })
      else if (kind === 'nul-output')
        vi.mocked(h.port.createPrivateRecording).mockResolvedValue({
          path: '/private/' + String.fromCodePoint(0) + '.mp4',
          remove: h.remove,
        })
      else
        vi.mocked(h.port.openPortal).mockResolvedValue({
          video: { fd: 3, nodeId: 42 },
          closed: h.closed.promise,
          close: h.close,
        })
      const run = await h.driver.start(
        { ...OPTIONS, systemAudio: kind === 'missing-system' },
        vi.fn(),
      )
      expect(await run.result).toMatchObject({ ok: false })
      expect(h.port.launchVerified).not.toHaveBeenCalled()
    },
  )

  it('checks cancellation after the sniffer returns, before publishing a preview', async () => {
    const h = setup()
    const sniff = Promise.withResolvers<unknown>()
    vi.mocked(h.port.sniff).mockReturnValue(sniff.promise)
    const run = await h.driver.start(OPTIONS, vi.fn())
    const stopping = run.stop()
    await Promise.resolve()
    await Promise.resolve()
    h.owner.abort()
    sniff.resolve(INFO)
    await stopping
    expect(await run.result).toMatchObject({ ok: false })
    expect(h.remove).toHaveBeenCalledTimes(1)
  })

  it('does not start a helper if the owner closes during private file creation', async () => {
    const h = setup()
    const file =
      Promise.withResolvers<Awaited<ReturnType<LinuxRecordingPort['createPrivateRecording']>>>()
    vi.mocked(h.port.createPrivateRecording).mockReturnValue(file.promise)
    const pending = h.driver.start(OPTIONS, vi.fn())
    await Promise.resolve()
    await Promise.resolve()
    h.owner.abort()
    file.resolve({ path: '/private/late.mp4', remove: h.remove })
    const run = await pending
    expect(await run.result).toMatchObject({ ok: false })
    expect(h.port.launchVerified).not.toHaveBeenCalled()
    expect(h.remove).toHaveBeenCalledTimes(1)
  })

  it('cancels while the picker is pending and closes the late portal without launching', async () => {
    const h = setup()
    const portal = deferred<Awaited<ReturnType<LinuxRecordingPort['openPortal']>>>()
    vi.mocked(h.port.openPortal).mockReturnValue(portal.promise)
    const pending = h.driver.start(OPTIONS, vi.fn())
    await Promise.resolve()
    h.owner.abort()
    portal.resolve({ video: { fd: 3, nodeId: 42 }, closed: h.closed.promise, close: h.close })
    const run = await pending
    expect(await run.result).toMatchObject({ ok: false })
    expect(h.port.launchVerified).not.toHaveBeenCalled()
    expect(h.close).toHaveBeenCalledTimes(1)
  })
})

function latestSetup() {
  const dispose = vi.fn(() => Promise.resolve())
  const port: LinuxLatestRecordingPort = {
    roots: ['/home/user/Videos/Screencasts', '/home/user/Videos/Spectacle'],
    list: vi.fn(() => Promise.resolve([])),
    copyForPreview: vi.fn(() =>
      Promise.resolve({ path: '/private/copy.mp4', info: INFO, dispose }),
    ),
  }
  return { port, dispose }
}

describe('Linux Attach latest', () => {
  it('selects the newest fresh GNOME/Spectacle file and privately copies without removing the original', async () => {
    const h = latestSetup()
    vi.mocked(h.port.list).mockImplementation((root) =>
      Promise.resolve([
        { path: `${root}/clip.mp4`, modifiedAt: root.endsWith('Spectacle') ? 1000 : 999 },
      ]),
    )
    const result = await latestLinuxRecording(h.port, 1000)
    expect(result.ok).toBe(true)
    expect(h.port.copyForPreview).toHaveBeenCalledWith(
      '/home/user/Videos/Spectacle/clip.mp4',
      209_715_200,
    )
  })
  it('normalizes Windows separators and keeps GNOME WebM for the explicit conversion offer', async () => {
    const h = latestSetup()
    const root = String.raw`\home\user\Videos\Screencasts`
    vi.mocked(h.port.list).mockResolvedValue([
      { path: String.raw`${root}\clip.webm`, modifiedAt: 1000 },
    ])
    vi.mocked(h.port.copyForPreview).mockResolvedValue({
      path: '/private/copy.webm',
      info: { ...INFO, mediaType: 'video/webm' },
      dispose: h.dispose,
    })
    const result = await latestLinuxRecording({ ...h.port, roots: [root] }, 1000)
    expect(result.ok && result.preview.info.mediaType).toBe('video/webm')
  })
  it.each(['old', 'future', 'outside', 'nested', 'type', 'nan'])(
    'refuses %s candidates before copy',
    async (kind) => {
      const h = latestSetup()
      vi.mocked(h.port.list).mockResolvedValue([
        {
          path:
            kind === 'outside'
              ? '/private/clip.mp4'
              : `/home/user/Videos/Screencasts/${kind === 'nested' ? 'nested/' : ''}clip.${kind === 'type' ? 'txt' : 'mp4'}`,
          modifiedAt:
            new Map([
              ['old', 1000 - SCREEN_RECORDING_RECENT_MAX_AGE_MS - 1],
              ['future', 1001],
              ['nan', NaN],
            ]).get(kind) ?? 1000,
        },
      ])
      expect(await latestLinuxRecording(h.port, 1000)).toEqual({
        ok: false,
        reason: UI_TEXT.media.recordingNoRecent,
      })
      expect(h.port.copyForPreview).not.toHaveBeenCalled()
    },
  )
  it('refuses a relative recording root before copy', async () => {
    const h = latestSetup()
    vi.mocked(h.port.list).mockResolvedValue([
      { path: 'Videos/Screencasts/clip.mp4', modifiedAt: 1000 },
    ])
    const result = await latestLinuxRecording({ ...h.port, roots: ['Videos/Screencasts'] }, 1000)
    expect(result.ok).toBe(false)
    expect(h.port.copyForPreview).not.toHaveBeenCalled()
  })
  it.each(['empty', 'kind', 'schema'])('disposes an invalid latest preview: %s', async (kind) => {
    const h = latestSetup()
    vi.mocked(h.port.list).mockResolvedValue([
      { path: '/home/user/Videos/Screencasts/clip.mp4', modifiedAt: 1000 },
    ])
    const invalid =
      kind === 'kind'
        ? { kind: 'image', mediaType: 'image/png', sizeBytes: 100 }
        : {
            ...INFO,
            sizeBytes: kind === 'empty' ? 0 : 100,
            ...(kind === 'schema' && { secret: 'canary' }),
          }
    // The injected sniffer is an external boundary; replace its info at runtime
    // to prove the driver validates it rather than trusting TypeScript types.
    const preview = { path: '/private/copy.mp4', info: INFO, dispose: h.dispose }
    Object.defineProperty(preview, 'info', { value: invalid })
    vi.mocked(h.port.copyForPreview).mockResolvedValue(preview)
    const result = await latestLinuxRecording(h.port, 1000)
    expect(result.ok).toBe(false)
    expect(h.dispose).toHaveBeenCalledTimes(1)
  })
  it('continues when one desktop folder is absent', async () => {
    const h = latestSetup()
    vi.mocked(h.port.list)
      .mockRejectedValueOnce(new Error('absent'))
      .mockResolvedValueOnce([{ path: '/home/user/Videos/Spectacle/clip.mp4', modifiedAt: 1000 }])
    const result = await latestLinuxRecording(h.port, 1000)
    expect(result.ok).toBe(true)
  })
  it('disposes a private copy that sniffs as empty or oversized', async () => {
    const h = latestSetup()
    vi.mocked(h.port.list).mockResolvedValue([
      { path: '/home/user/Videos/Screencasts/clip.mp4', modifiedAt: 1000 },
    ])
    vi.mocked(h.port.copyForPreview).mockResolvedValue({
      path: '/private/copy.mp4',
      info: { ...INFO, sizeBytes: 209_715_201 },
      dispose: h.dispose,
    })
    const result = await latestLinuxRecording(h.port, 1000)
    expect(result.ok).toBe(false)
    expect(h.dispose).toHaveBeenCalledTimes(1)
  })
})

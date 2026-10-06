import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserRecordingController,
  type BrowserRecordingPort,
  type BrowserRecordingState,
} from '../../src/webview/media/recorder/browserRecorder'
import { UI_TEXT } from '../../src/shared/constants'

const OPTIONS = { maxSeconds: 10, microphone: false, systemAudio: false }
type Capture = Awaited<ReturnType<BrowserRecordingPort['capture']>>
type Events = Parameters<ReturnType<Capture['createRecorder']>['listen']>[0]
class Track extends EventTarget {
  public readyState: MediaStreamTrackState = 'live'
  public readonly stop = vi.fn(() => {
    this.readyState = 'ended'
  })
}
function setup() {
  const track = new Track()
  let events: Events | undefined
  const stop = vi.fn(() => {
    events?.data(new Blob(['mp4'], { type: 'video/mp4' }))
    events?.stopped()
  })
  const start = vi.fn()
  const unlisten = vi.fn(() => {
    events = undefined
  })
  const release = vi.fn(() => {
    track.stop()
  })
  const capture: Capture = {
    tracks: [track],
    release,
    createRecorder: vi.fn(() => ({
      start,
      stop,
      listen: (listeners: Events) => {
        events = listeners
        return unlisten
      },
    })),
  }
  const port: BrowserRecordingPort = {
    browser: 'Test Browser',
    supportsMp4: vi.fn(() => true),
    capture: vi.fn(() => Promise.resolve(capture)),
    objectUrl: vi.fn(() => 'blob:private-preview'),
    revokeUrl: vi.fn(),
    attach: vi.fn(() => Promise.resolve()),
  }
  let state: BrowserRecordingState = { status: 'idle' }
  const changed = vi.fn((update: BrowserRecordingState) => {
    state = update
  })
  const controller = new BrowserRecordingController(port, changed)
  return {
    controller,
    port,
    capture,
    track,
    start,
    stop,
    release,
    unlisten,
    changed,
    state: () => state,
    events: () => events,
  }
}
async function pendingPreviewUpload(h: ReturnType<typeof setup>) {
  const upload = Promise.withResolvers<undefined>()
  vi.mocked(h.port.attach).mockReturnValue(upload.promise)
  await h.controller.start(OPTIONS, true)
  h.controller.stop()
  return { upload, attaching: h.controller.attach() }
}

afterEach(() => vi.useRealTimers())

describe('companion recording lifecycle', () => {
  it('does not capture or upload at construction, attach or Stop before Start', async () => {
    const h = setup()
    await h.controller.attach()
    h.controller.stop()
    expect(h.port.capture).not.toHaveBeenCalled()
    expect(h.port.attach).not.toHaveBeenCalled()
  })
  it('refuses non-user starts before capture', async () => {
    const h = setup()
    await h.controller.start(OPTIONS, false)
    expect(h.state()).toEqual({ status: 'error', reason: UI_TEXT.media.recordingUserOnly })
    expect(h.port.capture).not.toHaveBeenCalled()
  })
  it('refuses an unsupported browser by name before permission', async () => {
    const h = setup()
    vi.mocked(h.port.supportsMp4).mockReturnValue(false)
    await h.controller.start(OPTIONS, true)
    expect(h.state()).toMatchObject({
      status: 'error',
      reason: expect.stringContaining('Test Browser'),
    })
    expect(h.port.capture).not.toHaveBeenCalled()
  })
  it.each([0, 9, 601, NaN])(
    'refuses invalid recording bounds %s before capture',
    async (maxSeconds) => {
      const h = setup()
      await h.controller.start({ ...OPTIONS, maxSeconds }, true)
      expect(h.state().status).toBe('error')
      expect(h.port.capture).not.toHaveBeenCalled()
    },
  )
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'passes explicit sound selections %s/%s and stops to preview without uploading',
    async (microphone, systemAudio) => {
      const h = setup()
      const options = { ...OPTIONS, microphone, systemAudio }
      await h.controller.start(options, true)
      expect(h.port.capture).toHaveBeenCalledWith(options, expect.any(AbortSignal))
      expect(h.state()).toEqual({ status: 'recording', remaining: 10 })
      expect(h.start).toHaveBeenCalledWith(1000)
      h.controller.stop()
      expect(h.track.stop).toHaveBeenCalled()
      expect(h.release).toHaveBeenCalledTimes(1)
      expect(h.unlisten).toHaveBeenCalledTimes(1)
      expect(h.state()).toEqual({ status: 'preview', url: 'blob:private-preview' })
      expect(h.port.attach).not.toHaveBeenCalled()
      h.controller.discard()
      expect(h.port.revokeUrl).toHaveBeenCalledWith('blob:private-preview')
    },
  )
  it('attaches only after preview and releases the blob and URL after successful upload', async () => {
    const h = setup()
    await h.controller.start(OPTIONS, true)
    await h.controller.attach()
    expect(h.port.attach).not.toHaveBeenCalled()
    h.controller.stop()
    await h.controller.attach()
    const [blob, signal] = vi.mocked(h.port.attach).mock.calls[0]!
    expect(blob.type).toBe('video/mp4')
    expect(blob.size).toBe(3)
    expect(signal.aborted).toBe(true)
    expect(h.state().status).toBe('idle')
    expect(h.port.revokeUrl).toHaveBeenCalledTimes(1)
  })
  it('refuses a second Attach while its first upload is pending', async () => {
    const h = setup()
    const { upload, attaching: first } = await pendingPreviewUpload(h)
    const second = h.controller.attach()
    expect(h.port.attach).toHaveBeenCalledTimes(1)
    upload.resolve(undefined)
    await first
    await second
  })

  it('stops live tracks immediately while the final mp4 flush is pending', async () => {
    const h = setup()
    h.stop.mockImplementation(() => {
      /* Test controls the final flush events. */
    })
    await h.controller.start(OPTIONS, true)
    const events = h.events()!
    h.controller.stop()
    expect(h.track.stop).toHaveBeenCalledTimes(1)
    expect(h.release).not.toHaveBeenCalled()
    events.data(new Blob(['mp4']))
    events.stopped()
    expect(h.state().status).toBe('preview')
    h.controller.discard()
  })

  it('discards without uploading, even when a late stop callback arrives', async () => {
    const h = setup()
    await h.controller.start(OPTIONS, true)
    const late = h.events()!
    h.controller.discard()
    late.data(new Blob(['late']))
    late.stopped()
    late.error()
    expect(h.state().status).toBe('idle')
    expect(h.port.attach).not.toHaveBeenCalled()
    expect(h.port.objectUrl).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledTimes(1)
  })
  it('rejects the first over-limit chunk, stops every track and never creates a preview', async () => {
    const h = setup()
    await h.controller.start(OPTIONS, true)
    const huge = new Blob(['x'])
    Object.defineProperty(huge, 'size', { value: 209_715_201 })
    h.events()!.data(huge)
    expect(h.state()).toEqual({ status: 'error', reason: UI_TEXT.execFileTooLarge })
    expect(h.track.stop).toHaveBeenCalled()
    expect(h.port.objectUrl).not.toHaveBeenCalled()
    expect(h.port.attach).not.toHaveBeenCalled()
  })
  it('enforces the cumulative limit across chunks', async () => {
    const h = setup()
    await h.controller.start(OPTIONS, true)
    const chunk = new Blob(['x'])
    Object.defineProperty(chunk, 'size', { value: 104_857_601 })
    h.events()!.data(chunk)
    h.events()!.data(chunk)
    expect(h.state().status).toBe('error')
    expect(h.release).toHaveBeenCalledTimes(1)
  })
  it('counts down and stops at the maximum using repository-default test timeout', async () => {
    vi.useFakeTimers()
    const h = setup()
    await h.controller.start(OPTIONS, true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.state()).toEqual({ status: 'recording', remaining: 9 })
    await vi.advanceTimersByTimeAsync(9000)
    expect(h.state().status).toBe('preview')
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    h.controller.discard()
  })
  it.each([3000, -3000])(
    'stops after sleep or wall clock jump %s without extending the recording',
    async (jump) => {
      vi.useFakeTimers()
      const h = setup()
      await h.controller.start({ ...OPTIONS, maxSeconds: 120 }, true)
      vi.setSystemTime(Date.now() + jump)
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.state().status).toBe('preview')
      expect(h.track.stop).toHaveBeenCalled()
      h.controller.discard()
    },
  )
  it('stops when the operating system ends a capture track', async () => {
    const h = setup()
    await h.controller.start(OPTIONS, true)
    h.track.dispatchEvent(new Event('ended'))
    expect(h.state().status).toBe('preview')
    expect(h.release).toHaveBeenCalledTimes(1)
    h.controller.discard()
  })
  it('shows permission recovery without exposing browser error details', async () => {
    const h = setup()
    vi.mocked(h.port.capture).mockRejectedValue(new Error('private profile/account'))
    await h.controller.start(OPTIONS, true)
    expect(h.state()).toEqual({ status: 'error', reason: UI_TEXT.media.recordingPermissionDenied })
  })
  it.each([
    'track',
    'empty-tracks',
    'constructor',
    'start',
    'stop',
    'empty-output',
    'recorder',
    'url',
  ])('cleans failure at %s', async (kind) => {
    const h = setup()
    switch (kind) {
      case 'track': {
        h.track.readyState = 'ended'
        break
      }
      case 'empty-tracks': {
        vi.mocked(h.port.capture).mockResolvedValue({ ...h.capture, tracks: [] })
        break
      }
      case 'constructor': {
        vi.mocked(h.capture.createRecorder).mockImplementation(() => {
          throw new Error('encoder')
        })
        break
      }
      case 'start': {
        h.start.mockImplementation(() => {
          throw new Error('start')
        })
        break
      }
      case 'stop': {
        h.stop.mockImplementation(() => {
          throw new Error('stop')
        })
        break
      }
      case 'empty-output': {
        h.stop.mockImplementation(() => {
          h.events()?.stopped()
        })
        break
      }
      case 'url': {
        {
          vi.mocked(h.port.objectUrl).mockImplementation(() => {
            throw new Error('url')
          })
          // No default
        }
        break
      }
    }
    await h.controller.start(OPTIONS, true)
    if (kind === 'recorder') h.events()!.error()
    else h.controller.stop()
    expect(h.state().status).toBe('error')
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(h.port.attach).not.toHaveBeenCalled()
  })
  it('handles a preview URL failure from an asynchronous recorder Stop event', async () => {
    const h = setup()
    h.stop.mockImplementation(() => {
      /* Flush events arrive after Stop returns. */
    })
    vi.mocked(h.port.objectUrl).mockImplementation(() => {
      throw new Error('private URL failure')
    })
    await h.controller.start(OPTIONS, true)
    const events = h.events()!
    h.controller.stop()
    events.data(new Blob(['mp4']))
    expect(() => {
      events.stopped()
    }).not.toThrow()
    expect(h.state()).toEqual({ status: 'error', reason: UI_TEXT.media.recordingPermissionDenied })
    expect(h.release).toHaveBeenCalledTimes(1)
  })

  it('cancels pending permissions and releases late resources without starting a recorder', async () => {
    const h = setup()
    const pending = Promise.withResolvers<Capture>()
    vi.mocked(h.port.capture).mockReturnValue(pending.promise)
    const start = h.controller.start(OPTIONS, true)
    h.controller.discard()
    expect(vi.mocked(h.port.capture).mock.calls[0]![1].aborted).toBe(true)
    pending.resolve(h.capture)
    await start
    expect(h.capture.createRecorder).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(h.state().status).toBe('idle')
  })
  it('refuses concurrent starts while the picker is pending', async () => {
    const h = setup()
    const pending = Promise.withResolvers<Capture>()
    vi.mocked(h.port.capture).mockReturnValue(pending.promise)
    const first = h.controller.start(OPTIONS, true)
    await h.controller.start(OPTIONS, true)
    expect(h.port.capture).toHaveBeenCalledTimes(1)
    pending.resolve(h.capture)
    await first
    h.controller.discard()
  })
  it('aborts upload on owner close and ignores its late completion', async () => {
    const h = setup()
    const { upload, attaching: attached } = await pendingPreviewUpload(h)
    h.controller.discard()
    expect(vi.mocked(h.port.attach).mock.calls[0]![1].aborted).toBe(true)
    upload.resolve(undefined)
    await attached
    expect(h.state().status).toBe('idle')
    expect(h.port.revokeUrl).toHaveBeenCalledTimes(1)
  })
  it.each(['resolve', 'reject'])(
    'ignores late upload %s while a new recording is running',
    async (settlement) => {
      const h = setup()
      const { upload, attaching } = await pendingPreviewUpload(h)
      h.controller.discard()
      h.track.readyState = 'live'
      await h.controller.start(OPTIONS, true)
      if (settlement === 'resolve') upload.resolve(undefined)
      else upload.reject(new Error('old upload'))
      await attaching
      expect(h.state()).toEqual({ status: 'recording', remaining: 10 })
      expect(h.track.readyState).toBe('live')
      h.controller.discard()
    },
  )

  it('cleans failed upload without retaining bytes or leaking endpoint details', async () => {
    const h = setup()
    vi.mocked(h.port.attach).mockRejectedValue(new Error('private endpoint'))
    await h.controller.start(OPTIONS, true)
    h.controller.stop()
    await h.controller.attach()
    expect(h.state()).toEqual({ status: 'error', reason: 'Upload failed: mp4' })
    expect(h.port.revokeUrl).toHaveBeenCalledTimes(1)
  })
})

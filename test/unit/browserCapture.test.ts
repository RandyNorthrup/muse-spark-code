// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { companionBrowserPort } from '../../src/webview/media/recorder/browserCapture'
import { UI_TEXT } from '../../src/shared/constants'

class Track extends EventTarget {
  public readyState: MediaStreamTrackState = 'live'
  public readonly stop = vi.fn(() => {
    this.readyState = 'ended'
  })
  public constructor(public readonly kind: string) {
    super()
  }
}
class Stream {
  public constructor(private tracks: Track[] = []) {}
  public getTracks() {
    return this.tracks
  }
  public getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio')
  }
  public getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video')
  }
  public addTrack(track: Track) {
    this.tracks.push(track)
  }
  public removeTrack(track: Track) {
    this.tracks = this.tracks.filter((candidate) => candidate !== track)
  }
}
class Recorder extends EventTarget {
  public static readonly isTypeSupported = vi.fn().mockReturnValue(true)
  public static last: Recorder | undefined
  public readonly start = vi.fn()
  public readonly stop = vi.fn()
  public constructor(
    public readonly stream: Stream,
    public readonly options: MediaRecorderOptions,
  ) {
    super()
    Recorder.last = this
  }
}
class Mixer {
  public static last: Mixer | undefined
  public state = 'running'
  public readonly destination = new Stream([new Track('audio')])
  public readonly connect = vi.fn()
  public readonly createMediaStreamSource = vi.fn(() => ({ connect: this.connect }))
  public readonly createMediaStreamDestination = vi.fn(() => ({ stream: this.destination }))
  public readonly resume = vi.fn().mockResolvedValue(undefined)
  public readonly close = vi.fn(() => {
    this.state = 'closed'
    return Promise.resolve()
  })
  public constructor() {
    Mixer.last = this
  }
}
const OPTIONS = { maxSeconds: 10, microphone: false, systemAudio: false }
function setup() {
  const video = new Track('video')
  const sound = new Track('audio')
  const mic = new Track('audio')
  const screen = new Stream([video, sound])
  const display = vi.fn(() => Promise.resolve(screen))
  const microphone = vi.fn(() => Promise.resolve(new Stream([mic])))
  vi.stubGlobal('navigator', {
    mediaDevices: { getDisplayMedia: display, getUserMedia: microphone },
  })
  const attach = vi.fn().mockResolvedValue(undefined)
  const owner = new AbortController()
  const port = companionBrowserPort('Browser', attach)
  return { port, owner, attach, display, microphone, video, sound, mic, screen }
}
beforeEach(() => {
  vi.stubGlobal('MediaStream', Stream)
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('AudioContext', Mixer)
  Recorder.isTypeSupported.mockReturnValue(true)
  Recorder.last = undefined
  Mixer.last = undefined
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('real companion browser API binding', () => {
  it('probes mp4 support without requesting capture and refuses absent browser APIs', () => {
    const h = setup()
    expect(h.port.supportsMp4()).toBe(true)
    expect(Recorder.isTypeSupported).toHaveBeenCalledWith('video/mp4')
    expect(h.display).not.toHaveBeenCalled()
    Recorder.isTypeSupported.mockReturnValue(false)
    expect(h.port.supportsMp4()).toBe(false)
    vi.stubGlobal('MediaRecorder', undefined)
    expect(h.port.supportsMp4()).toBe(false)
    vi.stubGlobal('MediaRecorder', Recorder)
    Recorder.isTypeSupported.mockReturnValue(true)
    vi.stubGlobal('navigator', {})
    expect(h.port.supportsMp4()).toBe(false)
  })
  it('requests silent display by default, removes unsolicited audio and never opens a microphone', async () => {
    const h = setup()
    const capture = await h.port.capture(OPTIONS, h.owner.signal)
    expect(h.display).toHaveBeenCalledWith({ video: true, audio: false })
    expect(h.microphone).not.toHaveBeenCalled()
    expect(h.sound.stop).toHaveBeenCalledTimes(1)
    const encoder = capture.createRecorder()
    expect(Recorder.last?.stream.getAudioTracks()).toHaveLength(0)
    expect(Recorder.last?.options).toEqual({ mimeType: 'video/mp4' })
    const data = vi.fn()
    const stopped = vi.fn()
    const error = vi.fn()
    const remove = encoder.listen({ data, stopped, error })
    encoder.start(1000)
    encoder.stop()
    expect(Recorder.last?.start).toHaveBeenCalledWith(1000)
    const blob = new Blob(['mp4'], { type: 'video/mp4' })
    Recorder.last!.dispatchEvent(Object.assign(new Event('dataavailable'), { data: blob }))
    Recorder.last!.dispatchEvent(new Event('stop'))
    Recorder.last!.dispatchEvent(new Event('error'))
    expect(data).toHaveBeenCalledWith(blob)
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
    remove()
    Recorder.last!.dispatchEvent(new Event('stop'))
    expect(stopped).toHaveBeenCalledTimes(1)
    capture.release()
    expect(h.video.stop).toHaveBeenCalledTimes(1)
  })
  it('records system audio only when selected and does not request the microphone', async () => {
    const h = setup()
    const capture = await h.port.capture({ ...OPTIONS, systemAudio: true }, h.owner.signal)
    capture.createRecorder()
    expect(h.display).toHaveBeenCalledWith({ video: true, audio: true })
    expect(Recorder.last?.stream.getAudioTracks()).toEqual([h.sound])
    expect(h.microphone).not.toHaveBeenCalled()
    capture.release()
    expect(h.sound.stop).toHaveBeenCalled()
  })
  it.each([false, true])('mixes selected microphone, with system audio %s', async (systemAudio) => {
    const h = setup()
    const capture = await h.port.capture(
      { ...OPTIONS, microphone: true, systemAudio },
      h.owner.signal,
    )
    capture.createRecorder()
    expect(h.microphone).toHaveBeenCalledWith({ audio: true, video: false })
    expect(Mixer.last?.createMediaStreamSource).toHaveBeenCalledTimes(systemAudio ? 2 : 1)
    expect(Mixer.last?.resume).toHaveBeenCalledTimes(1)
    expect(Recorder.last?.stream.getAudioTracks()).toEqual(Mixer.last?.destination.getAudioTracks())
    capture.release()
    expect(h.video.stop).toHaveBeenCalled()
    expect(h.mic.stop).toHaveBeenCalled()
    expect(Mixer.last?.close).toHaveBeenCalledTimes(1)
    expect(Mixer.last?.destination.getTracks()[0]?.stop).toHaveBeenCalled()
  })
  it.each(['system', 'microphone', 'permission'])(
    'cleans denied or missing %s audio',
    async (kind) => {
      const h = setup()
      if (kind === 'system') h.screen.removeTrack(h.sound)
      else if (kind === 'microphone') h.microphone.mockResolvedValue(new Stream())
      else h.microphone.mockRejectedValue(new Error('permission'))
      await expect(
        h.port.capture(
          { ...OPTIONS, systemAudio: kind === 'system', microphone: kind !== 'system' },
          h.owner.signal,
        ),
      ).rejects.toThrow()
      expect(h.video.stop).toHaveBeenCalled()
    },
  )
  it('stops screen tracks immediately when owner closes while microphone consent is pending', async () => {
    const h = setup()
    const microphone = Promise.withResolvers<Stream>()
    h.microphone.mockReturnValue(microphone.promise)
    const capture = h.port.capture({ ...OPTIONS, microphone: true }, h.owner.signal)
    await Promise.resolve()
    h.owner.abort()
    expect(h.video.stop).toHaveBeenCalled()
    microphone.resolve(new Stream([h.mic]))
    await expect(capture).rejects.toThrow(UI_TEXT.media.recordingPermissionDenied)
    expect(h.mic.stop).toHaveBeenCalled()
  })
  it('refuses capture after its lifecycle was already aborted', async () => {
    const h = setup()
    h.owner.abort()
    await expect(h.port.capture(OPTIONS, h.owner.signal)).rejects.toThrow(
      UI_TEXT.media.recordingPermissionDenied,
    )
    expect(h.display).not.toHaveBeenCalled()
  })
  it('stops a late display permission result after close', async () => {
    const h = setup()
    const display = Promise.withResolvers<Stream>()
    h.display.mockReturnValue(display.promise)
    const capture = h.port.capture(OPTIONS, h.owner.signal)
    h.owner.abort()
    display.resolve(h.screen)
    await expect(capture).rejects.toThrow(UI_TEXT.media.recordingPermissionDenied)
    expect(h.video.stop).toHaveBeenCalled()
  })
  it('does not stop an already inactive MediaRecorder a second time', async () => {
    const h = setup()
    const capture = await h.port.capture(OPTIONS, h.owner.signal)
    const encoder = capture.createRecorder()
    Object.defineProperty(Recorder.last, 'state', { value: 'inactive' })
    encoder.stop()
    expect(Recorder.last?.stop).not.toHaveBeenCalled()
    capture.release()
  })
  it('delegates only explicit attach and revokes private browser URLs', async () => {
    const h = setup()
    const objectUrl = vi.fn(() => 'blob:private')
    const revokeUrl = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: objectUrl, revokeObjectURL: revokeUrl })
    const blob = new Blob(['mp4'])
    expect(h.port.objectUrl(blob)).toBe('blob:private')
    h.port.revokeUrl('blob:private')
    expect(revokeUrl).toHaveBeenCalledWith('blob:private')
    expect(h.attach).not.toHaveBeenCalled()
    await h.port.attach(blob, h.owner.signal)
    expect(h.attach).toHaveBeenCalledWith(blob, h.owner.signal)
  })
})

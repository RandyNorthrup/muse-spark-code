// Only the companion page owns browser capture. Upload is an injected E3 port.
import {
  MEDIA_FILE_ID_MIN_BYTES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { screenRecordingOptionsSchema } from '../../../shared/media'

interface Options {
  readonly maxSeconds: number
  readonly microphone: boolean
  readonly systemAudio: boolean
}

interface CaptureRecorder {
  readonly start: (timeslice: number) => void
  readonly stop: () => void
  readonly listen: (events: {
    readonly data: (blob: Blob) => void
    readonly stopped: () => void
    readonly error: () => void
  }) => () => void
}

interface BrowserCapture {
  readonly tracks: readonly Pick<
    MediaStreamTrack,
    'stop' | 'readyState' | 'addEventListener' | 'removeEventListener'
  >[]
  readonly createRecorder: () => CaptureRecorder
  /** Stops every screen/microphone track and closes any audio mixer. */
  readonly release: () => void
}

export interface BrowserRecordingPort {
  readonly browser: string
  readonly supportsMp4: () => boolean
  readonly capture: (options: Options, signal: AbortSignal) => Promise<BrowserCapture>
  readonly objectUrl: (blob: Blob) => string
  readonly revokeUrl: (url: string) => void
  /** E3 streams to its guarded endpoint. No request before explicit Attach. */
  readonly attach: (blob: Blob, signal: AbortSignal) => Promise<void>
}

export type BrowserRecordingState =
  | { readonly status: 'idle' | 'requesting' | 'stopping' | 'uploading' }
  | { readonly status: 'recording'; readonly remaining: number }
  | { readonly status: 'preview'; readonly url: string }
  | { readonly status: 'error'; readonly reason: string }

export class BrowserRecordingController {
  private state: BrowserRecordingState = { status: 'idle' }
  private epoch = 0
  private capture: BrowserCapture | undefined
  private recorder: CaptureRecorder | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private unlisten: (() => void) | undefined
  private blob: Blob | undefined
  private url: string | undefined
  private upload: AbortController | undefined
  private acquisition: AbortController | undefined

  public constructor(
    private readonly port: BrowserRecordingPort,
    private readonly changed: (state: BrowserRecordingState) => void,
  ) {}

  private fail(reason: string): void {
    this.clear()
    this.set({ status: 'error', reason })
  }

  private set(state: BrowserRecordingState): void {
    this.state = state
    this.changed(state)
  }
  private clearTimer(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }
  private releaseCapture(): void {
    this.clearTimer()
    this.unlisten?.()
    this.unlisten = undefined
    this.recorder = undefined
    this.capture?.release()
    this.capture = undefined
  }
  private clear(): void {
    ++this.epoch
    this.acquisition?.abort()
    this.acquisition = undefined
    this.upload?.abort()
    this.upload = undefined
    const recorder = this.recorder
    this.releaseCapture()
    try {
      recorder?.stop()
    } catch {
      /* Already stopped recorders need no second Stop. */
    }
    if (this.url !== undefined) this.port.revokeUrl(this.url)
    this.url = undefined
    this.blob = undefined
  }

  public async start(input: Options, isUserInitiated: boolean): Promise<void> {
    if (this.state.status !== 'idle' && this.state.status !== 'error') return
    if (!isUserInitiated) {
      this.fail(UI_TEXT.media.recordingUserOnly)
      return
    }
    if (!this.port.supportsMp4()) {
      this.fail(fill(UI_TEXT.media.recordingBrowserUnsupported, { browser: this.port.browser }))
      return
    }
    const options = screenRecordingOptionsSchema.safeParse(input)
    if (!options.success) {
      this.fail(UI_TEXT.media.recordingUserOnly)
      return
    }
    const epoch = ++this.epoch
    this.set({ status: 'requesting' })
    let acquired: BrowserCapture | undefined
    let isRequesting = true
    try {
      this.acquisition = new AbortController()
      acquired = await this.port.capture(options.data, this.acquisition.signal)
      isRequesting = false
      if (epoch !== this.epoch) {
        acquired.release()
        return
      }
      const capture = acquired
      this.capture = capture
      if (
        capture.tracks.length === 0 ||
        capture.tracks.some((track) => track.readyState !== 'live')
      ) {
        this.fail(UI_TEXT.media.recordingFailed)
        return
      }
      const recorder = capture.createRecorder()
      this.recorder = recorder
      const chunks: Blob[] = []
      let bytes = 0
      const unlistenRecorder = recorder.listen({
        data: (blob) => {
          if (epoch !== this.epoch) return
          bytes += blob.size
          if (bytes > MEDIA_MAX_UPLOAD_DEFAULT_MIB * MEDIA_FILE_ID_MIN_BYTES) {
            chunks.length = 0
            this.fail(UI_TEXT.execFileTooLarge)
          } else chunks.push(blob)
        },
        stopped: () => {
          if (epoch !== this.epoch) return
          try {
            this.releaseCapture()
            if (bytes === 0) {
              this.fail(UI_TEXT.media.recordingFailed)
              return
            }
            this.blob = new Blob(chunks, { type: 'video/mp4' })
            this.url = this.port.objectUrl(this.blob)
            this.set({ status: 'preview', url: this.url })
          } catch {
            this.fail(UI_TEXT.media.recordingFailed)
          }
        },
        error: () => {
          if (epoch === this.epoch) this.fail(UI_TEXT.media.recordingFailed)
        },
      })
      const ended = () => {
        this.stop()
      }
      for (const track of capture.tracks) track.addEventListener('ended', ended)
      this.unlisten = () => {
        unlistenRecorder()
        for (const track of capture.tracks) track.removeEventListener('ended', ended)
      }
      const started = performance.now()
      let previous = Date.now()
      this.set({ status: 'recording', remaining: options.data.maxSeconds })
      recorder.start(MILLISECONDS_PER_SECOND)
      this.timer = setInterval(() => {
        const now = Date.now()
        const remaining = Math.max(
          0,
          options.data.maxSeconds -
            Math.floor((performance.now() - started) / MILLISECONDS_PER_SECOND),
        )
        if (remaining === 0 || now < previous || now - previous > 2 * MILLISECONDS_PER_SECOND) {
          this.stop()
          return
        }
        previous = now
        if (this.state.status === 'recording') this.set({ status: 'recording', remaining })
      }, MILLISECONDS_PER_SECOND)
    } catch (error) {
      if (epoch === this.epoch)
        this.fail(
          isRequesting && error instanceof Error && error.name === 'NotAllowedError'
            ? UI_TEXT.media.recordingPermissionDenied
            : UI_TEXT.media.recordingFailed,
        )
      else acquired?.release()
    }
  }

  public stop(): void {
    if (this.state.status !== 'recording') return
    this.clearTimer()
    this.set({ status: 'stopping' })
    // Release live tracks immediately; the recorder still flushes its last chunk.
    const tracks = this.capture?.tracks ?? []
    for (const track of tracks) track.stop()
    try {
      this.recorder?.stop()
    } catch {
      this.fail(UI_TEXT.media.recordingFailed)
    }
  }

  public async attach(): Promise<void> {
    if (this.state.status !== 'preview' || this.blob === undefined) return
    const epoch = this.epoch
    const upload = new AbortController()
    this.upload = upload
    this.set({ status: 'uploading' })
    try {
      await this.port.attach(this.blob, upload.signal)
      if (epoch === this.epoch) this.discard()
    } catch {
      if (epoch === this.epoch) this.fail(fill(UI_TEXT.media.uploadFailed, { reason: 'mp4' }))
    }
  }

  /** Also used for pagehide, editor close and owner disposal. */
  public discard(): void {
    this.clear()
    this.set({ status: 'idle' })
  }
}

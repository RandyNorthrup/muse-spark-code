// Muse Voice (M35, PLAN.md D30): the paid, opt-in dictation engine. The
// microphone's audio comes from a capture helper (the same resident-helper
// driver as the free engine, with "audio" lines instead of "text"), and is
// streamed to Meta's Muse Voice Transcribe over its realtime WebSocket with
// the user's Model API key; the final transcript lands at the caret.
//
// The stream (dev.meta.ai/docs/api-reference/voice/realtime): the first text
// frame is the handshake carrying the key, answered by `{"sessionId"}`;
// then binary frames of 16-bit mono PCM at real time (the microphone's own
// pace, audio recorded while the handshake is answered is held and sent at
// once, well inside the 5 s Meta allows ahead); then `{"type":"endStream"}`,
// after which the final transcript arrives and the server closes with 1000.
// Every whole second sent is counted for the window's tally, the way Meta
// bills it. Audio exists outside the machine only between the press and the
// release, and only on Meta's endpoint.
//
// No `vscode` and no socket here: the host injects the WebSocket.

import * as z from 'zod/mini'
import {
  MUSE_VOICE_AUDIO_ENCODING,
  MUSE_VOICE_BYTES_PER_SECOND,
  MUSE_VOICE_CLOSE_REASONS,
  MUSE_VOICE_FINISH_TIMEOUT_MS,
  MUSE_VOICE_HANDSHAKE_TIMEOUT_MS,
  MUSE_VOICE_MODE,
  MUSE_VOICE_MODEL,
  MUSE_VOICE_PARTIAL_MODE,
  UI_TEXT,
  WEBSOCKET_CLOSE_NORMAL,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { CoreLogger } from '../logging'
import type { DictationHandle, DictationListener, DictationStatus } from './dictation'

/** What the stream hears from the socket; the host adapts the platform's WebSocket to it. */
export interface VoiceSocketHandlers {
  onOpen(): void
  onText(text: string): void
  /** Fires once, however the socket ended. */
  onClose(code: number, reason: string): void
}

export interface VoiceSocket {
  sendText(text: string): void
  sendBinary(bytes: Uint8Array): void
  close(): void
}

export type OpenVoiceSocket = (url: string, handlers: VoiceSocketHandlers) => VoiceSocket

// The frames Meta sends: the handshake's answer has no type; the rest do.
const acknowledgementSchema = z.object({ sessionId: z.string() })
const transcriptSchema = z.object({
  type: z.literal('transcript'),
  transcript: z.string(),
  final: z.optional(z.boolean()),
})
const errorSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  errorCode: z.optional(z.nullable(z.string())),
})

type StreamState = 'connecting' | 'handshaking' | 'streaming' | 'finishing' | 'done'

export interface VoiceStreamDeps {
  readonly url: string
  readonly openSocket: OpenVoiceSocket
  readonly log: CoreLogger
}

export interface VoiceStreamCallbacks {
  /** The recording's transcript, once, after `finish` (possibly empty: nothing was said). */
  onFinal(text: string): void
  /** The stream failed; no transcript follows. */
  onFailed(reason: string): void
}

/** Why Meta closed a stream, in the user's words; the code is Meta's. */
function closeReason(code: number, reason: string): string {
  const kind = (MUSE_VOICE_CLOSE_REASONS as Readonly<Record<number, string>>)[code]
  const detail = reason === '' ? '' : `: ${reason}`
  switch (kind) {
    case 'badRequest': {
      return `${UI_TEXT.museVoiceRefused}${detail}`
    }
    case 'rateLimited': {
      return UI_TEXT.museVoiceRateLimited
    }
    default: {
      return `${fill(UI_TEXT.museVoiceClosed, { code: String(code) })}${detail}`
    }
  }
}

/** One recording's stream to Muse Voice Transcribe. */
export class MuseVoiceStream {
  private state: StreamState = 'connecting'
  private socket: VoiceSocket | undefined
  private readonly held: Uint8Array[] = []
  private bytesSent = 0
  private latest = ''
  private isFinishWanted = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private apiKey = ''

  public constructor(
    private readonly deps: VoiceStreamDeps,
    private readonly callbacks: VoiceStreamCallbacks,
  ) {}

  private arm(ms: number, reason: string): void {
    this.disarm()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.fail(reason)
    }, ms)
  }

  private disarm(): void {
    if (this.timer === undefined) {
      return
    }
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private end(): void {
    this.state = 'done'
    this.disarm()
    this.held.length = 0
    this.socket?.close()
  }

  private deliver(text: string): void {
    if (this.state === 'done') {
      return
    }
    this.end()
    this.deps.log.info(
      `Muse Voice: ${String(text.length)} characters transcribed from ${String(this.seconds)} s of audio`,
    )
    this.callbacks.onFinal(text)
  }

  private sendAudio(bytes: Uint8Array): void {
    this.socket?.sendBinary(bytes)
    this.bytesSent += bytes.length
  }

  private sendEnd(): void {
    this.state = 'finishing'
    this.socket?.sendText(JSON.stringify({ type: 'endStream' }))
    this.arm(MUSE_VOICE_FINISH_TIMEOUT_MS, UI_TEXT.museVoiceNoFinal)
  }

  private onOpen(): void {
    this.state = 'handshaking'
    this.socket?.sendText(
      JSON.stringify({
        authorization: { accessToken: `Bearer ${this.apiKey}` },
        audioEncoding: MUSE_VOICE_AUDIO_ENCODING,
        model: MUSE_VOICE_MODEL,
        mode: MUSE_VOICE_MODE,
        partialMode: MUSE_VOICE_PARTIAL_MODE,
        emitAudioProgress: false,
      }),
    )
  }

  private onText(text: string): void {
    let frame: unknown
    try {
      frame = JSON.parse(text)
    } catch {
      this.fail(UI_TEXT.museVoiceMalformed)
      return
    }
    if (this.state === 'handshaking' && acknowledgementSchema.safeParse(frame).success) {
      this.disarm()
      this.state = 'streaming'
      for (const bytes of this.held.splice(0)) {
        this.sendAudio(bytes)
      }
      if (this.isFinishWanted) {
        this.sendEnd()
      }
      return
    }
    const error = errorSchema.safeParse(frame)
    if (error.success) {
      this.fail(`${UI_TEXT.museVoiceRefused}: ${error.data.message}`)
      return
    }
    const transcript = transcriptSchema.safeParse(frame)
    if (!transcript.success) {
      // Speech boundaries, progress, speaker labels: not used here.
      return
    }
    // Cumulative partials: each replaces the one before.
    this.latest = transcript.data.transcript
    if (transcript.data.final === true && this.state === 'finishing') {
      this.deliver(this.latest)
    }
  }

  private onClose(code: number, reason: string): void {
    if (this.state === 'done') {
      return
    }
    // After endStream a normal close ends the stream: the last transcript is it.
    if (code === WEBSOCKET_CLOSE_NORMAL && this.state === 'finishing') {
      this.deliver(this.latest)
      return
    }
    this.fail(closeReason(code, reason))
  }

  /** Whole seconds of audio sent: what Meta bills, rounded down. */
  public get seconds(): number {
    return Math.floor(this.bytesSent / MUSE_VOICE_BYTES_PER_SECOND)
  }

  /** Ends the stream as failed: the reason goes to `onFailed`, once. */
  public fail(reason: string): void {
    if (this.state === 'done') {
      return
    }
    this.deps.log.warn(`Muse Voice stream failed: ${reason}`)
    this.end()
    this.callbacks.onFailed(reason)
  }

  /** Opens the socket and sends the handshake with the key; audio pushed meanwhile is held. */
  public start(apiKey: string): void {
    if (this.state !== 'connecting') {
      return
    }
    this.apiKey = apiKey
    this.arm(MUSE_VOICE_HANDSHAKE_TIMEOUT_MS, UI_TEXT.museVoiceNoAnswer)
    try {
      this.socket = this.deps.openSocket(this.deps.url, {
        onOpen: () => {
          this.onOpen()
        },
        onText: (text) => {
          this.onText(text)
        },
        onClose: (code, reason) => {
          this.onClose(code, reason)
        },
      })
    } catch (error: unknown) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  /** One piece of the recording, in order. */
  public push(bytes: Uint8Array): void {
    if (this.state === 'streaming') {
      this.sendAudio(bytes)
    } else if (this.state === 'connecting' || this.state === 'handshaking') {
      this.held.push(bytes)
    }
  }

  /** The recording ended: the transcript follows through `onFinal`. */
  public finish(): void {
    if (this.state === 'streaming') {
      this.sendEnd()
    } else if (this.state === 'connecting' || this.state === 'handshaking') {
      this.isFinishWanted = true
    }
  }

  /** Drops the stream without a transcript (the panel closed). */
  public abort(): void {
    this.end()
  }
}

/** The capture helper sends no words; its audio goes to the stream. */
function ignoreWords(): void {
  // Nothing to insert: the transcript comes from Muse Voice.
}

export interface MuseVoiceDeps {
  /** The capture helper's driver, reporting to the given listener. */
  readonly createCapture: (listener: DictationListener) => DictationHandle
  readonly openSocket: OpenVoiceSocket
  readonly url: string
  /** The Model API key, read per recording (never the CLI's credential). */
  readonly apiKey: () => Promise<string | undefined>
  /** Counts whole seconds sent, for the window's tally. */
  readonly onSeconds: (seconds: number) => void
  readonly log: CoreLogger
}

/**
 * The microphone on the paid engine: the capture helper records, each
 * recording is streamed as it is made, and its transcript is the listener's
 * text. A recording's stream finishes on its own after the release, so the
 * next press can start the next one at once.
 */
export class MuseVoiceDictation implements DictationHandle {
  private readonly capture: DictationHandle
  /** The stream of the recording being made; undefined between recordings. */
  private recording: MuseVoiceStream | undefined
  /** Every stream still open, the finishing ones included (a dispose ends them). */
  private readonly open = new Set<MuseVoiceStream>()
  private status: DictationStatus = 'idle'
  private isDisposed = false

  public constructor(
    private readonly deps: MuseVoiceDeps,
    private readonly listener: DictationListener,
  ) {
    this.capture = deps.createCapture({
      onStatus: (status) => {
        this.status = status
        listener.onStatus(status)
      },
      onText: ignoreWords,
      onAudio: (pcm) => {
        this.recording?.push(pcm)
      },
      // Every byte has arrived: the stream asks for its transcript.
      onStopped: () => {
        const stream = this.recording
        this.recording = undefined
        stream?.finish()
      },
      onError: (reason) => {
        const stream = this.recording
        this.recording = undefined
        stream?.abort()
        if (stream !== undefined) {
          this.settle(stream)
        }
        listener.onError(reason)
      },
    })
  }

  /** A stream that ended: its seconds are counted, once. */
  private settle(stream: MuseVoiceStream): void {
    if (this.open.delete(stream)) {
      this.deps.onSeconds(stream.seconds)
    }
  }

  private newStream(key: Promise<string | undefined>): MuseVoiceStream {
    const stream: MuseVoiceStream = new MuseVoiceStream(
      { url: this.deps.url, openSocket: this.deps.openSocket, log: this.deps.log },
      {
        onFinal: (text) => {
          this.settle(stream)
          const trimmed = text.trim()
          if (trimmed !== '') {
            this.listener.onText(trimmed)
          }
        },
        onFailed: (reason) => {
          this.settle(stream)
          if (this.recording === stream) {
            this.recording = undefined
            this.capture.stop()
          }
          this.listener.onError(reason)
        },
      },
    )
    this.open.add(stream)
    // The helper records from the press; the key is read meanwhile, and the
    // stream holds the audio until its handshake is answered.
    void key
      .then((apiKey) => {
        if (apiKey === undefined) {
          stream.fail(UI_TEXT.museVoiceNoKey)
        } else {
          stream.start(apiKey)
        }
      })
      .catch((error: unknown) => {
        stream.fail(error instanceof Error ? error.message : String(error))
      })
    return stream
  }

  public start(): void {
    if (this.isDisposed || this.status !== 'idle') {
      return
    }
    this.recording = this.newStream(this.deps.apiKey())
    this.capture.start()
  }

  public stop(): void {
    this.capture.stop()
  }

  public dispose(): void {
    this.isDisposed = true
    this.recording = undefined
    this.capture.dispose()
    for (const stream of this.open) {
      stream.abort()
      this.settle(stream)
    }
  }
}

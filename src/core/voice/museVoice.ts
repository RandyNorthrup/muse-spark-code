import { Buffer } from 'node:buffer'
import { payerCredentialSchema } from '../backends/modelapi/billingRoute'
import { Usd, type UsdAmount } from '../../shared/usd'
// Muse Voice (M35, PLAN.md D30): the paid, opt-in dictation engine. The
// microphone's audio comes from a capture helper (the same resident-helper
// driver as the free engine, with "audio" lines instead of "text"), and is
// streamed to Meta's Muse Voice Transcribe over its realtime WebSocket with
// the user's Model API key; the final transcript lands at the caret.
//
// The stream (dev.meta.ai/docs/api-reference/voice/realtime): the first text
// frame is the handshake carrying the key, answered by `{"sessionId"}`;
// then binary frames of 16-bit mono PCM at real time (the microphone's own
// pace; audio held while the handshake is answered is sent first); then `{"type":"endStream"}`,
// after which the final transcript arrives and the server closes with 1000.
// Final audioProcessedMs supplies the tariff estimate; the provider invoice
// cannot be read back. All recorders send 80 ms frames and one short tail.
// Audio captured between start and stop goes only to Meta; held PCM and the
// tail may finish sending after the microphone stops.
//
// No `vscode` and no socket here: the host injects the WebSocket.

import * as z from 'zod/mini'
import { createHash } from 'node:crypto'
import type { OwnedSessionBudgetScope } from '../backends/modelapi/sessionBudget'
import {
  MILLISECONDS_PER_SECOND,
  MUSE_VOICE_FRAME_BYTES,
  MUSE_VOICE_MAX_BYTES,
  MUSE_VOICE_MAX_SECONDS,
  MUSE_VOICE_RESERVED_MS,
  MUSE_VOICE_IDLE_ERROR,
  MUSE_VOICE_IDLE_CLOSE,
  MUSE_VOICE_AUDIO_ENCODING,
  MUSE_VOICE_BYTES_PER_SECOND,
  MUSE_VOICE_CLOSE_REASONS,
  MUSE_VOICE_FINISH_TIMEOUT_MS,
  MUSE_VOICE_HANDSHAKE_TIMEOUT_MS,
  MUSE_VOICE_MODE,
  MUSE_VOICE_MODEL,
  MUSE_VOICE_PARTIAL_MODE,
  PAID_PRICES_USD,
  SECONDS_PER_HOUR,
  UI_TEXT,
  WEBSOCKET_CLOSE_NORMAL,
} from '../../shared/constants'
import { fill, formatUnit } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { CoreLogger } from '../logging'
import type {
  DictationHandle,
  DictationListener,
  DictationStatus,
  VoiceConsentFence,
} from './dictation'

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
  final: z.boolean(),
  audioProcessedMs: z.number().check(z.int(), z.nonnegative()),
})
const errorSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  errorCode: z.optional(z.nullable(z.string())),
  errorType: z.optional(z.string()),
})

type StreamState = 'connecting' | 'handshaking' | 'streaming' | 'finishing' | 'done'

export interface VoiceStreamDeps {
  readonly url: string
  readonly openSocket: OpenVoiceSocket
  readonly log: CoreLogger
  readonly admitSend?: () => void
  readonly onAuthorizationStarted?: () => void
}

export interface VoiceStreamCallbacks {
  /** The recording's transcript, once, after `finish` (possibly empty: nothing was said). */
  onFinal(text: string): void
  /** The stream failed; no transcript follows. */
  onFailed(reason: string): void
  onLimit?(): void
}

/** Why Meta closed a stream, in the user's words; the code is Meta's. */
function closeReason(code: number, reason: string): string {
  if (reason === MUSE_VOICE_IDLE_CLOSE) return UI_TEXT.museVoiceIdle
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
  private bytesAccepted = 0
  private tail: Uint8Array = new Uint8Array(0)
  private finalProcessedMs: number | undefined
  private limitTimer: ReturnType<typeof setTimeout> | undefined
  private isLimitReached = false
  private latest = ''
  private isFinishWanted = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private apiKey = ''

  public constructor(
    private readonly deps: VoiceStreamDeps,
    private readonly callbacks: VoiceStreamCallbacks,
  ) {
    this.limitTimer = setTimeout(() => {
      this.reachLimit()
    }, MUSE_VOICE_MAX_SECONDS * MILLISECONDS_PER_SECOND)
  }

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
    this.tail = new Uint8Array(0)
    this.apiKey = ''
    this.clearLimit()
    try {
      this.socket?.close()
    } catch {
      this.deps.log.warn('Muse Voice transport close failed')
    }
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
    if (!this.canSend()) {
      return
    }
    // Count before dispatch: a throwing transport may already have queued it.
    this.bytesSent += bytes.length
    try {
      this.socket?.sendBinary(bytes)
    } catch {
      this.fail(UI_TEXT.museVoiceTransportFailed)
    }
  }

  private sendEnd(): void {
    if (!this.canSend()) {
      return
    }
    this.state = 'finishing'
    this.arm(MUSE_VOICE_FINISH_TIMEOUT_MS, UI_TEXT.museVoiceNoFinal)
    try {
      this.socket?.sendText(JSON.stringify({ type: 'endStream' }))
    } catch {
      this.fail(UI_TEXT.museVoiceTransportFailed)
    }
  }

  private onOpen(): void {
    if (!this.canSend()) {
      return
    }
    this.state = 'handshaking'
    this.deps.onAuthorizationStarted?.()
    try {
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
    } catch {
      this.fail(UI_TEXT.museVoiceTransportFailed)
    } finally {
      this.apiKey = ''
    }
  }

  private canSend(): boolean {
    if (this.state === 'done') {
      return false
    }
    try {
      this.deps.admitSend?.()
      return true
    } catch (error: unknown) {
      this.fail(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  private onText(text: string): void {
    if (this.state === 'done') return
    let frame: unknown
    try {
      frame = JSON.parse(text)
    } catch (error) {
      // Only a malformed helper line fails the stream: the parser raises
      // SyntaxError for exactly that, so anything else keeps its kind.
      if (!(error instanceof SyntaxError)) throw error
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
      this.fail(
        error.data.message === MUSE_VOICE_IDLE_ERROR
          ? UI_TEXT.museVoiceIdle
          : `${UI_TEXT.museVoiceRefused}: ${error.data.message}`,
      )
      return
    }
    const transcript = transcriptSchema.safeParse(frame)
    if (!transcript.success) {
      if (
        typeof frame === 'object' &&
        frame !== null &&
        'type' in frame &&
        frame.type === 'transcript'
      ) {
        this.fail(UI_TEXT.museVoiceInvalidDuration)
        return
      }
      // Speech boundaries, progress, speaker labels: not used here.
      return
    }
    // Cumulative partials: each replaces the one before.
    this.latest = transcript.data.transcript
    if (!transcript.data.final || this.state !== 'finishing') return
    this.finalProcessedMs = transcript.data.audioProcessedMs
    this.deliver(this.latest)
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

  private clearLimit(): void {
    if (this.limitTimer !== undefined) clearTimeout(this.limitTimer)
    this.limitTimer = undefined
  }

  private reachLimit(): void {
    if (this.isLimitReached || this.state === 'done' || this.state === 'finishing') return
    this.isLimitReached = true
    this.finish()
    this.callbacks.onLimit?.()
  }

  private queueAudio(bytes: Uint8Array): void {
    if (bytes.length === 0) return
    if (this.state === 'streaming') this.sendAudio(bytes)
    else if (this.state === 'connecting' || this.state === 'handshaking') this.held.push(bytes)
  }

  private isDone(): boolean {
    return this.state === 'done'
  }

  /** Locally sent audio bytes, used for the exact local cost estimate. */
  public get audioBytes(): number {
    return this.bytesSent
  }

  /** Tariff seconds from the final report, otherwise a local estimate. */
  public get seconds(): number {
    return Math.floor(
      this.finalProcessedMs === undefined
        ? this.bytesSent / MUSE_VOICE_BYTES_PER_SECOND
        : this.finalProcessedMs / MILLISECONDS_PER_SECOND,
    )
  }

  public get hasFinalDuration(): boolean {
    return this.finalProcessedMs !== undefined
  }

  /** Ends the stream as failed: the reason goes to `onFailed`, once. */
  public fail(reason: string): void {
    if (this.state === 'done') {
      return
    }
    this.deps.log.warn('Muse Voice stream failed')
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

  /** Bounded PCM, reframed identically for Windows, macOS and Linux. */
  public push(bytes: Uint8Array): void {
    if (this.isFinishWanted || this.state === 'done' || this.state === 'finishing') return
    const accepted = bytes.subarray(0, MUSE_VOICE_MAX_BYTES - this.bytesAccepted)
    this.bytesAccepted += accepted.length
    const pending = Buffer.concat([this.tail, accepted])
    let offset = 0
    while (offset + MUSE_VOICE_FRAME_BYTES <= pending.length) {
      this.queueAudio(pending.subarray(offset, offset + MUSE_VOICE_FRAME_BYTES))
      offset += MUSE_VOICE_FRAME_BYTES
      if (this.isDone()) return
    }
    this.tail = Uint8Array.from(pending.subarray(offset))
    if (this.bytesAccepted >= MUSE_VOICE_MAX_BYTES) this.reachLimit()
  }

  /** Send at most one short tail before endStream. */
  public finish(): void {
    if (this.isFinishWanted || this.state === 'done') return
    this.isFinishWanted = true
    this.clearLimit()
    this.queueAudio(this.tail)
    this.tail = new Uint8Array(0)
    if (this.state === 'streaming') this.sendEnd()
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
  /** Counts reported whole seconds, or local seconds without a final. */
  readonly onSeconds: (seconds: number) => void
  /** Durable D78 admission on either backend, before opening the socket. */
  /**
  D78's exact daily admission, or `undefined` when the person set no
  daily limit: with no limit there is nothing to admit against (D208).
  */
  readonly reserveDaily: (costUsd: UsdAmount) => Promise<VoiceDailyClaim | undefined>
  readonly log: CoreLogger
}

interface VoiceDailyClaim {
  check(): unknown
  /** After the recording: its cost, or `undefined` when it went out with no reported usage. */
  settle(costUsd: UsdAmount | undefined): Promise<void>
}

interface VoiceBudgetState {
  scope: OwnedSessionBudgetScope | undefined
  daily: VoiceDailyClaim | undefined
  isPreparing: boolean
  keyDigest: string | undefined
  hasAuthorizationStarted: boolean
  isSettled: boolean
}

/**
One microphone press's paid admission (RVCM352B P1-a): the parent budget
scope, the consent/context fence and the key read, all captured
synchronously when Start is pressed. A press that waits behind another
dictation carries this object with it; the preparation that runs when its
turn comes reads nothing else, so a cleared controller slot cannot widen
it into an unreserved, unfenced recording.
*/
interface VoiceAdmission {
  readonly scope: Promise<OwnedSessionBudgetScope | undefined>
  readonly fence: VoiceConsentFence | undefined
  readonly key: Promise<string | undefined>
}

/**
The microphone on the paid engine: the capture helper records, each
recording is streamed as it is made, and its transcript is the listener's
text. A stop acknowledgement retires its helper before the next capture;
its socket may continue finishing while the next recording begins.
*/
export class MuseVoiceDictation implements DictationHandle {
  /** Each helper instance and callback belongs to exactly one recording. */
  private readonly captures = new Map<MuseVoiceStream, DictationHandle>()
  private current: { readonly id: number; readonly stream: MuseVoiceStream } | undefined
  private nextRecordingId = 0
  /**
  The latest settlement write: the next preparation waits for it before
  reserving (RVCM352B P1-b). Settling runs in the background so an end
  never waits on the filesystem, but two recordings' journal writes must
  not interleave: a readdir landing between another writer's claim
  directory and its claim file reads as missing storage.
  */
  private lastSettlement: Promise<unknown> = Promise.resolve()
  private isStopping = false
  /**
  The press waiting behind a stopping or draining recording, with the
  admission it was pressed under. A newer press replaces it (its press
  was superseded); `stop` and `dispose` drop it unreserved.
  */
  private pendingAdmission: VoiceAdmission | undefined
  /** Every stream still open, the finishing ones included (a dispose ends them). */
  private readonly open = new Set<MuseVoiceStream>()
  private readonly budgets = new Map<MuseVoiceStream, VoiceBudgetState>()
  /** Settlement writes still running, so dispose can wait for each of them. */
  private readonly settling = new Set<Promise<void>>()
  /** The recording admitted but not yet capturing: no microphone is held. */
  private preparingStream: MuseVoiceStream | undefined
  /** Every stop and dispose cancels the preparation still running. */
  private prepareAttempt = 0
  /** Include cancelled preparations still releasing liability when another start arrives. */
  private readonly preparations = new Set<Promise<void>>()
  private lastStatus: DictationStatus | undefined
  private isDisposed = false

  public constructor(
    private readonly deps: MuseVoiceDeps,
    private readonly listener: DictationListener,
  ) {}

  private createCapture(stream: MuseVoiceStream): DictationHandle {
    return this.deps.createCapture({
      onStatus: (status) => {
        if (
          this.current?.stream === stream &&
          !this.isDisposed &&
          !(status === 'idle' && this.isStopping)
        )
          this.setStatus(status)
      },
      onText: ignoreWords,
      onAudio: (pcm) => {
        if (this.captures.has(stream)) stream.push(pcm)
      },
      onStopped: () => {
        if (!this.captures.has(stream) || this.isDisposed) return
        // Retire this helper before allowing another recording. A trailing
        // event from it retains this closure and can never touch the next.
        void this.finishRecording(stream)
      },
      onError: (reason) => {
        if (!this.captures.has(stream) || this.isDisposed) return
        void this.failRecording(stream, reason)
      },
    })
  }

  /**
  The recording's capture is gone when this resolves: its helper process
  exit is observed (bounded; then it is killed and that is said) before
  the stream finishes or settles. Ownership clears only then, so a Stop
  never reports ended — and the next Start never runs — while a recorder
  process still exists.
  */
  private releaseCapture(stream: MuseVoiceStream): Promise<void> {
    const capture = this.captures.get(stream)
    this.captures.delete(stream)
    if (capture === undefined) {
      if (this.current?.stream === stream) {
        this.current = undefined
        this.isStopping = false
      }
      return Promise.resolve()
    }
    const disposal = (async () => {
      try {
        await capture.dispose()
      } catch {
        this.deps.log.warn('Muse Voice capture cleanup failed')
      } finally {
        if (this.current?.stream === stream) {
          this.current = undefined
        }
        this.isStopping = false
      }
    })()
    this.settling.add(disposal)
    void disposal
      .finally(() => this.settling.delete(disposal))
      .catch(() => {
        this.deps.log.warn('Muse Voice capture cleanup failed')
      })
    return disposal
  }

  /** A retired recording's end: reaped, then finished, then the queued press. */
  private async finishRecording(stream: MuseVoiceStream): Promise<void> {
    await this.releaseCapture(stream)
    if (this.isDisposed) return
    stream.finish()
    this.startPending()
  }

  /** A failed recording's end: reaped, then settled and said, then queued. */
  private async failRecording(stream: MuseVoiceStream, reason: string): Promise<void> {
    await this.releaseCapture(stream)
    if (this.isDisposed) return
    stream.abort()
    this.settle(stream)
    this.listener.onError(reason)
    this.startPending()
  }

  private startPending(): void {
    if (this.current !== undefined || this.isDisposed) return
    this.setStatus('idle')
    const admission = this.pendingAdmission
    if (admission === undefined) return
    this.pendingAdmission = undefined
    this.beginPreparation(admission)
  }

  /** The button state, without repeats (the preparation and the capture both announce). */
  private setStatus(status: DictationStatus): void {
    if (this.lastStatus === status) {
      return
    }
    this.lastStatus = status
    this.listener.onStatus(status)
  }

  /** A stream that ended: its seconds are counted, once. */
  private settle(stream: MuseVoiceStream): void {
    // A final may beat the helper's stop acknowledgement at the hard cap.
    // Settling money must not release microphone ownership early.
    if (this.current?.stream === stream && !this.captures.has(stream)) {
      this.current = undefined
      this.isStopping = false
    }
    if (!this.open.delete(stream)) {
      return
    }
    this.deps.onSeconds(stream.seconds)
    const estimatedUsageText =
      stream.audioBytes === 0 ? UI_TEXT.museVoiceUsageEmpty : UI_TEXT.museVoiceUsageEstimated
    const usageText = stream.hasFinalDuration ? UI_TEXT.museVoiceUsageReported : estimatedUsageText
    this.listener.onVoiceUsage?.(
      fill(usageText, {
        duration: formatUnit(stream.seconds, 'second'),
        cost: formatUsd(
          Usd.from(PAID_PRICES_USD.voicePerHour)
            .times(stream.seconds)
            .divideIntegerCeiling(SECONDS_PER_HOUR)
            .toAmount(),
        ),
      }),
    )
    const budget = this.budgets.get(stream)
    this.budgets.delete(stream)
    if (budget === undefined) {
      return
    }
    // Tracked, so dispose drains every settlement write it started, and the
    // next preparation waits for it before reserving.
    const settlement = this.settleBudget(budget, stream)
    this.lastSettlement = settlement
    this.settling.add(settlement)
    const forget = (): void => {
      this.settling.delete(settlement)
    }
    void settlement.then(forget).catch(forget)
  }

  private isStreamOpen(stream: MuseVoiceStream): boolean {
    return this.open.has(stream) && !this.isDisposed
  }

  private reservationUsd(): UsdAmount {
    return Usd.from(PAID_PRICES_USD.voicePerHour)
      .times(MUSE_VOICE_RESERVED_MS)
      .divideIntegerCeiling(SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND)
      .toAmount()
  }

  /**
  A recording that reached Meta joins the conversation's running total as
  cost unknown: Muse Voice reports no billed duration, and a local
  estimate is never counted as spent (D208). Its seconds are tallied
  apart. A recording that never started refunds instead.
  */
  private async settleBudget(state: VoiceBudgetState, stream: MuseVoiceStream): Promise<void> {
    if (state.isPreparing || state.isSettled) return
    state.isSettled = true
    const hasSentAudio = state.hasAuthorizationStarted && stream.audioBytes > 0
    if (state.scope !== undefined && state.hasAuthorizationStarted) state.scope.charge(undefined)
    // An async boundary catches a synchronous throw while still starting
    // the write immediately.
    const results = await Promise.allSettled([
      state.daily?.settle(hasSentAudio ? undefined : Usd.from(0).toAmount()),
    ])
    if (results.every((result) => result.status === 'fulfilled')) return
    this.deps.log.warn('Muse Voice spend was not saved')
    if (!this.isDisposed) this.listener.onError(UI_TEXT.sessionBudgetStoreUnavailable)
  }

  private async prepareStream(
    stream: MuseVoiceStream,
    state: VoiceBudgetState,
    admission: VoiceAdmission,
    attempt: number,
  ): Promise<void> {
    let isAdmitted = false
    // A stop or dispose behind a pending write cancels the start: the
    // recording ends idle with nothing captured and what was reserved
    // refunded, never an error for a stop the user asked for.
    const isCancelled = (): boolean => {
      if (attempt !== this.prepareAttempt || this.isDisposed) {
        if (this.current?.stream === stream) {
          this.current = undefined
        }
        if (this.current === undefined && !this.isDisposed) {
          this.setStatus('idle')
        }
        return true
      }
      return false
    }
    // No longer preparing, but the stream stays open: a failed stream
    // settles itself, a live one settles on its transcript, and only a
    // cancelled one is withdrawn here for a quiet refund below.
    const endPreparation = (): void => {
      if (this.preparingStream === stream) {
        this.preparingStream = undefined
      }
    }
    const withdrawPreparation = (): void => {
      endPreparation()
      stream.abort()
      void this.releaseCapture(stream)
      this.open.delete(stream)
      this.budgets.delete(stream)
    }
    try {
      const [scope, apiKey] = await Promise.all([admission.scope, admission.key])
      // Successive recordings on one driver settle in order: the previous
      // settlement lands before anything is reserved here.
      await this.lastSettlement
      state.scope = scope
      if (isCancelled() || !this.isStreamOpen(stream)) {
        withdrawPreparation()
        return
      }
      if (apiKey === undefined) {
        endPreparation()
        stream.fail(UI_TEXT.museVoiceNoKey)
        this.announceIdle(stream)
        return
      }
      // A queued Start runs under the admission it was pressed with, and
      // that admission is rechecked before anything is reserved: a dead
      // scope, a withdrawn consent or a stopped backend refuses here with
      // its true reason, recording and sending nothing.
      admission.fence?.(createHash('sha256').update(apiKey).digest('hex'), true)
      state.daily = await this.deps.reserveDaily(this.reservationUsd())
      if (isCancelled() || !this.isStreamOpen(stream)) {
        withdrawPreparation()
        return
      }
      // Its billed duration has no verified bound, so a person-set limit
      // cannot be kept for it (D208).
      if (state.scope !== undefined && Usd.from(state.scope.capUsd()).compare(Usd.from(0)) > 0) {
        throw new Error(UI_TEXT.sessionBudgetVoiceUnavailable)
      }
      // The durable write may have waited while SecretStorage changed.
      // An owned recording reads the actual key again after that await.
      const sendingKey = await this.deps.apiKey()
      if (isCancelled() || !this.isStreamOpen(stream)) {
        withdrawPreparation()
        return
      }
      if (sendingKey === undefined) {
        endPreparation()
        stream.fail(UI_TEXT.museVoiceNoKey)
        this.announceIdle(stream)
        return
      }
      state.keyDigest = createHash('sha256').update(sendingKey).digest('hex')
      admission.fence?.(state.keyDigest, true)
      this.admitBudgetSend(state)
      if (isCancelled() || !this.isStreamOpen(stream)) {
        withdrawPreparation()
        return
      }
      stream.start(sendingKey)
      if (!this.isStreamOpen(stream)) return
      isAdmitted = true
      endPreparation()
      // The microphone starts only now: the key is read and the daily
      // reservation has succeeded, so a refusal never records and never
      // triggers the system's microphone prompt.
      this.captures.get(stream)?.start()
    } catch (error: unknown) {
      endPreparation()
      stream.fail(error instanceof Error ? error.message : String(error))
      this.announceIdle(stream)
    } finally {
      state.isPreparing = false
      endPreparation()
      // A cancelled start refunds its partial admission without usage noise;
      // a failed stream already settled itself (its guard says settled).
      if (!isAdmitted || !this.open.has(stream)) {
        await this.settleBudget(state, stream)
        this.startPending()
      }
    }
  }

  /** Idle after a preparation that never captured, unless a new press owns the button. */
  private announceIdle(stream: MuseVoiceStream): void {
    if (this.current?.stream === stream) {
      this.current = undefined
    }
    if (this.current === undefined && !this.isDisposed) {
      this.setStatus('idle')
    }
  }

  private admitBudgetSend(state: VoiceBudgetState): void {
    state.daily?.check()
    if (state.scope === undefined) return
    if (state.keyDigest !== state.scope.accountId) {
      throw new Error(UI_TEXT.notSignedInReason)
    }
    if (!state.scope.isStillAllowed(payerCredentialSchema.parse(state.keyDigest))) {
      throw new Error(UI_TEXT.sessionBudgetVoiceContextChanged)
    }
  }

  private newStream(admission: VoiceAdmission): {
    readonly stream: MuseVoiceStream
    readonly state: VoiceBudgetState
    readonly consentFence: VoiceConsentFence | undefined
  } {
    const consentFence = admission.fence
    const state: VoiceBudgetState = {
      scope: undefined,
      daily: undefined,
      isPreparing: true,
      keyDigest: undefined,
      hasAuthorizationStarted: false,
      isSettled: false,
    }
    const stream: MuseVoiceStream = new MuseVoiceStream(
      {
        url: this.deps.url,
        openSocket: this.deps.openSocket,
        log: this.deps.log,
        admitSend: () => {
          consentFence?.(state.keyDigest, true)
          this.admitBudgetSend(state)
        },
        onAuthorizationStarted: () => {
          state.hasAuthorizationStarted = true
        },
      },
      {
        onLimit: () => {
          // The cap belongs to its own recording: only a live current one
          // still holds the microphone.
          if (this.current?.stream === stream && !this.isStopping) this.stop()
        },
        onFinal: (text) => {
          this.settle(stream)
          try {
            consentFence?.(state.keyDigest, false)
          } catch {
            // Fail closed: a consent fence that cannot confirm delivers no transcript.
            return
          }
          if (
            state.scope?.isStillAllowed(
              state.keyDigest === undefined
                ? undefined
                : payerCredentialSchema.parse(state.keyDigest),
            ) === false
          ) {
            return
          }
          const trimmed = text.trim()
          if (trimmed !== '') {
            this.listener.onText(trimmed)
          }
        },
        onFailed: (reason) => {
          const isCurrent = this.current?.stream === stream
          this.settle(stream)
          if (isCurrent) {
            // Idle (and any queued press) waits for the capture's real
            // release: starting pending now would find `current` still
            // set, return at once, and leave the button non-idle forever.
            void this.releaseCapture(stream).then(() => {
              this.startPending()
            })
          }
          this.listener.onError(reason)
        },
      },
    )
    this.open.add(stream)
    this.budgets.set(stream, state)
    return { stream, state, consentFence }
  }

  /**
  The admission this press runs under, read synchronously: the scope and
  fence the controller admitted before calling, and the key. A queued
  press keeps this object; nothing later re-reads the listener.
  */
  private captureAdmission(): VoiceAdmission {
    return {
      scope: this.listener.ownedBudgetScope?.() ?? Promise.resolve(undefined),
      fence: this.listener.voiceConsentFence?.(),
      key: this.deps.apiKey(),
    }
  }

  private beginPreparation(admission: VoiceAdmission): void {
    this.prepareAttempt += 1
    const attempt = this.prepareAttempt
    this.setStatus('starting')
    const id = this.nextRecordingId
    this.nextRecordingId += 1
    const built = this.newStream(admission)
    this.current = { id, stream: built.stream }
    this.captures.set(built.stream, this.createCapture(built.stream))
    this.preparingStream = built.stream
    const preparation = this.prepareStream(built.stream, built.state, admission, attempt)
    this.preparations.add(preparation)
    void preparation
      .finally(() => this.preparations.delete(preparation))
      .catch(() => {
        this.deps.log.warn('Muse Voice admission cleanup failed')
      })
  }

  public start(): void {
    if (this.isDisposed) return
    if (this.isStopping || this.preparingStream !== undefined) {
      this.pendingAdmission = this.captureAdmission()
      return
    }
    if (this.current !== undefined) return
    this.beginPreparation(this.captureAdmission())
  }

  public stop(): void {
    this.pendingAdmission = undefined
    this.prepareAttempt += 1
    const recording = this.current
    if (recording === undefined || this.isStopping) return
    if (recording.stream === this.preparingStream) {
      // Cancelled while admitting: nothing was captured, and idle waits
      // for the capture's process to be observed gone. Ownership stays
      // until then, so a press meanwhile queues behind it.
      this.isStopping = true
      recording.stream.abort()
      void this.releaseCapture(recording.stream).then(() => {
        this.announceIdle(recording.stream)
      })
      return
    }
    // Keep its identity until acknowledgement (or Dictation's bounded force).
    // Set before stop: fake and Linux helpers may acknowledge synchronously.
    this.isStopping = true
    this.captures.get(recording.stream)?.stop()
  }

  /** Stops the capture, closes every socket, and waits for admission and settlement writes. */
  public async dispose(): Promise<void> {
    this.isDisposed = true
    this.pendingAdmission = undefined
    this.prepareAttempt += 1
    const preparations = [...this.preparations]
    // A preparing recording never captured: its own attempt refunds it once
    // the pending write lands, so only the rest end here.
    const finishing = [...this.open].filter((stream) => stream !== this.preparingStream)
    this.current = undefined
    this.isStopping = false
    for (const stream of this.captures.keys()) void this.releaseCapture(stream)
    for (const stream of finishing) {
      stream.abort()
      this.settle(stream)
    }
    await Promise.allSettled(preparations)
    for (const stream of this.open) {
      stream.abort()
      this.settle(stream)
    }
    // Failures already reached the listener through onError; the drain itself
    // never fails the shutdown waiting on it.
    await Promise.allSettled(this.settling)
  }
}

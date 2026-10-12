import { Buffer } from 'node:buffer'
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
import type {
  OwnedSessionBudgetScope,
  SessionBudgetClaim,
} from '../backends/modelapi/sessionBudget'
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
  readonly reserveDaily: (costUsd: UsdAmount) => Promise<VoiceDailyClaim>
  readonly log: CoreLogger
}

interface VoiceDailyClaim {
  check(): unknown
  settle: SessionBudgetClaim['settle']
}

interface VoiceBudgetState {
  scope: OwnedSessionBudgetScope | undefined
  claim: SessionBudgetClaim | undefined
  daily: VoiceDailyClaim | undefined
  isPreparing: boolean
  keyDigest: string | undefined
  hasAuthorizationStarted: boolean
  isSettled: boolean
}

/**
 * The microphone on the paid engine: the capture helper records, each
 * recording is streamed as it is made, and its transcript is the listener's
 * text. A recording's stream finishes on its own after the release, so the
 * next press can start the next one at once.
 */
export class MuseVoiceDictation implements DictationHandle {
  private readonly capture: DictationHandle
  /**
   * Every recording has an identity: the one being made, plus the stopped
   * ones still waiting for the helper's acknowledgement. A helper event for
   * a recording that is no longer current goes to its own stream — audio to
   * the stopped one until the next goes live, "stopped" to the oldest
   * waiter — never to the current one.
   */
  private current:
    { readonly id: number; readonly stream: MuseVoiceStream; isLive: boolean } | undefined
  private readonly awaitingStop: { readonly id: number; readonly stream: MuseVoiceStream }[] = []
  private nextRecordingId = 0
  /** Stop requested for the current recording, its acknowledgement pending. */
  private isStopping = false
  /** Every stream still open, the finishing ones included (a dispose ends them). */
  private readonly open = new Set<MuseVoiceStream>()
  private readonly budgets = new Map<MuseVoiceStream, VoiceBudgetState>()
  /** Settlement writes still running, so dispose can wait for each of them. */
  private readonly settling = new Set<Promise<void>>()
  /** The recording admitted but not yet capturing: no microphone is held. */
  private preparingStream: MuseVoiceStream | undefined
  /** Every stop and dispose cancels the preparation still running. */
  private prepareAttempt = 0
  /** The running preparation, so dispose can wait for its writes. */
  private preparePromise: Promise<void> | undefined
  private lastStatus: DictationStatus | undefined
  private isDisposed = false

  public constructor(
    private readonly deps: MuseVoiceDeps,
    private readonly listener: DictationListener,
  ) {
    this.capture = deps.createCapture({
      onStatus: (status) => {
        if (status === 'listening' && this.current !== undefined) {
          this.current.isLive = true
        }
        this.setStatus(status)
      },
      onText: ignoreWords,
      onAudio: (pcm) => {
        this.audioTarget()?.push(pcm)
      },
      // Every byte has arrived: the stream asks for its transcript.
      onStopped: () => {
        const waiter = this.awaitingStop.shift()
        if (waiter !== undefined) {
          waiter.stream.finish()
          return
        }
        const stream = this.current?.stream
        this.current = undefined
        this.isStopping = false
        stream?.finish()
      },
      onError: (reason) => {
        // The helper died: every unfinished recording ends on its own
        // stream, and none of them survives into the next press.
        const unfinished = [
          ...this.awaitingStop.splice(0).map((waiter) => waiter.stream),
          ...(this.current === undefined ? [] : [this.current.stream]),
        ]
        this.current = undefined
        this.isStopping = false
        for (const stream of unfinished) {
          stream.abort()
          this.settle(stream)
        }
        listener.onError(reason)
      },
    })
  }

  /** The button state, without repeats (the preparation and the capture both announce). */
  private setStatus(status: DictationStatus): void {
    if (this.lastStatus === status) {
      return
    }
    this.lastStatus = status
    this.listener.onStatus(status)
  }

  /**
   * The stream audio belongs to: the live recording, else the stopped one
   * still waiting for its acknowledgement, else the one not yet live. A
   * recording that already finished never hears again (M35, the restart race).
   */
  private audioTarget(): MuseVoiceStream | undefined {
    if (this.current?.isLive === true) {
      return this.current.stream
    }
    const waiter = this.awaitingStop.at(-1)
    return waiter === undefined ? this.current?.stream : waiter.stream
  }

  /** A stream that ended: its seconds are counted, once. */
  private settle(stream: MuseVoiceStream): void {
    const index = this.awaitingStop.findIndex((waiter) => waiter.stream === stream)
    if (index !== -1) {
      this.awaitingStop.splice(index, 1)
    }
    if (this.current?.stream === stream) {
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
    // Tracked, so dispose drains every settlement write it started.
    const settlement = this.settleBudget(budget, stream)
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

  private async settleBudget(state: VoiceBudgetState, stream: MuseVoiceStream): Promise<void> {
    if (state.isPreparing || state.isSettled) return
    state.isSettled = true
    const isUnknown =
      state.hasAuthorizationStarted && stream.audioBytes > 0 && !stream.hasFinalDuration
    const estimate = Usd.from(PAID_PRICES_USD.voicePerHour)
      .times(stream.seconds)
      .divideIntegerCeiling(SECONDS_PER_HOUR)
      .toAmount()
    // A missing final keeps the reservation; known nonsends and idle refund.
    const amount = isUnknown ? this.reservationUsd() : estimate
    const results = await Promise.allSettled([
      state.claim?.settle(amount, isUnknown),
      state.daily?.settle(amount, isUnknown),
    ])
    if (results.every((result) => result.status === 'fulfilled')) return
    this.deps.log.warn('Muse Voice spend was not saved')
    if (!this.isDisposed) this.listener.onError(UI_TEXT.sessionBudgetStoreUnavailable)
  }

  private async prepareStream(
    stream: MuseVoiceStream,
    state: VoiceBudgetState,
    key: Promise<string | undefined>,
    consentFence: VoiceConsentFence | undefined,
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
      this.open.delete(stream)
      this.budgets.delete(stream)
    }
    try {
      const [scope, apiKey] = await Promise.all([this.listener.ownedBudgetScope?.(), key])
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
      state.daily = await this.deps.reserveDaily(this.reservationUsd())
      if (isCancelled() || !this.isStreamOpen(stream)) {
        withdrawPreparation()
        return
      }
      if (state.scope !== undefined) {
        state.claim = await state.scope.journal.reserve(
          state.scope.sessionId,
          state.scope.accountId,
          this.reservationUsd(),
        )
      }
      if (isCancelled() || !this.isStreamOpen(stream)) {
        withdrawPreparation()
        return
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
      consentFence?.(state.keyDigest, true)
      this.admitBudgetSend(state)
      if (isCancelled() || !this.isStreamOpen(stream)) {
        withdrawPreparation()
        return
      }
      stream.start(sendingKey)
      isAdmitted = true
      endPreparation()
      // The microphone starts only now: the key is read and both durable
      // reservations have succeeded, so a refusal never records and never
      // triggers the system's microphone prompt.
      this.capture.start()
    } catch (error: unknown) {
      endPreparation()
      stream.fail(error instanceof Error ? error.message : String(error))
      this.announceIdle(stream)
    } finally {
      state.isPreparing = false
      endPreparation()
      // A cancelled start refunds its partial admission without usage noise;
      // a failed stream already settled itself (its guard says settled).
      if (!isAdmitted) await this.settleBudget(state, stream)
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
    state.claim?.check(state.scope.capUsd())
    if (state.keyDigest !== state.scope.accountId) {
      throw new Error(UI_TEXT.notSignedInReason)
    }
    if (!state.scope.isStillAllowed(state.keyDigest)) {
      throw new Error(UI_TEXT.sessionBudgetVoiceContextChanged)
    }
  }

  private newStream(key: Promise<string | undefined>): {
    readonly stream: MuseVoiceStream
    readonly state: VoiceBudgetState
    readonly key: Promise<string | undefined>
    readonly consentFence: VoiceConsentFence | undefined
  } {
    const consentFence = this.listener.voiceConsentFence?.()
    const state: VoiceBudgetState = {
      scope: undefined,
      claim: undefined,
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
          if (this.current?.stream === stream) this.stop()
        },
        onFinal: (text) => {
          this.settle(stream)
          try {
            consentFence?.(state.keyDigest, false)
          } catch {
            return
          }
          if (state.scope?.isStillAllowed(state.keyDigest) === false) {
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
            this.capture.stop()
          }
          this.listener.onError(reason)
        },
      },
    )
    this.open.add(stream)
    this.budgets.set(stream, state)
    return { stream, state, key, consentFence }
  }

  public start(): void {
    // A press while the previous stop is still unacknowledged starts the
    // next recording at once: the driver holds both identities, and the
    // capture layer only begins it once the old stop is acknowledged. A
    // press while a start is still preparing is dropped: one attempt at a
    // time, cancelled by stop or dispose.
    if (this.isDisposed || this.current !== undefined || this.preparingStream !== undefined) {
      return
    }
    this.isStopping = false
    this.prepareAttempt += 1
    const attempt = this.prepareAttempt
    this.setStatus('starting')
    const id = this.nextRecordingId
    this.nextRecordingId += 1
    const built = this.newStream(this.deps.apiKey())
    this.current = { id, stream: built.stream, isLive: false }
    this.preparingStream = built.stream
    this.preparePromise = this.prepareStream(
      built.stream,
      built.state,
      built.key,
      built.consentFence,
      attempt,
    )
  }

  public stop(): void {
    // A preparation still running ends here: nothing was captured, so there
    // is nothing to finish, and the attempt refunds below.
    this.prepareAttempt += 1
    this.capture.stop()
    const recording = this.current
    if (recording === undefined || this.isStopping) {
      return
    }
    this.isStopping = true
    this.current = undefined
    if (recording.stream !== this.preparingStream) {
      this.awaitingStop.push(recording)
    }
  }

  /** Stops the capture, closes every socket, and waits for admission and settlement writes. */
  public async dispose(): Promise<void> {
    this.isDisposed = true
    this.prepareAttempt += 1
    const preparation = this.preparePromise
    this.preparePromise = undefined
    // A preparing recording never captured: its own attempt refunds it once
    // the pending write lands, so only the rest end here.
    const finishing = [...this.open].filter((stream) => stream !== this.preparingStream)
    this.current = undefined
    this.isStopping = false
    this.awaitingStop.length = 0
    await this.capture.dispose()
    for (const stream of finishing) {
      stream.abort()
      this.settle(stream)
    }
    await preparation
    for (const stream of this.open) {
      stream.abort()
      this.settle(stream)
    }
    // Failures already reached the listener through onError; the drain itself
    // never fails the shutdown waiting on it.
    await Promise.allSettled(this.settling)
  }
}

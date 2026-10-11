// The Model API factory's `prepareAudioMessage` (M2/V seam): attached
// audio and video turn parts become transcripts through the real conversion
// and transcription adapters, so MP3s and video soundtracks convert before
// transcription. Sources, consent and reserve arrive from the caller: the
// factory leaves them unbound until lane V binds attach-port tokens, the
// host-owned transcription POST, converter presence and the paid seams,
// and supplies no port until then. A turn with nothing
// transcribable resolves undefined, byte-identical to an absent port.
import { UI_TEXT, type MEDIA_AUDIO_ACTION_OPTIONS } from '../../shared/constants'
import type { TurnPart } from '../agent/agentBackend'
import type { PaidFeatureGate, PaidUsage } from '../paid/paidFeatures'
import type { PaidUseConsent } from '../paid/paidConsent'
import type { locateMediaConverter, MediaConversionOptions } from '../media/convert'
import type { TranscriptionPostDeps } from './transcribeBatchHttp'
import type { Usd } from '../../shared/usd'
import {
  audioRouteOptions,
  prepareAudioAttachment,
  type AudioConversionPort,
  type AudioRoutingContext,
  type AudioSource,
  type BatchSpendClaim,
  type BatchTranscriptionPort,
} from './transcribeBatch'

export interface AudioMessageSeams {
  /** Attach-port tokens to confined sources; lane V binds the registry. */
  readonly resolveSource: (part: TurnPart) => AudioSource | undefined
  readonly readAudioBytes: (absolutePath: string, signal: AbortSignal) => Promise<Uint8Array>
  /** Host-owned transcription POST with the Model API key; lane V binds the pinned transport. */
  readonly postTranscription: TranscriptionPostDeps['postTranscription']
  /** Binder-resolved converter presence; the router refuses with a named reason when false. */
  readonly canExtractWav: boolean
  readonly conversionOptions?: MediaConversionOptions
  readonly locateConverter?: () => Promise<Awaited<ReturnType<typeof locateMediaConverter>>>
  /** Shared PaidUseConsent with voice's window-once policy. */
  readonly consent: Pick<PaidUseConsent, 'allows'>
  /** D78 daily and M82 session admission, durable before dispatch. */
  readonly reserve: (costUsd: Usd, signal: AbortSignal) => Promise<BatchSpendClaim>
  readonly usage?: Pick<PaidUsage, 'addVoiceBatch'>
  readonly assertCurrent?: () => void
}

export interface AudioMessagePreparationDeps {
  readonly contextFor: (modelId: string) => AudioRoutingContext
  readonly audioAction?: (() => (typeof MEDIA_AUDIO_ACTION_OPTIONS)[number]) | undefined
  readonly conversion: AudioConversionPort
  readonly batch: BatchTranscriptionPort
  readonly gate: Pick<PaidFeatureGate, 'isOn'>
  readonly usage: Pick<PaidUsage, 'addVoiceBatch'>
  readonly resolveSource: AudioMessageSeams['resolveSource']
  readonly assertCurrent: () => void
  readonly consent: AudioMessageSeams['consent']
  readonly reserve: AudioMessageSeams['reserve']
}

/** Builds the host's `prepareAudioMessage` over the bound adapters. */
export function createPrepareAudioMessage(deps: AudioMessagePreparationDeps) {
  return async (request: {
    readonly sessionId: string
    readonly turnId: string
    readonly modelId: string
    readonly parts: readonly TurnPart[]
    readonly signal: AbortSignal
  }): Promise<
    | {
        readonly parts: readonly TurnPart[]
        readonly modelId: string
        readonly assertCurrent: () => void
      }
    | undefined
  > => {
    const context = deps.contextFor(request.modelId)
    const prepared: TurnPart[] = []
    let hasTranscribed = false
    for (const part of request.parts) {
      const source = deps.resolveSource(part)
      if (source === undefined) {
        prepared.push(part)
        continue
      }
      // An explicit standalone-audio choice must be supported; it never
      // falls back to a different action. Video keeps its soundtrack route.
      const defaultAction = audioRouteOptions(source.info, context).defaultAction
      const action =
        source.info.kind === 'audio' ? (deps.audioAction?.() ?? defaultAction) : defaultAction
      if (action === undefined) {
        prepared.push(part)
        continue
      }
      let attachment: Awaited<ReturnType<typeof prepareAudioAttachment>>
      try {
        attachment = await prepareAudioAttachment(
          source,
          action,
          {
            context,
            assertCurrent: deps.assertCurrent,
            converter: deps.conversion,
            batch: deps.batch,
            gate: deps.gate,
            consent: deps.consent,
            reserve: deps.reserve,
            usage: deps.usage,
          },
          request.signal,
        )
      } catch (error: unknown) {
        // D85.5's "Send without sound": a video whose transcription was
        // declined (or yielded nothing) still goes as itself, as its attach
        // warning said. Standalone audio has nothing else to send.
        if (
          source.info.kind !== 'video' ||
          request.signal.aborted ||
          !(error instanceof Error) ||
          error.message !== UI_TEXT.museVoiceRefused
        )
          throw error
        prepared.push(part)
        continue
      }
      deps.assertCurrent()
      if (attachment.transcript === undefined) {
        if (attachment.dispose !== undefined) await attachment.dispose()
        prepared.push(part)
      } else {
        hasTranscribed = true
        // D85.5: the transcript goes beside the video, never instead of it.
        // A video keeps its visual part (the router returns it as `media`);
        // standalone audio, which no Meta model hears, becomes the transcript.
        if (attachment.media !== undefined) prepared.push(part)
        prepared.push(attachment.transcript)
      }
    }
    return hasTranscribed
      ? { parts: prepared, modelId: request.modelId, assertCurrent: deps.assertCurrent }
      : undefined
  }
}

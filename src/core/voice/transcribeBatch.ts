// M105-A / D85.5. Portable sound routing; the captured batch HTTP adapter,
// M1's confined converter and M2's media encoder are injected at integration.
import * as z from 'zod/mini'
import {
  MAX_TEXT_ATTACHMENT_BYTES,
  PAID_PRICES_USD,
  SECONDS_PER_HOUR,
  TEXT_ATTACHMENT_MEDIA_TYPE,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatUsd } from '../../shared/l10n/text'
import { mediaInfoSchema, type MediaInfo } from '../../shared/media'
import type { BackendKind } from '../../shared/protocol'
import type { AudioAction, AudioRouteOptions } from '../../shared/audioRouting'
import type { TextFilePart } from '../agent/agentBackend'
import type { PaidUseConsent } from '../paid/paidConsent'
import type { PaidFeatureGate, PaidUsage } from '../paid/paidFeatures'
import { paidFeaturePrice } from '../../shared/paid'
import { unlessAborted } from '../timeouts'
import { Usd, nonnegativeUsdSchema, type UsdAmount } from '../../shared/usd'
import { USD_DECIMAL_RADIX } from '../../shared/usdConstants'

type SoundMedia = Extract<MediaInfo, { kind: 'video' | 'audio' }>

/** Only metadata and an opaque confined-read token, never file bytes or a key. */
export interface AudioSource {
  readonly name: string
  readonly pathToken: string
  readonly info: SoundMedia
}

/** M95/M2 projects its evidence-bearing record; names alone grant nothing. */
export interface AudioModelCapabilities {
  readonly modelId: string
  readonly video: 'yes' | 'no' | 'unknown'
  readonly videoFormats: readonly string[]
  readonly hearsSoundtrack: 'yes' | 'no' | 'unknown'
  readonly audio: 'yes' | 'no' | 'unknown'
  readonly audioFormats: readonly string[]
}

export interface AudioRoutingContext {
  readonly backend: BackendKind
  readonly model: AudioModelCapabilities
  /** Same provider and tier, explicitly chosen by the caller (1.2 at Meta). */
  readonly soundtrackModel?: AudioModelCapabilities
  /** Empty until a captured batch adapter exists; U18 decides video formats. */
  readonly batchFormats: readonly string[]
  readonly canExtractWav: boolean
  readonly canWrapMp4: boolean
  readonly isVoiceOn: boolean
}

function canTakeVideo(model: AudioModelCapabilities, mime: string): boolean {
  return model.video === 'yes' && model.videoFormats.includes(mime)
}

/** No vendor-wide defaults: unknown support never authorizes a native send. */
export function audioRouteOptions(
  info: SoundMedia,
  context: AudioRoutingContext,
): AudioRouteOptions {
  mediaInfoSchema.parse(info)
  const { model, soundtrackModel } = context
  const labels: AudioRouteOptions['labels'] = {
    transcribe: `${info.kind === 'video' ? UI_TEXT.media.transcribeSound : UI_TEXT.media.transcribe} (${UI_TEXT.paidRowBadge}: ${paidFeaturePrice('voice')})`,
    useSoundtrackModel: fill(UI_TEXT.media.useSoundtrackModel, {
      model: soundtrackModel?.modelId ?? '',
    }),
    wrapAsVideo: fill(UI_TEXT.media.wrapAsVideo, { model: soundtrackModel?.modelId ?? '' }),
    sendWithoutSound: UI_TEXT.media.sendWithoutSound,
    sendAudio: UI_TEXT.media.send,
  }
  if (context.backend === 'museCode')
    return { actions: [], labels, warning: UI_TEXT.media.museCodeRefusal }
  if (info.kind === 'video' && !canTakeVideo(model, info.mediaType)) {
    return {
      actions: [],
      labels,
      warning: fill(
        model.video === 'unknown' ? UI_TEXT.media.videoUnknown : UI_TEXT.media.videoUnsupported,
        { model: model.modelId },
      ),
    }
  }
  if (info.kind === 'video' && (info.hasSoundtrack === false || model.hearsSoundtrack === 'yes')) {
    return { actions: [], labels }
  }
  const actions: AudioAction[] = []
  if (
    info.kind === 'audio' &&
    model.audio === 'yes' &&
    model.audioFormats.includes(info.mediaType)
  ) {
    actions.push('sendAudio')
  }
  if (
    context.isVoiceOn &&
    (context.batchFormats.includes(info.mediaType) ||
      (info.kind === 'video' &&
        context.canExtractWav &&
        context.batchFormats.includes('audio/wav')))
  ) {
    actions.push('transcribe')
  }
  const fallbackMime = info.kind === 'video' ? info.mediaType : 'video/mp4'
  const isFallback =
    soundtrackModel?.hearsSoundtrack === 'yes' && canTakeVideo(soundtrackModel, fallbackMime)
  if (isFallback && (info.kind === 'video' || context.canWrapMp4)) {
    actions.push(info.kind === 'video' ? 'useSoundtrackModel' : 'wrapAsVideo')
  }
  if (info.kind === 'video') actions.push('sendWithoutSound')
  let defaultAction: AudioAction | undefined
  if (actions.includes('sendAudio')) defaultAction = 'sendAudio'
  else if (actions.includes('transcribe')) defaultAction = 'transcribe'
  let warning: string | undefined
  if (info.kind === 'video') {
    warning =
      model.hearsSoundtrack === 'unknown'
        ? UI_TEXT.media.soundUnknown
        : fill(UI_TEXT.media.soundtrackUnsupported, { model: model.modelId })
  } else if (!actions.includes('sendAudio')) {
    warning = fill(
      model.audio === 'unknown' ? UI_TEXT.media.audioUnknown : UI_TEXT.media.audioUnsupported,
      { model: model.modelId },
    )
  }
  return {
    actions,
    labels,
    ...(defaultAction !== undefined && { defaultAction }),
    ...(isFallback && { soundtrackModelId: soundtrackModel.modelId }),
    ...(warning !== undefined && { warning }),
  }
}

/** Application result, NOT a provider schema. The adapter parses the captured
 * HTTP response before mapping it here. No duration receipt is invented. */
const batchResultSchema = z.strictObject({
  text: z.string(),
  billedSeconds: z.optional(z.number().check(z.gte(0))),
})

export interface BatchTranscriptionPort {
  /** Evidence-backed billing bound, including any provider rounding. Unknown
   * refuses admission; sniffed duration alone is not a billing receipt. */
  readonly billableSecondsUpperBound: (source: AudioSource) => number | undefined
  /** Streams a confined source; calls admitSend before EACH charged attempt,
   * after retrieving the stored key. Stop/close aborts the supplied signal. */
  readonly transcribe: (
    source: AudioSource,
    signal: AbortSignal,
    admitSend: () => void,
  ) => Promise<z.infer<typeof batchResultSchema>>
}

export interface AudioConversionPort {
  /** M1 verifies the absolute executable through its trusted-path port, uses
   * argument arrays and a bounded owner-only temporary file. No key is passed. */
  readonly convert: (
    source: AudioSource,
    mode: 'extractWav' | 'wrapMp4',
    signal: AbortSignal,
  ) => Promise<{
    readonly source: AudioSource
    readonly dispose: () => Promise<void>
  }>
}

export interface BatchSpendClaim {
  /** Final synchronous admission, including the current budget and owner. */
  readonly admitSend: () => void
  /** Undefined keeps the full reservation as uncertain liability. */
  readonly settle: (costUsd: Usd | undefined) => Promise<void>
}

export interface AudioPreparationDeps {
  readonly context: AudioRoutingContext
  /** Rebinds owner/key, model, mode, trust, contributor consent and source
   * revision after every await. Throws on a stale choice, including switch-back. */
  readonly assertCurrent: () => void
  readonly converter?: AudioConversionPort
  readonly batch?: BatchTranscriptionPort
  readonly gate: Pick<PaidFeatureGate, 'isOn'>
  /** Shared PaidUseConsent, with voice's window-once policy and batch question. */
  readonly consent: Pick<PaidUseConsent, 'allows'>
  /** D78 daily and M82 session admission, durable before dispatch. */
  readonly reserve: (costUsd: Usd, signal: AbortSignal) => Promise<BatchSpendClaim>
  readonly usage: Pick<PaidUsage, 'addVoiceBatch'>
}

export interface PreparedAudioAttachment {
  /** This message only; the session's selected model is never changed. */
  readonly modelId: string
  readonly media?: AudioSource
  readonly transcript?: TextFilePart
  /** Wrapped video's private file is kept until upload or discard. */
  readonly dispose?: () => Promise<void>
}

/** The existing three-choice modal uses this question for a batch, with exact
 * hourly money and the shared daily budget; no microphone starts. */
export function batchTranscriptionQuestion(name: string, dailyBudgetUsd: UsdAmount) {
  if (!nonnegativeUsdSchema.safeParse(dailyBudgetUsd).success)
    throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
  const price = fill(UI_TEXT.paidVoicePrice, { price: formatUsd(PAID_PRICES_USD.voicePerHour, 2) })
  return {
    title: fill(UI_TEXT.media.transcript, { name }),
    detail: [
      fill(UI_TEXT.imageBuyBilling, { price }),
      fill(UI_TEXT.paidDailyBudgetLine, { budget: formatUsd(dailyBudgetUsd, 2) }),
    ].join('\n\n'),
  }
}

/** The shared money policy rounds fractional nano-USD liability upward. */
const DECIMAL_SECONDS = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i
function batchCost(seconds: number): Usd {
  const match = DECIMAL_SECONDS.exec(String(seconds))
  if (match === null) throw new Error(UI_TEXT.media.durationUnknown)
  const digits = BigInt(`${match[1] ?? ''}${match[2] ?? ''}`)
  const shift = Number(match[3] ?? 0) - (match[2]?.length ?? 0)
  if (!Number.isSafeInteger(shift)) throw new Error(UI_TEXT.media.durationUnknown)
  const radix = BigInt(USD_DECIMAL_RADIX)
  const count = Number(shift >= 0 ? digits * radix ** BigInt(shift) : digits)
  let cost = Usd.from(PAID_PRICES_USD.voicePerHour).times(count)
  for (let i = shift; i < 0; i++) cost = cost.divide(USD_DECIMAL_RADIX)
  return cost.divideIntegerCeiling(SECONDS_PER_HOUR)
}

function check(deps: AudioPreparationDeps, signal: AbortSignal): void {
  signal.throwIfAborted()
  deps.assertCurrent()
}

/** Prepares one explicit/default sound choice without dispatching a chat turn. */
export async function prepareAudioAttachment(
  source: AudioSource,
  action: AudioAction,
  deps: AudioPreparationDeps,
  signal: AbortSignal,
): Promise<PreparedAudioAttachment> {
  check(deps, signal)
  const options = audioRouteOptions(source.info, deps.context)
  if (!options.actions.includes(action)) {
    throw new Error(
      options.warning ??
        fill(UI_TEXT.media.audioUnsupported, { model: deps.context.model.modelId }),
    )
  }
  const modelId = deps.context.model.modelId
  if (action === 'sendWithoutSound' || action === 'sendAudio') return { modelId, media: source }
  const fallback = deps.context.soundtrackModel
  if (action === 'useSoundtrackModel' && fallback !== undefined)
    return { modelId: fallback.modelId, media: source }
  if (action === 'wrapAsVideo' && fallback !== undefined && deps.converter !== undefined) {
    const converted = await deps.converter.convert(source, 'wrapMp4', signal)
    try {
      check(deps, signal)
      const info = mediaInfoSchema.parse(converted.source.info)
      if (
        info.kind !== 'video' ||
        info.mediaType !== 'video/mp4' ||
        info.hasSoundtrack !== true ||
        info.durationSeconds !== source.info.durationSeconds
      )
        throw new Error(UI_TEXT.media.converterUnavailable)
      return { modelId: fallback.modelId, media: converted.source, dispose: converted.dispose }
    } catch (error: unknown) {
      await converted.dispose()
      throw error
    }
  }
  if (action !== 'transcribe' || deps.batch === undefined || !deps.gate.isOn('voice'))
    throw new Error(UI_TEXT.museVoiceRefused)
  const seconds = source.info.durationSeconds
  if (seconds === null) throw new Error(UI_TEXT.media.durationUnknown)
  const upperSeconds = deps.batch.billableSecondsUpperBound(source)
  if (upperSeconds === undefined || !Number.isFinite(upperSeconds) || upperSeconds < seconds)
    throw new Error(UI_TEXT.sessionBudgetVoiceUnavailable)
  const allowed = await unlessAborted(
    deps.consent.allows({ feature: 'voice' }, false, undefined, signal),
    signal,
  )
  check(deps, signal)
  if (!allowed) throw new Error(UI_TEXT.museVoiceRefused)
  let converted: Awaited<ReturnType<AudioConversionPort['convert']>> | undefined
  let claim: BatchSpendClaim | undefined
  const accounting: { hasSent: boolean; settledCost: Usd | undefined; countedSeconds: number } = {
    hasSent: false,
    settledCost: Usd.from(0),
    countedSeconds: upperSeconds,
  }
  try {
    if (!deps.context.batchFormats.includes(source.info.mediaType)) {
      if (deps.converter === undefined) throw new Error(UI_TEXT.media.converterUnavailable)
      converted = await deps.converter.convert(source, 'extractWav', signal)
      check(deps, signal)
      const info = mediaInfoSchema.parse(converted.source.info)
      if (
        info.kind !== 'audio' ||
        info.mediaType !== 'audio/wav' ||
        info.durationSeconds !== seconds
      )
        throw new Error(UI_TEXT.media.converterUnavailable)
    }
    const admittedClaim = await deps.reserve(batchCost(upperSeconds), signal)
    claim = admittedClaim
    check(deps, signal)
    const result = batchResultSchema.parse(
      await deps.batch.transcribe(converted?.source ?? source, signal, () => {
        check(deps, signal)
        if (accounting.hasSent || !deps.gate.isOn('voice'))
          throw new Error(UI_TEXT.museVoiceRefused)
        admittedClaim.admitSend()
        accounting.hasSent = true
        accounting.settledCost = undefined
      }),
    )
    if (!accounting.hasSent) throw new Error(UI_TEXT.museVoiceRefused)
    // A validated bill is independent of whether the text may enter chat.
    accounting.countedSeconds = result.billedSeconds ?? upperSeconds
    accounting.settledCost =
      result.billedSeconds === undefined ? undefined : batchCost(accounting.countedSeconds)
    if (accounting.countedSeconds > upperSeconds)
      throw new Error(UI_TEXT.sessionBudgetVoiceUnavailable)
    if (
      result.text.trim() === '' ||
      new TextEncoder().encode(result.text).length > MAX_TEXT_ATTACHMENT_BYTES
    )
      throw new Error(UI_TEXT.museVoiceRefused)
    check(deps, signal)
    return {
      modelId,
      ...(source.info.kind === 'video' && { media: source }),
      transcript: {
        type: 'textFile',
        name: fill(UI_TEXT.media.transcript, { name: source.name }),
        mediaType: TEXT_ATTACHMENT_MEDIA_TYPE,
        text: result.text,
        sizeBytes: new TextEncoder().encode(result.text).length,
      },
    }
  } finally {
    try {
      try {
        if (accounting.hasSent) deps.usage.addVoiceBatch(accounting.countedSeconds)
      } finally {
        await claim?.settle(accounting.settledCost)
      }
    } finally {
      await converted?.dispose()
    }
  }
}

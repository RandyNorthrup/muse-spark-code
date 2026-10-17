// M105 lane V, seam 3B: the production audio binding. The Model API bundle
// installs this as the host's one `prepareAudioMessage` (RVMEDIAW2 2), built
// in dist/productionMedia.js so transcription and conversion load only with
// the session's media service, never at activation.
//
// An attached video or audio part (seam 1's registry) is routed by D85.5's
// router: a video on a model that does not hear its sound keeps its visual
// part and gains a transcript; standalone audio becomes its transcript. The
// transcript comes from Muse Voice's batch endpoint over seam 2's narrow
// POST, under seam 4's consent, reservations and tally. A non-contract file
// converts first through the trusted converter (seam 3), found at the
// machine's configured path alone or else its documented installs. A turn
// with no attached sound returns undefined, byte-identical to no port.
import { lstat, readFile } from 'node:fs/promises'
import {
  BYTES_PER_MIB,
  MEDIA_MAX_UPLOAD_MIB,
  UI_TEXT,
  type MEDIA_AUDIO_ACTION_OPTIONS,
} from '../../shared/constants'
import type { TurnPart } from '../agent/agentBackend'
import type { AttachedMediaPort } from '../media/attachedMedia'
import {
  locateMediaConverter,
  type MediaConversionOptions,
  type MediaConverter,
} from '../media/convert'
import { converterTrustedPath } from '../../runtime/converterTrust'
import { createPrepareAudioMessage } from './audioMessagePreparation'
import { audioRouteOptions, type AudioRoutingContext, type AudioSource } from './transcribeBatch'
import {
  createModelApiAudioContext,
  createTranscriptionPorts,
  type TranscriptionPostDeps,
} from './transcribeBatchHttp'
import { voiceBatchSeams, type VoiceBatchSeamDeps } from './voiceBatchSeams'

export interface ProductionAudioDeps extends Omit<VoiceBatchSeamDeps, 'sessionId'> {
  readonly attached: Pick<AttachedMediaPort, 'audio' | 'read'>
  /** Seam 2's transcription POST on the session's Meta client. */
  readonly postTranscription: TranscriptionPostDeps['postTranscription']
  /** The machine-scoped converter path; empty or absent: documented installs. */
  readonly converterPath: () => string | undefined
  readonly audioAction?: (() => (typeof MEDIA_AUDIO_ACTION_OPTIONS)[number]) | undefined
  /** The platform's encoder bindings (owner-only folder, memory watch); the trusted-path port is added here. */
  readonly conversionOptions?: () => MediaConversionOptions | Promise<MediaConversionOptions>
  /** Discovery itself; tests inject it, production uses `locateMediaConverter`. */
  readonly locateConverter?: typeof locateMediaConverter
}

/**
 * The converter's refusal, said rather than dropped: when sound would have
 * been transcribed had conversion been possible, standalone audio (which no
 * Meta model hears) and any part under a configured converter path refuse
 * with the discovery's reason. A video with no converter installed and none
 * configured still goes, without its sound, as the attach warning said.
 */
function assertConvertible(
  sources: readonly AudioSource[],
  located: Awaited<ReturnType<typeof locateMediaConverter>>,
  context: (canExtractWav: boolean) => AudioRoutingContext,
  isConfigured: boolean,
): void {
  if (located.ok) return
  for (const source of sources) {
    const possible = audioRouteOptions(source.info, context(true)).defaultAction
    const actual = audioRouteOptions(source.info, context(false)).defaultAction
    if (
      possible === 'transcribe' &&
      actual !== 'transcribe' &&
      (isConfigured || source.info.kind === 'audio')
    )
      throw new Error(located.reason)
  }
}

/** A bounded read of a file the converter rendered; attachments stream verified. */
async function readAudioBytes(absolutePath: string, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted()
  const info = await lstat(absolutePath)
  if (!info.isFile() || info.size > MEDIA_MAX_UPLOAD_MIB * BYTES_PER_MIB)
    throw new Error(UI_TEXT.attachmentUnreadable)
  return new Uint8Array(await readFile(absolutePath, { signal }))
}

/** The configured converter alone, or none (documented installs). */
function configured(converterPath: string | undefined): readonly MediaConverter[] {
  const command = converterPath?.trim() ?? ''
  return command === '' ? [] : [{ kind: 'ffmpeg', command }]
}

/** The host's `prepareAudioMessage` over the production adapters. */
export function createProductionAudio(deps: ProductionAudioDeps) {
  return async (request: {
    readonly sessionId: string
    readonly turnId: string
    readonly modelId: string
    readonly parts: readonly TurnPart[]
    readonly signal: AbortSignal
    /** The host's own currency (its model revision), checked with every step. */
    readonly assertCurrent?: () => void
  }) => {
    const sources = request.parts.flatMap((part) => deps.attached.audio(part) ?? [])
    // Nothing attached to hear: no converter probe, no port, no bytes changed.
    if (sources.length === 0) return
    const conversionOptions: MediaConversionOptions = {
      ...(await deps.conversionOptions?.()),
      trustedPath: converterTrustedPath(),
    }
    const configuredConverters = configured(deps.converterPath())
    const located = await (deps.locateConverter ?? locateMediaConverter)({
      ...conversionOptions,
      configuredConverters,
    })
    request.signal.throwIfAborted()
    const isVoiceOn = deps.isPaidFeatureOn('voice')
    const context = (canExtractWav: boolean) =>
      createModelApiAudioContext({ modelId: request.modelId, canExtractWav, isVoiceOn })
    assertConvertible(
      sources.filter(
        (source) => source.info.kind !== 'audio' || deps.audioAction?.() !== 'sendAudio',
      ),
      located,
      context,
      configuredConverters.length > 0,
    )
    const ports = createTranscriptionPorts({
      postTranscription: deps.postTranscription,
      readAudioBytes,
      readSource: (source, signal) => deps.attached.read(source.pathToken, signal),
      locateConverter: () => Promise.resolve(located),
      conversionOptions,
    })
    const seams = voiceBatchSeams({ ...deps, sessionId: request.sessionId })
    return await createPrepareAudioMessage({
      contextFor: (modelId) =>
        createModelApiAudioContext({ modelId, canExtractWav: located.ok, isVoiceOn }),
      ...ports,
      ...seams,
      audioAction: deps.audioAction,
      resolveSource: (part) => deps.attached.audio(part),
      // Stop, the host's model revision and the Muse Voice setting, after
      // every await and at the dispatch itself: a change abandons the
      // preparation before anything is spent (RVMEDIAV 2, 4).
      assertCurrent: () => {
        request.signal.throwIfAborted()
        request.assertCurrent?.()
        if (deps.isPaidFeatureOn('voice') !== isVoiceOn) throw new Error(UI_TEXT.museVoiceRefused)
      },
    })(request)
  }
}

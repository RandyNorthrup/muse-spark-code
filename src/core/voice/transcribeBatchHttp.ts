// U18 / D85.5: the captured batch-transcription HTTP adapter and the
// production converter binding. Round 2 sent mp3, mp4 and mov as they are
// and every one returned HTTP 400 `invalid_request_error`, param "audio":
// "The 'audio' part must be a mono 16-bit PCM WAV at 16 or 24 kHz". Round 3
// converted the same soundtracks locally (`-vn -ac 1 -ar 16000 -c:a
// pcm_s16le`) and DIARIZATION/PUSH_TO_TALK answered 200 with
// `{transcript, audioDurationMs, turns}` (T7/T8/T9 in
// `docs/research/m105-captures/round3-2026-10-08.jsonl`). No response
// carries usage, so the receipt is `audioDurationMs` rounded down to seconds
// times $0.18 per hour (`docs/certification/m105-captures.md` U18).
//
// The product therefore converts before it sends: `prepareAudioAttachment`
// (in `./transcribeBatch`) routes anything outside `batchFormats` through
// the `AudioConversionPort` below, which renders exactly 16 kHz mono WAV
// with M1's confined converter and refuses honestly when no converter is on
// the machine. The adapter re-sniffs the bytes at the last mile and never
// sends a container. Mode mirrors the captures: a video soundtrack is
// diarized, standalone audio uses push-to-talk. Lane V binds these ports to
// the hosts; this module stays host-free (`vscode` never imported).
import * as z from 'zod/mini'
import { randomUUID } from 'node:crypto'
import {
  MUSE_VOICE_MODEL,
  TRANSCRIBE_WAV_BITS_PER_SAMPLE,
  TRANSCRIBE_WAV_CHANNELS,
  TRANSCRIBE_WAV_FORMAT_PCM,
  TRANSCRIBE_WAV_SAMPLE_RATES,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { sniffMediaBytes } from '../media/limits'
import { readWavFormat } from '../media/sniff/riff'
import {
  convertToWav16kMono,
  locateMediaConverter,
  type MediaConversionOptions,
} from '../media/convert'
import type {
  AudioConversionPort,
  AudioModelCapabilities,
  AudioRoutingContext,
  AudioSource,
  BatchTranscriptionPort,
} from './transcribeBatch'

/** Milliseconds per billed second; the receipt rounds the captured `audioDurationMs` down. */
const MS_PER_BILLABLE_SECOND = 1000
/** The server's refusal stays readable; a runaway body never reaches the turn. */
const SERVER_MESSAGE_MAX_CHARS = 500
/** Video soundtracks are diarized, standalone audio uses push-to-talk (T7/T8 vs T9). */
const VIDEO_TRANSCRIBE_MODE = 'DIARIZATION'
const AUDIO_TRANSCRIBE_MODE = 'PUSH_TO_TALK'
/** The captured `request` part of the multipart body. */
const TRANSCRIBE_AUDIO_ENCODING = 'WAV'
/** U18: the batch endpoint accepts only 16 kHz mono WAV, never a container. */
const BATCH_ACCEPTED_FORMATS = ['audio/wav'] as const
/** The last-mile contract: mono 16-bit PCM at 16 or 24 kHz (round-3 refusal). */
function isBatchContractWav(wav: Uint8Array): boolean {
  const format = readWavFormat(wav)
  return (
    format?.format === TRANSCRIBE_WAV_FORMAT_PCM &&
    format.channels === TRANSCRIBE_WAV_CHANNELS &&
    format.bitsPerSample === TRANSCRIBE_WAV_BITS_PER_SAMPLE &&
    (format.sampleRate === TRANSCRIBE_WAV_SAMPLE_RATES[0] ||
      format.sampleRate === TRANSCRIBE_WAV_SAMPLE_RATES[1])
  )
}
/** Containers sent as-is come back with this status and the captured refusal. */
const TRANSCRIBE_REFUSED_STATUS = 400

const batchBodySchema = z.object({
  transcript: z.string(),
  audioDurationMs: z.number().check(z.gte(0)),
})

const batchErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    param: z.optional(z.string()),
  }),
})

export interface TranscriptionPostDeps {
  /** Host-owned POST with the Model API key and endpoint; fake HTTP in tests. */
  readonly postTranscription: (request: {
    readonly route: string
    readonly body: ReadableStream<Uint8Array>
    readonly contentType: string
    readonly signal: AbortSignal
    /** Called synchronously immediately before the fetch, after the key and
    endpoint are ready; a throw refuses the POST (RVMEDIAV 2). */
    readonly dispatch: () => void
  }) => Promise<Response>
  /** Bounded read of a converted file this adapter rendered. */
  readonly readAudioBytes: (absolutePath: string, signal: AbortSignal) => Promise<Uint8Array>
  /** The approved attachment's digest-verified stream (the registry's):
  a changed size or digest throws before its last chunk (RVMEDIAV 1). */
  readonly readSource: (source: AudioSource, signal: AbortSignal) => AsyncIterable<Uint8Array>
}

export interface TranscriptionConversionDeps {
  readonly locateConverter?: () => Promise<Awaited<ReturnType<typeof locateMediaConverter>>>
  readonly conversionOptions?: MediaConversionOptions
  readonly mintToken?: () => string
}

function serverMessage(raw: unknown): string | undefined {
  const parsed = batchErrorSchema.safeParse(raw)
  return !parsed.success || parsed.data.error.message.trim() === ''
    ? undefined
    : parsed.data.error.message.slice(0, SERVER_MESSAGE_MAX_CHARS)
}

function wavFileName(name: string): string {
  return /\.[a-z0-9]+$/iu.test(name) ? name.replace(/\.[a-z0-9]+$/iu, '.wav') : `${name}.wav`
}

/** Builds the captured multipart body: a JSON `request` part plus the WAV `audio` part. */
function transcriptionBody(
  wav: Uint8Array,
  name: string,
  mode: string,
): {
  readonly body: ReadableStream<Uint8Array>
  readonly contentType: string
} {
  const boundary = `muse-transcribe-${randomUUID()}`
  const encoder = new TextEncoder()
  const quotedName = wavFileName(name).replaceAll('"', '%22')
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify({ model: MUSE_VOICE_MODEL, audioEncoding: TRANSCRIBE_AUDIO_ENCODING, mode })}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${quotedName}"\r\n` +
      `Content-Type: audio/wav\r\n\r\n`,
  )
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`)
  let hasSentPrefix = false
  return {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!hasSentPrefix) {
          hasSentPrefix = true
          controller.enqueue(prefix)
          controller.enqueue(wav)
          controller.enqueue(suffix)
        }
        controller.close()
      },
    }),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

/** The approved attachment's bytes, whole only when they are the ones attached. */
async function verifiedBytes(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let size = 0
  for await (const chunk of chunks) {
    parts.push(chunk)
    size += chunk.byteLength
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

function audioCaps(modelId: string): AudioModelCapabilities {
  if (modelId === 'muse-spark-1.2-contributor' || modelId === 'muse-spark-1.3-contributor') {
    return {
      modelId,
      video: 'yes',
      videoFormats: ['video/mp4', 'video/quicktime'],
      hearsSoundtrack: modelId === 'muse-spark-1.2-contributor' ? 'yes' : 'no',
      audio: 'no',
      audioFormats: [],
    }
  }
  return {
    modelId,
    video: 'unknown',
    videoFormats: [],
    hearsSoundtrack: 'unknown',
    audio: 'unknown',
    audioFormats: [],
  }
}

/** Production sound context for the Model API backend. Unknown models stay
unknown, which the router refuses with a named reason; `wrapAsVideo`
stays off until lane V binds M2's encoder. */
export function createModelApiAudioContext(options: {
  readonly modelId: string
  readonly soundtrackModelId?: string
  readonly canExtractWav: boolean
  readonly isVoiceOn: boolean
}): AudioRoutingContext {
  return {
    backend: 'modelApi',
    model: audioCaps(options.modelId),
    ...(options.soundtrackModelId !== undefined && {
      soundtrackModel: audioCaps(options.soundtrackModelId),
    }),
    batchFormats: [...BATCH_ACCEPTED_FORMATS],
    canExtractWav: options.canExtractWav,
    canWrapMp4: false,
    isVoiceOn: options.isVoiceOn,
  }
}

export function createTranscriptionPorts(
  deps: TranscriptionPostDeps & TranscriptionConversionDeps,
): {
  readonly conversion: AudioConversionPort
  readonly batch: BatchTranscriptionPort
} {
  const converted = new Map<
    string,
    { readonly path: string; readonly kind: AudioSource['info']['kind'] }
  >()
  const mintToken = deps.mintToken ?? (() => `transcribed-${randomUUID()}`)

  const conversion: AudioConversionPort = {
    convert: async (source, mode, signal) => {
      signal.throwIfAborted()
      if (mode !== 'extractWav') throw new Error(UI_TEXT.media.converterUnavailable)
      // A file this adapter rendered converts from its own path; an
      // attachment converts from its digest-verified bytes, written to the
      // conversion's private folder, never from the user's path (RVMEDIAV2).
      const renderedPath = converted.get(source.pathToken)?.path
      const located = await (deps.locateConverter ?? locateMediaConverter)()
      if (!located.ok) throw new Error(located.reason)
      const rendered = await convertToWav16kMono(renderedPath ?? source.name, located.converter, {
        ...deps.conversionOptions,
        signal,
        ...(renderedPath === undefined && {
          inputBytes: () => deps.readSource(source, signal),
        }),
      })
      if (!rendered.ok) throw new Error(rendered.reason)
      const token = mintToken()
      converted.set(token, { path: rendered.path, kind: source.info.kind })
      const dispose = async () => {
        converted.delete(token)
        await rendered.dispose()
      }
      return {
        source: {
          name: wavFileName(source.name),
          pathToken: token,
          info: { ...rendered.info, durationSeconds: source.info.durationSeconds },
        },
        dispose,
      }
    },
  }

  const batch: BatchTranscriptionPort = {
    billableSecondsUpperBound: (source) =>
      source.info.durationSeconds === null ? undefined : Math.ceil(source.info.durationSeconds),
    transcribe: async (source, signal, admission) => {
      signal.throwIfAborted()
      // An attachment is read through its digest-verified stream; only a
      // file this adapter rendered is read by path.
      const renderedPath = converted.get(source.pathToken)?.path
      let wav =
        renderedPath === undefined
          ? await verifiedBytes(deps.readSource(source, signal))
          : await deps.readAudioBytes(renderedPath, signal)
      const sniffed = sniffMediaBytes(wav)
      if (sniffed?.kind !== 'audio' || sniffed.mediaType !== 'audio/wav')
        throw new Error(UI_TEXT.media.converterUnavailable)
      let rendered: Awaited<ReturnType<AudioConversionPort['convert']>> | undefined
      let name = source.name
      // From the conversion's creation onward every path disposes it: a
      // failed reread, an invalid rendered header, Stop, the POST and its
      // refusal all leave through this finally.
      try {
        if (!isBatchContractWav(wav)) {
          // The last mile renders the captured contract before any admission:
          // any other WAV is converted, or refused here when no converter is
          // on the machine. Nothing billable has happened yet.
          rendered = await conversion.convert(source, 'extractWav', signal)
          const renderedWav = converted.get(rendered.source.pathToken)?.path
          if (renderedWav === undefined) throw new Error(UI_TEXT.media.converterUnavailable)
          wav = await deps.readAudioBytes(renderedWav, signal)
          name = rendered.source.name
          if (!isBatchContractWav(wav)) throw new Error(UI_TEXT.media.converterUnavailable)
        }
        // The bytes' own duration is bound to the reservation: what the
        // receipt can bill never exceeds the approved attachment's bound.
        const measured = sniffMediaBytes(wav)?.durationSeconds
        const upper = batch.billableSecondsUpperBound(source)
        if (
          measured === undefined ||
          measured === null ||
          upper === undefined ||
          Math.floor(measured) > upper
        )
          throw new Error(fill(UI_TEXT.media.sourceChanged, { name: source.name }))
        admission.check()
        // The mode follows the original attachment, not the converted bytes:
        // a video soundtrack is diarized, standalone audio uses push-to-talk.
        const origin = converted.get(source.pathToken)?.kind ?? source.info.kind
        const mode = origin === 'video' ? VIDEO_TRANSCRIBE_MODE : AUDIO_TRANSCRIBE_MODE
        const { body, contentType } = transcriptionBody(wav, name, mode)
        const response = await deps.postTranscription({
          route: `/asr/transcribe?sessionId=${randomUUID()}`,
          body,
          contentType,
          signal,
          dispatch: admission.dispatch,
        })
        let raw: unknown
        try {
          raw = await response.json()
        } catch {
          // An empty or non-JSON refusal carries no server message; the status below still refuses.
          raw = null
        }
        if (!response.ok) {
          const refusal = serverMessage(raw)
          if (refusal !== undefined && response.status === TRANSCRIBE_REFUSED_STATUS)
            throw new Error(refusal)
          throw new Error(`Transcription request failed: HTTP ${String(response.status)}`)
        }
        const parsed = batchBodySchema.safeParse(raw)
        if (!parsed.success) throw new Error('Transcription response was not a transcript receipt')
        return {
          text: parsed.data.transcript,
          billedSeconds: Math.floor(parsed.data.audioDurationMs / MS_PER_BILLABLE_SECOND),
        }
      } finally {
        await rendered?.dispose()
      }
    },
  }

  return { conversion, batch }
}

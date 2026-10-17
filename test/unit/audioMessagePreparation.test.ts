import {
  synthWav,
  collectTranscriptionBody,
  attachedAudioBytes,
  expectTranscriptionPost,
} from './helpers/media/batchFixtures'
// MEDIAW finding 7: the Model API factory's `prepareAudioMessage` runs
// attached audio through the real routing, conversion and batch adapters,
// so an attached MP3 converts to contract WAV before transcription. The
// marker text part stands in for lane V's attach-port token registry;
// everything past `resolveSource` is product code.
import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPrepareAudioMessage } from '../../src/core/voice/audioMessagePreparation'
import {
  createModelApiAudioContext,
  createTranscriptionPorts,
} from '../../src/core/voice/transcribeBatchHttp'
import type { AudioSource } from '../../src/core/voice/transcribeBatch'
import type { TurnPart } from '../../src/core/agent/agentBackend'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { fakeConversionOptions } from './helpers/media/conversion'

const MP3_FIXTURE = 'test/fixtures/voice/tone-2s.mp3'
const MARKER = 'attached-audio-stands-here'
const VIDEO_MARKER = 'attached-video-stands-here'

// A video whose soundtrack 1.3 does not hear (U4): the router's default is
// to transcribe the sound, and the video itself still goes (D85.5).
const videoSource: AudioSource = {
  name: 'clip.mp4',
  pathToken: 'confined-video',
  info: {
    kind: 'video',
    mediaType: 'video/mp4',
    sizeBytes: 4000,
    durationSeconds: 2,
    hasSoundtrack: true,
    width: 320,
    height: 240,
  },
}

const mp3Source: AudioSource = {
  name: 'speech.mp3',
  pathToken: 'confined-mp3',
  info: { kind: 'audio', mediaType: 'audio/mpeg', sizeBytes: 1000, durationSeconds: 2 },
}

interface Rig {
  readonly prepare: ReturnType<typeof createPrepareAudioMessage>
  readonly posted: { readonly route: string; readonly contentType: string; readonly body: string }[]
  readonly paths: Map<string, string>
  readonly settled: (string | undefined)[]
  readonly voiceSeconds: () => number
}

function rig(options?: {
  readonly voiceOn?: boolean
  readonly isAllowed?: boolean
  readonly action?: 'transcribe' | 'sendAudio'
  readonly nativeAudio?: boolean
  /** Mutable explicit choice; the preparation must notice a change mid-await. */
  readonly actionCell?: { value: 'transcribe' | 'sendAudio' }
  /** Flip the choice inside each await of the preparation. */
  readonly onConsent?: () => void
  readonly onConvert?: () => void
  readonly onReserve?: () => void
  /** After the converted bytes are read, just before the dispatch admission. */
  readonly onReadRendered?: () => void
}): Rig {
  const posted: Rig['posted'] = []
  const paths = new Map<string, string>()
  const settled: (string | undefined)[] = []
  let voiceSeconds = 0
  const ports = createTranscriptionPorts({
    readAudioBytes: async (absolutePath) => {
      options?.onReadRendered?.()
      return new Uint8Array(await readFile(absolutePath))
    },
    readSource: (source) => attachedAudioBytes(paths, source.pathToken),
    postTranscription: async (request) => {
      const raw = await collectTranscriptionBody(request)
      posted.push({
        route: request.route,
        contentType: request.contentType,
        body: raw.toString('utf8'),
      })
      return Response.json({ transcript: 'The Blue Llama.', audioDurationMs: 2080 })
    },
    locateConverter: () =>
      Promise.resolve({
        ok: true as const,
        // Never executed: `run` below stands in for the bytes, so no real
        // binary is touched. Absolute only because the product refuses
        // relative commands.
        converter: { kind: 'ffmpeg' as const, command: path.join(tmpdir(), 'muse-fake-ffmpeg') },
      }),
    conversionOptions: fakeConversionOptions(async (_command, _args, runOptions) => {
      options?.onConvert?.()
      await writeFile(runOptions.outputPath, synthWav(2))
    }),
  })
  const cell = options?.actionCell
  const action = cell?.value ?? options?.action
  const prepare = createPrepareAudioMessage({
    contextFor: (modelId) => {
      const context = createModelApiAudioContext({
        modelId,
        canExtractWav: true,
        isVoiceOn: options?.voiceOn ?? true,
      })
      return options?.nativeAudio === true
        ? { ...context, model: { ...context.model, audio: 'yes', audioFormats: ['audio/mpeg'] } }
        : context
    },
    ...((action !== undefined || cell !== undefined) && {
      audioAction: () => cell?.value ?? action ?? 'transcribe',
    }),
    ...ports,
    gate: { isOn: () => options?.voiceOn ?? true },
    usage: {
      addVoiceBatch: (seconds) => {
        voiceSeconds += seconds
      },
    },
    resolveSource: (part: TurnPart) => {
      if (part.type !== 'text') return undefined
      if (part.text === MARKER) return mp3Source
      return part.text === VIDEO_MARKER ? videoSource : undefined
    },
    assertCurrent: () => undefined,
    consent: {
      allows: () => {
        options?.onConsent?.()
        return Promise.resolve(options?.isAllowed ?? true)
      },
    },
    reserve: () => {
      options?.onReserve?.()
      return Promise.resolve({
        admitSend: () => undefined,
        settle: (actual) => {
          settled.push(actual?.toAmount())
          return Promise.resolve()
        },
      })
    },
  })
  return { prepare, posted, paths, settled, voiceSeconds: () => voiceSeconds }
}

function prepareParts(r: Rig, parts: readonly TurnPart[]) {
  return r.prepare({
    sessionId: 'session-1',
    turnId: 'turn-1',
    modelId: 'muse-spark-1.3-contributor',
    parts,
    signal: new AbortController().signal,
  })
}

describe('Model API factory audio preparation (MEDIAW finding 7)', () => {
  it('converts an attached MP3 before the batch POST and returns its transcript', async () => {
    const r = rig()
    r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
    const prepared = await prepareParts(r, [{ type: 'text', text: MARKER }])
    expect(prepared?.modelId).toBe('muse-spark-1.3-contributor')
    expect(prepared?.parts).toHaveLength(1)
    const transcript = prepared?.parts[0]
    if (transcript?.type !== 'textFile') throw new Error('expected a transcript textFile part')
    expect(transcript.text).toBe('The Blue Llama.')
    expect(r.posted).toHaveLength(1)
    const post = expectTranscriptionPost(r.posted[0])
    // The converted WAV rides the wire, never the mp3 container.
    expect(post.body.includes('RIFF')).toBe(true)
    expect(post.body.includes('ID3')).toBe(false)
    expect(r.settled).toHaveLength(1)
    expect(r.voiceSeconds()).toBe(2)
  })

  it('keeps a video beside its soundtrack transcript, never replacing it (RVMEDIAW 5)', async () => {
    // D85.5: "the transcript goes beside the video as text". The adapter
    // once appended only the transcript, dropping the video's frames.
    const r = rig()
    // The fake converter never reads its input; any confined file stands in.
    r.paths.set(videoSource.pathToken, path.resolve(MP3_FIXTURE))
    const videoPart: TurnPart = { type: 'text', text: VIDEO_MARKER }
    const prepared = await prepareParts(r, [
      { type: 'text', text: 'What happens here?' },
      videoPart,
    ])
    expect(prepared?.parts).toHaveLength(3)
    // The original video part survives, in place, for the replay to upload.
    expect(prepared?.parts[1]).toBe(videoPart)
    const transcript = prepared?.parts[2]
    if (transcript?.type !== 'textFile') throw new Error('expected a transcript textFile part')
    expect(transcript.text).toBe('The Blue Llama.')
    expect(transcript.name).toContain('clip.mp4')
    // A soundtrack is diarized; one POST carries the converted WAV.
    expect(r.posted).toHaveLength(1)
    expect(r.posted[0]?.body).toContain('DIARIZATION')
    expect(r.posted[0]?.body.includes('RIFF')).toBe(true)
  })

  it('resolves undefined when no part is transcribable, like an absent port', async () => {
    const r = rig()
    const prepared = await prepareParts(r, [{ type: 'text', text: 'just text' }])
    expect(prepared).toBeUndefined()
    expect(r.posted).toHaveLength(0)
  })

  it('sends a video without its sound when transcription is declined; declined audio refuses (lane V)', async () => {
    // D85.5's Send without sound: the paid question's No is not a failed turn.
    const r = rig({ isAllowed: false })
    r.paths.set(videoSource.pathToken, path.resolve(MP3_FIXTURE))
    const videoPart: TurnPart = { type: 'text', text: VIDEO_MARKER }
    const request = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      modelId: 'muse-spark-1.3-contributor',
      signal: new AbortController().signal,
    }
    expect(await r.prepare({ ...request, parts: [videoPart] })).toBeUndefined()
    expect(r.posted).toHaveLength(0)
    r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
    await expect(
      r.prepare({ ...request, parts: [{ type: 'text', text: MARKER }] }),
    ).rejects.toThrow(UI_TEXT.museVoiceRefused)
    expect(r.settled).toHaveLength(0)
  })

  it('leaves the turn untouched when the voice feature is off, like an absent port', async () => {
    const r = rig({ voiceOn: false })
    r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
    const prepared = await prepareParts(r, [{ type: 'text', text: MARKER }])
    expect(prepared).toBeUndefined()
    expect(r.posted).toHaveLength(0)
  })
  it.each(['transcribe', 'sendAudio'] as const)(
    'honors explicit %s on a synthetic model that hears audio',
    async (action) => {
      const r = rig({ action, nativeAudio: true })
      r.paths.set(mp3Source.pathToken, MP3_FIXTURE)
      const result = await prepareParts(r, [{ type: 'text', text: MARKER }])
      expect(r.posted).toHaveLength(action === 'transcribe' ? 1 : 0)
      if (action === 'transcribe')
        expect(result?.parts).toMatchObject([{ type: 'textFile', text: 'The Blue Llama.' }])
      else {
        expect(result).toBeUndefined()
        expect(r.settled).toEqual([])
      }
    },
  )

  // RVM105 2: the preparation captured transcribe before its awaits; a
  // change to sendAudio during any of them refuses with sendAudio's reason
  // (the model does not take audio) before any transcription request.
  it.each(['consent', 'convert', 'reserve', 'read'] as const)(
    'refuses a sendAudio change during %s without a transcription POST',
    async (stage) => {
      const cell = { value: 'transcribe' as 'transcribe' | 'sendAudio' }
      const flip = () => {
        cell.value = 'sendAudio'
      }
      const r = rig({
        actionCell: cell,
        ...(stage === 'consent' && { onConsent: flip }),
        ...(stage === 'convert' && { onConvert: flip }),
        ...(stage === 'reserve' && { onReserve: flip }),
        ...(stage === 'read' && { onReadRendered: flip }),
      })
      r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
      await expect(prepareParts(r, [{ type: 'text', text: MARKER }])).rejects.toThrow(
        fill(UI_TEXT.media.audioUnsupported, { model: 'muse-spark-1.3-contributor' }),
      )
      expect(r.posted).toHaveLength(0)
    },
  )

  it('ignores an audio-action change for a video part, which has no audio action', async () => {
    const cell = { value: 'transcribe' as 'transcribe' | 'sendAudio' }
    const r = rig({
      actionCell: cell,
      onConsent: () => {
        cell.value = 'sendAudio'
      },
    })
    r.paths.set(videoSource.pathToken, path.resolve(MP3_FIXTURE))
    const prepared = await prepareParts(r, [{ type: 'text', text: VIDEO_MARKER }])
    expect(prepared?.parts).toHaveLength(2)
    expect(r.posted).toHaveLength(1)
  })
})

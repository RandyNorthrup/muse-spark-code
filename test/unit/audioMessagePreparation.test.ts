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

function synthWav(seconds: number): Uint8Array {
  const sampleRate = 16_000
  const dataBytes = seconds * sampleRate * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

interface Rig {
  readonly prepare: ReturnType<typeof createPrepareAudioMessage>
  readonly posted: { readonly route: string; readonly contentType: string; readonly body: string }[]
  readonly paths: Map<string, string>
  readonly settled: (string | undefined)[]
  readonly voiceSeconds: () => number
}

function rig(options?: { readonly voiceOn?: boolean }): Rig {
  const posted: Rig['posted'] = []
  const paths = new Map<string, string>()
  const settled: (string | undefined)[] = []
  let voiceSeconds = 0
  const ports = createTranscriptionPorts({
    resolveSourcePath: (source) => Promise.resolve(paths.get(source.pathToken)),
    readAudioBytes: async (absolutePath) => new Uint8Array(await readFile(absolutePath)),
    postTranscription: async (request) => {
      const chunks: Uint8Array[] = []
      const reader = request.body.getReader()
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        chunks.push(next.value)
      }
      const raw = Buffer.concat(chunks)
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
    conversionOptions: {
      trustedPath: { verify: () => Promise.resolve('ok' as const) },
      readRssBytes: () => Promise.resolve(0),
      probeVersion: () =>
        Promise.resolve('ffmpeg version 7.0-test Copyright (c) 2025 the FFmpeg developers'),
      run: async (_command: string, _args: readonly string[], runOptions): Promise<void> => {
        await writeFile(runOptions.outputPath, synthWav(2))
      },
    },
  })
  const prepare = createPrepareAudioMessage({
    contextFor: (modelId) =>
      createModelApiAudioContext({
        modelId,
        canExtractWav: true,
        isVoiceOn: options?.voiceOn ?? true,
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
    consent: { allows: () => Promise.resolve(true) },
    reserve: () => {
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

describe('Model API factory audio preparation (MEDIAW finding 7)', () => {
  it('converts an attached MP3 before the batch POST and returns its transcript', async () => {
    const r = rig()
    r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
    const prepared = await r.prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      modelId: 'muse-spark-1.3-contributor',
      parts: [{ type: 'text', text: MARKER }],
      signal: new AbortController().signal,
    })
    expect(prepared?.modelId).toBe('muse-spark-1.3-contributor')
    expect(prepared?.parts).toHaveLength(1)
    const transcript = prepared?.parts[0]
    if (transcript?.type !== 'textFile') throw new Error('expected a transcript textFile part')
    expect(transcript.text).toBe('The Blue Llama.')
    expect(r.posted).toHaveLength(1)
    const post = r.posted[0]
    if (post === undefined) throw new Error('expected one transcription POST')
    expect(post.route).toMatch(/^\/asr\/transcribe\?sessionId=/)
    expect(post.contentType).toMatch(/^multipart\/form-data; boundary=/)
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
    const prepared = await r.prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      modelId: 'muse-spark-1.3-contributor',
      parts: [{ type: 'text', text: 'What happens here?' }, videoPart],
      signal: new AbortController().signal,
    })
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
    const prepared = await r.prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      modelId: 'muse-spark-1.3-contributor',
      parts: [{ type: 'text', text: 'just text' }],
      signal: new AbortController().signal,
    })
    expect(prepared).toBeUndefined()
    expect(r.posted).toHaveLength(0)
  })

  it('leaves the turn untouched when the voice feature is off, like an absent port', async () => {
    const r = rig({ voiceOn: false })
    r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
    const prepared = await r.prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      modelId: 'muse-spark-1.3-contributor',
      parts: [{ type: 'text', text: MARKER }],
      signal: new AbortController().signal,
    })
    expect(prepared).toBeUndefined()
    expect(r.posted).toHaveLength(0)
  })
})

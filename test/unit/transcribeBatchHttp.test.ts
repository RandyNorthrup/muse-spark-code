// U18: the product converts to 16 kHz mono WAV before the batch send, never
// the container. Through the real `prepareAudioAttachment` with the real
// ports: a fake encoder stands in for ffmpeg's bytes (its own rendering is
// proven by the real-ffmpeg test at the bottom), fake HTTP stands in for
// `/asr/transcribe`, and the T7/T8/T9 receipts pin the money.
import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  createModelApiAudioContext,
  createTranscriptionPorts,
  type TranscriptionConversionDeps,
} from '../../src/core/voice/transcribeBatchHttp'
import {
  audioRouteOptions,
  prepareAudioAttachment,
  type AudioPreparationDeps,
  type AudioSource,
} from '../../src/core/voice/transcribeBatch'
import { convertToWav16kMono } from '../../src/core/media/convert'
import { UI_TEXT } from '../../src/shared/constants'
import type { Usd } from '../../src/shared/usd'

const MP3_FIXTURE = 'test/fixtures/voice/tone-2s.mp3'
const FFMPEG = '/usr/local/bin/ffmpeg'
const execFileAsync = promisify(execFile)

/** Minimal PCM WAV the sniffer reads with an exact duration. */
function synthWav(seconds: number): Uint8Array {
  const dataBytes = Math.round(seconds * 32_000)
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16_000, 24)
  buffer.writeUInt32LE(32_000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const response = new Response(stream)
  return await response.text()
}

interface Posted {
  route: string
  contentType: string
  body: string
}

function rig(options?: {
  readonly locate?: TranscriptionConversionDeps['locateConverter']
  readonly encoderWav?: Uint8Array
  readonly respond?: () => Response
}) {
  const stubWav = options?.encoderWav
  const posted: Posted[] = []
  const paths = new Map<string, string>()
  const settled: (string | undefined)[] = []
  const reserved: Usd[] = []
  let voiceSeconds = 0
  const ports = createTranscriptionPorts({
    resolveSourcePath: (source) => Promise.resolve(paths.get(source.pathToken)),
    readAudioBytes: async (absolutePath) => new Uint8Array(await readFile(absolutePath)),
    postTranscription: async (request) => {
      posted.push({
        route: request.route,
        contentType: request.contentType,
        body: await streamText(request.body),
      })
      return options?.respond?.() ?? Response.json({ transcript: 'ok', audioDurationMs: 1000 })
    },
    locateConverter:
      options?.locate ??
      (() =>
        Promise.resolve({
          ok: true as const,
          converter: { kind: 'ffmpeg' as const, command: FFMPEG },
        })),
    conversionOptions: {
      trustedPath: { verify: () => Promise.resolve('ok' as const) },
      readRssBytes: () => Promise.resolve(0),
      ...(stubWav !== undefined && {
        run: async (_command: string, _args: readonly string[], runOptions): Promise<void> => {
          await writeFile(runOptions.outputPath, stubWav)
        },
      }),
    },
  })
  const context = createModelApiAudioContext({
    modelId: 'muse-spark-1.3-contributor',
    soundtrackModelId: 'muse-spark-1.2-contributor',
    canExtractWav: true,
    isVoiceOn: true,
  })
  const deps: AudioPreparationDeps = {
    context,
    assertCurrent: () => undefined,
    converter: ports.conversion,
    batch: ports.batch,
    gate: { isOn: () => true },
    consent: { allows: () => Promise.resolve(true) },
    reserve: (cost) => {
      reserved.push(cost)
      return Promise.resolve({
        admitSend: () => undefined,
        settle: (actual) => {
          settled.push(actual?.toAmount())
          return Promise.resolve()
        },
      })
    },
    usage: {
      addVoiceBatch: (seconds) => {
        voiceSeconds += seconds
      },
    },
  }
  const prepare = (source: AudioSource, signal = new AbortController().signal) =>
    prepareAudioAttachment(source, 'transcribe', deps, signal)
  return {
    ports,
    posted,
    paths,
    settled,
    reserved,
    prepare,
    get voiceSeconds() {
      return voiceSeconds
    },
  }
}

const mp3Source: AudioSource = {
  name: 'speech.mp3',
  pathToken: 'confined-mp3',
  info: { kind: 'audio', mediaType: 'audio/mpeg', sizeBytes: 1000, durationSeconds: 2 },
}

describe('U18 WAV conversion before the batch send', () => {
  it('converts mp3 to WAV before POST, settling the floored receipt (T9 shape)', async () => {
    const wav = synthWav(2)
    const r = rig({
      encoderWav: wav,
      respond: () => Response.json({ transcript: 'The Blue Llama.', audioDurationMs: 2080 }),
    })
    r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
    const prepared = await r.prepare(mp3Source)
    expect(prepared.transcript?.text).toBe('The Blue Llama.')
    expect(r.posted).toHaveLength(1)
    const post = r.posted[0]
    if (post === undefined) throw new Error('expected one transcription POST')
    expect(post.route).toMatch(/^\/asr\/transcribe\?sessionId=/)
    expect(post.contentType).toMatch(/^multipart\/form-data; boundary=/)
    // Text parts lead; the WAV bytes follow. Slice so a failure never dumps them.
    const head = post.body.slice(0, 800)
    expect(head).toContain('"audioEncoding":"WAV"')
    expect(head).toContain('"mode":"PUSH_TO_TALK"')
    expect(head).toContain('filename="speech.wav"')
    // The converted WAV rides the wire, never the mp3 container.
    expect(head).toContain('Content-Type: audio/wav')
    expect(post.body.includes('RIFF')).toBe(true)
    expect(post.body.includes('ID3')).toBe(false)
    expect(r.reserved[0]?.toAmount()).toBe('0.0001')
    expect(r.settled[0]).toBe('0.0001')
    expect(r.voiceSeconds).toBe(2)
  })

  it('diarizes a video soundtrack and settles thirty seconds for 30080 ms (T7 receipt)', async () => {
    const video: AudioSource = {
      name: 'clip30.mp4',
      pathToken: 'confined-mp4',
      info: {
        kind: 'video',
        mediaType: 'video/mp4',
        sizeBytes: 500_000,
        durationSeconds: 30.08,
        hasSoundtrack: true,
      },
    }
    const r = rig({
      encoderWav: synthWav(30.08),
      respond: () =>
        Response.json({
          transcript: 'The blue llama counts to seven at the harbor.',
          audioDurationMs: 30_080,
          turns: [],
        }),
    })
    r.paths.set(video.pathToken, path.resolve(MP3_FIXTURE))
    const prepared = await r.prepare(video)
    expect(prepared.transcript?.text).toContain('blue llama')
    expect(prepared.media).toEqual(video)
    const post = r.posted[0]
    if (post === undefined) throw new Error('expected one transcription POST')
    const head = post.body.slice(0, 800)
    expect(head).toContain('"mode":"DIARIZATION"')
    expect(head).toContain('filename="clip30.wav"')
    expect(r.reserved[0]?.toAmount()).toBe('0.00155')
    expect(r.settled[0]).toBe('0.0015')
    expect(r.voiceSeconds).toBe(30)
  })

  it('sends an already-16 kHz WAV as-is without touching the converter', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'muse-wav-direct-'))
    try {
      const wavPath = path.join(root, 'speech.wav')
      await writeFile(wavPath, synthWav(3))
      const source: AudioSource = {
        name: 'speech.wav',
        pathToken: 'confined-wav',
        info: { kind: 'audio', mediaType: 'audio/wav', sizeBytes: 96_000, durationSeconds: 3 },
      }
      const locate = vi.fn(() => Promise.reject(new Error('converter must not be located')))
      const r = rig({
        locate,
        respond: () => Response.json({ transcript: 'Direct wav.', audioDurationMs: 3360 }),
      })
      r.paths.set(source.pathToken, wavPath)
      const prepared = await r.prepare(source)
      expect(prepared.transcript?.text).toBe('Direct wav.')
      expect(locate).not.toHaveBeenCalled()
      expect(r.posted).toHaveLength(1)
      expect(r.settled[0]).toBe('0.00015')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses container bytes at the last mile before any HTTP', async () => {
    const lying: AudioSource = {
      ...mp3Source,
      info: { ...mp3Source.info, mediaType: 'audio/wav' },
    }
    const r = rig()
    r.paths.set(lying.pathToken, path.resolve(MP3_FIXTURE))
    await expect(r.prepare(lying)).rejects.toThrow(UI_TEXT.media.converterUnavailable)
    expect(r.posted).toHaveLength(0)
    expect(r.settled).toEqual(['0'])
  })

  it('surfaces the 400 refusal in its own words and holds the reserve uncertain', async () => {
    const message = "The 'audio' part must be a mono 16-bit PCM WAV at 16 or 24 kHz"
    const r = rig({
      encoderWav: synthWav(2),
      respond: () => Response.json({ error: { message, param: 'audio' } }, { status: 400 }),
    })
    r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
    await expect(r.prepare(mp3Source)).rejects.toThrow(message)
    expect(r.settled).toEqual([undefined])
    // The attempt was admitted before the refusal, so usage keeps the bound
    // while the money stays an uncertain liability.
    expect(r.voiceSeconds).toBe(2)
  })

  it('refuses honestly when no converter is on the machine, before any HTTP or reserve', async () => {
    const r = rig({
      locate: () => Promise.resolve({ ok: false, reason: UI_TEXT.media.converterUnavailable }),
    })
    r.paths.set(mp3Source.pathToken, path.resolve(MP3_FIXTURE))
    await expect(r.prepare(mp3Source)).rejects.toThrow(UI_TEXT.media.converterUnavailable)
    expect(r.posted).toHaveLength(0)
    expect(r.reserved).toHaveLength(0)
    expect(r.settled).toEqual([])
  })

  it('refuses wrap-as-video until lane V binds an encoder', async () => {
    const r = rig()
    await expect(
      r.ports.conversion.convert(mp3Source, 'wrapMp4', new AbortController().signal),
    ).rejects.toThrow(UI_TEXT.media.converterUnavailable)
  })

  it('offers transcription only for WAV where no converter exists', () => {
    if (mp3Source.info.kind !== 'audio') throw new Error('expected audio fixture')
    const context = createModelApiAudioContext({
      modelId: 'muse-spark-1.3-contributor',
      canExtractWav: false,
      isVoiceOn: true,
    })
    expect(audioRouteOptions(mp3Source.info, context).actions).not.toContain('transcribe')
    expect(context.batchFormats).toEqual(['audio/wav'])
  })

  it('renders 16 kHz mono WAV through the real ffmpeg', async () => {
    // The rig's sandbox denies file watches (EMFILE), which the default
    // supervisor treats as a kill signal, so this test supervises the real
    // encoder with a plain bounded spawn: the product's ffmpeg arguments and
    // output bytes are what it pins, not the watch boundary (M1's territory).
    const rendered = await convertToWav16kMono(
      path.resolve(MP3_FIXTURE),
      { kind: 'ffmpeg', command: FFMPEG },
      {
        trustedPath: { verify: () => Promise.resolve('ok' as const) },
        readRssBytes: () => Promise.resolve(0),
        run: async (command, args, runOptions): Promise<void> => {
          await execFileAsync(command, [...args], { cwd: runOptions.cwd })
        },
      },
    )
    if (!rendered.ok) throw new Error(`conversion failed: ${rendered.reason}`)
    try {
      expect(rendered.info.mediaType).toBe('audio/wav')
      expect(rendered.info.durationSeconds).toBeCloseTo(2, 1)
      const bytes = await readFile(rendered.path)
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
      expect(bytes.readUInt16LE(20)).toBe(1)
      expect(bytes.readUInt16LE(22)).toBe(1)
      expect(bytes.readUInt32LE(24)).toBe(16_000)
    } finally {
      await rendered.dispose()
    }
  })
})

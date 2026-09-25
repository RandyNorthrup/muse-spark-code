import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictationHandle, DictationListener } from '../../src/core/voice/dictation'
import {
  MuseVoiceDictation,
  MuseVoiceStream,
  type VoiceSocket,
  type VoiceSocketHandlers,
} from '../../src/core/voice/museVoice'
import {
  MUSE_VOICE_FINISH_TIMEOUT_MS,
  MUSE_VOICE_HANDSHAKE_TIMEOUT_MS,
} from '../../src/shared/constants'
import { openWebSocket } from '../../src/host/voice/dictationHost'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startFakeVoiceServer } from './helpers/fakeVoiceServer'

const KEY = 'LLM|1|secret'
const URL = 'wss://voice.example.test/v1/asr/realtime'

/** A socket under test control: what the stream sent, and the server's side to play. */
class FakeSocket implements VoiceSocket {
  public readonly texts: string[] = []
  public readonly binaries: Uint8Array[] = []
  public isClosed = false

  public constructor(public readonly handlers: VoiceSocketHandlers) {}

  public sendText(text: string): void {
    this.texts.push(text)
  }

  public sendBinary(bytes: Uint8Array): void {
    this.binaries.push(bytes)
  }

  public close(): void {
    this.isClosed = true
  }

  public serverSays(payload: unknown): void {
    this.handlers.onText(JSON.stringify(payload))
  }
}

function streamSetup() {
  const sockets: FakeSocket[] = []
  const finals: string[] = []
  const failures: string[] = []
  const stream = new MuseVoiceStream(
    {
      url: URL,
      openSocket: (url, handlers) => {
        expect(url).toBe(URL)
        const socket = new FakeSocket(handlers)
        sockets.push(socket)
        return socket
      },
      log: new FakeLogOutputChannel(),
    },
    {
      onFinal: (text) => {
        finals.push(text)
      },
      onFailed: (reason) => {
        failures.push(reason)
      },
    },
  )
  const socket = (): FakeSocket => {
    const found = sockets[0]
    if (found === undefined) {
      throw new Error('no socket')
    }
    return found
  }
  return { stream, socket, finals, failures }
}

/** PCM of `seconds` at 16 kHz, 16-bit mono. */
const pcm = (seconds: number) => new Uint8Array(Math.round(seconds * 32_000))

describe('MuseVoiceStream (M35)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the key in the first frame, holds audio until the answer, and delivers the final text', () => {
    const t = streamSetup()
    t.stream.push(pcm(0.5))
    t.stream.start(KEY)
    t.stream.push(pcm(0.25))
    t.socket().handlers.onOpen()
    expect(t.socket().texts.map((text) => JSON.parse(text) as unknown)).toEqual([
      {
        authorization: { accessToken: `Bearer ${KEY}` },
        audioEncoding: 'PCM_16KHZ',
        model: 'muse-voice-transcribe-1.0',
        mode: 'PUSH_TO_TALK',
        partialMode: 'CUMULATIVE',
        emitAudioProgress: false,
      },
    ])
    // Audio recorded while the handshake is answered is held too.
    t.stream.push(pcm(0.125))
    expect(t.socket().binaries).toEqual([])
    t.socket().serverSays({ sessionId: 's1' })
    // What was held goes first, in order; then audio goes as it comes.
    expect(t.socket().binaries.map((bytes) => bytes.length)).toEqual([16_000, 8000, 4000])
    t.stream.push(pcm(1.5))
    t.socket().serverSays({ type: 'transcript', transcript: 'open the', final: false })
    t.socket().serverSays({ type: 'speechStart', turnId: 1, audioProcessedMs: 10 })
    t.stream.finish()
    expect(t.socket().texts.at(-1)).toBe('{"type":"endStream"}')
    t.socket().serverSays({ type: 'transcript', transcript: 'Open the settings.', final: true })
    expect(t.finals).toEqual(['Open the settings.'])
    expect(t.failures).toEqual([])
    expect(t.socket().isClosed).toBe(true)
    // 2.375 s sent: billed as 2.
    expect(t.stream.seconds).toBe(2)
  })

  it('sends the end after the answer when the recording ended first', () => {
    const t = streamSetup()
    t.stream.start(KEY)
    t.stream.push(pcm(0.1))
    t.stream.finish()
    t.socket().handlers.onOpen()
    t.socket().serverSays({ sessionId: 's1' })
    expect(t.socket().binaries).toHaveLength(1)
    expect(t.socket().texts.at(-1)).toBe('{"type":"endStream"}')
  })

  it('takes the last partial when the server closes normally without a final one', () => {
    const t = streamSetup()
    t.stream.start(KEY)
    t.socket().handlers.onOpen()
    t.socket().serverSays({ sessionId: 's1' })
    t.socket().serverSays({ type: 'transcript', transcript: 'one' })
    t.socket().serverSays({ type: 'transcript', transcript: 'one two' })
    t.stream.finish()
    t.socket().handlers.onClose(1000, '')
    expect(t.finals).toEqual(['one two'])
  })

  it('says why it failed: an error event, a refusal, a rate limit, a server close', () => {
    const cases: [(socket: FakeSocket) => void, string][] = [
      [
        (socket) => {
          socket.serverSays({ type: 'error', message: 'invalid audio', errorCode: 'bad' })
        },
        'Muse Voice refused the recording: invalid audio',
      ],
      [
        (socket) => {
          socket.handlers.onClose(1008, 'pacing')
        },
        'Muse Voice refused the recording: pacing',
      ],
      [
        (socket) => {
          socket.handlers.onClose(1013, '')
        },
        'Muse Voice is rate-limited for this key; wait a moment and try again.',
      ],
      [
        (socket) => {
          socket.handlers.onClose(1011, 'Max session duration reached')
        },
        'Muse Voice closed the connection (code 1011): Max session duration reached',
      ],
      [
        (socket) => {
          socket.handlers.onText('{not json')
        },
        'Muse Voice sent something that is not JSON, so the recording was dropped.',
      ],
    ]
    for (const [act, reason] of cases) {
      const t = streamSetup()
      t.stream.start(KEY)
      t.socket().handlers.onOpen()
      t.socket().serverSays({ sessionId: 's1' })
      act(t.socket())
      expect(t.failures).toEqual([reason])
      expect(t.finals).toEqual([])
      expect(t.socket().isClosed).toBe(true)
    }
  })

  it('gives up on a handshake that is not answered, and on a final text that never comes', () => {
    const silent = streamSetup()
    silent.stream.start(KEY)
    silent.socket().handlers.onOpen()
    vi.advanceTimersByTime(MUSE_VOICE_HANDSHAKE_TIMEOUT_MS)
    expect(silent.failures).toEqual([
      'Muse Voice did not answer; check the connection and try again.',
    ])
    const slow = streamSetup()
    slow.stream.start(KEY)
    slow.socket().handlers.onOpen()
    slow.socket().serverSays({ sessionId: 's1' })
    slow.stream.finish()
    vi.advanceTimersByTime(MUSE_VOICE_FINISH_TIMEOUT_MS)
    expect(slow.failures).toEqual(['Muse Voice did not send the transcript in time; try again.'])
  })

  it('stays quiet after an abort, and a close before the end is a failure', () => {
    const t = streamSetup()
    t.stream.start(KEY)
    t.stream.abort()
    t.socket().handlers.onClose(1006, '')
    expect(t.finals).toEqual([])
    expect(t.failures).toEqual([])
    const dropped = streamSetup()
    dropped.stream.start(KEY)
    dropped.socket().handlers.onClose(1006, '')
    expect(dropped.failures).toEqual(['Muse Voice closed the connection (code 1006)'])
  })
})

/** A capture driver under test control: the helper's lines played by hand. */
class FakeCapture implements DictationHandle {
  public starts = 0
  public stops = 0
  public isDisposed = false

  public constructor(public readonly listener: DictationListener) {}

  public start(): void {
    this.starts += 1
    this.listener.onStatus('starting')
  }

  public stop(): void {
    this.stops += 1
    this.listener.onStatus('idle')
  }

  public dispose(): void {
    this.isDisposed = true
  }
}

function dictationSetup(hasKey = true) {
  const apiKey = hasKey ? KEY : undefined
  const captures: FakeCapture[] = []
  const sockets: FakeSocket[] = []
  const texts: string[] = []
  const errors: string[] = []
  const statuses: string[] = []
  const seconds: number[] = []
  const dictation = new MuseVoiceDictation(
    {
      createCapture: (listener) => {
        const capture = new FakeCapture(listener)
        captures.push(capture)
        return capture
      },
      openSocket: (_url, handlers) => {
        const socket = new FakeSocket(handlers)
        sockets.push(socket)
        return socket
      },
      url: URL,
      apiKey: () => Promise.resolve(apiKey),
      onSeconds: (count) => {
        seconds.push(count)
      },
      log: new FakeLogOutputChannel(),
    },
    {
      onStatus: (status) => {
        statuses.push(status)
      },
      onText: (text) => {
        texts.push(text)
      },
      onError: (reason) => {
        errors.push(reason)
      },
    },
  )
  const capture = () => captures[0]!
  const socket = (index = 0) => sockets[index]!
  return { dictation, capture, socket, sockets, texts, errors, statuses, seconds }
}

/** Waits for the recording's socket, opens it and answers its handshake. */
async function answered(t: ReturnType<typeof dictationSetup>): Promise<void> {
  await vi.waitFor(() => {
    expect(t.sockets).toHaveLength(1)
  })
  t.socket().handlers.onOpen()
  t.socket().serverSays({ sessionId: 's1' })
}

describe('MuseVoiceDictation (M35)', () => {
  it('records, streams, and inserts the transcript, counting the seconds sent', async () => {
    const t = dictationSetup()
    t.dictation.start()
    expect(t.capture().starts).toBe(1)
    t.capture().listener.onStatus('listening')
    t.capture().listener.onAudio?.(pcm(1))
    await answered(t)
    t.capture().listener.onAudio?.(pcm(2.5))
    t.dictation.stop()
    expect(t.capture().stops).toBe(1)
    t.capture().listener.onStopped?.()
    t.socket().serverSays({ type: 'transcript', transcript: '  run the tests  ', final: true })
    expect(t.texts).toEqual(['run the tests'])
    expect(t.seconds).toEqual([3])
    expect(t.statuses).toEqual(['starting', 'listening', 'idle'])
  })

  it('starts the next recording while the last one finishes', async () => {
    const t = dictationSetup()
    t.dictation.start()
    await vi.waitFor(() => {
      expect(t.sockets).toHaveLength(1)
    })
    t.capture().listener.onStatus('idle')
    t.capture().listener.onStopped?.()
    t.dictation.start()
    await vi.waitFor(() => {
      expect(t.sockets).toHaveLength(2)
    })
    t.socket(0).handlers.onOpen()
    t.socket(0).serverSays({ sessionId: 's1' })
    t.socket(0).serverSays({ type: 'transcript', transcript: 'first', final: true })
    expect(t.texts).toEqual(['first'])
    expect(t.socket(1).isClosed).toBe(false)
  })

  it('stops the recording and says why when there is no key', async () => {
    const t = dictationSetup(false)
    t.dictation.start()
    await vi.waitFor(() => {
      expect(t.errors).toEqual(['Muse Voice needs a Model API key; sign in with one first.'])
    })
    expect(t.capture().stops).toBe(1)
    expect(t.sockets).toEqual([])
  })

  it('drops the stream when the recorder fails, and counts what was sent', async () => {
    const t = dictationSetup()
    t.dictation.start()
    await answered(t)
    t.capture().listener.onAudio?.(pcm(1.2))
    t.capture().listener.onError('The microphone stopped')
    expect(t.errors).toEqual(['The microphone stopped'])
    expect(t.socket().isClosed).toBe(true)
    expect(t.seconds).toEqual([1])
  })

  it('ends every stream on dispose, counting each once', async () => {
    const t = dictationSetup()
    t.dictation.start()
    await vi.waitFor(() => {
      expect(t.sockets).toHaveLength(1)
    })
    t.dictation.dispose()
    expect(t.capture().isDisposed).toBe(true)
    expect(t.socket().isClosed).toBe(true)
    expect(t.seconds).toEqual([0])
    t.dictation.start()
    expect(t.capture().starts).toBe(1)
  })
})

describe('Muse Voice over a real WebSocket (M35)', () => {
  it('streams through Node’s WebSocket to a fake endpoint and gets the transcript', async () => {
    const server = await startFakeVoiceServer((connection, frame) => {
      if (typeof frame === 'string' && frame.includes('authorization')) {
        connection.sendText({ sessionId: 'live-1' })
      } else if (frame === '{"type":"endStream"}') {
        connection.sendText({ type: 'transcript', transcript: 'hello there', final: false })
        connection.sendText({ type: 'transcript', transcript: 'Hello there.', final: true })
        connection.close(1000)
      }
    })
    try {
      const done = Promise.withResolvers<string>()
      const stream = new MuseVoiceStream(
        { url: server.url, openSocket: openWebSocket, log: new FakeLogOutputChannel() },
        { onFinal: done.resolve, onFailed: done.reject },
      )
      stream.start(KEY)
      const audio = Uint8Array.from({ length: 48_000 }, (_value, index) => index % 256)
      stream.push(audio.subarray(0, 16_000))
      const connection = await server.connection
      await vi.waitFor(() => {
        expect(connection.received.length).toBeGreaterThanOrEqual(2)
      })
      stream.push(audio.subarray(16_000))
      stream.finish()
      await expect(done.promise).resolves.toBe('Hello there.')
      const [handshake, ...rest] = connection.received
      expect(JSON.parse(String(handshake))).toMatchObject({
        authorization: { accessToken: `Bearer ${KEY}` },
        audioEncoding: 'PCM_16KHZ',
      })
      const sent = Buffer.concat(rest.filter((part): part is Buffer => Buffer.isBuffer(part)))
      expect(sent.equals(Buffer.from(audio))).toBe(true)
      expect(rest.at(-1)).toBe('{"type":"endStream"}')
      expect(stream.seconds).toBe(1)
    } finally {
      await server.stop()
    }
  })
})

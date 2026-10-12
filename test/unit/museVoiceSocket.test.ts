// Loopback replay runs on a rig that permits local listeners.
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { MuseVoiceStream } from '../../src/core/voice/museVoice'
import { openWebSocket } from '../../src/host/voice/voiceProcesses'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startFakeVoiceServer } from './helpers/fakeVoiceServer'

const KEY = 'LLM|1|secret'

describe('Muse Voice over a real WebSocket (M35)', () => {
  it('streams through Node’s WebSocket to a fake endpoint and gets the transcript', async () => {
    const server = await startFakeVoiceServer((connection, frame) => {
      if (typeof frame === 'string' && frame.includes('authorization')) {
        connection.sendText({ sessionId: 'live-1' })
      } else if (frame === '{"type":"endStream"}') {
        connection.sendText({
          type: 'transcript',
          transcript: 'hello there',
          final: false,
          audioProcessedMs: 3040,
        })
        connection.sendText({
          type: 'transcript',
          transcript: 'Hello there.',
          final: true,
          audioProcessedMs: 3040,
        })
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
      const audio = Uint8Array.from({ length: 96_000 }, (_value, index) => index % 256)
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
      expect(stream.seconds).toBe(3)
    } finally {
      await server.stop()
    }
  })
})

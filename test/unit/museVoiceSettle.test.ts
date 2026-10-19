// Muse Voice stream settlement (D119): a refused send fails the stream in
// the refusal's own words instead of throwing out of the socket handshake.
import { describe, expect, it } from 'vitest'
import {
  MuseVoiceStream,
  type VoiceSocketHandlers,
  type VoiceStreamCallbacks,
  type VoiceStreamDeps,
} from '../../src/core/voice/museVoice'

function refusingSendDeps(): {
  deps: VoiceStreamDeps
  opened: { handlers?: VoiceSocketHandlers }
  sent: string[]
} {
  const opened: { handlers?: VoiceSocketHandlers } = {}
  const warnings: string[] = []
  const sent: string[] = []
  const deps: VoiceStreamDeps = {
    url: 'wss://voice.test/stream',
    openSocket: (url: string, handlers: VoiceSocketHandlers) => {
      if (url !== 'wss://voice.test/stream') throw new Error('unexpected socket url')
      opened.handlers = handlers
      return {
        sendText: (text) => {
          sent.push(text)
        },
        sendBinary: (bytes) => {
          sent.push(`binary:${String(bytes.length)}`)
        },
        close: () => {
          sent.push('closed')
        },
      }
    },
    log: {
      trace: (message) => {
        warnings.push(message)
      },
      info: (message) => {
        warnings.push(message)
      },
      warn: (message) => {
        warnings.push(message)
      },
      error: (message) => {
        warnings.push(message)
      },
    },
    admitSend: () => {
      throw new Error('sending is not allowed here')
    },
  }
  return { deps, opened, sent }
}

describe('Muse Voice stream settlement', () => {
  it('fails the handshake in the refusal words when sending is refused', () => {
    const failed: string[] = []
    const { deps, opened, sent } = refusingSendDeps()
    const callbacks: VoiceStreamCallbacks = {
      onFinal: () => {
        throw new Error('no transcript follows a failed stream')
      },
      onFailed: (reason) => {
        failed.push(reason)
      },
    }
    const stream = new MuseVoiceStream(deps, callbacks)
    stream.start('test-key')
    expect(() => {
      opened.handlers?.onOpen()
    }).not.toThrow()
    expect(failed).toEqual(['sending is not allowed here'])
    expect(sent).toEqual(['closed'])
  })
})

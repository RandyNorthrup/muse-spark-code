import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OwnedSessionBudgetScope } from '../../src/core/backends/modelapi/sessionBudget'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { removeFolder } from './helpers/temporaryFolders'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  STORED_SESSION_VERSION,
  UI_TEXT,
  PAID_PRICES_USD,
  SECONDS_PER_HOUR,
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
    // 2.375 local seconds sent; the existing window estimate retains 2.
    expect(t.stream.seconds).toBe(2)
    expect(t.stream.audioSeconds).toBe(2.375)
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

function dictationSetup(
  hasKey = true,
  ownedBudgetScope?: DictationListener['ownedBudgetScope'],
  keyProvider?: () => Promise<string | undefined>,
) {
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
      apiKey: keyProvider ?? (() => Promise.resolve(apiKey)),
      onSeconds: (count) => {
        seconds.push(count)
      },
      log: new FakeLogOutputChannel(),
    },
    {
      ...(ownedBudgetScope !== undefined && { ownedBudgetScope }),
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

const budgetDirectory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-voice-budget-')))
afterAll(() => removeFolder(budgetDirectory))

async function voiceBudget(name: string, capUsd = 0) {
  const store = createFileSessionStore({
    directory: path.join(budgetDirectory, name),
    log: new FakeLogOutputChannel(),
    retentionDays: () => 0,
    now: () => 0,
    sleep: () => Promise.resolve(),
  })
  const accountId = createHash('sha256').update(KEY).digest('hex')
  await store.save({
    version: STORED_SESSION_VERSION,
    sessionId: 'voice-parent',
    accountId,
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'promptUnmatched',
    effort: 'high',
    createdAt: '2026-09-29T00:00:00Z',
    lastActivityAt: '2026-09-29T00:00:00Z',
    turnIds: [],
    todos: [],
    replay: [],
    transcript: [],
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  })
  const journal = store.budget
  if (journal === undefined) {
    throw new Error('No voice budget journal')
  }
  const current = { capUsd, isOwnerCurrent: true }
  const scope: OwnedSessionBudgetScope = Object.freeze({
    sessionId: 'voice-parent',
    accountId,
    journal,
    capUsd: () => current.capUsd,
    isStillAllowed: (digest: string | undefined) => current.isOwnerCurrent && digest === accountId,
  })
  return { scope, current, store }
}

type VoiceBudgetFixture = Awaited<ReturnType<typeof voiceBudget>>

async function voiceBudgetTotal(budget: VoiceBudgetFixture) {
  return await budget.scope.journal.read(budget.scope.sessionId, budget.scope.accountId)
}

async function expectVoiceRefund(budget: VoiceBudgetFixture): Promise<void> {
  await vi.waitFor(async () => {
    expect(await voiceBudgetTotal(budget)).toEqual({ spentUsd: 0, hasUnknownHistoricalFees: false })
  })
}

async function waitVoicePrepared(t: ReturnType<typeof dictationSetup>): Promise<void> {
  await vi.waitFor(() => {
    expect(t.errors.length + t.sockets.length).toBeGreaterThan(0)
  })
}

function holdVoicePublication(budget: VoiceBudgetFixture) {
  const held = Promise.withResolvers<undefined>()
  const written = Promise.withResolvers<undefined>()
  const reserve = budget.scope.journal.reserve.bind(budget.scope.journal)
  const spy = vi.spyOn(budget.scope.journal, 'reserve').mockImplementation(async (...args) => {
    const claim = await reserve(...args)
    written.resolve(undefined)
    await held.promise
    return claim
  })
  return { held, written, spy }
}

async function stopRecordedVoice(t: ReturnType<typeof dictationSetup>, seconds: number) {
  await answered(t)
  t.capture().listener.onAudio?.(pcm(seconds))
  t.capture().listener.onStopped?.()
}

async function expectUnknownVoiceEstimate(budget: VoiceBudgetFixture, seconds: number) {
  await vi.waitFor(async () => {
    const total = await voiceBudgetTotal(budget)
    expect(total.hasUnknownHistoricalFees).toBe(true)
    expect(total.spentUsd).toBeCloseTo(
      (seconds * PAID_PRICES_USD.voicePerHour) / SECONDS_PER_HOUR,
      12,
    )
  })
}

describe('MuseVoiceDictation shared budget (M82)', () => {
  it.each([undefined, 'LLM|1|foreign-voice-key'])(
    'refunds known nonsent voice when the actual key is %s',
    async (key) => {
      const budget = await voiceBudget(`actual-key-${key === undefined ? 'missing' : 'foreign'}`)
      const t = dictationSetup(
        true,
        () => Promise.resolve(budget.scope),
        () => Promise.resolve(key),
      )
      t.dictation.start()
      await waitVoicePrepared(t)
      expect(t.errors).toContain(
        key === undefined ? UI_TEXT.museVoiceNoKey : UI_TEXT.notSignedInReason,
      )
      expect(t.sockets).toEqual([])
      await expectVoiceRefund(budget)
      t.dictation.dispose()
    },
  )

  it('waits for durable voice intent before opening a socket and refunds disposal during that write', async () => {
    const budget = await voiceBudget('durable-before-socket')
    const { held, written, spy } = holdVoicePublication(budget)
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    try {
      t.dictation.start()
      await written.promise
      expect(t.sockets).toEqual([])
      t.dictation.dispose()
      held.resolve(undefined)
      await expectVoiceRefund(budget)
    } finally {
      held.resolve(undefined)
      spy.mockRestore()
      t.dictation.dispose()
    }
  })

  it('publishes uncertainty before authentication and blocks finite admission while voice is active', async () => {
    const budget = await voiceBudget('pending-before-auth')
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await vi.waitFor(() => {
      expect(t.sockets).toHaveLength(1)
    })
    const total = await budget.scope.journal.read(budget.scope.sessionId, budget.scope.accountId)
    expect(total.hasUnknownHistoricalFees).toBe(true)
    expect(t.socket().texts).toEqual([])
    const next = await budget.scope.journal.reserve(
      budget.scope.sessionId,
      budget.scope.accountId,
      0.01,
    )
    expect(() => next.check(1)).toThrow(UI_TEXT.sessionBudgetLegacyFeesUnknown)
    await next.settle(0, false)
    t.dictation.dispose()
    await expectVoiceRefund(budget)
  })

  it('reads the actual key after a blocked durable write and refunds a replacement key without opening a socket', async () => {
    const budget = await voiceBudget('key-replaced-during-write')
    const { held, written, spy } = holdVoicePublication(budget)
    let actualKey = KEY
    const key = vi.fn(() => Promise.resolve(actualKey))
    const t = dictationSetup(true, () => Promise.resolve(budget.scope), key)
    try {
      t.dictation.start()
      await written.promise
      expect(key).toHaveBeenCalledTimes(1)
      actualKey = 'LLM|1|replacement-voice-key'
      held.resolve(undefined)
      await waitVoicePrepared(t)
      expect(t.errors).toContain(UI_TEXT.notSignedInReason)
      expect(key).toHaveBeenCalledTimes(2)
      expect(t.sockets).toEqual([])
      await expectVoiceRefund(budget)
    } finally {
      held.resolve(undefined)
      spy.mockRestore()
      t.dictation.dispose()
    }
  })

  it('settles the original row and drops a final transcript after the parent owner changed', async () => {
    const budget = await voiceBudget('late-old-owner-transcript')
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await stopRecordedVoice(t, 0.5)
    budget.current.isOwnerCurrent = false
    t.socket().serverSays({ type: 'transcript', transcript: 'old owner text', final: true })
    expect(t.texts).toEqual([])
    await expectUnknownVoiceEstimate(budget, 0.5)
    t.dictation.dispose()
  })

  it.each(['cap', 'owner'])(
    'sends no authentication and refunds when %s changes after preparation',
    async (change) => {
      const budget = await voiceBudget(`prepared-${change}`)
      const t = dictationSetup(true, () => Promise.resolve(budget.scope))
      t.dictation.start()
      await vi.waitFor(() => {
        expect(t.sockets).toHaveLength(1)
      })
      if (change === 'cap') {
        budget.current.capUsd = 1
      } else {
        budget.current.isOwnerCurrent = false
      }
      t.socket().handlers.onOpen()
      expect(t.socket().texts).toEqual([])
      expect(t.errors).toContain(
        change === 'cap'
          ? UI_TEXT.sessionBudgetVoiceUnavailable
          : UI_TEXT.sessionBudgetVoiceContextChanged,
      )
      await expectVoiceRefund(budget)
      t.dictation.dispose()
    },
  )

  it.each(['final', 'lost'])(
    'retains unknown billing after authentication, even with a %s result',
    async (outcome) => {
      const budget = await voiceBudget(`authenticated-${outcome}`)
      const t = dictationSetup(true, () => Promise.resolve(budget.scope))
      t.dictation.start()
      await stopRecordedVoice(t, 0.5)
      if (outcome === 'final') {
        t.socket().serverSays({ type: 'transcript', transcript: 'known text', final: true })
      } else {
        t.socket().handlers.onClose(1011, 'lost')
      }
      await expectUnknownVoiceEstimate(budget, 0.5)
      t.dictation.dispose()
    },
  )

  it('refuses capped start before opening a socket and sends no more audio after an owner change', async () => {
    const capped = await voiceBudget('capped-start', 1)
    const denied = dictationSetup(true, () => Promise.resolve(capped.scope))
    denied.dictation.start()
    await waitVoicePrepared(denied)
    expect(denied.errors).toContain(UI_TEXT.sessionBudgetVoiceUnavailable)
    expect(denied.sockets).toEqual([])
    denied.dictation.dispose()
    const budget = await voiceBudget('owner-change-audio')
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await answered(t)
    budget.current.isOwnerCurrent = false
    t.capture().listener.onAudio?.(pcm(1))
    expect(t.socket().binaries).toEqual([])
    expect(t.socket().isClosed).toBe(true)
    t.dictation.dispose()
  })
})

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

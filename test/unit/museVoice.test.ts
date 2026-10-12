import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { fill } from '../../src/shared/l10n/text'
import { formatUsd } from '../../src/core/usage/insights'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OwnedSessionBudgetScope } from '../../src/core/backends/modelapi/sessionBudget'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { FakeHelperProcess } from './helpers/fakeHelperChild'
import { removeFolder } from './helpers/temporaryFolders'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Dictation,
  type DictationHandle,
  type DictationListener,
  type HelperChild,
  type VoiceConsentFence,
} from '../../src/core/voice/dictation'
import {
  MuseVoiceDictation,
  MuseVoiceStream,
  type VoiceSocket,
  type VoiceSocketHandlers,
} from '../../src/core/voice/museVoice'
import {
  DICTATION_QUIT_GRACE_MS,
  DICTATION_STOP_GRACE_MS,
  MUSE_VOICE_BYTES_PER_SECOND,
  MUSE_VOICE_FRAME_BYTES,
  MUSE_VOICE_MAX_BYTES,
  MUSE_VOICE_MAX_SECONDS,
  MUSE_VOICE_RESERVED_MS,
  MUSE_VOICE_FINISH_TIMEOUT_MS,
  MUSE_VOICE_HANDSHAKE_TIMEOUT_MS,
  UI_TEXT,
  PAID_PRICES_USD,
  SECONDS_PER_HOUR,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeParentSession } from './helpers/fakeParentSession'

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
    expect(t.socket().binaries.map((bytes) => bytes.length)).toEqual(
      Array.from({ length: 10 }, () => MUSE_VOICE_FRAME_BYTES),
    )
    t.stream.push(pcm(1.5))
    t.socket().serverSays({
      type: 'transcript',
      transcript: 'open the',
      final: false,
      audioProcessedMs: 2000,
    })
    t.socket().serverSays({ type: 'speechStart', turnId: 1, audioProcessedMs: 10 })
    t.stream.finish()
    expect(t.socket().texts.at(-1)).toBe('{"type":"endStream"}')
    t.socket().serverSays({
      type: 'transcript',
      transcript: 'Open the settings.',
      final: true,
      audioProcessedMs: 2000,
    })
    expect(t.finals).toEqual(['Open the settings.'])
    expect(t.failures).toEqual([])
    expect(t.socket().isClosed).toBe(true)
    // 2.375 local seconds sent; the existing window estimate retains 2.
    expect(t.stream.seconds).toBe(2)
    expect(t.stream.audioBytes).toBe(2.375 * MUSE_VOICE_BYTES_PER_SECOND)
  })

  it('sends the end after the answer when the recording ended first', () => {
    const t = streamSetup()
    t.stream.start(KEY)
    t.stream.push(pcm(0.1))
    t.stream.finish()
    t.stream.push(pcm(1))
    t.socket().handlers.onOpen()
    t.socket().serverSays({ sessionId: 's1' })
    expect(t.socket().binaries.map((bytes) => bytes.length)).toEqual([2560, 640])
    expect(t.socket().texts.at(-1)).toBe('{"type":"endStream"}')
  })

  it('takes the last partial when the server closes normally without a final one', () => {
    const t = streamSetup()
    t.stream.start(KEY)
    t.socket().handlers.onOpen()
    t.socket().serverSays({ sessionId: 's1' })
    t.socket().serverSays({
      type: 'transcript',
      transcript: 'one',
      final: false,
      audioProcessedMs: 2000,
    })
    t.socket().serverSays({
      type: 'transcript',
      transcript: 'one two',
      final: false,
      audioProcessedMs: 2000,
    })
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
          socket.handlers.onClose(1008, 'Ingress below real-time')
        },
        UI_TEXT.museVoiceIdle,
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

  public dispose(): void | Promise<void> {
    this.isDisposed = true
  }
}

function voiceObservations() {
  const sockets: FakeSocket[] = []
  const texts: string[] = []
  const errors: string[] = []
  const statuses: string[] = []
  const seconds: number[] = []
  return { sockets, texts, errors, statuses, seconds }
}

function fakeVoiceDailyClaim() {
  return {
    check: vi.fn(),
    settle: vi.fn(() =>
      Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
    ),
  }
}

function dictationSetup(
  hasKey = true,
  ownedBudgetScope?: DictationListener['ownedBudgetScope'],
  keyProvider?: () => Promise<string | undefined>,
  reserveDaily?: ConstructorParameters<typeof MuseVoiceDictation>[0]['reserveDaily'],
  fenceForPress?: () => VoiceConsentFence | undefined,
  makeCapture?: (listener: DictationListener) => FakeCapture,
) {
  const apiKey = hasKey ? KEY : undefined
  const captures: FakeCapture[] = []
  const { sockets, texts, errors, statuses, seconds } = voiceObservations()
  const daily = fakeVoiceDailyClaim()
  const reserve = vi.fn(reserveDaily ?? (() => Promise.resolve(daily)))
  const usage: string[] = []
  const dictation = new MuseVoiceDictation(
    {
      createCapture: (listener) => {
        const capture =
          makeCapture === undefined ? new FakeCapture(listener) : makeCapture(listener)
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
      reserveDaily: reserve,
      log: new FakeLogOutputChannel(),
    },
    {
      onVoiceUsage: (message) => {
        usage.push(message)
      },
      ...(ownedBudgetScope !== undefined && { ownedBudgetScope }),
      ...(fenceForPress !== undefined && { voiceConsentFence: fenceForPress }),
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
  const capture = () => captures.at(-1)!
  const socket = (index = 0) => sockets[index]!
  return {
    dictation,
    capture,
    socket,
    sockets,
    texts,
    errors,
    statuses,
    seconds,
    daily,
    reserve,
    usage,
  }
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
  await store.save(fakeParentSession('voice-parent', accountId))
  const journal = store.budget
  if (journal === undefined) {
    throw new Error('No voice budget journal')
  }
  const current = { capUsd, isOwnerCurrent: true }
  const scope: OwnedSessionBudgetScope = Object.freeze({
    sessionId: 'voice-parent',
    accountId,
    journal,
    capUsd: () => Usd.from(current.capUsd).toAmount(),
    isStillAllowed: (digest: string | undefined) => current.isOwnerCurrent && digest === accountId,
  })
  return { scope, current, store }
}

const reservation = () =>
  Usd.from(PAID_PRICES_USD.voicePerHour)
    .times(MUSE_VOICE_RESERVED_MS)
    .divideIntegerCeiling(SECONDS_PER_HOUR * 1000)
    .toAmount()

type VoiceBudgetFixture = Awaited<ReturnType<typeof voiceBudget>>

async function voiceBudgetTotal(budget: VoiceBudgetFixture) {
  return await budget.scope.journal.read(budget.scope.sessionId, budget.scope.accountId)
}

async function expectVoiceRefund(budget: VoiceBudgetFixture): Promise<void> {
  await vi.waitFor(async () => {
    expect(await voiceBudgetTotal(budget)).toEqual({
      spentUsd: Usd.from(0).toAmount(),
      hasUnknownHistoricalFees: false,
    })
  })
}

async function waitVoicePrepared(t: ReturnType<typeof dictationSetup>): Promise<void> {
  await vi.waitFor(() => {
    expect(t.errors.length + t.sockets.length).toBeGreaterThan(0)
  })
}

/** The preparation admitted the start and the microphone is held. */
async function captureStarted(t: ReturnType<typeof dictationSetup>): Promise<void> {
  await vi.waitFor(() => {
    expect(t.capture().starts).toBe(1)
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
  await flushVoicePrepare()
  // The end lands once the capture's exit is observed, not on the acknowledgement.
  await flushVoicePrepare()
}

async function expectUnknownVoiceEstimate(budget: VoiceBudgetFixture) {
  await vi.waitFor(async () => {
    const total = await voiceBudgetTotal(budget)
    expect(total.hasUnknownHistoricalFees).toBe(true)
    expect(Number(total.spentUsd)).toBeCloseTo(Number(reservation()), 12)
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
      await t.dictation.dispose()
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
      // The drain waits for the held write: release it concurrently.
      const disposed = t.dictation.dispose()
      held.resolve(undefined)
      await disposed
      await expectVoiceRefund(budget)
    } finally {
      held.resolve(undefined)
      spy.mockRestore()
      await t.dictation.dispose()
    }
  })

  it('reserves bounded liability before authentication and blocks concurrent over-cap admission', async () => {
    const budget = await voiceBudget('pending-before-auth')
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await vi.waitFor(() => {
      expect(t.sockets).toHaveLength(1)
    })
    const total = await budget.scope.journal.read(budget.scope.sessionId, budget.scope.accountId)
    expect(total.hasUnknownHistoricalFees).toBe(false)
    expect(total.spentUsd).toBe(reservation())
    expect(t.socket().texts).toEqual([])
    const next = await budget.scope.journal.reserve(
      budget.scope.sessionId,
      budget.scope.accountId,
      Usd.from(0.01).toAmount(),
    )
    expect(() => next.check(Usd.from(0.015).toAmount())).toThrow()
    await next.settle(Usd.from(0).toAmount(), false)
    await t.dictation.dispose()
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
      await t.dictation.dispose()
    }
  })

  it('settles the original row and drops a final transcript after the parent owner changed', async () => {
    const budget = await voiceBudget('late-old-owner-transcript')
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await stopRecordedVoice(t, 0.5)
    budget.current.isOwnerCurrent = false
    t.socket().serverSays({
      type: 'transcript',
      transcript: 'old owner text',
      final: true,
      audioProcessedMs: 560,
    })
    expect(t.texts).toEqual([])
    await expectVoiceRefund(budget)
    await t.dictation.dispose()
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
        budget.current.capUsd = 0.001
      } else {
        budget.current.isOwnerCurrent = false
      }
      t.socket().handlers.onOpen()
      expect(t.socket().texts).toEqual([])
      expect(t.errors).toContain(
        change === 'cap'
          ? fill(UI_TEXT.sessionBudgetStopped, {
              estimate: formatUsd(reservation()),
              cap: formatUsd(Usd.from('0.001').toAmount()),
              spent: formatUsd(0),
            })
          : UI_TEXT.sessionBudgetVoiceContextChanged,
      )
      await expectVoiceRefund(budget)
      await t.dictation.dispose()
    },
  )

  it.each(['final', 'lost'])(
    'settles a %s result from final duration or retains uncertain liability',
    async (outcome) => {
      const budget = await voiceBudget(`authenticated-${outcome}`)
      const t = dictationSetup(true, () => Promise.resolve(budget.scope))
      t.dictation.start()
      await stopRecordedVoice(t, 0.5)
      if (outcome === 'final') {
        t.socket().serverSays({
          type: 'transcript',
          transcript: 'known text',
          final: true,
          audioProcessedMs: 560,
        })
      } else {
        t.socket().handlers.onClose(1011, 'lost')
      }
      if (outcome === 'final') await expectVoiceRefund(budget)
      else await expectUnknownVoiceEstimate(budget)
      await t.dictation.dispose()
    },
  )

  it('refuses capped start before opening a socket and sends no more audio after an owner change', async () => {
    const capped = await voiceBudget('capped-start', 0.001)
    const denied = dictationSetup(true, () => Promise.resolve(capped.scope))
    denied.dictation.start()
    await waitVoicePrepared(denied)
    expect(denied.errors).toEqual([
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatUsd(reservation()),
        cap: formatUsd(Usd.from('0.001').toAmount()),
        spent: formatUsd(0),
      }),
    ])
    expect(denied.sockets).toEqual([])
    expect(denied.capture().starts).toBe(0)
    await denied.dictation.dispose()
    const budget = await voiceBudget('owner-change-audio')
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await answered(t)
    budget.current.isOwnerCurrent = false
    t.capture().listener.onAudio?.(pcm(1))
    expect(t.socket().binaries).toEqual([])
    expect(t.socket().isClosed).toBe(true)
    await t.dictation.dispose()
  })
})

describe('MuseVoiceDictation queued admission (RVCM352B P1-a)', () => {
  it('a queued Start keeps the budget scope and fence it was pressed under', async () => {
    const first = await voiceBudget('queued-admission-first', 1)
    const second = await voiceBudget('queued-admission-second', 1)
    // Like the controller's press slots: each press reads them once, and the
    // press clears them on return, so a later re-read finds nothing.
    let press = 0
    const scopes = [first.scope, second.scope]
    const fenceBCalls: unknown[][] = []
    const fenceB: VoiceConsentFence = (...args) => {
      fenceBCalls.push(args)
    }
    const readPress = <T>(values: T[]): T | undefined => (press < 0 ? undefined : values[press])
    const dailyHeld = Promise.withResolvers<ReturnType<typeof fakeVoiceDailyClaim>>()
    const enteredDaily = Promise.withResolvers<undefined>()
    let dailyCalls = 0
    const t = dictationSetup(
      true,
      () => Promise.resolve(readPress(scopes)),
      undefined,
      () => {
        dailyCalls += 1
        if (dailyCalls === 1) {
          enteredDaily.resolve(undefined)
          return dailyHeld.promise
        }
        return Promise.resolve(t.daily)
      },
      () => (press === 1 ? fenceB : undefined),
    )
    try {
      t.dictation.start()
      press = -1
      await enteredDaily.promise
      expect(t.sockets).toEqual([])
      // Stop while A's daily admission is pending, then press B: it waits
      // behind the draining A with the admission it was pressed under.
      t.dictation.stop()
      press = 1
      t.dictation.start()
      press = -1
      dailyHeld.resolve(t.daily)
      await captureStarted(t)
      // B reserved the parent journal it was admitted with, ran under its
      // own consent fence, and opened the only socket; A left nothing behind.
      await vi.waitFor(async () => {
        const secondTotal = await voiceBudgetTotal(second)
        expect(secondTotal.spentUsd).toBe(reservation())
      })
      expect(t.sockets).toHaveLength(1)
      expect(fenceBCalls.length).toBeGreaterThan(0)
      const firstTotal = await voiceBudgetTotal(first)
      expect(firstTotal.spentUsd).toBe(Usd.from(0).toAmount())
    } finally {
      dailyHeld.resolve(t.daily)
      await t.dictation.dispose()
    }
    await expectVoiceRefund(second)
    await expectVoiceRefund(first)
  })

  it('a queued Start whose admission died is refused with the true reason', async () => {
    const budget = await voiceBudget('queued-admission-stale', 1)
    const context = { isValid: true }
    const fence: VoiceConsentFence = () => {
      if (!context.isValid) throw new Error(UI_TEXT.sessionBudgetVoiceContextChanged)
    }
    const t = dictationSetup(
      true,
      () => Promise.resolve(budget.scope),
      undefined,
      undefined,
      () => fence,
    )
    try {
      t.dictation.start()
      await captureStarted(t)
      expect(t.sockets).toHaveLength(1)
      // B parks behind the stopping A; the world changes on its watch.
      t.dictation.stop()
      t.dictation.start()
      context.isValid = false
      t.capture().listener.onStopped?.()
      // Refused before any reservation: the true reason, no socket, no
      // capture start, and no second daily admission for B.
      await vi.waitFor(() => {
        expect(t.errors).toEqual([UI_TEXT.sessionBudgetVoiceContextChanged])
      })
      expect(t.sockets).toHaveLength(1)
      expect(t.reserve).toHaveBeenCalledOnce()
      expect(t.capture().starts).toBe(0)
    } finally {
      await t.dictation.dispose()
    }
    await expectVoiceRefund(budget)
  })
})

/** A capture whose process exit the test observes by hand (RVCM352B P1-b). */
class GatedCapture extends FakeCapture {
  public readonly exitGate = Promise.withResolvers<undefined>()
  public exited = false

  public override async dispose(): Promise<void> {
    this.isDisposed = true
    await this.exitGate.promise
    this.exited = true
  }
}

type VoiceEnd = 'stop' | 'cancel' | 'capture-error' | 'dispose'
type VoicePhase = 'prepare' | 'record' | 'settle'

/** The server reported zero final audio; the settlement write followed. */
async function settleZeroFinal(t: ReturnType<typeof dictationSetup>): Promise<void> {
  t.socket().serverSays({
    type: 'transcript',
    transcript: '',
    final: true,
    audioProcessedMs: 0,
  })
  await vi.waitFor(() => {
    expect(t.daily.settle).toHaveBeenCalledOnce()
  })
}

describe('MuseVoiceDictation end reasons (RVCM352B P1-b table)', () => {
  const cells: [VoiceEnd, VoicePhase][] = [
    ['stop', 'record'],
    ['cancel', 'prepare'],
    ['capture-error', 'prepare'],
    ['capture-error', 'record'],
    ['dispose', 'prepare'],
    ['dispose', 'record'],
    ['dispose', 'settle'],
  ]

  it.each(cells)(
    'end %s during %s leaves no recorder, settles each recording once, and admits the next press',
    async (end, phase) => {
      const budget = await voiceBudget(`table-${end}-${phase}`, 1)
      const gated: GatedCapture[] = []
      const dailyReserveGate = Promise.withResolvers<ReturnType<typeof fakeVoiceDailyClaim>>()
      const dailySettleGate = Promise.withResolvers<{
        spentUsd: UsdAmount
        hasUnknownHistoricalFees: boolean
      }>()
      let dailyReserves = 0
      let isDrained = false
      const t = dictationSetup(
        true,
        () => Promise.resolve(budget.scope),
        undefined,
        () => {
          dailyReserves += 1
          return phase === 'prepare' && dailyReserves === 1
            ? dailyReserveGate.promise
            : Promise.resolve(t.daily)
        },
        undefined,
        (listener) => {
          const capture = new GatedCapture(listener)
          gated.push(capture)
          return capture
        },
      )
      const releaseExit = (index: number): void => {
        gated[index]?.exitGate.resolve(undefined)
      }
      const settleCalls = (): unknown[][] => t.daily.settle.mock.calls.map((call) => [...call])
      try {
        t.dictation.start()
        if (phase === 'prepare') {
          await vi.waitFor(() => {
            expect(dailyReserves).toBe(1)
          })
          expect(t.capture().starts).toBe(0)
        } else {
          await captureStarted(t)
          if (phase === 'settle') {
            t.socket().handlers.onOpen()
            t.socket().serverSays({ sessionId: `table-${end}-${phase}` })
            t.dictation.stop()
            // The fake capture acks by hand; the exit is observed after.
            t.capture().listener.onStopped?.()
            releaseExit(0)
            await flushVoicePrepare()
            t.daily.settle.mockImplementationOnce(() => dailySettleGate.promise)
            await settleZeroFinal(t)
            expect(gated[0]?.exited).toBe(true)
          }
        }
        switch (end) {
          case 'dispose': {
            const disposed = (async () => {
              await t.dictation.dispose()
              isDrained = true
            })()
            await flushVoicePrepare()
            // The drain waits for the recorder's exit (and a held settlement).
            expect(isDrained).toBe(false)
            releaseExit(0)
            await flushVoicePrepare()
            if (phase === 'prepare') dailyReserveGate.resolve(t.daily)
            else if (phase === 'settle') {
              dailySettleGate.resolve({
                spentUsd: Usd.from(0).toAmount(),
                hasUnknownHistoricalFees: false,
              })
            }
            await disposed
            expect(isDrained).toBe(true)
            break
          }
          case 'stop': {
            t.dictation.stop()
            t.capture().listener.onStopped?.()
            await flushVoicePrepare()
            // Ended only when the exit is observed: nothing counted yet.
            expect(gated[0]?.exited).toBe(false)
            expect(t.seconds).toEqual([])
            releaseExit(0)
            await flushVoicePrepare()
            expect(gated[0]?.exited).toBe(true)
            expect(t.statuses).toContain('idle')
            break
          }
          case 'cancel': {
            t.dictation.stop()
            await flushVoicePrepare()
            expect(gated[0]?.exited).toBe(false)
            expect(t.statuses).not.toContain('idle')
            releaseExit(0)
            dailyReserveGate.resolve(t.daily)
            await flushVoicePrepare()
            expect(gated[0]?.exited).toBe(true)
            expect(t.statuses).toContain('idle')
            break
          }
          default: {
            t.capture().listener.onError('the microphone stopped')
            await flushVoicePrepare()
            // The failure is said once the process is gone, not on the report.
            expect(t.errors).toEqual([])
            expect(gated[0]?.exited).toBe(false)
            releaseExit(0)
            await flushVoicePrepare()
            expect(gated[0]?.exited).toBe(true)
            expect(t.errors).toEqual(['the microphone stopped'])
            break
          }
        }
        if (end !== 'dispose') {
          // The next press admits afresh on a new recorder.
          if (phase === 'prepare') dailyReserveGate.resolve(t.daily)
          t.dictation.start()
          await captureStarted(t)
          expect(t.capture().starts).toBe(1)
          expect(t.errors.filter((error) => error !== 'the microphone stopped')).toEqual([])
          for (const capture of gated) capture.exitGate.resolve(undefined)
          await t.dictation.dispose()
        }
        expect(gated.every((capture) => capture.exited)).toBe(true)
      } finally {
        dailyReserveGate.resolve(t.daily)
        dailySettleGate.resolve({
          spentUsd: Usd.from(0).toAmount(),
          hasUnknownHistoricalFees: false,
        })
        for (const capture of gated) capture.exitGate.resolve(undefined)
        await t.dictation.dispose()
      }
      // Each recording settled exactly once, for nothing, and refunded.
      const expectedSettles = end === 'dispose' ? 1 : 2
      expect(settleCalls()).toEqual(
        Array.from({ length: expectedSettles }, () => [Usd.from(0).toAmount(), false]),
      )
      await expectVoiceRefund(budget)
    },
  )

  it('a slow final settles once after the recorder is already gone', async () => {
    const budget = await voiceBudget('table-slow-final', 1)
    const gated: GatedCapture[] = []
    const t = dictationSetup(
      true,
      () => Promise.resolve(budget.scope),
      undefined,
      undefined,
      undefined,
      (listener) => {
        const capture = new GatedCapture(listener)
        gated.push(capture)
        return capture
      },
    )
    try {
      t.dictation.start()
      await captureStarted(t)
      t.socket().handlers.onOpen()
      t.socket().serverSays({ sessionId: 'table-slow-final' })
      t.dictation.stop()
      t.capture().listener.onStopped?.()
      gated[0]?.exitGate.resolve(undefined)
      await flushVoicePrepare()
      // The recorder is gone while the transcript is still awaited, and
      // nothing is counted or settled meanwhile.
      expect(gated[0]?.exited).toBe(true)
      expect(t.seconds).toEqual([])
      expect(t.daily.settle).not.toHaveBeenCalled()
      await settleZeroFinal(t)
      expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(Usd.from(0).toAmount(), false)
    } finally {
      for (const capture of gated) capture.exitGate.resolve(undefined)
      await t.dictation.dispose()
    }
    await expectVoiceRefund(budget)
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
    await captureStarted(t)
    t.capture().listener.onStatus('listening')
    t.capture().listener.onAudio?.(pcm(1))
    await answered(t)
    t.capture().listener.onAudio?.(pcm(2.5))
    t.dictation.stop()
    expect(t.capture().stops).toBe(1)
    t.capture().listener.onStopped?.()
    await flushVoicePrepare()
    t.socket().serverSays({
      type: 'transcript',
      transcript: '  run the tests  ',
      final: true,
      audioProcessedMs: 3520,
    })
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
    await flushVoicePrepare()
    t.dictation.start()
    await vi.waitFor(() => {
      expect(t.sockets).toHaveLength(2)
    })
    t.socket(0).handlers.onOpen()
    t.socket(0).serverSays({ sessionId: 's1' })
    t.socket(0).serverSays({
      type: 'transcript',
      transcript: 'first',
      final: true,
      audioProcessedMs: 2000,
    })
    expect(t.texts).toEqual(['first'])
    expect(t.socket(1).isClosed).toBe(false)
  })

  it('stops the recording and says why when there is no key', async () => {
    const t = dictationSetup(false)
    t.dictation.start()
    await vi.waitFor(() => {
      expect(t.errors).toEqual([UI_TEXT.museVoiceNoKey])
    })
    // Without a key nothing is captured: the failure is said with no
    // recording and no socket.
    expect(t.capture().starts).toBe(0)
    expect(t.capture().isDisposed).toBe(true)
    expect(t.sockets).toEqual([])
    expect(t.statuses).toEqual(['starting', 'idle'])
    await t.dictation.dispose()
  })

  it('drops the stream when the recorder fails, and counts what was sent', async () => {
    const t = dictationSetup()
    t.dictation.start()
    await answered(t)
    t.capture().listener.onAudio?.(pcm(1.2))
    t.capture().listener.onError('The microphone stopped')
    await flushVoicePrepare()
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
    await t.dictation.dispose()
    expect(t.capture().isDisposed).toBe(true)
    expect(t.socket().isClosed).toBe(true)
    expect(t.seconds).toEqual([0])
    t.dictation.start()
    expect(t.capture().starts).toBe(1)
  })
})

describe('CM352 bounded voice admission and receipts', () => {
  it('admits a finite session cap, settles reported seconds instead of sent seconds, and shows the tally', async () => {
    const budget = await voiceBudget('finite-reported', 1)
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await answered(t)
    expect(t.reserve).toHaveBeenCalledExactlyOnceWith(Usd.from('0.009004').toAmount())
    const pendingTotal = await voiceBudgetTotal(budget)
    expect(pendingTotal.spentUsd).toBe(reservation())
    t.capture().listener.onAudio?.(pcm(1.99))
    t.capture().listener.onStopped?.()
    await flushVoicePrepare()
    t.socket().serverSays({
      type: 'transcript',
      transcript: 'silence also counts',
      final: true,
      audioProcessedMs: 2000,
    })
    await vi.waitFor(async () => {
      const settledTotal = await voiceBudgetTotal(budget)
      expect(settledTotal.spentUsd).toBe(Usd.from('0.0001').toAmount())
    })
    expect(t.seconds).toEqual([2])
    expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(Usd.from('0.0001').toAmount(), false)
    expect(t.usage).toEqual([expect.stringContaining('reported duration')])
    expect(t.usage[0]).toContain('bill cannot be read back')
    await t.dictation.dispose()
  })

  it('refuses daily admission before opening and refunds a daily claim when the session cannot fit', async () => {
    const deny = dictationSetup(true, undefined, undefined, () =>
      Promise.reject(new Error('daily cap')),
    )
    deny.dictation.start()
    await waitVoicePrepared(deny)
    expect(deny.sockets).toEqual([])
    expect(deny.errors).toEqual(['daily cap'])
    // A refused reservation starts no recorder: the microphone never runs.
    expect(deny.capture().starts).toBe(0)
    await deny.dictation.dispose()
    const budget = await voiceBudget('daily-refund-session-denied', 0.001)
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await waitVoicePrepared(t)
    await vi.waitFor(() => {
      expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(Usd.from(0).toAmount(), false)
    })
    expect(t.sockets).toEqual([])
    expect(t.capture().starts).toBe(0)
    await expectVoiceRefund(budget)
    await t.dictation.dispose()
  })

  it('checks daily admission before every audio send and retains liability after a sent interruption', async () => {
    const t = dictationSetup()
    t.dictation.start()
    await answered(t)
    t.capture().listener.onAudio?.(pcm(1))
    const before = t.socket().binaries.length
    t.daily.check.mockImplementation(() => {
      throw new Error('daily changed')
    })
    t.capture().listener.onAudio?.(pcm(1))
    expect(t.socket().binaries).toHaveLength(before)
    expect(t.errors).toEqual(['daily changed'])
    await vi.waitFor(() => {
      expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(reservation(), true)
    })
    expect(t.seconds).toEqual([0])
    expect(t.usage[0]).toContain('full reservation remains uncertain')
    await t.dictation.dispose()
  })

  it('refunds an idle captured errorType frame with no audio, and reports the true pacing sentence', async () => {
    const budget = await voiceBudget('idle-zero', 1)
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await answered(t)
    t.socket().serverSays({
      type: 'error',
      message: 'Ingress audio slower than real-time',
      sessionId: 's1',
      errorType: 'invalid_request_error',
    })
    expect(t.errors).toEqual([UI_TEXT.museVoiceIdle])
    t.socket().handlers.onClose(1008, 'Ingress below real-time')
    expect(t.errors).toEqual([UI_TEXT.museVoiceIdle])
    expect(t.seconds).toEqual([0])
    await expectVoiceRefund(budget)
    expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(Usd.from(0).toAmount(), false)
    expect(t.usage[0]).toContain('No audio was sent')
    await t.dictation.dispose()
  })

  it('refunds disposal while the daily write is pending, and surfaces settlement failures', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof dictationSetup>['daily']>()
    const started = Promise.withResolvers<undefined>()
    const t = dictationSetup(true, undefined, undefined, () => {
      started.resolve(undefined)
      return pending.promise
    })
    t.dictation.start()
    await started.promise
    const disposed = t.dictation.dispose()
    pending.resolve(t.daily)
    await disposed
    await vi.waitFor(() => {
      expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(Usd.from(0).toAmount(), false)
    })
    expect(t.sockets).toEqual([])
    const broken = dictationSetup()
    broken.daily.settle.mockRejectedValue(new Error('disk unavailable'))
    broken.dictation.start()
    await answered(broken)
    broken.capture().listener.onStopped?.()
    await flushVoicePrepare()
    broken
      .socket()
      .serverSays({ type: 'transcript', transcript: '', final: true, audioProcessedMs: 0 })
    await vi.waitFor(() => {
      expect(broken.errors).toContain(UI_TEXT.sessionBudgetStoreUnavailable)
    })
    await broken.dictation.dispose()
  })

  it.each(['scope', 'key', 'daily', 'session', 'key reread'])(
    'drains shutdown during the %s await and leaves no stranded claim',
    async (stage) => {
      const budget = await voiceBudget(`shutdown-${stage.replaceAll(' ', '-')}`, 1)
      const held = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      const pause = async () => {
        entered.resolve(undefined)
        await held.promise
      }
      const reserve = budget.scope.journal.reserve.bind(budget.scope.journal)
      const reserveSpy = vi
        .spyOn(budget.scope.journal, 'reserve')
        .mockImplementation(async (...args) => {
          if (stage === 'session') await pause()
          return await reserve(...args)
        })
      let keyReads = 0
      const t = dictationSetup(
        true,
        async () => {
          if (stage === 'scope') await pause()
          return budget.scope
        },
        async () => {
          keyReads += 1
          if ((stage === 'key' && keyReads === 1) || (stage === 'key reread' && keyReads === 2)) {
            await pause()
          }
          return KEY
        },
        async () => {
          if (stage === 'daily') await pause()
          return t.daily
        },
      )
      try {
        t.dictation.start()
        await entered.promise
        let hasDrained = false
        const disposed = (async () => {
          await t.dictation.dispose()
          hasDrained = true
        })()
        await flushVoicePrepare()
        expect(hasDrained).toBe(false)
        expect(t.capture().starts).toBe(0)
        expect(t.sockets).toEqual([])
        held.resolve(undefined)
        await disposed
        expect(hasDrained).toBe(true)
        expect(t.capture().isDisposed).toBe(true)
        const total = await voiceBudgetTotal(budget)
        expect(total.spentUsd).toBe(Usd.from(0).toAmount())
        // The same journal admits and releases the next recording's liability.
        const next = await budget.scope.journal.reserve(
          'voice-parent',
          budget.scope.accountId,
          reservation(),
        )
        expect(next.check(Usd.from(1).toAmount()).spentUsd).toBe(reservation())
        await next.settle(Usd.from(0).toAmount(), false)
      } finally {
        held.resolve(undefined)
        reserveSpy.mockRestore()
        await t.dictation.dispose()
      }
    },
  )

  it('drains both liability writes even when capture disposal throws synchronously', async () => {
    const budget = await voiceBudget('throwing-capture-dispose', 1)
    const t = dictationSetup(true, () => Promise.resolve(budget.scope))
    t.dictation.start()
    await answered(t)
    t.capture().listener.onAudio?.(pcm(1))
    const failure = vi.spyOn(t.capture(), 'dispose').mockImplementation(() => {
      throw new Error('capture cleanup failed')
    })
    try {
      await expect(t.dictation.dispose()).resolves.toBeUndefined()
      expect(t.socket().isClosed).toBe(true)
      expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(reservation(), true)
      expect(await voiceBudgetTotal(budget)).toEqual({
        spentUsd: reservation(),
        hasUnknownHistoricalFees: true,
      })
    } finally {
      failure.mockRestore()
      await t.dictation.dispose()
    }
  })

  it('waits for a pending settlement write on dispose, then settles reported seconds', async () => {
    const release = Promise.withResolvers<undefined>()
    const t = dictationSetup()
    t.daily.settle.mockImplementation(async () => {
      await release.promise
      return {
        spentUsd: Usd.from(0).toAmount(),
        hasUnknownHistoricalFees: false,
      }
    })
    t.dictation.start()
    await answered(t)
    t.capture().listener.onAudio?.(pcm(1.99))
    t.capture().listener.onStopped?.()
    await flushVoicePrepare()
    t.socket().serverSays({
      type: 'transcript',
      transcript: 'held settlement',
      final: true,
      audioProcessedMs: 2000,
    })
    await vi.waitFor(() => {
      expect(t.daily.settle).toHaveBeenCalled()
    })
    // The drain does not finish while the journal write is still running.
    let isDrained = false
    const disposed = t.dictation.dispose()
    const watchDrain = (async (): Promise<void> => {
      await disposed
      isDrained = true
    })()
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
    expect(isDrained).toBe(false)
    expect(t.socket().isClosed).toBe(true)
    release.resolve(undefined)
    await disposed
    await watchDrain
    expect(isDrained).toBe(true)
    expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(Usd.from('0.0001').toAmount(), false)
    expect(t.seconds).toEqual([2])
  })

  it.each([4096, 3200, 65_536])(
    'reframes recorder chunks of %s bytes, enforces the byte cap, and stops the recorder',
    async (chunkSize) => {
      const t = dictationSetup()
      t.dictation.start()
      await answered(t)
      const audio = Buffer.alloc(MUSE_VOICE_MAX_BYTES + chunkSize, 7)
      for (let offset = 0; offset < audio.length; offset += chunkSize) {
        t.capture().listener.onAudio?.(audio.subarray(offset, offset + chunkSize))
      }
      expect(t.capture().stops).toBe(1)
      expect(t.socket().binaries.every((frame) => frame.length === MUSE_VOICE_FRAME_BYTES)).toBe(
        true,
      )
      expect(
        Buffer.concat(t.socket().binaries).equals(audio.subarray(0, MUSE_VOICE_MAX_BYTES)),
      ).toBe(true)
      expect(t.socket().texts.at(-1)).toBe('{"type":"endStream"}')
      t.socket().serverSays({
        type: 'transcript',
        transcript: '',
        final: true,
        audioProcessedMs: MUSE_VOICE_RESERVED_MS,
      })
      expect(t.seconds).toEqual([MUSE_VOICE_MAX_SECONDS])
      await vi.waitFor(() => {
        expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(Usd.from('0.009').toAmount(), false)
      })
      await t.dictation.dispose()
    },
  )

  it('ends an elapsed-time capped stream even without incoming audio, and ignores late bytes', () => {
    vi.useFakeTimers()
    try {
      const t = streamSetup()
      t.stream.start(KEY)
      t.socket().handlers.onOpen()
      t.socket().serverSays({ sessionId: 'elapsed' })
      vi.advanceTimersByTime(MUSE_VOICE_MAX_SECONDS * 1000)
      expect(t.socket().texts.at(-1)).toBe('{"type":"endStream"}')
      t.stream.push(pcm(1))
      expect(t.socket().binaries).toEqual([])
      t.stream.abort()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid reported duration %s',
    (duration) => {
      const t = streamSetup()
      t.stream.start(KEY)
      t.socket().handlers.onOpen()
      t.socket().serverSays({ sessionId: 'invalid-duration' })
      t.stream.finish()
      t.socket().serverSays({
        type: 'transcript',
        transcript: 'unsafe',
        final: true,
        audioProcessedMs: duration,
      })
      expect(t.finals).toEqual([])
      expect(t.failures).toEqual([UI_TEXT.museVoiceInvalidDuration])
    },
  )

  it('does not clamp an unexpectedly large final report to its reservation', async () => {
    const t = dictationSetup()
    t.dictation.start()
    await stopRecordedVoice(t, 1)
    t.socket().serverSays({
      type: 'transcript',
      transcript: '',
      final: true,
      audioProcessedMs: 181_000,
    })
    expect(t.seconds).toEqual([181])
    expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(Usd.from('0.00905').toAmount(), false)
    await t.dictation.dispose()
  })

  it('settles once even when a transport send and close both throw', async () => {
    const t = dictationSetup()
    t.dictation.start()
    await answered(t)
    vi.spyOn(t.socket(), 'sendBinary').mockImplementation(() => {
      throw new Error('send failed')
    })
    vi.spyOn(t.socket(), 'close').mockImplementation(() => {
      throw new Error('close failed')
    })
    t.capture().listener.onAudio?.(pcm(1))
    expect(t.errors).toEqual([UI_TEXT.museVoiceTransportFailed])
    expect(t.seconds).toEqual([0])
    expect(t.daily.settle).toHaveBeenCalledExactlyOnceWith(reservation(), true)
    await t.dictation.dispose()
  })
})

it('CM352 shares real daily reservations across Muse Code windows and releases final duration headroom', async () => {
  const directory = path.join(budgetDirectory, 'real-daily-voice')
  const daily = () =>
    createPaidDailyBudget({
      directory,
      now: () => 0,
      capUsd: () => Usd.from('0.5').toAmount(),
      sleep: () => Promise.resolve(),
      isModelApi: () => false,
    })
  const firstDay = daily()
  const secondDay = daily()
  const previous = await firstDay.reserveExact(Usd.from('0.49').toAmount())
  await previous.settle(Usd.from('0.49').toAmount(), false)
  const first = dictationSetup(true, undefined, undefined, firstDay.reserveExact)
  const second = dictationSetup(true, undefined, undefined, secondDay.reserveExact)
  try {
    first.dictation.start()
    await answered(first)
    second.dictation.start()
    await waitVoicePrepared(second)
    expect(second.sockets).toEqual([])
    expect(second.errors).toHaveLength(1)
    first.capture().listener.onAudio?.(pcm(3))
    first.capture().listener.onStopped?.()
    await flushVoicePrepare()
    first
      .socket()
      .serverSays({ type: 'transcript', transcript: '', final: true, audioProcessedMs: 3040 })
    await vi.waitFor(async () => {
      const total = await firstDay.latestDay()
      expect(total.spentUsd).toBe(Usd.from('0.49015').toAmount())
    })
    second.dictation.start()
    await answered(second)
    second.capture().listener.onAudio?.(pcm(3))
    second.capture().listener.onStopped?.()
    await flushVoicePrepare()
    second
      .socket()
      .serverSays({ type: 'transcript', transcript: '', final: true, audioProcessedMs: 3040 })
    await vi.waitFor(async () => {
      const total = await secondDay.latestDay()
      expect(total.spentUsd).toBe(Usd.from('0.4903').toAmount())
    })
    expect(first.seconds).toEqual([3])
    expect(second.seconds).toEqual([0, 3])
  } finally {
    await first.dictation.dispose()
    await second.dictation.dispose()
  }
})

/** A helper process under test control speaking the line protocol. */
class FakeHelperChild extends FakeHelperProcess implements HelperChild {
  public onStopFailed(): void {
    // This fake never refuses a stop.
  }

  public kill(): void {
    // Kills land as exits only when the test says the process is gone.
  }
}

function identitySetup() {
  const children: FakeHelperChild[] = []
  const { sockets, texts, errors, statuses, seconds } = voiceObservations()
  const daily = fakeVoiceDailyClaim()
  const driver = new MuseVoiceDictation(
    {
      createCapture: (listener) =>
        new Dictation({
          invocation: { command: 'helper', args: [] },
          spawn: () => {
            const child = new FakeHelperChild()
            children.push(child)
            return child
          },
          listener,
          log: new FakeLogOutputChannel(),
        }),
      openSocket: (_url, handlers) => {
        const socket = new FakeSocket(handlers)
        sockets.push(socket)
        return socket
      },
      url: URL,
      apiKey: () => Promise.resolve(KEY),
      onSeconds: (count) => {
        seconds.push(count)
      },
      reserveDaily: () => Promise.resolve(daily),
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
  const child = (index = 0): FakeHelperChild => {
    const found = children[index]
    if (found === undefined) {
      throw new Error('no helper')
    }
    return found
  }
  return { driver, child, sockets, texts, errors, statuses, seconds }
}

async function flushVoicePrepare(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve()
  }
}

function voiceAudioLine(seconds: number): unknown {
  return {
    type: 'audio',
    data: Buffer.from(pcm(seconds)).toString('base64'),
  }
}

/**
 * Ends every helper that never exited: dispose quits them, and the clock
 * runs past the bounded kill so the drain resolves under fake timers.
 */
async function disposeIdentity(t: ReturnType<typeof identitySetup>): Promise<void> {
  const disposed = t.driver.dispose()
  await vi.advanceTimersByTimeAsync(2 * DICTATION_QUIT_GRACE_MS)
  await disposed
}

async function listeningIdentity(
  t: ReturnType<typeof identitySetup>,
  seconds: number,
): Promise<void> {
  t.driver.start()
  await flushVoicePrepare()
  t.child().emitLine({ type: 'ready', language: 'pcm_s16le' })
  t.child().emitLine({ type: 'listening' })
  t.child().emitLine(voiceAudioLine(seconds))
  t.sockets[0]?.handlers.onOpen()
  t.sockets[0]?.serverSays({ sessionId: 'a' })
}

async function stoppingIdentityAtCap(isStartQueued: boolean) {
  const t = identitySetup()
  await listeningIdentity(t, 1)
  vi.advanceTimersByTime((MUSE_VOICE_MAX_SECONDS - 1) * 1000)
  t.driver.stop()
  if (isStartQueued) t.driver.start()
  vi.advanceTimersByTime(1000)
  return t
}

/**
 * The helper's stop acknowledgement, then its observed process exit: only
 * the pair ends a recording (RVCM352B P1-b), retiring the stream and
 * releasing the queued press.
 */
async function ackStop(
  t: ReturnType<typeof identitySetup>,
  index = 0,
  description = 'exit code 0',
): Promise<void> {
  t.child(index).emitLine({ type: 'stopped' })
  expect(t.child(index).sent).toEqual(expect.arrayContaining(['start', 'stop', 'quit']))
  await flushVoicePrepare()
  t.child(index).exit(description)
  await flushVoicePrepare()
}

describe('MuseVoiceDictation recording identity (P1 restart race)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a stop then start keeps each recording on its own stream and cap', async () => {
    const t = identitySetup()
    await listeningIdentity(t, 1)
    const aFrames = t.sockets[0]?.binaries.length ?? 0
    expect(aFrames).toBeGreaterThan(0)
    // Stop reports nothing until the helper acknowledges it.
    t.driver.stop()
    expect(t.child().sent).toEqual(['start', 'stop'])
    expect(t.statuses).not.toContain('idle')
    // B starts before A's acknowledgement arrives: the helper hears nothing yet.
    t.driver.start()
    await flushVoicePrepare()
    expect(t.sockets).toHaveLength(1)
    expect(t.child().sent).toEqual(['start', 'stop'])
    // A's trailing audio still belongs to A, never to B.
    t.child().emitLine(voiceAudioLine(1))
    expect(t.sockets[1]).toBeUndefined()
    expect(t.sockets[0]?.binaries.length).toBeGreaterThan(aFrames)
    // A's acknowledgement retires A, but B waits for A's observed exit.
    t.child().emitLine({ type: 'stopped' })
    await flushVoicePrepare()
    expect(t.child().sent).toEqual(['start', 'stop', 'quit'])
    expect(t.sockets).toHaveLength(1)
    t.child().exit('exit code 0')
    await flushVoicePrepare()
    t.child(1).emitLine({ type: 'ready', language: 'pcm_s16le' })
    expect(t.child(1).sent).toEqual(['start'])
    expect(t.sockets[0]?.texts.at(-1)).toBe('{"type":"endStream"}')
    expect(t.sockets[1]?.texts).toEqual([])
    t.sockets[0]?.serverSays({
      type: 'transcript',
      transcript: 'first',
      final: true,
      audioProcessedMs: 2000,
    })
    expect(t.texts).toEqual(['first'])
    expect(t.seconds).toEqual([2])
    // B captures on its own acknowledgement, with its own stream.
    t.child(1).emitLine({ type: 'listening' })
    t.child(1).emitLine(voiceAudioLine(1))
    t.sockets[1]?.handlers.onOpen()
    t.sockets[1]?.serverSays({ sessionId: 'b' })
    expect(t.sockets[1]?.binaries.length).toBeGreaterThan(0)
    // The cap stops B at its own limit: A's timer died with A.
    vi.advanceTimersByTime(MUSE_VOICE_MAX_SECONDS * 1000)
    expect(t.sockets[1]?.texts.at(-1)).toBe('{"type":"endStream"}')
    expect(t.child(1).sent.at(-1)).toBe('stop')
    await disposeIdentity(t)
  })

  it('keeps queued B when A reaches its cap while waiting for stopped acknowledgement', async () => {
    const t = await stoppingIdentityAtCap(true)
    try {
      await ackStop(t)
      expect(t.sockets).toHaveLength(2)
      expect(t.child(1).sent).toEqual([])
      t.child(1).emitLine({ type: 'ready', language: 'pcm_s16le' })
      t.child(1).emitLine({ type: 'listening' })
      const socket = t.sockets.at(-1)
      socket?.handlers.onOpen()
      socket?.serverSays({ sessionId: 'b-cap' })
      vi.advanceTimersByTime(MUSE_VOICE_MAX_SECONDS * 1000)
      expect(t.child(1).sent).toEqual(['start', 'stop'])
    } finally {
      await disposeIdentity(t)
    }
  })

  it('keeps capture ownership when a cap final arrives before helper acknowledgement', async () => {
    const t = await stoppingIdentityAtCap(false)
    try {
      t.sockets[0]?.serverSays({
        type: 'transcript',
        transcript: 'a',
        final: true,
        audioProcessedMs: 1000,
      })
      expect(t.seconds).toEqual([1])
      t.driver.start()
      await flushVoicePrepare()
      expect(t.sockets).toHaveLength(1)
      await ackStop(t)
      expect(t.sockets).toHaveLength(2)
    } finally {
      await disposeIdentity(t)
    }
  })

  it('forces an unacknowledged A stop before starting B with its own cap', async () => {
    const t = identitySetup()
    try {
      t.driver.start()
      await flushVoicePrepare()
      t.child().emitLine({ type: 'ready', language: 'pcm_s16le' })
      t.child().emitLine({ type: 'listening' })
      t.sockets[0]?.handlers.onOpen()
      t.sockets[0]?.serverSays({ sessionId: 'a' })
      t.driver.stop()
      t.driver.start()
      vi.advanceTimersByTime(DICTATION_STOP_GRACE_MS)
      // The grace failure ends A once its (unresponsive) process is gone.
      t.child().exit('signal SIGKILL')
      await flushVoicePrepare()
      expect(t.sockets[0]?.isClosed).toBe(true)
      expect(t.sockets).toHaveLength(2)
      t.child(1).emitLine({ type: 'ready', language: 'pcm_s16le' })
      t.child(1).emitLine({ type: 'listening' })
      t.sockets[1]?.handlers.onOpen()
      t.sockets[1]?.serverSays({ sessionId: 'b' })
      t.child().emitLine({ type: 'stopped' })
      t.child().emitLine(voiceAudioLine(1))
      expect(t.sockets[1]?.texts).toHaveLength(1)
      vi.advanceTimersByTime(MUSE_VOICE_MAX_SECONDS * 1000)
      expect(t.child(1).sent.at(-1)).toBe('stop')
    } finally {
      await disposeIdentity(t)
    }
  })

  it.each(['listening', 'audio', 'stopped', 'error'])(
    'drops A trailing %s at every interleaving with B start and preserves B cap',
    async (event) => {
      for (const stage of ['queued', 'starting', 'listening']) {
        const t = identitySetup()
        try {
          t.driver.start()
          await flushVoicePrepare()
          const a = t.child()
          a.emitLine({ type: 'ready', language: 'pcm_s16le' })
          a.emitLine({ type: 'listening' })
          t.sockets[0]?.handlers.onOpen()
          t.sockets[0]?.serverSays({ sessionId: 'a' })
          a.emitLine(voiceAudioLine(1))
          t.driver.stop()
          t.driver.start()
          await flushVoicePrepare()
          expect(t.sockets).toHaveLength(1)
          if (stage !== 'queued') {
            // The acknowledgement retires A; B still waits for A's exit.
            a.emitLine({ type: 'stopped' })
            await flushVoicePrepare()
            expect(t.sockets).toHaveLength(1)
          }
          if (stage === 'listening') {
            // B begins only after A's process is observed gone.
            a.exit('exit code 0')
            await flushVoicePrepare()
            t.child(1).emitLine({ type: 'ready', language: 'pcm_s16le' })
            t.child(1).emitLine({ type: 'listening' })
          }
          a.emitLine(
            event === 'audio' ? voiceAudioLine(1) : { type: event, reason: 'old helper failed' },
          )
          if (stage === 'queued' && event !== 'stopped' && event !== 'error') {
            a.emitLine({ type: 'stopped' })
          }
          await flushVoicePrepare()
          if (stage !== 'listening') {
            // Whatever retired A — acknowledgement or failure — B begins
            // only after A's process is observed gone.
            a.exit('exit code 0')
            await flushVoicePrepare()
          }
          expect(t.sockets).toHaveLength(2)
          const b = t.child(1)
          b.emitLine({ type: 'ready', language: 'pcm_s16le' })
          b.emitLine({ type: 'listening' })
          t.sockets[1]?.handlers.onOpen()
          t.sockets[1]?.serverSays({ sessionId: 'b' })
          // Old socket events also retain A, even after B listens.
          t.sockets[0]?.serverSays({
            type: 'transcript',
            transcript: 'a',
            final: true,
            audioProcessedMs: 1000,
          })
          t.sockets[0]?.handlers.onClose(1000, '')
          b.emitLine(voiceAudioLine(1))
          expect(t.sockets[1]?.binaries.length).toBeGreaterThan(0)
          expect(t.sockets[1]?.texts).toHaveLength(1)
          vi.advanceTimersByTime(MUSE_VOICE_MAX_SECONDS * 1000)
          expect(b.sent.at(-1)).toBe('stop')
          expect(t.sockets[1]?.texts.at(-1)).toBe('{"type":"endStream"}')
        } finally {
          await disposeIdentity(t)
        }
      }
    },
  )

  it('a late helper error ends each unfinished recording on its own stream', async () => {
    const t = identitySetup()
    await listeningIdentity(t, 2)
    t.driver.stop()
    t.driver.start()
    await flushVoicePrepare()
    expect(t.sockets).toHaveLength(1)
    t.child().emitLine({ type: 'error', reason: 'the helper died' })
    // The failure is said once A's process is observed gone; B follows it.
    expect(t.errors).toEqual([])
    t.child().exit('exit code 2')
    await flushVoicePrepare()
    expect(t.errors).toEqual(['the helper died'])
    expect(t.texts).toEqual([])
    // A counts what it sent; B never captured and counts nothing.
    expect(t.seconds).toEqual([2])
    expect(t.sockets[0]?.isClosed).toBe(true)
    expect(t.sockets[1]?.isClosed).toBe(false)
    // The next press starts afresh on a new helper.
    t.driver.start()
    await flushVoicePrepare()
    expect(t.errors).toHaveLength(1)
    await disposeIdentity(t)
  })
})

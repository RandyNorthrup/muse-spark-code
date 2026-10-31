// RLF-QUOTA (PLAN.md D229): a spent subscription window is its own turn
// outcome, never "internal" and never transient. The CLI's typed
// `TurnError.quota` (ADR 50047) rides `turn/completed` onto the
// `turnCompleted` event; every surface states it with the reset in the
// person's local time; automatic resend never fires before the reset;
// continuing at the reset is the person's opt-in.
//
// Every wire byte is recorded or schema-verified. The failure text and
// reset instant are byte for byte from the observed 0.19.0 ACP error line
// (test/fixtures/musecode-quota/observed-acp-error.json: the lead's
// observation of 2026-10-30, every Muse lane at once); the `quota`
// member follows CLI 1.4.10's offline schema export, verified on this
// rig. The CLI's `retryable` judgment for a quota failure is unrecorded,
// so the mapping and the panel cases cover both values with an identical
// outcome. The live-wire panel cases run the real controller, a real
// MuseCodeHost and its real session over the SDK's real Connection,
// scripted with the echo-turn capture (zero model calls) as in
// museCodeAutoResend.test.ts.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import type { TranscriptEntry } from '../../src/webview/state/transcriptEntries'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import {
  MALFORMED_PARAMS,
  mapNotification,
  UNKNOWN_METHOD,
} from '../../src/core/backends/musecode/mapNotification'
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../src/shared/constants'
import { fill, formatDateTime } from '../../src/shared/l10n/text'
import { quotaTurnFailureText, quotaWaitText } from '../../src/shared/turnFailure'
import { execQuotaOutcome } from '../../src/runtime/exec/runExec'
import {
  QUOTA_MESSAGE,
  QUOTA_RESETS_AT_MS,
  quotaTurnCompleted,
  quotaTurnParams,
} from './helpers/musecodeQuota'
import {
  awaitPosts,
  conversationPanel,
  modelApiRig,
  turnAcceptances,
  turnCompletions,
  type PanelRig,
} from './helpers/conversationPanel'
import {
  captureBroadcast,
  captureResult,
  closeLiveHosts,
  readCapture,
  refuseUnscripted,
  startLiveHost,
  type Answer,
  type LiveHost,
  type WireFrame,
} from './helpers/museReplay'
import { removeFolder } from './helpers/temporaryFolders'

function mappedQuotaTurn(isRetryable: boolean) {
  const mapped = mapNotification({
    method: 'turn/completed',
    params: quotaTurnParams({ sessionId: 'session-1', turnId: 'turn-1', retryable: isRetryable }),
  })
  if (mapped === MALFORMED_PARAMS || mapped === UNKNOWN_METHOD || !('event' in mapped))
    throw new Error('the quota end refused to map')
  if (mapped.event.type !== 'turnCompleted') throw new Error('the quota end mapped past its turn')
  return mapped.event
}

describe('subscription quota mapping', () => {
  it.each([true, false])('carries the typed quota detail with retryable %s', (retryable) => {
    const event = mappedQuotaTurn(retryable)
    expect(event.terminal).toBe('failed')
    expect(event.reason).toBe(QUOTA_MESSAGE)
    expect(event.retryable).toBe(retryable)
    expect(event.quota).toEqual({ limitKind: 'tierLimit', resetsAtMs: QUOTA_RESETS_AT_MS })
  })

  it('leaves a failure without the typed detail untouched', () => {
    const params = {
      ...quotaTurnParams({ sessionId: 'session-1', turnId: 'turn-1', retryable: true }),
      error: { kind: 'modelError', message: QUOTA_MESSAGE, retryable: true },
    }
    const mapped = mapNotification({ method: 'turn/completed', params })
    if (mapped === MALFORMED_PARAMS || mapped === UNKNOWN_METHOD || !('event' in mapped))
      throw new Error('the bare end refused to map')
    const event = mapped.event
    expect(event.type).toBe('turnCompleted')
    if (event.type !== 'turnCompleted') return
    expect(event.terminal).toBe('failed')
    expect(event.retryable).toBe(true)
    expect('quota' in event).toBe(false)
  })
})

describe('subscription quota words', () => {
  it('states the failure with the reset in the person’s local time', () => {
    const text = quotaTurnFailureText({ quota: { resetsAtMs: QUOTA_RESETS_AT_MS } })
    expect(text).toBe(
      fill(UI_TEXT.subscriptionQuotaExhausted, {
        resetTime: formatDateTime(QUOTA_RESETS_AT_MS),
      }),
    )
    expect(text).toContain(formatDateTime(QUOTA_RESETS_AT_MS))
    expect(text).not.toContain('{resetTime}')
    // Never the raw 429 line: the reset is stated, not buried in text.
    expect(text).not.toContain('request_id')
    expect(text).not.toContain('rate_limit_error')
  })

  it('answers undefined without the typed detail', () => {
    expect(quotaTurnFailureText({})).toBeUndefined()
    expect(quotaTurnFailureText({ quota: undefined })).toBeUndefined()
  })

  it('states the wait row with the same reset', () => {
    const text = quotaWaitText({ resetsAtMs: QUOTA_RESETS_AT_MS })
    expect(text).toBe(
      fill(UI_TEXT.turnQuotaWaiting, { resetTime: formatDateTime(QUOTA_RESETS_AT_MS) }),
    )
    expect(text).not.toContain('{resetTime}')
  })
})

const echo = readCapture(new URL('../fixtures/m106/msp-1.4.7-echo-turn.json', import.meta.url))
const echoInit = captureResult(echo.frames, 1)
const echoModels = captureResult(echo.frames, 2)
const echoStart = captureResult(echo.frames, 3)
const echoTurnAck = captureResult(echo.frames, 4)
const echoStarted = captureBroadcast(echo.frames, 'turn/started')
const echoCompleted = captureBroadcast(echo.frames, 'turn/completed')
const lifecycle = readCapture(
  new URL('../fixtures/m106/msp-1.4.4-session-lifecycle.json', import.meta.url),
)
const effortAck = captureResult(lifecycle.frames, 4)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function liveString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new TypeError(`the capture serves no ${what}`)
  return value
}

const startSession = echoStart['session']
if (!isRecord(startSession)) throw new Error('the capture serves no session/start session')
const LIVE_SESSION_ID = liveString(startSession, 'sessionId', 'session id')
const LIVE_TURN_ID = liveString(echoTurnAck, 'turnId', 'turn id')

const TYPED = 'Say the word apricot, then stop.'

function quotaEnd(isRetryable: boolean): WireFrame {
  return quotaTurnCompleted({
    sessionId: LIVE_SESSION_ID,
    turnId: LIVE_TURN_ID,
    retryable: isRetryable,
  })
}

function turnRetries(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) =>
    message.type === 'agentEvent' && message.event.type === 'turnRetry' ? [message.event] : [],
  )
}

/** The transcript the panel's posted messages reduce to, through the real reducer. */
function shownTranscript(panel: PanelRig) {
  let state = initialUiState
  state = uiReducer(state, {
    type: 'submitted',
    localId: 'local-1',
    text: TYPED,
    attachments: [],
    contextLabel: undefined,
  })
  for (const message of panel.posted) {
    state = uiReducer(state, { type: 'hostMessage', message, at: 0 })
  }
  return state.transcript
}

/** The live region's last announcement after the posted messages, through the real reducer. */
function lastAnnouncement(panel: PanelRig): string | undefined {
  let state = initialUiState
  for (const message of panel.posted) {
    state = uiReducer(state, { type: 'hostMessage', message, at: 0 })
  }
  return state.announcement?.text
}

interface QuotaRig {
  readonly panel: PanelRig
  readonly live: LiveHost
  readonly waits: number[]
  readonly releaseSleep: () => void
}

function quotaPanel(
  directory: string,
  options?: {
    readonly quotaContinue?: () => boolean
    readonly now?: () => number
  },
): QuotaRig {
  const script = (method: string): Answer => {
    switch (method) {
      case 'session/start': {
        return { result: echoStart }
      }
      case 'model/list': {
        return { result: echoModels }
      }
      case 'session/setReasoningEffort': {
        return { result: effortAck }
      }
      case 'turn/start': {
        return { result: echoTurnAck }
      }
      default: {
        return refuseUnscripted(method)
      }
    }
  }
  const live = startLiveHost(script, undefined, {
    initializeResult: echoInit,
    startResult: echoStart,
  })
  const rig = modelApiRig(directory)
  const waits: number[] = []
  const gate = Promise.withResolvers<undefined>()
  const resendSleep = (ms: number, signal: AbortSignal): Promise<void> => {
    waits.push(ms)
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('the resend wait was already stopped'))
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          reject(new Error('the resend wait stopped'))
        },
        { once: true },
      )
      void gate.promise.then(resolve)
    })
  }
  const panel = conversationPanel({
    rig,
    directory,
    isNamespaceKnown: true,
    backend: 'museCode',
    modelId: 'muse-spark-1.3-contributor',
    ensureHost: () => Promise.resolve(live.host),
    resendSleep,
    resendRandom: () => 0.5,
    ...(options?.quotaContinue !== undefined && { museCodeQuotaContinue: options.quotaContinue }),
    ...(options?.now !== undefined && { now: options.now }),
  })
  return {
    panel,
    live,
    waits,
    releaseSleep: () => {
      gate.resolve(undefined)
    },
  }
}

async function sendFirst(panel: PanelRig): Promise<void> {
  await panel.controller.handle({
    type: 'sendMessage',
    localId: 'local-1',
    text: TYPED,
    attachmentIds: [],
  })
}

async function startFirstTurn(rig: QuotaRig): Promise<void> {
  await sendFirst(rig.panel)
  await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
  rig.live.wire.release(echoStarted)
}

describe('subscription quota on the panel', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-quota-'))
  })

  afterEach(async () => {
    await closeLiveHosts()
    await removeFolder(directory)
  })

  it.each([true, false])(
    'shows a quota failure at once by default with retryable %s, naming the reset',
    async (isRetryable) => {
      const rig = quotaPanel(directory)
      await startFirstTurn(rig)
      rig.live.wire.release(quotaEnd(isRetryable))
      const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
      expect(end?.terminal).toBe('failed')
      expect(end?.retryable).toBe(isRetryable)
      // No automatic resend before the reset: no wait named, one submit.
      expect(turnRetries(rig.panel.posted)).toHaveLength(0)
      expect(rig.waits).toHaveLength(0)
      expect(rig.live.wire.sentCount('turn/start')).toBe(1)
      // The error row states the reset; the raw 429 line is gone.
      const row = shownTranscript(rig.panel).find((entry) => entry.kind === 'error')
      expect(row?.text).toBe(quotaTurnFailureText({ quota: { resetsAtMs: QUOTA_RESETS_AT_MS } }))
      expect(row?.text).toContain(formatDateTime(QUOTA_RESETS_AT_MS))
      expect(row?.text).not.toContain('request_id')
      // Manual Retry follows the CLI's own judgment, as on any failure.
      expect(row !== undefined && 'retryTurnId' in row).toBe(isRetryable)
      // The live region announces the reset too, never raw text.
      expect(lastAnnouncement(rig.panel)).toContain(formatDateTime(QUOTA_RESETS_AT_MS))
    },
  )

  it('waits until the reset and continues with the opt-in', async () => {
    const minuteMs = 60 * MILLISECONDS_PER_SECOND
    const rig = quotaPanel(directory, {
      quotaContinue: () => true,
      now: () => QUOTA_RESETS_AT_MS - minuteMs,
    })
    await startFirstTurn(rig)
    rig.live.wire.release(quotaEnd(true))
    const [wait] = await awaitPosts(rig.panel, turnRetries, 1, 'quota waits named')
    // The provider's own wait, honoured whole: a minute to the reset.
    expect(rig.waits).toEqual([minuteMs])
    expect(wait?.retryDelayMs).toBe(minuteMs)
    expect(wait?.quota).toEqual({ limitKind: 'tierLimit', resetsAtMs: QUOTA_RESETS_AT_MS })
    // The row names the reset with Stop, not a seconds count.
    const waiting = shownTranscript(rig.panel).find(
      (entry): entry is Extract<TranscriptEntry, { kind: 'notice' }> =>
        entry.kind === 'notice' && entry.id === `retry:${LIVE_TURN_ID}`,
    )
    expect(waiting?.text).toBe(quotaWaitText({ resetsAtMs: QUOTA_RESETS_AT_MS }))
    expect(waiting?.retryingTurnId).toBe(LIVE_TURN_ID)
    rig.releaseSleep()
    await awaitPosts(rig.panel, turnAcceptances, 2, 'turns accepted')
    expect(rig.live.wire.sentCount('turn/start')).toBe(2)
    rig.live.wire.release(echoCompleted)
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('completed')
  })

  it('resubmits at once when the reset already passed', async () => {
    const rig = quotaPanel(directory, { quotaContinue: () => true })
    await startFirstTurn(rig)
    rig.live.wire.release(quotaEnd(false))
    await awaitPosts(rig.panel, turnRetries, 1, 'quota waits named')
    // The recorded reset is past on a real clock: no wait of ours is added.
    expect(rig.waits).toEqual([0])
    rig.releaseSleep()
    await awaitPosts(rig.panel, turnAcceptances, 2, 'turns accepted')
    expect(rig.live.wire.sentCount('turn/start')).toBe(2)
  })

  it('stops the quota wait on Stop and shows the failure with its reset', async () => {
    const minuteMs = 60 * MILLISECONDS_PER_SECOND
    const rig = quotaPanel(directory, {
      quotaContinue: () => true,
      now: () => QUOTA_RESETS_AT_MS - minuteMs,
    })
    await startFirstTurn(rig)
    rig.live.wire.release(quotaEnd(true))
    await awaitPosts(rig.panel, turnRetries, 1, 'quota waits named')
    await rig.panel.controller.handle({ type: 'cancelTurn' })
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('failed')
    expect(end?.quota).toEqual({ limitKind: 'tierLimit', resetsAtMs: QUOTA_RESETS_AT_MS })
    expect(rig.live.wire.sentCount('turn/start')).toBe(1)
    const row = shownTranscript(rig.panel).find((entry) => entry.kind === 'error')
    expect(row?.text).toBe(quotaTurnFailureText({ quota: { resetsAtMs: QUOTA_RESETS_AT_MS } }))
    rig.releaseSleep()
  })

  it('shows the failure when the opt-in turns off mid-wait', async () => {
    let isOn = true
    const minuteMs = 60 * MILLISECONDS_PER_SECOND
    const rig = quotaPanel(directory, {
      quotaContinue: () => isOn,
      now: () => QUOTA_RESETS_AT_MS - minuteMs,
    })
    await startFirstTurn(rig)
    rig.live.wire.release(quotaEnd(true))
    await awaitPosts(rig.panel, turnRetries, 1, 'quota waits named')
    isOn = false
    rig.releaseSleep()
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('failed')
    expect(rig.live.wire.sentCount('turn/start')).toBe(1)
    expect(turnRetries(rig.panel.posted)).toHaveLength(1)
  })
})

describe('subscription quota headless outcome', () => {
  it('types a quota turn with the reset in words', () => {
    const outcome = execQuotaOutcome(mappedQuotaTurn(true))
    expect(outcome?.kind).toBe('quota_exhausted')
    expect(outcome?.message).toBe(
      quotaTurnFailureText({ quota: { resetsAtMs: QUOTA_RESETS_AT_MS } }),
    )
    expect(outcome?.message).toContain(formatDateTime(QUOTA_RESETS_AT_MS))
    expect(outcome?.message).not.toContain('request_id')
  })

  it('answers undefined without the typed detail', () => {
    expect(execQuotaOutcome({})).toBeUndefined()
    expect(execQuotaOutcome({ quota: undefined })).toBeUndefined()
  })
})

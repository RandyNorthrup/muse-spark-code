// The live echo-turn rig the resend suites share (museCodeAutoResend,
// museCodeQuotaExhausted): the recorded echo capture's answers, the live
// session and turn ids they serve, one typed message, a gated resend
// clock, and the transcript the panel's posts reduce to. Zero model
// calls: the Model API rig answers usage reads from local files, and the
// replay wire answers every CLI call from the capture.
import type { AgentHost } from '../../../src/core/agent/agentBackend'
import type { HostToWebviewMessage } from '../../../src/shared/protocol'
import { initialUiState, uiReducer } from '../../../src/webview/state/uiState'
import { expect } from 'vitest'
import {
  awaitPosts,
  conversationPanel,
  modelApiRig,
  turnAcceptances,
  turnCompletions,
  type PanelRig,
} from './conversationPanel'
import {
  captureBroadcast,
  captureResult,
  readCapture,
  refuseUnscripted,
  startLiveHost,
  type Answer,
  type LiveHost,
} from './museReplay'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function liveString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new TypeError(`the capture serves no ${what}`)
  return value
}

const echo = readCapture(new URL('../../fixtures/m106/msp-1.4.7-echo-turn.json', import.meta.url))
const echoInit = captureResult(echo.frames, 1)
const echoModels = captureResult(echo.frames, 2)
const echoStart = captureResult(echo.frames, 3)
const echoTurnAck = captureResult(echo.frames, 4)
export const echoStarted = captureBroadcast(echo.frames, 'turn/started')
export const echoItem = captureBroadcast(echo.frames, 'item/completed')
export const echoCompleted = captureBroadcast(echo.frames, 'turn/completed')
const lifecycle = readCapture(
  new URL('../../fixtures/m106/msp-1.4.4-session-lifecycle.json', import.meta.url),
)
const effortAck = captureResult(lifecycle.frames, 4)

// The live session and turn: the ids the script's recorded answers serve.
const startSession = echoStart['session']
if (!isRecord(startSession)) throw new Error('the capture serves no session/start session')
export const LIVE_SESSION_ID = liveString(startSession, 'sessionId', 'session id')
export const LIVE_TURN_ID = liveString(echoTurnAck, 'turnId', 'turn id')

export const TYPED = 'Say the word apricot, then stop.'

/** The script's answers; the turn/start answer is overridable per suite. */
export function liveTurnScript(turnStart?: (method: string) => Answer): (method: string) => Answer {
  return (method: string): Answer => {
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
        return turnStart === undefined ? { result: echoTurnAck } : turnStart(method)
      }
      default: {
        return refuseUnscripted(method)
      }
    }
  }
}

export interface LiveTurnRig {
  readonly panel: PanelRig
  readonly live: LiveHost
  readonly waits: number[]
  readonly releaseSleep: () => void
}

/**
The wait's clock, held shut until the test releases it: the suite watches
the named wait, then lets the resend fire (or stops it). An abort (Stop,
a new turn, dispose) rejects it, as the product's own clock does.
*/
export function gatedSleep(): {
  readonly waits: number[]
  readonly resendSleep: (ms: number, signal: AbortSignal) => Promise<void>
  readonly releaseSleep: () => void
} {
  const waits: number[] = []
  const gate = Promise.withResolvers<undefined>()
  const releaseSleep = (): void => {
    gate.resolve(undefined)
  }
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
  return { waits, resendSleep, releaseSleep }
}

/** A live host over the recorded answers, for suites that juggle hosts. */
export function startEchoHost(script: (method: string) => Answer): LiveHost {
  return startLiveHost(script, undefined, {
    initializeResult: echoInit,
    startResult: echoStart,
  })
}

/** The live host and panel over the recorded answers, with the gated clock. */
export function liveTurnPanel(
  directory: string,
  options: {
    readonly modelId: string
    readonly script: (method: string) => Answer
    readonly live?: LiveHost
    readonly ensureHost?: () => Promise<AgentHost>
    readonly museCodeMaxRetries?: () => number | undefined
    readonly museCodeQuotaContinue?: () => boolean
    readonly now?: () => number
  },
): LiveTurnRig {
  const live = options.live ?? startEchoHost(options.script)
  const rig = modelApiRig(directory)
  const { waits, resendSleep, releaseSleep } = gatedSleep()
  const panel = conversationPanel({
    rig,
    directory,
    isNamespaceKnown: true,
    backend: 'museCode',
    modelId: options.modelId,
    ensureHost: options.ensureHost ?? (() => Promise.resolve(live.host)),
    ...(options.museCodeMaxRetries !== undefined && {
      museCodeMaxRetries: options.museCodeMaxRetries,
    }),
    ...(options.museCodeQuotaContinue !== undefined && {
      museCodeQuotaContinue: options.museCodeQuotaContinue,
    }),
    ...(options.now !== undefined && { now: options.now }),
    resendSleep,
    resendRandom: () => 0.5,
  })
  return { panel, live, waits, releaseSleep }
}

export async function sendAs(panel: PanelRig, localId: string): Promise<void> {
  await panel.controller.handle({
    type: 'sendMessage',
    localId,
    text: TYPED,
    attachmentIds: [],
  })
}

export async function sendFirst(panel: PanelRig): Promise<void> {
  await sendAs(panel, 'local-1')
}

/** The first send accepted with its start released, ready for the end under test. */
export async function startFirstTurn(rig: LiveTurnRig): Promise<void> {
  await sendFirst(rig.panel)
  await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
  rig.live.wire.release(echoStarted)
}

/** Lets a named wait fire and awaits the resend's acceptance. */
export async function releaseResend(rig: LiveTurnRig, accepted: number): Promise<void> {
  rig.releaseSleep()
  await awaitPosts(rig.panel, turnAcceptances, accepted, 'turns accepted')
}

/** The resent turn completes: two submits, the recorded end, completed. */
export async function expectCompletedTurn(rig: LiveTurnRig): Promise<void> {
  expect(rig.live.wire.sentCount('turn/start')).toBe(2)
  rig.live.wire.release(echoCompleted)
  const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
  expect(end?.terminal).toBe('completed')
}

export function turnRetries(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) =>
    message.type === 'agentEvent' && message.event.type === 'turnRetry' ? [message.event] : [],
  )
}

/** The transcript the panel's posted messages reduce to, through the real reducer. */
export function shownTranscript(panel: PanelRig) {
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

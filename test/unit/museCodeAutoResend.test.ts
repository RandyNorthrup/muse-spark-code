// RLF-AUTORETRY (PLAN.md D217): the Muse Code backend resends a
// retryable failed turn by itself, naming the wait ("Retrying in Ns
// (attempt K of N)") with Stop, and shows the error with Retry when the
// wait ends without resending. Driven through the same `handle` entry the
// webview uses, against the real controller, a real MuseCodeHost and its
// real session over the SDK's real Connection.
//
// Every wire byte is recorded. The session runs on the echo-turn capture
// (test/fixtures/m106/msp-1.4.7-echo-turn.json: pinned CLI 1.4.7-R6101.1,
// `serve --provider echo`, zero model calls, captured 2026-10-23 via
// `node capture-echo-turn.mjs`): its model list, session start, turn
// starts, turn/started, items and completed turn/completed. The effort
// ack is the recorded `session/setReasoningEffort` one from
// msp-1.4.4-session-lifecycle.json. The failed turn is the recorded
// `turn/completed` the CLI sent with its own `retryable: true` judgment
// (docs/certification/m91-captures/05-linux-msp-failure/turn-completed.jsonl,
// 2026-10-04, "refused by exit 2"); the cancelled one is that capture's
// recorded cancelled end. Released through the wire like any broadcast,
// they travel the SDK read loop, the host dispatch, the real schema
// mapping and the real session emit to the controller.
//
// Two substitutions, both connection-local identities the live routing
// needs (the replay harness already rewrites the commandId the same
// way): the m91 frame's sessionId/turnId become the live session's and
// turn's, with its viewCursor and stream id following. The replay serves
// the one recorded turn/start ack for every submit, so every turn here
// shares its turnId; the product mints a fresh one per submit. Failure
// content (terminal, reason, kind, the CLI's retryable judgment) is
// never touched.
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentHost, HostExit } from '../../src/core/agent/agentBackend'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import { conversationPanel, modelApiRig, type PanelRig } from './helpers/conversationPanel'
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

const echo = readCapture(new URL('../fixtures/m106/msp-1.4.7-echo-turn.json', import.meta.url))
const echoInit = captureResult(echo.frames, 1)
const echoModels = captureResult(echo.frames, 2)
const echoStart = captureResult(echo.frames, 3)
const echoTurnAck = captureResult(echo.frames, 4)
const echoStarted = captureBroadcast(echo.frames, 'turn/started')
const echoItem = captureBroadcast(echo.frames, 'item/completed')
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

// The live session and turn: the ids the script's recorded answers serve.
const startSession = echoStart['session']
if (!isRecord(startSession)) throw new Error('the capture serves no session/start session')
const LIVE_SESSION_ID = liveString(startSession, 'sessionId', 'session id')
const LIVE_TURN_ID = liveString(echoTurnAck, 'turnId', 'turn id')

// The recorded item's text, read off the frame: the row the failed
// turn's work stays as, asserted surviving below.
const echoItemParams = echoItem.params
if (!isRecord(echoItemParams?.['item'])) throw new Error('the capture serves no item')
const ITEM_TEXT = liveString(echoItemParams['item'], 'text', 'item text')

const TYPED = 'Say the word apricot, then stop.'

const m91Lines = readFileSync(
  new URL(
    '../../docs/certification/m91-captures/05-linux-msp-failure/turn-completed.jsonl',
    import.meta.url,
  ),
  'utf8',
).split('\n')
function m91Record(index: number): unknown {
  const line = m91Lines[index]
  if (line === undefined) throw new Error(`the m91 capture serves no line ${String(index)}`)
  return JSON.parse(line)
}
const m91EndSchema = z.object({
  method: z.literal('turn/completed'),
  params: z.record(z.string(), z.unknown()),
})
const m91Line = m91EndSchema.parse(m91Record(0))
const m91Cancelled = m91EndSchema.parse(m91Record(3))

/**
The recorded m91 end, addressed to the live session and turn: only the
connection-local identities move (sessionId, turnId, the cursor and
stream id naming the session). Terminal, reason, kind and the CLI's own
retryable judgment stay byte for byte.
*/
function m91End(line: typeof m91Line): WireFrame {
  const params: Record<string, unknown> = structuredClone(line.params)
  const recordedSessionId = params['sessionId']
  if (typeof recordedSessionId !== 'string') throw new TypeError('the m91 end names no session')
  params['sessionId'] = LIVE_SESSION_ID
  params['turnId'] = LIVE_TURN_ID
  const cursor = params['viewCursor']
  if (typeof cursor === 'string')
    params['viewCursor'] = cursor.replace(recordedSessionId, () => LIVE_SESSION_ID)
  const range = params['sourceRange']
  if (isRecord(range) && isRecord(range['stream'])) range['stream']['id'] = LIVE_SESSION_ID
  return { jsonrpc: '2.0', method: 'turn/completed', params }
}

function turnRetries(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) =>
    message.type === 'agentEvent' && message.event.type === 'turnRetry' ? [message.event] : [],
  )
}

function turnCompletions(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) =>
    message.type === 'agentEvent' && message.event.type === 'turnCompleted' ? [message.event] : [],
  )
}

function turnAcceptances(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) => (message.type === 'turnAccepted' ? [message] : []))
}

function sendFailures(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) => (message.type === 'sendFailed' ? [message] : []))
}

async function awaitPosts<T>(
  panel: PanelRig,
  collect: (posted: readonly HostToWebviewMessage[]) => readonly T[],
  count: number,
  what: string,
): Promise<readonly T[]> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const found = collect(panel.posted)
    if (found.length >= count) {
      return found
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    `only ${String(collect(panel.posted).length)} ${what}, wanted ${String(count)}; posted: ${JSON.stringify(panel.posted).slice(0, 2000)}`,
  )
}

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

interface ResendRig {
  readonly panel: PanelRig
  readonly live: LiveHost
  readonly waits: number[]
  readonly releaseSleep: () => void
}

function scriptFor(shouldRefuseTurnStart: boolean): (method: string) => Answer {
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
        return shouldRefuseTurnStart ? refuseUnscripted('turn/start') : { result: echoTurnAck }
      }
      default: {
        return refuseUnscripted(method)
      }
    }
  }
}

function resendPanel(
  directory: string,
  options?: {
    readonly maxRetries?: () => number | undefined
    readonly shouldRefuseTurnStart?: boolean
    readonly live?: LiveHost
    readonly ensureHost?: () => Promise<AgentHost>
  },
): ResendRig {
  const live =
    options?.live ??
    startLiveHost(scriptFor(options?.shouldRefuseTurnStart === true), {
      initializeResult: echoInit,
      startResult: echoStart,
    })
  const rig = modelApiRig(directory)
  const waits: number[] = []
  const gate = Promise.withResolvers<undefined>()
  const releaseSleep = (): void => {
    gate.resolve(undefined)
  }
  // The wait's clock, held shut until the test releases it: the suite
  // watches the named wait, then lets the resend fire (or stops it).
  // An abort (Stop, a new turn, dispose) rejects it, as the product's
  // own clock does.
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
        {
          once: true,
        },
      )
      void gate.promise.then(resolve)
    })
  }
  const panel = conversationPanel({
    rig,
    directory,
    isNamespaceKnown: true,
    backend: 'museCode',
    modelId: 'muse-wonder-1.0',
    ensureHost: options?.ensureHost ?? (() => Promise.resolve(live.host)),
    ...(options?.maxRetries !== undefined && { museCodeMaxRetries: options.maxRetries }),
    resendSleep,
    resendRandom: () => 0.5,
  })
  return { panel, live, waits, releaseSleep }
}

async function sendFirst(panel: PanelRig): Promise<void> {
  await panel.controller.handle({
    type: 'sendMessage',
    localId: 'local-1',
    text: TYPED,
    attachmentIds: [],
  })
}

describe('Muse Code automatic resend', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-autoresend-'))
  })

  afterEach(async () => {
    await closeLiveHosts()
    await removeFolder(directory)
  })

  it('retries a retryable failed turn and completes with its rows intact', async () => {
    const rig = resendPanel(directory)
    await sendFirst(rig.panel)
    await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
    rig.live.wire.release(echoStarted)
    rig.live.wire.release(echoItem)
    rig.live.wire.release(m91End(m91Line))
    const [wait] = await awaitPosts(rig.panel, turnRetries, 1, 'resend waits named')
    // The industry wait: 0.5 s doubled zero times, plus the 0.5 jitter
    // draw's 500 ms — the first of two resends.
    expect(rig.waits).toEqual([1000])
    expect(wait?.attempt).toBe(1)
    expect(wait?.maxAttempts).toBe(3)
    expect(wait?.retryDelayMs).toBe(1000)
    rig.releaseSleep()
    await awaitPosts(rig.panel, turnAcceptances, 2, 'turns accepted')
    expect(rig.live.wire.sentCount('turn/start')).toBe(2)
    rig.live.wire.release(echoCompleted)
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('completed')
    // The failed turn's work stays: its item row survives the resend.
    expect(JSON.stringify(shownTranscript(rig.panel))).toContain(ITEM_TEXT)
    expect(sendFailures(rig.panel.posted)).toHaveLength(0)
  })

  it('shows a cancelled turn once, without resending', async () => {
    const rig = resendPanel(directory)
    await sendFirst(rig.panel)
    await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
    rig.live.wire.release(echoStarted)
    rig.live.wire.release(m91End(m91Cancelled))
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('cancelled')
    expect(turnRetries(rig.panel.posted)).toHaveLength(0)
    expect(rig.waits).toHaveLength(0)
    expect(rig.live.wire.sentCount('turn/start')).toBe(1)
  })

  it('does not resend a refused submit', async () => {
    const rig = resendPanel(directory, { shouldRefuseTurnStart: true })
    await sendFirst(rig.panel)
    await awaitPosts(rig.panel, sendFailures, 1, 'sends refused')
    expect(turnRetries(rig.panel.posted)).toHaveLength(0)
    expect(rig.waits).toHaveLength(0)
    expect(rig.live.wire.sentCount('turn/start')).toBe(1)
  })

  it('stops the wait on Stop and shows the failure with Retry', async () => {
    const rig = resendPanel(directory)
    await sendFirst(rig.panel)
    await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
    rig.live.wire.release(echoStarted)
    rig.live.wire.release(m91End(m91Line))
    await awaitPosts(rig.panel, turnRetries, 1, 'resend waits named')
    await rig.panel.controller.handle({ type: 'cancelTurn' })
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('failed')
    // The held failure keeps the CLI's retryable judgment: Retry stays armed.
    expect(end?.retryable).toBe(true)
    expect(rig.live.wire.sentCount('turn/start')).toBe(1)
    rig.releaseSleep()
  })

  it('stops at the default limit: two resends, then the error', async () => {
    const rig = resendPanel(directory)
    await sendFirst(rig.panel)
    await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
    rig.live.wire.release(echoStarted)
    rig.live.wire.release(m91End(m91Line))
    await awaitPosts(rig.panel, turnRetries, 1, 'first resend waits named')
    rig.releaseSleep()
    await awaitPosts(rig.panel, turnAcceptances, 2, 'turns accepted')
    rig.live.wire.release(m91End(m91Line))
    await awaitPosts(rig.panel, turnRetries, 2, 'second resend waits named')
    rig.releaseSleep()
    await awaitPosts(rig.panel, turnAcceptances, 3, 'turns accepted')
    rig.live.wire.release(m91End(m91Line))
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('failed')
    expect(end?.retryable).toBe(true)
    expect(rig.live.wire.sentCount('turn/start')).toBe(3)
    // 0.5 s, then 1 s, each plus the suite's 500 ms jitter draw.
    expect(rig.waits).toEqual([1000, 1500])
    // No third wait: the limit spent itself on the second resend.
    expect(turnRetries(rig.panel.posted)).toHaveLength(2)
  })

  it('stops at the person-set limit, and 0 disables resending', async () => {
    let limit: number | undefined = 1
    const rig = resendPanel(directory, { maxRetries: () => limit })
    await sendFirst(rig.panel)
    await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
    rig.live.wire.release(echoStarted)
    rig.live.wire.release(m91End(m91Line))
    const [wait] = await awaitPosts(rig.panel, turnRetries, 1, 'resend waits named')
    expect(wait?.maxAttempts).toBe(2)
    rig.releaseSleep()
    await awaitPosts(rig.panel, turnAcceptances, 2, 'turns accepted')
    rig.live.wire.release(m91End(m91Line))
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('failed')
    expect(rig.live.wire.sentCount('turn/start')).toBe(2)
    expect(turnRetries(rig.panel.posted)).toHaveLength(1)

    // 0 disables: the next failure shows at once, with no wait.
    limit = 0
    await rig.panel.controller.handle({
      type: 'sendMessage',
      localId: 'local-2',
      text: TYPED,
      attachmentIds: [],
    })
    await awaitPosts(rig.panel, turnAcceptances, 3, 'turns accepted')
    rig.live.wire.release(echoStarted)
    rig.live.wire.release(m91End(m91Line))
    const [, disabled] = await awaitPosts(rig.panel, turnCompletions, 2, 'turns ended')
    expect(disabled?.terminal).toBe('failed')
    expect(turnRetries(rig.panel.posted)).toHaveLength(1)
    expect(rig.waits).toHaveLength(1)
    expect(rig.live.wire.sentCount('turn/start')).toBe(3)
  })

  it('a limit lowered to 0 mid-wait refuses the resend', async () => {
    let limit: number | undefined = 2
    const rig = resendPanel(directory, { maxRetries: () => limit })
    await sendFirst(rig.panel)
    await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
    rig.live.wire.release(echoStarted)
    rig.live.wire.release(m91End(m91Line))
    await awaitPosts(rig.panel, turnRetries, 1, 'resend waits named')
    limit = 0
    rig.releaseSleep()
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('failed')
    expect(rig.live.wire.sentCount('turn/start')).toBe(1)
  })

  it('a dead host resends on its replacement and completes', async () => {
    // The replacement host the restart serves: the resend re-establishes
    // the dropped session on it, as a send after a restart does (D25).
    const first = startLiveHost(scriptFor(false), {
      initializeResult: echoInit,
      startResult: echoStart,
    })
    const replacement = startLiveHost(scriptFor(false), {
      initializeResult: echoInit,
      startResult: echoStart,
    })
    let current: LiveHost = first
    const rig = resendPanel(directory, {
      live: first,
      ensureHost: () => Promise.resolve(current.host),
    })
    await sendFirst(rig.panel)
    await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
    rig.live.wire.release(echoStarted)
    current = replacement
    const crash: HostExit = {
      description: 'signal SIGKILL (the suite reports the host dead)',
      isExpected: false,
      isPersistent: false,
      isFailure: true,
    }
    rig.panel.controller.hostExited(crash)
    await awaitPosts(rig.panel, turnRetries, 1, 'resend waits named')
    rig.releaseSleep()
    await awaitPosts(rig.panel, turnAcceptances, 2, 'turns accepted')
    expect(rig.live.wire.sentCount('turn/start')).toBe(1)
    expect(replacement.wire.sentCount('turn/start')).toBe(1)
    replacement.wire.release(echoCompleted)
    const [end] = await awaitPosts(rig.panel, turnCompletions, 1, 'turns ended')
    expect(end?.terminal).toBe('completed')
  })
})

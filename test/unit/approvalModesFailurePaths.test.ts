// The approval-mode failure paths, proven through the real session on saved
// wire (lane PR251FIX5, PLAN.md D123, GRV251F finding 3).
//
// Every wire byte below is recorded live from the pinned Muse Code 1.4.7
// binary (`serve --provider echo`, zero model calls, 2026-10-19,
// `node temp/capture-approval-modes.mjs`), committed as
// test/fixtures/m106/msp-1.4.7-approval-modes.json: the accepted
// `session/setApprovalMode` acks (each carries `effectiveMode`, the mode the
// host runs), the `invalidParams` refusal of an unknown mode, the
// `experimentalRequired` refusal of the profile step without `experimentalApi`,
// and the `session/approvalModeChanged` each accepted command broadcasts.
// Each test drives the REAL `MuseCodeHost`/`MuseSession` over the REAL SDK
// `Connection`; the replay transport serves those recorded frames and
// substitutes only the per-connection nonces (the JSON-RPC id and the ack's
// `commandId` echo) with the live values. The tear itself is the host's own
// turn tracking: a started turn emitted through the session, the path a real
// `turn/started` notification takes through deliver/receive/emit. No turn runs
// on a model anywhere here.
//
// A refused schedule restore is not replayed: restoring needs a schedule
// admission whose grant context would be invented data (the FIX4 record), and
// the re-review confirms that hole closed.
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Connection, type DuplexTransport } from '@muse-code/sdk'
import { isModeKeptError, isPermissionReviewerError } from '../../src/core/agent/agentBackend'
import { MuseCodeHost, type MuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { stderrLogger } from '../../src/runtime/stderrLog'

const captureSchema = z.object({
  provenance: z.object({
    cli: z.string(),
    provider: z.string(),
    model: z.string(),
    modelAttempts: z.number(),
    requestAttempts: z.number(),
    captureCommand: z.string(),
  }),
  frames: z.array(
    z.object({
      direction: z.enum(['sent', 'received']),
      frame: z.object({
        jsonrpc: z.literal('2.0'),
        id: z.number().optional(),
        method: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        result: z.record(z.string(), z.unknown()).optional(),
        error: z
          .object({
            code: z.number(),
            message: z.string(),
            data: z.record(z.string(), z.unknown()),
          })
          .optional(),
      }),
    }),
  ),
})
type Capture = z.infer<typeof captureSchema>
type WireFrame = Capture['frames'][number]['frame']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const capture: Capture = captureSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../fixtures/m106/msp-1.4.7-approval-modes.json', import.meta.url),
      'utf8',
    ),
  ),
)

function receivedResult(id: number): Record<string, unknown> {
  const frame = capture.frames.find(
    (row) => row.direction === 'received' && row.frame.id === id && row.frame.result !== undefined,
  )?.frame
  if (frame?.result === undefined)
    throw new Error(`the capture serves no result for id ${String(id)}`)
  return frame.result
}

function receivedError(id: number): {
  code: number
  message: string
  data: Record<string, unknown>
} {
  const frame = capture.frames.find(
    (row) => row.direction === 'received' && row.frame.id === id && row.frame.error !== undefined,
  )?.frame
  if (frame?.error === undefined)
    throw new Error(`the capture serves no refusal for id ${String(id)}`)
  return frame.error
}

/** The recorded broadcast for an accepted mode command, by the mode it names. */
function modeChangedNotify(mode: string): WireFrame {
  const frame = capture.frames.find(
    (row) =>
      row.direction === 'received' &&
      row.frame.method === 'session/approvalModeChanged' &&
      isRecord(row.frame.params) &&
      row.frame.params['mode'] === mode,
  )?.frame
  if (frame === undefined) throw new Error(`the capture serves no approvalModeChanged for ${mode}`)
  return frame
}

const initializeResult = receivedResult(1)
const modelListResult = receivedResult(2)
const startResult = receivedResult(3)
const ackManual = receivedResult(4)
const ackAuto = receivedResult(6)
const modeRefusal = receivedError(7)
const profileRefusal = receivedError(8)
// The saved ack names the mode the host runs; the test tears that adoption.

type Answer = { result: unknown } | { error: unknown }

/**
 * The SDK's transport fed with the recording: answers come from the script
 * the test installs (recorded content, gated on the test's releases), while
 * notifications are released verbatim by the test. Methods without a scripted
 * answer are refused loudly instead of invented.
 */
class ReplayWire {
  private readonly inbox: string[] = []
  private readonly waiters: ((value: string | null) => void)[] = []
  private ended = false
  private readonly sentMethods: string[] = []
  public answer: (method: string, params: Record<string, unknown>) => Answer | Promise<Answer> =
    () => Promise.reject(new Error('the replay script is not installed'))

  private push(line: unknown): void {
    const text = `${JSON.stringify(line)}\n`
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.inbox.push(text)
    else waiter(text)
  }

  public transport(): DuplexTransport {
    return {
      incoming: {
        [Symbol.asyncIterator]: () => ({
          next: async (): Promise<IteratorResult<string>> => {
            const head = this.inbox.shift()
            if (head !== undefined) return { done: false, value: head }
            if (this.ended) return { done: true, value: '' }
            const value = await new Promise<string | null>((resolve) => {
              this.waiters.push(resolve)
            })
            return value === null ? { done: true, value: '' } : { done: false, value }
          },
        }),
      },
      write: (chunk: string): Promise<void> => {
        const sent: unknown = JSON.parse(chunk)
        if (!isRecord(sent) || typeof sent['id'] !== 'number' || typeof sent['method'] !== 'string')
          return Promise.resolve()
        const id = sent['id']
        const method = sent['method']
        const params = isRecord(sent['params']) ? sent['params'] : {}
        this.sentMethods.push(method)
        // Never hold the submission tail: invoking the script runs it
        // without blocking later writes (an async script suspends at its
        // gate; a sync one answers at once). A script that throws for an
        // unscripted method becomes the same loud refusal, never a dead write.
        let pending: Answer | Promise<Answer>
        try {
          pending = this.answer(method, params)
        } catch (error: unknown) {
          pending = Promise.reject(error instanceof Error ? error : new Error(String(error)))
        }
        void Promise.resolve(pending)
          .then((reply) => {
            if ('error' in reply) {
              this.push({ jsonrpc: '2.0', id, error: reply.error })
              return
            }
            const result = isRecord(reply.result) ? { ...reply.result } : reply.result
            // Per-connection nonces: the live id and commandId echo. Every
            // other byte stays the recorded one.
            if (
              isRecord(result) &&
              result['commandId'] !== undefined &&
              typeof params['commandId'] === 'string'
            )
              result['commandId'] = params['commandId']
            this.push({ jsonrpc: '2.0', id, result })
          })
          .catch((error: unknown) => {
            this.push({
              jsonrpc: '2.0',
              id,
              error: {
                code: -1,
                message: `no scripted answer for ${method} (replay harness): ${error instanceof Error ? error.message : String(error)}`,
                data: { kind: 'harnessGap' },
              },
            })
          })
        return Promise.resolve()
      },
    }
  }

  /** A recorded broadcast, verbatim, as the SDK's read loop will ingest it. */
  public release(frame: WireFrame): void {
    this.push(frame)
  }

  public sentCount(method: string): number {
    return this.sentMethods.filter((sent) => sent === method).length
  }

  public finish(): void {
    this.ended = true
    let waiter = this.waiters.shift()
    while (waiter !== undefined) {
      waiter(null)
      waiter = this.waiters.shift()
    }
  }
}

interface LiveSession {
  readonly host: MuseCodeHost
  readonly session: MuseSession
  readonly wire: ReplayWire
}

const liveHosts: MuseCodeHost[] = []
afterEach(async () => {
  for (const host of liveHosts.splice(0)) await host.close()
})

async function liveSession(
  answer: (method: string, params: Record<string, unknown>) => Answer | Promise<Answer>,
): Promise<LiveSession> {
  const wire = new ReplayWire()
  wire.answer = answer
  const connection = new Connection(wire.transport())
  const host = new MuseCodeHost(
    {
      connection,
      initializeResult,
      exited: Promise.withResolvers<{ code: number | null; signal: string | null }>().promise,
      close: async () => {
        wire.finish()
        await connection.close()
      },
    },
    stderrLogger(() => undefined, 'warn'),
  )
  liveHosts.push(host)
  const session = await host.startSession({
    workspaceRoot: '<capture-workspace>',
    modelId: capture.provenance.model,
    approvalMode: 'onRequest',
  })
  return { host, session, wire }
}

/** The request the session just sent, so the test can interleave the tear. */
async function waitForSent(wire: ReplayWire, method: string, count: number): Promise<void> {
  const deadline = Date.now() + 5000
  while (wire.sentCount(method) < count) {
    if (Date.now() > deadline) throw new Error(`replay harness: ${method} was never sent`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error: unknown) {
    return error
  }
  return undefined
}

function sessionIdOf(frame: WireFrame): unknown {
  return isRecord(frame.params) ? frame.params['sessionId'] : undefined
}

describe('approval-mode failure paths tell the truth on saved wire (GRV251F)', () => {
  beforeAll(async () => {
    // Warm the deferred mode-sync entry the session loads on the first change.
    await import('../../src/core/backends/musecode/approvalModesEntry')
  })

  it('the capture serves the ack, refusals and mode notice the failures replay', () => {
    // The recording's identity: the pinned 1.4.7 host, no model turn. Every
    // behavior below parses these frames; a re-capture that changes them
    // fails here with the diff, not deep in a behavior.
    expect(capture.provenance.cli).toBe('1.4.7-R6101.1')
    expect(capture.provenance.modelAttempts).toBe(0)
    expect(capture.provenance.captureCommand).toBe('node temp/capture-approval-modes.mjs')
    // Each saved ack names the mode the host runs.
    expect(ackManual['effectiveMode']).toMatchObject({ mode: 'promptUnmatched' })
    expect(ackAuto['effectiveMode']).toMatchObject({ mode: 'onRequest' })
    expect(modeRefusal).toMatchObject({
      code: -32_602,
      message: 'Invalid params: session/setApprovalMode params',
    })
    expect(modeRefusal.data['kind']).toBe('invalidParams')
    expect(profileRefusal).toMatchObject({
      code: -32_601,
      message: 'session/setPermissionProfile requires experimentalApi capability',
    })
    expect(profileRefusal.data['kind']).toBe('experimentalRequired')
  })

  it('a torn rollback keeps its sentence across its mode notice; the next send repeats it', async () => {
    const { promise: rollbackGate, resolve: releaseRollback } = Promise.withResolvers<Answer>()
    const { host, session, wire } = await liveSession(async (method, params) => {
      if (method === 'session/start') return { result: startResult }
      if (method === 'model/list') return { result: modelListResult }
      // The forward change applies; the profile step is refused, so the
      // previous mode is put back; the rollback ack tears.
      if (method === 'session/setApprovalMode' && params['mode'] === 'promptUnmatched')
        return { result: ackManual }
      if (method === 'session/setPermissionProfile') return { error: profileRefusal }
      if (method === 'session/setApprovalMode') return await rollbackGate
      throw new Error(`unexpected ${method}`)
    })
    const changing = session.setApprovalMode('promptUnmatched')
    // The rollback command is in flight: a turn starts before its ack lands.
    await waitForSent(wire, 'session/setApprovalMode', 2)
    session.emit({ type: 'turnStarted', turnId: 'turn-1' })
    releaseRollback({ result: ackAuto })
    const thrown = await caught(changing)
    expect(isPermissionReviewerError(thrown)).toBe(true)
    if (!isPermissionReviewerError(thrown)) expect.unreachable('a torn rollback must quarantine')
    const torn = fill(UI_TEXT.permissionReviewerRollbackTorn, { mode: 'onRequest' })
    expect(thrown.actualMode).toBe('onRequest')
    expect(thrown.message).toBe(torn)
    // The recorded broadcast for the accepted rollback arrives after the
    // quarantine is recorded (the u16 interleaving): it names the mode the
    // quarantine already recorded, so the sentence stays.
    const notice = modeChangedNotify('onRequest')
    expect(sessionIdOf(notice)).toBe(session.sessionId)
    wire.release(notice)
    // The SDK ingests the stream in order: once a later command answers, the
    // notice ahead of it was dispatched through the real path.
    await host.listModels()
    const refused = await caught(session.sendTurn([{ type: 'text', text: 'ping' }]))
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toBe(torn)
    expect((refused as Error).message).not.toBe(UI_TEXT.permissionReviewerMissing)
    // A genuinely different mode still drops the sentence: the later refusal
    // falls back to the generic words.
    wire.release(modeChangedNotify('denyUnmatched'))
    await host.listModels()
    const generic = await caught(session.sendTurn([{ type: 'text', text: 'ping' }]))
    expect((generic as Error).message).toBe(UI_TEXT.permissionReviewerMissing)
  })

  it('a torn forward change says the named mode runs without its reviewer', async () => {
    const { promise: ackGate, resolve: releaseAck } = Promise.withResolvers<Answer>()
    const { session, wire } = await liveSession(async (method, params) => {
      if (method === 'session/start') return { result: startResult }
      if (method === 'session/setApprovalMode' && params['mode'] === 'promptUnmatched')
        return await ackGate
      throw new Error(`unexpected ${method}`)
    })
    const changing = session.setApprovalMode('promptUnmatched')
    await waitForSent(wire, 'session/setApprovalMode', 1)
    session.emit({ type: 'turnStarted', turnId: 'turn-1' })
    releaseAck({ result: ackManual })
    const thrown = await caught(changing)
    expect(isPermissionReviewerError(thrown)).toBe(true)
    if (!isPermissionReviewerError(thrown)) expect.unreachable('a torn change must quarantine')
    expect(thrown.actualMode).toBe('promptUnmatched')
    expect(thrown.message).toBe(
      fill(UI_TEXT.permissionReviewerNotInstalled, {
        reason: UI_TEXT.permissionReviewerTornReason,
      }),
    )
    // The later refusal repeats the quarantine's sentence, not the generic one.
    const refused = await caught(session.sendTurn([{ type: 'text', text: 'ping' }]))
    expect((refused as Error).message).toBe(thrown.message)
  })

  it('a tear on Plan says the mode is in effect but unconfirmed, never a reviewer', async () => {
    const { promise: ackGate, resolve: releaseAck } = Promise.withResolvers<Answer>()
    const { session, wire } = await liveSession(async (method, params) => {
      if (method === 'session/start') return { result: startResult }
      if (method === 'session/setApprovalMode' && params['mode'] === 'denyUnmatched')
        return await ackGate
      throw new Error(`unexpected ${method}`)
    })
    const changing = session.setApprovalMode('denyUnmatched')
    await waitForSent(wire, 'session/setApprovalMode', 1)
    session.emit({ type: 'turnStarted', turnId: 'turn-1' })
    releaseAck({ result: receivedResult(5) })
    const thrown = await caught(changing)
    expect(isPermissionReviewerError(thrown)).toBe(true)
    if (!isPermissionReviewerError(thrown)) expect.unreachable('a torn change must quarantine')
    // Plan installs no reviewer, so the tear must not claim one failed.
    expect(thrown.actualMode).toBe('denyUnmatched')
    expect(thrown.message).toBe(
      fill(UI_TEXT.permissionModeTornUnconfirmed, { mode: 'denyUnmatched' }),
    )
    expect(thrown.message).not.toContain('reviewer')
    const refused = await caught(session.sendTurn([{ type: 'text', text: 'ping' }]))
    expect((refused as Error).message).toBe(thrown.message)
  })

  it('refused changes name the kept mode and keep turns live', async () => {
    const { session } = await liveSession((method, params) => {
      if (method === 'session/start') return { result: startResult }
      // An unknown mode never changes the host.
      if (method === 'session/setApprovalMode' && params['mode'] === 'not-a-mode-the-host-knows')
        return { error: modeRefusal }
      // The profile step is refused, and the rollback applies cleanly.
      if (method === 'session/setApprovalMode' && params['mode'] === 'promptUnmatched')
        return { result: ackManual }
      if (method === 'session/setPermissionProfile') return { error: profileRefusal }
      if (method === 'session/setApprovalMode') return { result: ackAuto }
      throw new Error(`unexpected ${method}`)
    })
    const refusedChange = await caught(session.setApprovalMode('not-a-mode-the-host-knows'))
    expect(isModeKeptError(refusedChange)).toBe(true)
    if (!isModeKeptError(refusedChange)) expect.unreachable('a refused change must keep the mode')
    expect(refusedChange.actualMode).toBe('onRequest')
    expect(refusedChange.message).toBe(
      fill(UI_TEXT.permissionModeKept, { reason: modeRefusal.message }),
    )
    const rolledBack = await caught(session.setApprovalMode('promptUnmatched'))
    expect(isModeKeptError(rolledBack)).toBe(true)
    if (!isModeKeptError(rolledBack)) expect.unreachable('a clean rollback must keep the mode')
    expect(rolledBack.actualMode).toBe('onRequest')
    // Turns stay live: the send reaches the wire instead of the quarantine.
    // No turn frame was recorded, so the harness refuses loudly; the point is
    // which refusal arrives — the wire's, never the quarantine's.
    const live = await caught(session.sendTurn([{ type: 'text', text: 'ping' }]))
    if (!(live instanceof Error)) expect.unreachable('the send must refuse at the wire')
    expect(live.message).toContain('no scripted answer for turn/start')
    expect(live.message).not.toContain('refused')
  })
})

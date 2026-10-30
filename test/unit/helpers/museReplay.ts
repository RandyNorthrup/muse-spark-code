// A real MuseCodeHost/MuseSession over the SDK's real Connection, fed by the
// recorded 1.4.7 capture (test/fixtures/m106/msp-1.4.7-approval-modes.json:
// pinned CLI 1.4.7-R6101.1, `serve --provider echo`, zero model calls,
// captured 2026-10-19 via `node temp/capture-approval-modes.mjs`). The
// script answers served methods with recorded frames; any other method is
// refused loudly by the harness, never invented. A refusal message may name
// a `/secret/path` marker: the tests assert the log carries the failure's
// kind, never that message.
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { Connection, type DuplexTransport } from '@muse-code/sdk'
import type { CoreLogger } from '../../../src/core/logging'
import {
  MuseCodeHost,
  type MuseCodeFeaturePorts,
  type MuseSession,
} from '../../../src/core/backends/musecode/MuseCodeHost'
import { stderrLogger } from '../../../src/runtime/stderrLog'
import { captureFrameRow } from './wireCapture'

const captureSchema = z.object({
  provenance: z.object({
    cli: z.string(),
    model: z.string(),
  }),
  frames: z.array(captureFrameRow),
})
type Capture = z.infer<typeof captureSchema>

const capture: Capture = captureSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/m106/msp-1.4.7-approval-modes.json', import.meta.url),
      'utf8',
    ),
  ),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The recorded result the CLI sent for a received id. */
export function recordedResult(id: number): Record<string, unknown> {
  const frame = capture.frames.find(
    (row) => row.direction === 'received' && row.frame.id === id && row.frame.result !== undefined,
  )?.frame
  if (frame?.result === undefined || !isRecord(frame.result))
    throw new Error(`the capture serves no result for id ${String(id)}`)
  return frame.result
}

export const initializeResult = recordedResult(1)
export const startResult = recordedResult(3)

/** One recorded wire frame, as the SDK's read loop ingests it. */
export type WireFrame = z.infer<typeof captureFrameRow>['frame']

export type Answer = { result: unknown } | { error: unknown }

/** The harness's loud refusal: the CLI refused, in the recorded envelope shape. */
export function refuseUnscripted(method: string): Answer {
  return {
    error: {
      code: -1,
      data: { kind: 'harnessGap', retryable: false },
      message: `no scripted answer for ${method} at /secret/path (replay harness)`,
    },
  }
}

/**
The SDK's transport fed with the recording: answers come from the script
the test installs (recorded content, gated on the test's releases), while
notifications are released verbatim by the test. Methods without a scripted
answer are refused loudly instead of invented.
*/
export class ReplayWire {
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

export interface LiveHost {
  readonly host: MuseCodeHost
  readonly wire: ReplayWire
}

const liveHosts: { host: MuseCodeHost; finish: () => void }[] = []

/** Closes every host this file started; call from afterEach. */
export async function closeLiveHosts(): Promise<void> {
  for (const live of liveHosts.splice(0)) {
    live.finish()
    await live.host.close()
  }
}

/** A real host over the replay wire, with a scripted capture instead of the pinned one. */
export interface LiveHostOptions {
  readonly initializeResult?: unknown
  readonly log?: CoreLogger
}

/**
A real host over the replay wire; the script answers every method the test
needs. Defaults serve the pinned capture to the stderr log; a suite with
its own capture passes both, and the shared registry still closes them.
*/
export function startLiveHost(
  answer: (method: string, params: Record<string, unknown>) => Answer | Promise<Answer>,
  features?: MuseCodeFeaturePorts,
  options?: LiveHostOptions,
): LiveHost {
  const wire = new ReplayWire()
  wire.answer = answer
  const connection = new Connection(wire.transport())
  const host = new MuseCodeHost(
    {
      connection,
      initializeResult: options?.initializeResult ?? initializeResult,
      exited: Promise.withResolvers<{ code: number | null; signal: string | null }>().promise,
      close: async () => {
        wire.finish()
        await connection.close()
      },
    },
    options?.log ?? stderrLogger(() => undefined, 'warn'),
    undefined,
    features,
  )
  liveHosts.push({
    host,
    finish: () => {
      wire.finish()
    },
  })
  return { host, wire }
}

export interface LiveSession extends LiveHost {
  readonly session: MuseSession
}

/** A real host plus its real started session; `session/start` serves the recorded frame. */
export async function startLiveSession(
  answer: (method: string, params: Record<string, unknown>) => Answer | Promise<Answer>,
  features?: MuseCodeFeaturePorts,
): Promise<LiveSession> {
  const live = startLiveHost(
    (method, params) =>
      method === 'session/start' ? { result: startResult } : answer(method, params),
    features,
  )
  const session = await live.host.startSession({
    workspaceRoot: '<capture-workspace>',
    modelId: capture.provenance.model,
    approvalMode: 'onRequest',
  })
  return { ...live, session }
}

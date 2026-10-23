// Lane J: the verified-path hold broker. The holder is a long-lived native
// process that keeps blob fds open; this runner starts it, waits for its
// ready line, pings it, and stops it. A hold that never becomes ready is
// refused, never retried here: respawn policy belongs to the session layer.
import * as z from 'zod/mini'
import type { ResourcePipedProcess, ResourceProcessOptions } from '../../resources/launch'
import {
  JUDGE_FAST_B1_PROTOCOL_MAX_BYTES,
  JUDGE_FAST_BLOBHOLD_TIMEOUT_MS,
} from '../../../shared/constants'

const readySchema = z.strictObject({
  ready: z.literal(true),
  blobs: z.number().check(z.int(), z.minimum(0)),
})

export type BlobHoldRefusal = 'readyTimeout' | 'blobCount' | 'protocol' | 'exited'
export interface BlobHoldExit {
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
}
export interface BlobHold {
  readonly blobs: number
  readonly pid: number | undefined
  readonly exited: Promise<BlobHoldExit>
  /** False when the holder is gone or stops answering; a missed pong latches the hold broken. */
  ping(): Promise<boolean>
  stop(): Promise<BlobHoldExit>
}
export type BlobHoldResult =
  | { readonly kind: 'held'; readonly hold: BlobHold }
  | { readonly kind: 'refused'; readonly reason: BlobHoldRefusal }
export interface BlobHoldOptions {
  readonly cwd: string
  readonly env: ResourceProcessOptions['env']
  readonly signal?: AbortSignal | undefined
  readonly timeoutMs?: number | undefined
}
/** F1b supplies the governed launcher; there is no ambient spawn fallback. */
export type BlobHoldStart = (
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
) => Promise<ResourcePipedProcess>

function parseReady(line: string): number | undefined {
  if (Buffer.byteLength(line) > JUDGE_FAST_B1_PROTOCOL_MAX_BYTES) return undefined
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error: unknown) {
    // JSON.parse throws only SyntaxError for text input: a malformed
    // protocol line decodes to nothing, and anything else surfaces.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const ready = readySchema.safeParse(value)
  return ready.success ? ready.data.blobs : undefined
}

type Timed<T> = { readonly kind: 'value'; readonly value: T } | { readonly kind: 'timeout' }

async function timed<T>(promise: Promise<T>, ms: number): Promise<Timed<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<Timed<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'timeout' })
    }, ms)
  })
  const valueOf = async (): Promise<Timed<T>> => ({ kind: 'value', value: await promise })
  try {
    return await Promise.race([valueOf(), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Newline-delimited protocol lines; undefined once the holder's stdout ends. */
class LineReader {
  private buffer = ''
  private readonly waiters: ((line: string | undefined) => void)[] = []
  private ended = false

  private take(): string | undefined {
    const at = this.buffer.indexOf('\n')
    if (at === -1) return undefined
    const line = this.buffer.slice(0, at)
    this.buffer = this.buffer.slice(at + 1)
    return line
  }

  private drain(): void {
    while (this.waiters.length > 0) {
      const line = this.take()
      if (line === undefined && !this.ended) return
      const waiter = this.waiters.shift()
      waiter?.(line)
    }
  }

  push(chunk: string): void {
    this.buffer += chunk
    this.drain()
  }

  end(): void {
    this.ended = true
    this.drain()
  }

  next(): Promise<string | undefined> {
    const line = this.take()
    if (line !== undefined || this.ended) return Promise.resolve(line)
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }
}

class Runner implements BlobHold {
  private readonly lines = new LineReader()
  private exit: BlobHoldExit | undefined
  private broken = false
  readonly exited: Promise<BlobHoldExit>

  constructor(
    readonly blobs: number,
    readonly pid: number | undefined,
    private readonly launched: ResourcePipedProcess,
    private readonly timeoutMs: number,
  ) {
    const child = launched.child
    child.stdout.on('data', (chunk: Buffer) => {
      this.lines.push(chunk.toString())
    })
    // The holder is silent on stderr, but a full pipe must never block it.
    child.stderr.resume()
    child.on('error', () => {
      this.lines.end()
    })
    this.exited = new Promise((resolve) => {
      // 'close' fires after the last stdio flush, so every protocol line
      // the holder wrote is already in the reader when the exit lands.
      child.on('close', (exitCode, signalCode) => {
        this.exit = { exitCode, signalCode }
        this.lines.end()
        resolve(this.exit)
      })
    })
  }

  /** The holder's first stdout line, or undefined when it exits first. */
  waitReady(): Promise<string | undefined> {
    return this.lines.next()
  }

  async ping(): Promise<boolean> {
    if (this.exit !== undefined || this.broken) return false
    const stdin = this.launched.child.stdin
    if (stdin.destroyed) return false
    stdin.write('ping\n')
    const raced = await timed(this.lines.next(), this.timeoutMs)
    // A holder that misses its pong is broken: a late pong must never
    // answer a later ping, so further pings stay false until stop.
    if (raced.kind === 'timeout' || raced.value !== 'pong') this.broken = true
    return !this.broken
  }

  async stop(): Promise<BlobHoldExit> {
    if (this.exit !== undefined) return this.exit
    const stdin = this.launched.child.stdin
    if (!stdin.destroyed) stdin.write('stop\n')
    const raced = await timed(this.exited, this.timeoutMs)
    if (raced.kind === 'value') return raced.value
    try {
      await this.launched.stop()
    } catch (error: unknown) {
      // The governed stop failed after the drain expired: SIGKILL is the
      // only move left (it reports false on an already-dead process, never
      // throws), the real exit is still awaited, and the stop failure
      // propagates instead of a faked clean shutdown.
      this.launched.child.kill('SIGKILL')
      await this.exited
      throw error
    }
    return await this.exited
  }
}

/**
Starts a blob hold. A launcher failure (a refused admission, a cancelled
start) propagates unchanged: the runner never editorialises a failure
whose vocabulary belongs to the launcher F1b chose. A throwIfAborted on
the caller's signal reports a cancelled handshake as cancellation, never
as a holder refusal.
*/
export async function startBlobHold(
  helper: string,
  blobs: readonly string[],
  start: BlobHoldStart,
  options: BlobHoldOptions,
): Promise<BlobHoldResult> {
  const timeoutMs = options.timeoutMs ?? JUDGE_FAST_BLOBHOLD_TIMEOUT_MS
  const launched = await start(helper, blobs, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
  })
  const refuse = (reason: BlobHoldRefusal): BlobHoldResult => {
    options.signal?.throwIfAborted()
    return { kind: 'refused', reason }
  }
  const runner = new Runner(blobs.length, await launched.pid(), launched, timeoutMs)
  const raced = await timed(runner.waitReady(), timeoutMs)
  if (raced.kind === 'timeout') {
    await runner.stop()
    return refuse('readyTimeout')
  }
  // An exit before the ready line ends the reader with no line.
  if (raced.value === undefined) {
    await runner.stop()
    return refuse('exited')
  }
  const held = parseReady(raced.value)
  if (held === undefined) {
    await runner.stop()
    return refuse('protocol')
  }
  if (held !== blobs.length) {
    await runner.stop()
    return refuse('blobCount')
  }
  return { kind: 'held', hold: runner }
}

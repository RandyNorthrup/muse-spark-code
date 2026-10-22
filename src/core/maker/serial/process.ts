import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import * as z from 'zod/mini'
import type { TreeRoot } from '../../../host/processTree'
import type { MakerStartGuard } from '../ports'

export interface SerialCommand {
  readonly file: string
  readonly args: readonly string[]
  readonly readyWord?: 'serial-ready' | 'lease-ready' | 'pipe-ready'
  readonly writable: boolean
}

export interface SerialProcessDependencies {
  readonly platform: NodeJS.Platform
  /** Host supplies its sanitized environment, never a model key. */
  readonly env: NodeJS.ProcessEnv
  readonly durationMs: number
  readonly readyTimeoutMs: number
  readonly stopGraceMs: number
  readonly maxBytes: number
  readonly maxStatusBytes: number
  readonly kill: (root: TreeRoot, startedAt: number) => Promise<void>
  readonly sweep: (pid: number | undefined, startedAt: number, diedAt: number) => Promise<void>
}

export interface SerialCapture {
  readonly bytes: Buffer
  readonly reason: 'ended' | 'duration' | 'limit' | 'stopped' | 'failed'
}

export interface SerialProcess {
  readonly pid: number | undefined
  readonly result: Promise<SerialCapture>
  readonly write: (bytes: Uint8Array) => Promise<void>
  readonly close: () => Promise<void>
}

const statusSchema = z.enum([
  'serial-ready',
  'lease-ready',
  'pipe-ready',
  'serial-unavailable',
  'serial-busy',
])

/** Start only after the engine's approval. stdin stays open for Arduino monitor. */
export async function startSerialProcess(
  command: SerialCommand,
  deps: SerialProcessDependencies,
  signal?: AbortSignal,
  beforeSpawn?: MakerStartGuard,
): Promise<SerialProcess> {
  if (signal?.aborted === true) throw new Error('serial-open-stopped')
  if (
    [
      deps.durationMs,
      deps.readyTimeoutMs,
      deps.stopGraceMs,
      deps.maxBytes,
      deps.maxStatusBytes,
    ].some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new Error('serial-process-limits-invalid')
  }
  const startedAt = Date.now()
  const file = command.file
  const args = [...command.args]
  const options = {
    env: deps.env,
    windowsHide: true,
    detached: deps.platform !== 'win32',
    stdio: 'pipe',
  } as const
  const start = await beforeSpawn?.()
  signal?.throwIfAborted()
  // No await or transport preparation may follow this guard before spawn.
  start?.()
  const child = spawn(file, args, options)
  let hasClosed = false
  let swept: Promise<void> | undefined
  child.once('exit', () => {
    // Descendants can hold the pipes open after their parent exits.
    swept = deps.sweep(child.pid, startedAt, Date.now())
  })
  let reason: SerialCapture['reason'] = 'ended'
  let closing: Promise<void> | undefined
  const close = (nextReason: SerialCapture['reason']) => {
    if (hasClosed) return Promise.resolve()
    if (closing !== undefined) return closing
    reason = nextReason
    closing = new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => {
        void deps.kill(child, startedAt).then(resolve).catch(reject)
      }, deps.stopGraceMs)
      child.once('close', () => {
        clearTimeout(force)
        resolve()
      })
      // Lets the native helper release TIOCEXCL and restore its own resources.
      child.stdin.end()
    })
    return closing
  }
  const chunks: Buffer[] = []
  let length = 0
  let written = 0
  let status = ''
  let onAbort: (() => void) | undefined
  const timer = setTimeout(() => {
    void close('duration')
  }, deps.durationMs)
  child.stdout.on('data', (raw: Buffer) => {
    const bytes = z.instanceof(Buffer).parse(raw)
    const remaining = deps.maxBytes - length
    chunks.push(Buffer.from(bytes.subarray(0, remaining)))
    length += Math.min(bytes.length, remaining)
    if (length >= deps.maxBytes) void close('limit')
  })
  // Resolvers stay in the executor, compatible with Node 20 hosts.
  const readiness = new Promise<void>((resolve, reject) => {
    const readyTimer = setTimeout(() => {
      reject(new Error('serial-helper-ready-timeout'))
      void close('failed')
    }, deps.readyTimeoutMs)
    const fail = (code: string, nextReason: SerialCapture['reason'] = 'failed') => {
      clearTimeout(readyTimer)
      reject(new Error(code))
      void close(nextReason).catch(() => {
        reason = 'failed'
      })
    }
    child.once('error', () => {
      fail('serial-helper-start-failed')
    })
    onAbort = () => {
      fail('serial-open-stopped', 'stopped')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) onAbort()
    child.once('close', () => {
      clearTimeout(readyTimer)
      reject(new Error('serial-helper-ended-before-ready'))
    })
    child.once('spawn', () => {
      if (command.readyWord !== undefined) {
        return
      }

      clearTimeout(readyTimer)
      resolve()
    })
    child.stderr.on('data', (bytes: Buffer) => {
      if (command.readyWord === undefined) return // Platform prose never reaches logs.
      status += bytes.toString('utf8')
      if (Buffer.byteLength(status) > deps.maxStatusBytes) {
        fail('serial-helper-status-oversize')
        return
      }
      const lines = status.split('\n')
      status = lines.pop() ?? ''
      let hasReadyWord = false
      for (const line of lines) {
        const parsed = statusSchema.safeParse(line.trim())
        if (!parsed.success || parsed.data === 'serial-unavailable') {
          fail('serial-helper-unavailable')
          return
        }
        if (parsed.data === 'serial-busy') {
          fail('serial-helper-busy')
          return
        }
        if (parsed.data === command.readyWord) hasReadyWord = true
      }
      if (!hasReadyWord) {
        return
      }

      clearTimeout(readyTimer)
      resolve()
    })
  })
  child.stdin.on('error', () => {
    void close('failed')
  })
  const result = new Promise<SerialCapture>((resolve, reject) => {
    child.once('close', (code) => {
      hasClosed = true
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      if (reason === 'ended' && code !== 0) reason = 'failed'
      // Spawn failures have no exit event; normal exits already swept above.
      void (swept ?? Promise.resolve())
        .then(() => {
          resolve({ bytes: Buffer.concat(chunks, length), reason })
        })
        .catch(reject)
    })
  })
  try {
    await readiness
  } catch (error: unknown) {
    try {
      await close('failed')
    } finally {
      await result
    }
    throw error
  }
  return {
    pid: child.pid,
    result,
    write: async (bytes) => {
      if (!command.writable) throw new Error('serial-monitor-read-only')
      if (closing !== undefined || child.exitCode !== null || child.signalCode !== null)
        throw new Error('serial-process-closed')
      if (written + bytes.length > deps.maxBytes) throw new Error('serial-write-oversize')
      written += bytes.length
      await writeBytes(child, bytes)
    },
    close: async () => {
      await close('stopped')
      await result
    },
  }
}

function writeBytes(child: ChildProcessWithoutNullStreams, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    child.stdin.write(bytes, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(new Error('serial-write-failed'))
    })
  })
}

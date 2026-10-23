import { spawn } from 'node:child_process'
import * as z from 'zod/mini'
import type { SerialProcessDependencies } from './process'

const PIPE_PREFIX = String.raw`\\.\pipe` + '\\'

export interface NativeLeaseHelper {
  readonly file: string
  /** POSIX: ['-I', shippedSerialPy]; Windows: []. */
  readonly prefix: readonly string[]
  readonly process: Pick<
    SerialProcessDependencies,
    'env' | 'platform' | 'readyTimeoutMs' | 'maxStatusBytes' | 'kill'
  >
}

/** Kernel mutex persists until stdin closes; it has no serial-read deadline. */
export async function withNativeLeaseMutex<T>(
  helper: NativeLeaseHelper,
  file: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const handle = await startLeaseHelper(helper, ['mutex', file], 'lease-ready')
  const listening = new AbortController()
  try {
    handle.signal.throwIfAborted()
    const lost = new Promise<never>((_resolve, reject) => {
      handle.signal.addEventListener(
        'abort',
        () => {
          reject(new Error('lease-helper-unavailable'))
        },
        {
          once: true,
          signal: listening.signal,
        },
      )
    })
    const result = await Promise.race([operation(handle.signal), lost])
    handle.signal.throwIfAborted()
    return result
  } finally {
    listening.abort()
    await handle.close()
  }
}

/** C# creates the pipe with an explicit current-user DACL. */
export async function listenNativeOwnerPipe(
  helper: NativeLeaseHelper,
  endpoint: string,
  id: string,
  stop: () => Promise<void>,
): Promise<() => Promise<void>> {
  if (helper.process.platform !== 'win32' || !endpoint.startsWith(PIPE_PREFIX))
    throw new Error('lease-pipe-invalid')
  const handle = await startLeaseHelper(
    helper,
    [
      'pipe',
      endpoint.slice(PIPE_PREFIX.length),
      id,
      String(helper.process.readyTimeoutMs),
      String(helper.process.maxStatusBytes),
    ],
    'pipe-ready',
    stop,
  )
  return handle.close
}

async function startLeaseHelper(
  helper: NativeLeaseHelper,
  args: readonly string[],
  readyWord: string,
  stop?: () => Promise<void>,
): Promise<{ close: () => Promise<void>; signal: AbortSignal }> {
  const startedAt = Date.now()
  const child = spawn(helper.file, [...helper.prefix, ...args], {
    env: helper.process.env,
    stdio: 'pipe',
    windowsHide: true,
    detached: helper.process.platform !== 'win32',
  })
  let isReady = false
  let stderr = ''
  let stdout = ''
  let isClosing = false
  const lifetime = new AbortController()
  const pendingStops = new Map<string, Promise<void>>()
  const invalidate = () => {
    lifetime.abort(new Error('lease-helper-unavailable'))
  }
  child.once('exit', invalidate)
  child.once('error', invalidate)
  const ended = new Promise<void>((resolve) =>
    child.once('close', () => {
      invalidate()
      resolve()
    }),
  )
  child.stdin.on('error', () => {
    child.stdin.destroy()
  })
  const readiness = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('lease-helper-timeout'))
    }, helper.process.readyTimeoutMs)
    const fail = () => {
      invalidate()
      clearTimeout(timer)
      reject(new Error('lease-helper-unavailable'))
    }
    child.once('error', fail)
    child.once('close', fail)
    child.stderr.on('data', (bytes: Buffer) => {
      stderr += bytes.toString('utf8')
      if (Buffer.byteLength(stderr) > helper.process.maxStatusBytes) {
        invalidate()
        clearTimeout(timer)
        reject(new Error('lease-helper-status-oversize'))
        return
      }
      const lines = stderr.split('\n')
      stderr = lines.pop() ?? ''
      for (const line of lines) {
        const word = z.enum(['lease-ready', 'pipe-ready']).safeParse(line.trim())
        if (!word.success) {
          fail()
          return
        }
        if (word.data !== readyWord) {
          continue
        }

        clearTimeout(timer)
        isReady = true
        resolve()
        return
      }
    })
  })
  child.stdout.on('data', (bytes: Buffer) => {
    stdout += bytes.toString('utf8')
    if (Buffer.byteLength(stdout) > helper.process.maxStatusBytes) {
      void helper.process.kill(child, startedAt)
      return
    }
    const lines = stdout.split('\n')
    stdout = lines.pop() ?? ''
    for (const frame of lines) {
      const line = frame.endsWith('\r') ? frame.slice(0, -1) : frame
      const callId = z.uuid().safeParse(line.startsWith('stop:') ? line.slice('stop:'.length) : '')
      if (stop === undefined || !callId.success) {
        void helper.process.kill(child, startedAt)
        return
      }
      const replying = (async () => {
        // Ensure the promise is tracked even when the host callback throws immediately.
        await Promise.resolve()
        try {
          await stop()
          child.stdin.write(`stopped:${callId.data}\n`)
        } catch (error: unknown) {
          let word: string
          if (error instanceof Error && error.message === 'lease-contender-cancelled')
            word = 'cancelled'
          else if (error instanceof Error && error.message === 'lease-contender-cancel-failed')
            word = 'cancel-failed'
          else if (error instanceof Error && error.message === 'lease-stop-failed') word = 'failed'
          else throw error
          child.stdin.write(`${word}:${callId.data}\n`)
        } finally {
          pendingStops.delete(callId.data)
        }
      })()
      pendingStops.set(callId.data, replying)
    }
  })
  try {
    await readiness
  } catch (error: unknown) {
    await helper.process.kill(child, startedAt)
    await ended
    throw error
  }
  return {
    signal: lifetime.signal,
    close: async () => {
      if (isClosing) {
        await ended
        return
      }
      isClosing = true
      if (!isReady) throw new Error('lease-helper-unavailable')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const forced = new Promise<void>((resolve, reject) => {
          timer = setTimeout(() => {
            void helper.process.kill(child, startedAt).then(resolve).catch(reject)
          }, helper.process.readyTimeoutMs)
        })
        await Promise.race([Promise.all(pendingStops.values()), ended, forced])
        child.stdin.end()
        await Promise.race([ended, forced])
        await ended
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

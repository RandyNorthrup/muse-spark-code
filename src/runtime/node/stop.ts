// `stop` for the home node: signal the recorded supervisor and wait until the
// process is gone. It stays in dist/node.js: stopping a node needs no
// listener, verifier or certificate, only the lock the supervisor recorded.
import process from 'node:process'
import * as z from 'zod/mini'
import {
  NODE_LOCK_FILE,
  NODE_MAX_AUTH_BYTES,
  NODE_STOP_POLL_MS,
  UI_TEXT,
} from '../../shared/constants'
import type { NodePrivateFiles } from './privateFiles'

const lockSchema = z.strictObject({ pid: z.number().check(z.int(), z.positive()) })

function abortablePoll(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, NODE_STOP_POLL_MS)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export interface StopNodeInput {
  readonly files: NodePrivateFiles
  readonly signal: AbortSignal
}

/**
Stop the serving node: signal its recorded supervisor, then wait until the
process is gone. `--all` is honored: the graceful shutdown ends every turn,
sandbox, model request and stream, and no maker device can be registered
until M103's runtime lands.
*/
export async function stopNode(input: StopNodeInput): Promise<{ done: true }> {
  const raw = await input.files.read(NODE_LOCK_FILE, NODE_MAX_AUTH_BYTES)
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch (error: unknown) {
    // The lock is ours; a corrupt one is a failed stop, never a guess.
    throw new Error(UI_TEXT.nodeErrors.failed, { cause: error })
  }
  const parsed = lockSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new Error(UI_TEXT.nodeErrors.failed, { cause: parsed.error })
  }
  const pid = parsed.data.pid
  try {
    process.kill(pid, 0)
  } catch (error: unknown) {
    // A stale lock is the operator's to remove (the home guide); a foreign
    // user's node is not ours to signal.
    if (isProcessGone(error)) throw new Error(UI_TEXT.nodeErrors.failed, { cause: error })
    if (isPermissionDenied(error)) throw new Error(UI_TEXT.nodeErrors.forbidden, { cause: error })
    throw error
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error: unknown) {
    if (isProcessGone(error)) return { done: true }
    if (isPermissionDenied(error)) throw new Error(UI_TEXT.nodeErrors.forbidden, { cause: error })
    throw error
  }
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch (error: unknown) {
      if (isProcessGone(error)) return { done: true }
      if (!isPermissionDenied(error)) throw error
    }
    await abortablePoll(input.signal)
    input.signal.throwIfAborted()
  }
}

function isProcessGone(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ESRCH' || error.code === 'ENOENT')
  )
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'
}

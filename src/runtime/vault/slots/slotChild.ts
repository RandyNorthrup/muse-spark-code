import { VAULT_KEY_BYTES, VAULT_LIMITS } from '../../../shared/constants'

// The slot helpers' shared child handling (macOS and Windows transports).
// Every byte a helper sends is untrusted framing around at most a bounded
// text plus the wrapped key; anything past the limit fails the exchange
// closed, and stderr never reaches anyone (it may name an account or path).

/** Largest stdout frame a slot helper may send: bounded text, key and length. */
export const SLOT_STDOUT_LIMIT = VAULT_LIMITS.text + VAULT_KEY_BYTES + Uint32Array.BYTES_PER_ELEMENT

/** The narrow event surface the shared handling needs from a helper child. */
export interface SlotChildErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown
}

export interface SlotChildProcess extends SlotChildErrorSource {
  readonly stdin: SlotChildErrorSource
  readonly stderr: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  }
}

/**
 * Fail the exchange on caller abort, child error or stdin error. The caller
 * stops this by settling: there is no timer here (the Windows screen-lock
 * probe must not time out).
 */
export function watchSlotChildErrors(
  child: SlotChildProcess,
  signal: AbortSignal | undefined,
  abort: () => void,
): void {
  signal?.addEventListener('abort', abort, { once: true })
  child.on('error', abort)
  child.stdin.on('error', abort)
}

/**
 * Collect one stdout chunk, erasing it and failing closed past the limit.
 * Returns the size to keep: unchanged on overflow, since the exchange is
 * already failed.
 */
export function collectSlotChunk(
  chunks: Buffer[],
  size: number,
  chunk: Buffer,
  fail: () => void,
): number {
  const next = size + chunk.length
  if (next > SLOT_STDOUT_LIMIT) {
    chunk.fill(0)
    fail()
    return size
  }
  chunks.push(chunk)
  return next
}

/** A helper's stderr never reaches anyone: it may name an account or path. */
export function drainSlotStderr(child: SlotChildProcess): void {
  child.stderr.on('data', (chunk: Buffer) => {
    chunk.fill(0)
  })
}

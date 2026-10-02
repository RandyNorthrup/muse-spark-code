// Bounded, cancellable stdin readers; never load a native credential module.
import type { Readable } from 'node:stream'
import { isValidModelApiKey, type SecretStore } from '../../host/auth/credentialStore'
import { EXEC_KEY_MAX_BYTES, SECRET_KEYS, UI_TEXT } from '../../shared/constants'

export interface MemorySecretStore extends SecretStore {
  clear(): void
}

/** The supplied key is the sole entry, even when a caller tries another name. */
export function memorySecretStore(key: string): MemorySecretStore {
  let held: string | undefined = key
  return {
    get(name) {
      return Promise.resolve(name === SECRET_KEYS.modelApiKey ? held : undefined)
    },
    store() {
      return Promise.reject(new Error(UI_TEXT.execTrustRefused))
    },
    delete(name) {
      if (name === SECRET_KEYS.modelApiKey) held = undefined
      return Promise.resolve()
    },
    clear() {
      held = undefined
    },
  }
}

function readBytes(
  input: Readable,
  maxBytes: number,
  signal: AbortSignal,
  isLine: boolean,
): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let isDone = false
    const finish = (error?: unknown, isTooLong = false) => {
      if (isDone) return
      isDone = true
      input.off('data', data)
      input.off('end', end)
      input.off('error', failure)
      input.off('close', end)
      signal.removeEventListener('abort', abort)
      input.destroy()
      if (error === undefined) {
        resolve(isTooLong ? undefined : Buffer.concat(chunks, bytes))
      } else {
        reject(
          error instanceof Error ? error : new Error(UI_TEXT.execInterrupted, { cause: error }),
        )
      }
      chunks.length = 0
    }
    const data = (chunk: unknown) => {
      if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) {
        finish(new Error(UI_TEXT.execKeyMissing))
        return
      }
      const raw = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      const lf = isLine ? raw.indexOf('\n') : -1
      const part = lf === -1 ? raw : raw.subarray(0, lf)
      bytes += part.length
      if (bytes > maxBytes) {
        finish(undefined, true)
        return
      }
      chunks.push(part)
      if (lf !== -1) finish()
    }
    const end = () => {
      finish()
    }
    const failure = (error: unknown) => {
      finish(error)
    }
    const abort = () => {
      finish(signal.reason ?? new Error(UI_TEXT.execInterrupted))
    }
    if (signal.aborted) {
      abort()
      return
    }
    input.on('data', data)
    input.once('end', end)
    input.once('close', end)
    input.once('error', failure)
    signal.addEventListener('abort', abort, { once: true })
    if (input.destroyed || input.readableEnded) end()
  })
}

export async function readKeyLine(
  input: Readable,
  signal: AbortSignal,
): Promise<
  { ok: true; key: string } | { ok: false; reason: 'tty' | 'empty' | 'invalid' | 'tooLong' }
> {
  if ('isTTY' in input && input.isTTY === true) {
    input.destroy()
    return { ok: false, reason: 'tty' }
  }
  const bytes = await readBytes(input, EXEC_KEY_MAX_BYTES, signal, true)
  if (bytes === undefined) return { ok: false, reason: 'tooLong' }
  let key: string
  try {
    key = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
  } catch {
    return { ok: false, reason: 'invalid' }
  } finally {
    bytes.fill(0)
  }
  if (key === '') return { ok: false, reason: 'empty' }
  return isValidModelApiKey(key) ? { ok: true, key } : { ok: false, reason: 'invalid' }
}

export async function readPromptStdin(
  input: Readable,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const bytes = await readBytes(input, maxBytes, signal, false)
  if (bytes === undefined) throw new Error(UI_TEXT.execFileTooLarge)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text === '') throw new Error(UI_TEXT.execPromptMissing)
  return text
}

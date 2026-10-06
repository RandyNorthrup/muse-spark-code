// Bounded, cancellable stdin readers; never load a native credential module.
import type { Readable } from 'node:stream'
import { isValidModelApiKey, type SecretStore } from '../../host/auth/credentialStore'
import type { KeyShape } from '../../core/providers/presets'
import { EXEC_KEY_MAX_BYTES, SECRET_KEYS, UI_TEXT } from '../../shared/constants'

export interface MemorySecretStore extends SecretStore {
  clear(): void
}

/** The supplied key is the sole entry, even when a caller tries another name. */
export function memorySecretStore(key: string): MemorySecretStore {
  return memorySecretStoreFor({ [SECRET_KEYS.modelApiKey]: key })
}

/**
 * Headless secrets held only in memory: each account's key, cleared when
 * the run ends. The map is exactly what the caller gave: a provider run
 * holds its provider's account, never the Meta key's alongside it.
 */
export function memorySecretStoreFor(entries: Readonly<Record<string, string>>): MemorySecretStore {
  const held = new Map(Object.entries(entries))
  return {
    get(name) {
      return Promise.resolve(held.get(name))
    },
    store() {
      return Promise.reject(new Error(UI_TEXT.execTrustRefused))
    },
    delete(name) {
      held.delete(name)
      return Promise.resolve()
    },
    clear() {
      held.clear()
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
      // The concatenated copy is the caller's; the received pieces held key
      // bytes too and are zeroed here, not left for the collector (RVM80A P2-1).
      for (const chunk of chunks) chunk.fill(0)
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
        part.fill(0)
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

/** One bounded, wiped UTF-8 line, with the caller's key-shape validator. */
async function readValidatedKeyLine(
  input: Readable,
  signal: AbortSignal,
  isValid: (key: string) => boolean,
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
    // One CRLF line ending is accepted; any other white space or CR is part
    // of the value and fails validation, as the Action's intake refuses it.
    const line = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    key = line.endsWith('\r') ? line.slice(0, -1) : line
  } catch {
    return { ok: false, reason: 'invalid' }
  } finally {
    bytes.fill(0)
  }
  if (key === '') return { ok: false, reason: 'empty' }
  return key === key.trim() && isValid(key) ? { ok: true, key } : { ok: false, reason: 'invalid' }
}

export async function readKeyLine(
  input: Readable,
  signal: AbortSignal,
): Promise<
  { ok: true; key: string } | { ok: false; reason: 'tty' | 'empty' | 'invalid' | 'tooLong' }
> {
  return await readValidatedKeyLine(input, signal, isValidModelApiKey)
}

/** Provider keys use the same bounded input and cleanup as Meta, with their own shape. */
export async function readProviderKeyLine(
  input: Readable,
  signal: AbortSignal,
  shape: KeyShape,
): Promise<
  { ok: true; key: string } | { ok: false; reason: 'tty' | 'empty' | 'invalid' | 'tooLong' }
> {
  const { presets } = await import('../../host/backend/providersEntry')
  return await readValidatedKeyLine(input, signal, (key) => presets.isKeyShape(shape, key))
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

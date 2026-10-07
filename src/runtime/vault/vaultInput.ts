import type { Writable } from 'node:stream'
import * as z from 'zod/mini'
import type { InputStream } from '../hiddenInput'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import { vaultEncodedSchema, vaultMaterialSchema } from '../../shared/vault'
import { wipeVaultMaterial } from './vaultCommand'

const LINE_ENDINGS = new Set(Buffer.from('\r\n'))
const CANCEL_KEYS = new Set(Buffer.from('\u{3}\u{4}'))
const BACKSPACE_KEYS = new Set(Buffer.from('\b\u{7F}'))

/** Bounded standard input; terminal echo is disabled and restored on every exit. */
export function readVaultLine(
  input: InputStream,
  output: Writable,
  prompt: string,
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.alloc(VAULT_LIMITS.frameBytes)
    let length = 0
    let isFinished = false
    const wasRaw = 'isRaw' in input && input.isRaw === true
    const isTty = input.isTTY === true
    const finish = (isAccepted: boolean): void => {
      if (isFinished) return
      isFinished = true
      let canReturn = isAccepted
      // A throwing stream callback cannot skip later cleanup, echo restoration or byte erasure.
      const cleanups = [
        () => input.pause(),
        () => input.off('data', data),
        () => input.off('end', end),
        () => input.off('error', error),
        () => output.off('error', error),
        () => {
          signal.removeEventListener('abort', error)
        },
      ]
      for (const cleanup of cleanups) {
        try {
          cleanup()
        } catch {
          canReturn = false
        }
      }
      try {
        if (isTty) input.setRawMode?.(wasRaw)
        if (isTty) output.write('\n')
        if (canReturn) {
          const owned = Buffer.alloc(length)
          owned.set(bytes.subarray(0, length))
          resolve(owned)
        } else reject(new Error(UI_TEXT.vault.noAccess))
      } catch {
        reject(new Error(UI_TEXT.vault.noAccess))
      } finally {
        bytes.fill(0)
      }
    }
    const error = (): void => {
      finish(false)
    }
    const end = (): void => {
      finish(!isTty && length > 0)
    }
    const data = (chunk: unknown): void => {
      if (!(chunk instanceof Uint8Array)) {
        finish(false)
        return
      }
      try {
        if (isFinished) return
        for (const byte of chunk) {
          if (LINE_ENDINGS.has(byte)) {
            finish(true)
            return
          }
          if (isTty && CANCEL_KEYS.has(byte)) {
            finish(false)
            return
          }
          if (isTty && BACKSPACE_KEYS.has(byte)) {
            if (length > 0) bytes[--length] = 0
          } else {
            if (length === bytes.length) {
              finish(false)
              return
            }
            bytes[length++] = byte
          }
        }
      } finally {
        chunk.fill(0)
      }
    }
    if (signal.aborted || (isTty && input.setRawMode === undefined)) {
      finish(false)
      return
    }
    input.on('data', data)
    input.once('end', end)
    input.once('error', error)
    output.once('error', error)
    signal.addEventListener('abort', error, { once: true })
    try {
      if (isTty) {
        output.write(prompt)
        input.setRawMode?.(true)
      }
      input.resume()
    } catch {
      finish(false)
    }
  })
}

/** Our private terminal format: byte fields are base64. It is never a public protocol. */
export async function readVaultMaterial(
  input: InputStream,
  output: Writable,
  signal: AbortSignal,
): Promise<unknown> {
  const line = await readVaultLine(input, output, `${UI_TEXT.vault.value}: `, signal)
  const material: Record<string, unknown> = {}
  try {
    const inputValue: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
    // Zod records deliberately omit this key; reject it before that sanitization can hide it.
    if (
      typeof inputValue === 'object' &&
      inputValue !== null &&
      Object.hasOwn(inputValue, '__proto__')
    )
      throw new Error(UI_TEXT.vault.noAccess)
    const raw = z.record(z.string(), z.unknown()).parse(inputValue)
    const byteFields = new Set([
      'value',
      'accessToken',
      'refreshToken',
      'privateKey',
      'username',
      'password',
      'totpSeed',
      'seed',
      'cookies',
    ])
    for (const [key, value] of Object.entries(raw)) {
      if (value !== null && byteFields.has(key)) {
        const encoded = vaultEncodedSchema.parse(value)
        const decoded = Buffer.from(encoded, 'base64')
        try {
          const owned = Buffer.alloc(decoded.length)
          owned.set(decoded)
          material[key] = owned
        } finally {
          decoded.fill(0)
        }
      } else material[key] = value
    }
    return vaultMaterialSchema.parse(material)
  } catch {
    wipeVaultMaterial(material)
    throw new Error(UI_TEXT.vault.noAccess)
  } finally {
    line.fill(0)
  }
}

/** Confirmation requires a local human terminal. Pipes cannot approve a use or standing grant. */
export async function chooseVaultDecision(
  input: InputStream,
  output: Writable,
  title: string,
  choices: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  if (input.isTTY !== true) throw new Error(UI_TEXT.vault.noAccess)
  const labels = choices.map((choice) => {
    let label = UI_TEXT.paidDeny
    if (choice === 'allowOnce') label = UI_TEXT.allowOnce
    else if (choice === 'allowSession') label = UI_TEXT.vault.allowSession
    return `${choice}: ${label}`
  })
  const bytes = await readVaultLine(input, output, `${title}\n${labels.join('\n')}\n`, signal)
  try {
    const answer = bytes.toString('utf8')
    return choices.includes(answer) ? answer : 'deny'
  } finally {
    bytes.fill(0)
  }
}

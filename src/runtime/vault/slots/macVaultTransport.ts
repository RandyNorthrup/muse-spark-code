import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  UI_TEXT,
  VAULT_APPROVAL_TTL_MS,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
} from '../../../shared/constants'
import { macVaultFailure, type MacVaultTransport } from './macVaultProtocol'

/** One trusted helper process per use; callers may cancel when the broker locks. */
export function macVaultTransport(helper: string, signal?: AbortSignal): MacVaultTransport {
  if (!path.isAbsolute(helper)) throw new Error(UI_TEXT.vault.noAccess)
  return {
    exchange: (header, key) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        const child = spawn(helper, [], { env: {}, stdio: 'pipe', shell: false })
        const chunks: Buffer[] = []
        let size = 0
        let isSettled = false
        const finish = (isOk: boolean, hasNativeFailure = false) => {
          if (isSettled) return
          isSettled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          const output = Buffer.alloc(isOk || hasNativeFailure ? size : 0)
          if (isOk || hasNativeFailure) {
            let offset = 0
            for (const chunk of chunks) {
              output.set(chunk, offset)
              offset += chunk.length
            }
          }
          if (isOk) resolve(output)
          else {
            const failure = hasNativeFailure ? macVaultFailure(output) : undefined
            output.fill(0)
            child.kill('SIGKILL')
            reject(failure ?? new Error(UI_TEXT.vault.noAccess))
          }
          for (const chunk of chunks) chunk.fill(0)
        }
        const abort = () => {
          finish(false)
        }
        const timer = setTimeout(abort, VAULT_APPROVAL_TTL_MS)
        signal?.addEventListener('abort', abort, { once: true })
        child.on('error', abort)
        child.stdin.on('error', abort)
        child.stdout.on('data', (chunk: Buffer) => {
          if (isSettled) {
            chunk.fill(0)
            return
          }
          size += chunk.length
          if (size > VAULT_LIMITS.text + VAULT_KEY_BYTES + Uint32Array.BYTES_PER_ELEMENT) {
            chunk.fill(0)
            finish(false)
            return
          }
          chunks.push(chunk)
        })
        // Even a failing helper cannot relay stderr (it may name an account/path).
        child.stderr.on('data', (chunk: Buffer) => {
          chunk.fill(0)
        })
        child.on('close', (code) => {
          finish(code === 0, code === 1)
        })
        const length = Buffer.alloc(Uint32Array.BYTES_PER_ELEMENT)
        length.writeUInt32BE(header.length)
        child.stdin.write(length)
        child.stdin.write(header)
        // The owned invoke buffer remains live until close, then is erased there.
        child.stdin.end(key)
      }),
  }
}

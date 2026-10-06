import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import {
  UI_TEXT,
  VAULT_APPROVAL_TTL_MS,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
} from '../../../shared/constants'
import { windowsVaultRequestSchema, type WindowsVaultTransport } from './windowsVaultProtocol'

/** One private helper per use; screen-lock waits last until the broker cancels. */
export function windowsVaultTransport(helper: string, signal?: AbortSignal): WindowsVaultTransport {
  if (!path.isAbsolute(helper) || !helper.toLowerCase().endsWith('.exe'))
    throw new Error(UI_TEXT.vault.noAccess)
  return {
    exchange: (header, key) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted || header.length > VAULT_LIMITS.text) {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        let request: unknown
        try {
          request = JSON.parse(Buffer.from(header).toString('utf8'))
        } catch {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        const parsed = windowsVaultRequestSchema.safeParse(request)
        if (
          !parsed.success ||
          key.length !== (parsed.data.operation === 'wrap' ? VAULT_KEY_BYTES : 0)
        ) {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        // Do not inherit credentials, a shell, or a visible console window.
        let child: ChildProcessWithoutNullStreams
        try {
          child = spawn(helper, [], { env: {}, stdio: 'pipe', shell: false, windowsHide: true })
        } catch {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        let isSettled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (isOk: boolean) => {
          if (isSettled) return
          isSettled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          if (isOk) {
            const output = Buffer.alloc(size)
            let offset = 0
            for (const chunk of chunks) {
              output.set(chunk, offset)
              offset += chunk.length
            }
            resolve(output)
          } else {
            child.kill('SIGKILL')
            reject(new Error(UI_TEXT.vault.noAccess))
          }
          for (const chunk of chunks) chunk.fill(0)
        }
        const abort = () => {
          finish(false)
        }
        if (parsed.data.operation !== 'screenLock') timer = setTimeout(abort, VAULT_APPROVAL_TTL_MS)
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
        child.stderr.on('data', (chunk: Buffer) => {
          chunk.fill(0)
        })
        child.on('close', (code) => {
          finish(code === 0)
        })
        if (signal?.aborted) {
          abort()
          return
        }
        const length = Buffer.alloc(Uint32Array.BYTES_PER_ELEMENT)
        length.writeUInt32BE(header.length)
        child.stdin.write(length)
        child.stdin.write(header)
        child.stdin.end(key)
      }),
  }
}

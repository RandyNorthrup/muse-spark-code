import path from 'node:path'
import process from 'node:process'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { type Socket } from 'node:net'
import * as z from 'zod/mini'
import { execResourceFile, spawnResourceProcess } from '../../core/resources/launcher'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import {
  type VaultProcessIdentity,
  type VaultSocketDescriptorPort,
} from '../../core/vault/broker/peer'
import {
  UI_TEXT,
  VAULT_BROKER_NATIVE_TIMEOUT_MS,
  VAULT_LIMITS,
  VAULT_FILE_SINGLE_LINK,
  WORKSPACE_IDENTITY_ZERO,
} from '../../shared/constants'

const processSchema = z.strictObject({
  processId: z.number().check(z.int(), z.positive()),
  userId: z.string().check(z.regex(/^[0-9]+$/u)),
  startedAt: z.number().check(z.int(), z.positive(), z.refine(Number.isSafeInteger)),
  executable: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
})
const lockSchema = z.strictObject({ v: z.literal(1), locked: z.literal(true) })

/** Approved Node internal descriptor access (M109 lead decision 9, PLAN §8). */
export const vaultSocketDescriptors: VaultSocketDescriptorPort = {
  descriptor: (socket: Socket) =>
    z
      .object({
        fd: z.number().check(z.int(), z.positive()),
      })
      .parse(Reflect.get(socket, '_handle')).fd,
}

/** The Secure Enclave slot helper (built by native/darwin/build.sh in CI's macOS job). */
export function macVaultSlotExecutable(installRoot: string): string {
  if (process.platform !== 'darwin') throw new Error(UI_TEXT.vault.noAccess)
  return path.join(installRoot, 'dist', 'native', 'darwin', 'muse-vault')
}
/** Installed helper only; never a PATH lookup or a source/workspace-selected executable. */
export function vaultPeerExecutable(installRoot: string): string {
  if (process.platform === 'darwin')
    return path.join(installRoot, 'native', 'darwin', 'muse-vault-peer')
  if (process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64'))
    return path.join(installRoot, 'native', 'linux', process.arch, 'muse-vault-peer')
  throw new Error(UI_TEXT.vault.noAccess)
}
export async function vaultProcessIdentity(
  helper: string,
  pid: number,
): Promise<VaultProcessIdentity | null> {
  z.number().check(z.int(), z.positive()).parse(pid)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await execResourceFile('probe', helper, ['identity', String(pid)], {
        env: {},
        timeout: VAULT_BROKER_NATIVE_TIMEOUT_MS,
        maxBuffer: VAULT_LIMITS.text,
      })
      const parsed = processSchema.parse(JSON.parse(result.stdout))
      if (parsed.processId !== pid) throw new Error(UI_TEXT.vault.noAccess)
      return parsed
    } catch (error: unknown) {
      if (error !== null && typeof error === 'object' && 'code' in error) {
        // Exit 2 proves absence. Exit 1 can be a process vanishing between native reads;
        // one fresh probe must prove absence or a valid identity, never a guessed death.
        if (error.code === 2) return null
        if (attempt === 0 && error.code === 1) continue
      }
      break
    }
  }
  // Discard native diagnostics; only the fixed failure escapes.
  throw new Error(UI_TEXT.vault.noAccess)
}

/** A kernel lock survives broker crashes only until its private stdin reaches EOF. Never unlink it. */
export async function holdVaultStartupLock(
  helper: string,
  file: string,
  shouldWait = false,
): Promise<{
  release(): Promise<void>
  onLost(listener: () => void): void
}> {
  const handle = await open(
    file,
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
    constants.S_IRUSR | constants.S_IWUSR,
  )
  try {
    const held = await handleIdentity(handle)
    if (
      !held.isFile() ||
      held.nlink !== VAULT_FILE_SINGLE_LINK ||
      held.uid !== BigInt(process.getuid?.() ?? -1) ||
      (held.mode & BigInt(constants.S_IRWXG | constants.S_IRWXO)) !== WORKSPACE_IDENTITY_ZERO ||
      !sameFile(held, await lstatIdentity(file))
    )
      throw new Error(UI_TEXT.vault.noAccess)
    const { child, stop } = await spawnResourceProcess(
      'contained',
      helper,
      [shouldWait ? 'lock-wait' : 'lock'],
      { env: {} },
      [handle.fd],
    )
    child.stderr.resume()
    for (const stream of [child.stdout, child.stderr])
      stream.on('error', () => {
        /* Readiness is bounded; subsequent guardian exit is observed by onLost. */
      })
    // EOF/lost lock is handled through exit; a broken private input must not be an uncaught error.
    child.stdin.on('error', () => {
      /* Exit notifies onLost and releases the held kernel lock. */
    })
    let hasReleased = false
    const closed = new Promise<void>((resolve) =>
      child.once('exit', () => {
        resolve()
      }),
    )
    try {
      await new Promise<void>((resolve, reject) => {
        let buffer = Buffer.alloc(0)
        const timer = setTimeout(() => {
          reject(new Error(UI_TEXT.vault.noAccess))
        }, VAULT_BROKER_NATIVE_TIMEOUT_MS)
        const failed = (): void => {
          clearTimeout(timer)
          reject(new Error(UI_TEXT.vault.noAccess))
        }
        child.once('exit', failed)
        child.once('error', failed)
        const data = (bytes: Buffer): void => {
          buffer = Buffer.concat([buffer, bytes])
          if (buffer.length > VAULT_LIMITS.text) {
            failed()
            return
          }
          if (!buffer.includes('\n')) return
          clearTimeout(timer)
          child.removeListener('exit', failed)
          child.removeListener('error', failed)
          child.stdout.removeListener('data', data)
          try {
            lockSchema.parse(JSON.parse(buffer.toString('utf8')))
            resolve()
          } catch {
            // A malformed lock answer never resolves the hold; the fixed refusal rejects it.
            reject(new Error(UI_TEXT.vault.noAccess))
          }
        }
        child.stdout.on('data', data)
      })
      if (!sameFile(held, await lstatIdentity(file))) throw new Error(UI_TEXT.vault.noAccess)
    } catch (error: unknown) {
      await stop()
      throw error
    }
    return {
      release: async () => {
        hasReleased = true
        child.stdin.end()
        await closed
      },
      onLost: (listener) => {
        child.once('exit', () => {
          if (!hasReleased) listener()
        })
        // A signal kill leaves exitCode null, so a death already reaped before
        // this subscription would otherwise be missed: re-check signalCode too.
        if (!hasReleased && (child.exitCode !== null || child.signalCode !== null)) listener()
      },
    }
  } finally {
    await handle.close()
  }
}

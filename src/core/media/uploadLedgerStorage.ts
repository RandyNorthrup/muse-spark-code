// The upload ledger's file storage (D85.2): atomic writes under the
// repository's shared cross-process mutex (core/fileLock, the
// session-budget design, never stolen). Shared by the media replay and the
// session store's ownership binding, so both hold the same lock.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { withMkdirLock } from '../fileLock'
import {
  MEDIA_SHA256_PATTERN,
  MEDIA_UPLOAD_LOCK_ATTEMPTS,
  MEDIA_UPLOAD_LOCK_WAIT_MS,
} from '../../shared/constants'
import type { UploadLedgerStorage } from './uploadLedger'

export const UPLOAD_LEDGER_FILE = 'uploads.json'
/** The digest of the last keyed account, so a keyless restart keeps its list. */
export const LAST_ACCOUNT_FILE = 'last-account.json'
const lastAccountSchema = z.strictObject({ version: z.literal(1), accountId: z.string() })
const LOCK_SUFFIX = '.lock'
const OWNER_DIRECTORY_MODE = 0o700
const OWNER_FILE_MODE = 0o600

/**
Remember the last keyed account beneath the uploads root: only the
digest, never the key (it already names the account's directory). A
corrupt or missing pointer reads as none and is rewritten on the next
keyed open.
*/
export async function writeLastAccountId(root: string, accountId: string): Promise<void> {
  await writeStateAtomically(root, LAST_ACCOUNT_FILE, { version: 1, accountId })
}

export async function readLastAccountId(root: string): Promise<string | undefined> {
  try {
    const parsed = lastAccountSchema.safeParse(
      JSON.parse(await readFile(path.join(root, LAST_ACCOUNT_FILE), 'utf8')),
    )
    // The digest is validated, not just non-empty (round 4, P3-4): with
    // ".", the ledger directory would resolve to the root itself.
    return parsed.success && MEDIA_SHA256_PATTERN.test(parsed.data.accountId)
      ? parsed.data.accountId
      : undefined
  } catch {
    return undefined
  }
}

/** The account's ledger directory beneath the uploads root (one per account). */
export function accountLedgerDirectory(root: string, accountId: string): string {
  const directory = path.join(root, accountId)
  const resolved = path.resolve(directory)
  const base = path.resolve(root)
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`))
    throw new Error('Media path escapes its directory')
  return directory
}

export interface LedgerStoreLock {
  /** Waits between attempts; injected so tests do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Bounded attempts before the scope fails closed; the tuned default stands in. */
  readonly attempts?: number
  /** Milliseconds between attempts; the tuned default stands in. */
  readonly waitMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>((settle) => setTimeout(settle, ms))

// Staging names are unique per writer (process and random), so two
// sessions in one process never share a temporary file on the way to rename.
function stagingFile(directory: string, fileName: string): string {
  return path.join(directory, `${fileName}.${String(process.pid)}.${randomUUID()}.tmp`)
}

/** Atomically replaces one JSON state file through a unique staging name. */
export async function writeStateAtomically(
  directory: string,
  fileName: string,
  state: unknown,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: OWNER_DIRECTORY_MODE })
  const staging = stagingFile(directory, fileName)
  try {
    await writeFile(staging, JSON.stringify(state), { mode: OWNER_FILE_MODE })
    await rename(staging, path.join(directory, fileName))
  } catch (error: unknown) {
    await rm(staging, { force: true })
    throw error
  }
}

/** Atomic writes under the shared cross-process mutex (core/fileLock). */
export function fileUploadLedgerStorage(
  directory: string,
  lock?: LedgerStoreLock,
): UploadLedgerStorage {
  const stateFile = path.join(directory, UPLOAD_LEDGER_FILE)
  return {
    async read(): Promise<unknown> {
      try {
        return JSON.parse(await readFile(stateFile, 'utf8'))
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'ENOENT'
        )
          return undefined
        throw error
      }
    },
    async write(state): Promise<void> {
      await writeStateAtomically(directory, UPLOAD_LEDGER_FILE, state)
    },
    async withLock<T>(operation: () => Promise<T>): Promise<T> {
      return await withMkdirLock(
        `${stateFile}${LOCK_SUFFIX}`,
        {
          sleep: lock?.sleep ?? defaultSleep,
          attempts: lock?.attempts ?? MEDIA_UPLOAD_LOCK_ATTEMPTS,
          waitMs: lock?.waitMs ?? MEDIA_UPLOAD_LOCK_WAIT_MS,
          locked: () => new Error('Upload ledger is locked'),
        },
        operation,
      )
    },
  }
}

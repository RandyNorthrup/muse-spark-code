// Native file IDs are 64-bit on Windows. This is the sole sampler and
// comparator: callers retain the exact IDs even when Number would alias them.
import { statSync, type BigIntStats } from 'node:fs'
import { lstat, stat, type FileHandle } from 'node:fs/promises'
import { WORKSPACE_IDENTITY_ZERO } from '../../shared/constants'

export type FileIdentity = Pick<BigIntStats, 'dev' | 'ino'>

/** A held stage's size/mtime change during writing; only its native ID binds cleanup. */
export function identityOf(sample: FileIdentity): FileIdentity {
  return { dev: sample.dev, ino: sample.ino }
}

export async function statIdentity(file: string): Promise<BigIntStats> {
  return await stat(file, { bigint: true })
}

export async function lstatIdentity(file: string): Promise<BigIntStats> {
  return await lstat(file, { bigint: true })
}

export async function handleIdentity(handle: FileHandle): Promise<BigIntStats> {
  return await handle.stat({ bigint: true })
}

/** The ACP's last admission check is synchronous, immediately before mutation. */
export function statIdentitySync(file: string): BigIntStats {
  return statSync(file, { bigint: true })
}

function isSameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

export { isSameFile as sameFile }

/** An absent/invalid native ID cannot bind a workspace or an import preview. */
export function fileIdentityKey(identity: FileIdentity): string | undefined {
  return identity.ino <= WORKSPACE_IDENTITY_ZERO || identity.dev < WORKSPACE_IDENTITY_ZERO
    ? undefined
    : `${identity.dev.toString()}:${identity.ino.toString()}`
}

/** Exact read-time IDs and nanosecond clock for cached byte provenance. */
export function fileReadIdentity(sample: Pick<BigIntStats, 'dev' | 'ino' | 'size' | 'mtimeNs'>): {
  readonly dev: string
  readonly ino: string
  readonly size: number
  readonly mtime: string
} {
  return {
    dev: sample.dev.toString(),
    ino: sample.ino.toString(),
    size: Number(sample.size),
    mtime: sample.mtimeNs.toString(),
  }
}

import { randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { open, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { canonicalPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'
import { isStoreErrorCode, storeErrorCode } from '../backend/storeErrors'
import { settleTeamClaim, type TeamSettlementClaims } from '../../core/team/teamMeter'
export type { TeamSettlementClaims } from '../../core/team/teamMeter'
import type { WindowAuthority, WindowIdentity } from './windowIdentity'

const envelopeSchema = z.strictObject({
  version: z.literal(1),
  owner: z.strictObject({
    instanceId: z.uuid(),
    startedAt: z.number().check(z.int(), z.nonnegative()),
  }),
  value: z.unknown(),
})
const recordNameSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/))

export type JournalRead<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'record'; readonly value: T }
  | { readonly kind: 'broken'; readonly file: string; readonly wasMovedAside: boolean }

export interface TeamJournal {
  readonly owner: WindowIdentity
  write<T>(name: string, value: T, schema: z.core.$ZodType<T>): Promise<void>
  read<T>(name: string, schema: z.core.$ZodType<T>): Promise<JournalRead<T>>
  names(): Promise<readonly string[]>
  /** Startup discovery reads other windows; it never elects an owner or writes their files. */
  otherWindows(): Promise<{
    readonly journals: readonly TeamJournal[]
    readonly unreadable: readonly string[]
  }>
}

/** Recovery shares A's durable settlement algorithm and retains K's failure codes. */
export async function settleTeamJournalClaim(
  claims: TeamSettlementClaims,
  id: string,
  outcome: Parameters<typeof settleTeamClaim>[2],
): Promise<void> {
  await settleTeamClaim(
    claims,
    id,
    outcome,
    (reason) =>
      new Error(reason === 'unavailable' ? 'TEAM_CLAIM_UNAVAILABLE' : 'TEAM_CLAIM_CONFLICT'),
  )
}

/** A foreign journal is read-only until Take over, regardless of hint freshness. */
export function createTeamJournal(options: {
  readonly storageDirectory: string
  readonly authority: WindowAuthority
  readonly owner: WindowIdentity
  readonly maxRecordBytes: number
  readonly platform: NodeJS.Platform
}): TeamJournal {
  const directory = path.join(
    options.storageDirectory,
    'team',
    'journal',
    z.uuid().parse(options.owner.instanceId),
  )
  const targetFor = (name: string) => path.join(directory, `${recordNameSchema.parse(name)}.json`)
  let tail = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = tail
    const result = (async () => {
      await previous
      return await operation()
    })()
    // A rejected caller receives its error; subsequent journal operations may retry.
    tail = (async () => {
      await Promise.allSettled([result])
    })()
    return result
  }
  // The record still resolves to the journal's own file: both sides are
  // canonical, so a stable link above the storage (macOS /tmp, a symlinked
  // home) passes, while a record or folder swapped for a link to foreign
  // ground fails and stays unreadable evidence, never followed.
  const assertPath = async (target: string): Promise<string> => {
    const canonicalTarget = await canonicalPath(target)
    const canonicalParent = await canonicalPath(path.dirname(target))
    if (canonicalTarget !== path.join(canonicalParent, path.basename(target))) {
      throw new Error('TEAM_JOURNAL_PATH_CHANGED')
    }
    return canonicalTarget
  }
  const flush = async (target: string) => {
    // FlushFileBuffers on Windows requires write access. POSIX permits the
    // read-only descriptor, but it would make every Windows intent fail EPERM.
    const file = await open(target, 'r+')
    try {
      await file.sync()
    } finally {
      await file.close()
    }
    if (options.platform === 'win32') return
    const folder = await open(directory, 'r')
    try {
      await folder.sync()
    } finally {
      await folder.close()
    }
  }
  return {
    owner: options.owner,
    async write(name, value, schema) {
      await serialize(async () => {
        options.authority.assertCanWrite(options.owner)
        const target = targetFor(name)
        const canonicalTarget = await assertPath(target)
        const content = JSON.stringify({
          version: 1,
          owner: options.owner,
          value: z.parse(schema, value),
        })
        if (Buffer.byteLength(content) > options.maxRecordBytes) {
          throw new Error('TEAM_JOURNAL_RECORD_TOO_LARGE')
        }
        // The write itself goes through the canonical spelling: the atomic
        // writer's temporary-file checks compare a path with its own
        // canonical form, which only agrees above a stable link when the
        // input is already canonical. Same file on disk either way.
        await writeFileAtomically(canonicalTarget, content, {
          sleep: delay,
          expectedCanonicalPath: canonicalTarget,
          assertCanWrite: () => {
            options.authority.assertCanWrite(options.owner)
          },
        })
        await flush(target)
      })
    },
    async read(name, schema) {
      return await serialize(async () => {
        // A damaged leaf is evidence, not a traversal and not a fatal startup error.
        if (!recordNameSchema.safeParse(name).success) {
          return {
            kind: 'broken',
            file: path.join(directory, `${path.basename(name)}.json`),
            wasMovedAside: false,
          }
        }
        const target = targetFor(name)
        try {
          await assertPath(target)
        } catch {
          // A linked/unavailable record is unreadable evidence; do not follow or move it.
          return { kind: 'broken', file: target, wasMovedAside: false }
        }
        let content: string
        try {
          content = await readFile(target, 'utf8')
        } catch (error: unknown) {
          // No entry is a missing record. An entry that is there but cannot
          // be read through (a link to nothing; on Windows a junction to a
          // file, which the path check above cannot see) is evidence.
          return storeErrorCode(error) === 'ENOENT' &&
            lstatSync(target, { throwIfNoEntry: false }) === undefined
            ? { kind: 'missing' }
            : { kind: 'broken', file: target, wasMovedAside: false }
        }
        try {
          if (Buffer.byteLength(content) > options.maxRecordBytes) {
            throw new Error('TEAM_JOURNAL_RECORD_TOO_LARGE')
          }
          const envelope = envelopeSchema.parse(JSON.parse(content))
          if (
            envelope.owner.instanceId !== options.owner.instanceId ||
            envelope.owner.startedAt !== options.owner.startedAt
          ) {
            throw new Error('TEAM_JOURNAL_OWNER_CHANGED')
          }
          return { kind: 'record', value: z.parse(schema, envelope.value) }
        } catch {
          // Preserve unreadable evidence. Never rename a possibly live window's file.
          const wasMovedAside = options.authority.canWrite(options.owner)
          const broken = `${target}.${randomUUID()}.broken`
          if (wasMovedAside) {
            await assertPath(target)
            options.authority.assertCanWrite(options.owner)
            await rename(target, broken)
          }
          return { kind: 'broken', file: wasMovedAside ? broken : target, wasMovedAside }
        }
      })
    },
    async names() {
      await assertPath(directory)
      try {
        const names = await readdir(directory)
        return names
          .filter((name) => name.endsWith('.json'))
          .map((name) => name.slice(0, -'.json'.length))
      } catch (error: unknown) {
        if (isStoreErrorCode(error, 'ENOENT')) return []
        throw error
      }
    },
    async otherWindows() {
      const root = path.dirname(directory)
      await assertPath(root)
      let instances: string[]
      try {
        instances = await readdir(root)
      } catch (error: unknown) {
        if (isStoreErrorCode(error, 'ENOENT')) return { journals: [], unreadable: [] }
        throw error
      }
      const journals: TeamJournal[] = []
      const unreadable: string[] = []
      for (const instance of instances) {
        if (instance === options.owner.instanceId || !z.uuid().safeParse(instance).success) continue
        const foreignDirectory = path.join(root, instance)
        let names: string[]
        try {
          await assertPath(foreignDirectory)
          names = await readdir(foreignDirectory)
        } catch {
          // A foreign window that cannot be listed is unreadable evidence,
          // not a fatal error: named, and the walk continues.
          unreadable.push(foreignDirectory)
          continue
        }
        let owner: WindowIdentity | undefined
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          const file = path.join(foreignDirectory, name)
          try {
            if (!recordNameSchema.safeParse(name.slice(0, -'.json'.length)).success)
              throw new Error('TEAM_JOURNAL_NAME_INVALID')
            await assertPath(file)
            const content = await readFile(file, 'utf8')
            if (Buffer.byteLength(content) > options.maxRecordBytes)
              throw new Error('TEAM_JOURNAL_RECORD_TOO_LARGE')
            const envelope = envelopeSchema.parse(JSON.parse(content))
            if (
              envelope.owner.instanceId !== instance ||
              (owner !== undefined && envelope.owner.startedAt !== owner.startedAt)
            )
              throw new Error('TEAM_JOURNAL_OWNER_CHANGED')
            owner = envelope.owner
          } catch {
            // A record that cannot be read is unreadable evidence: named,
            // never trusted, and the walk continues.
            unreadable.push(file)
          }
        }
        if (owner !== undefined) journals.push(createTeamJournal({ ...options, owner }))
      }
      return { journals, unreadable }
    },
  }
}

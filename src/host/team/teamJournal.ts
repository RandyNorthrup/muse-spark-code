import { randomUUID } from 'node:crypto'
import { open, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { canonicalPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'
import { storeErrorCode } from '../backend/storeErrors'
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

/** Structural settlement view of lane A's TeamReservationJournal at 8901ea1b.
 * The same injected D78 journal supplies claim/check and latestDay to A's
 * checkAndReserve. K never creates a second paid ledger or reservation.
 */
export interface TeamSettlementClaims {
  lookupByClaimId(id: string): Promise<
    | {
        readonly reservation: TeamSettledUsage & { readonly id: string; readonly dayKey: string }
        readonly outcome?: TeamSettlementOutcome
      }
    | undefined
  >
  settle(
    id: string,
    outcome: TeamSettledUsage & { readonly kind: 'reported' | 'liability' },
  ): Promise<void>
  refund(id: string): Promise<void>
}

interface TeamSettledUsage {
  readonly tokens: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly spendUsd: number
}

type TeamSettlementOutcome =
  | (TeamSettledUsage & { readonly kind: 'reported' | 'liability' })
  | {
      readonly kind: 'refunded'
      readonly tokens: 0
      readonly inputTokens: 0
      readonly outputTokens: 0
      readonly spendUsd: 0
    }

/** Settle the original D78 claim, including recovery after a lost acknowledgement.
 * The backing journal must durably compare-and-publish each outcome: concurrent
 * callers can race this lookup. Identical outcomes succeed; conflicts refuse.
 */
export async function settleTeamJournalClaim(
  claims: TeamSettlementClaims,
  id: string,
  outcome:
    | (TeamSettledUsage & { readonly kind: 'reported' })
    | { readonly kind: 'unknown' }
    | { readonly kind: 'nonsent' },
): Promise<void> {
  const claim = await claims.lookupByClaimId(id)
  if (claim?.reservation.id !== id) throw new Error('TEAM_CLAIM_UNAVAILABLE')
  let next: TeamSettlementOutcome
  if (outcome.kind === 'nonsent')
    next = { kind: 'refunded', tokens: 0, inputTokens: 0, outputTokens: 0, spendUsd: 0 }
  else if (outcome.kind === 'unknown')
    next = {
      kind: 'liability',
      tokens: claim.reservation.tokens,
      inputTokens: claim.reservation.inputTokens,
      outputTokens: claim.reservation.outputTokens,
      spendUsd: claim.reservation.spendUsd,
    }
  else next = outcome
  if (claim.outcome !== undefined) {
    if (
      claim.outcome.kind !== next.kind ||
      claim.outcome.tokens !== next.tokens ||
      claim.outcome.inputTokens !== next.inputTokens ||
      claim.outcome.outputTokens !== next.outputTokens ||
      claim.outcome.spendUsd !== next.spendUsd
    )
      throw new Error('TEAM_CLAIM_CONFLICT')
    return
  }
  if (next.kind === 'refunded') await claims.refund(id)
  else await claims.settle(id, next)
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
  const assertPath = async (target: string) => {
    if ((await canonicalPath(target)) !== path.resolve(target)) {
      throw new Error('TEAM_JOURNAL_PATH_CHANGED')
    }
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
        await assertPath(target)
        const content = JSON.stringify({
          version: 1,
          owner: options.owner,
          value: z.parse(schema, value),
        })
        if (Buffer.byteLength(content) > options.maxRecordBytes) {
          throw new Error('TEAM_JOURNAL_RECORD_TOO_LARGE')
        }
        await writeFileAtomically(target, content, {
          sleep: delay,
          expectedCanonicalPath: target,
          assertCanWrite: () => {
            options.authority.assertCanWrite(options.owner)
          },
        })
        await flush(target)
      })
    },
    async read(name, schema) {
      return await serialize(async () => {
        const target = targetFor(name)
        await assertPath(target)
        let content: string
        try {
          content = await readFile(target, 'utf8')
        } catch (error: unknown) {
          if (storeErrorCode(error) === 'ENOENT') return { kind: 'missing' }
          throw error
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
        if (storeErrorCode(error) === 'ENOENT') return []
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
        if (storeErrorCode(error) === 'ENOENT') return { journals: [], unreadable: [] }
        throw error
      }
      const journals: TeamJournal[] = []
      const unreadable: string[] = []
      for (const instance of instances) {
        if (instance === options.owner.instanceId || !z.uuid().safeParse(instance).success) continue
        const foreignDirectory = path.join(root, instance)
        await assertPath(foreignDirectory)
        const names = await readdir(foreignDirectory)
        let owner: WindowIdentity | undefined
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          const file = path.join(foreignDirectory, name)
          await assertPath(file)
          try {
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
            unreadable.push(file)
          }
        }
        if (owner !== undefined) journals.push(createTeamJournal({ ...options, owner }))
      }
      return { journals, unreadable }
    },
  }
}

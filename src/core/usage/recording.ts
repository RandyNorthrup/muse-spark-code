import { estimateAccountOwnerSchema, type EstimateAccountOwner } from '../../shared/estimateOwner'
import type { UsdAmount } from '../../shared/usd'
import { legacyUsdSchema } from '../../shared/usdSchema'
// R's injected seam to J's journal. No filesystem or provider requests here.
import type { Usage } from '../backends/modelapi/schemas'
import type { ModelPricing } from '../providers/priceCard'
import type { CoreLogger } from '../logging'
import type { UsageJournalEntry, UsageRecord, UsageLimitSnapshot } from '../../shared/usageJournal'
import { MODEL_API_CLOSE_SETTLE_MS, USAGE_JOURNAL_VERSION } from '../../shared/constants'
import { usageLocalDay as localUsageDay } from './localDay'

export type RecordedCall = Omit<
  UsageRecord,
  'v' | 'id' | 'type' | 'at' | 'day' | 'timezoneOffsetMins' | 'client' | 'tokens' | 'cost'
> & {
  readonly pricing?: ModelPricing | undefined
  readonly providerCostUsd?: UsdAmount | undefined
  readonly uncertain?: boolean | undefined
  readonly retainedLiabilityUsd?: UsdAmount | undefined
}

/** Structurally matches UsageJournal; J validates and settles before writing. */
export interface UsageWriter {
  noteUsage(
    usage: Partial<Usage> | undefined,
    context: RecordedCall & {
      readonly id: string
      readonly at: number
      readonly client: string
    },
  ): void
  append(entry: UsageJournalEntry): void
  read(): Promise<{ readonly records: readonly UsageRecord[] }>
  flush(): Promise<void>
}

export interface OwnedUsageLimitSnapshot {
  readonly snapshot: UsageLimitSnapshot
  readonly owner: EstimateAccountOwner
  /**
  The producer stream's order for this owner and source: `observedAt`
  orders observations across streams, `sequence` breaks ties within one.
  Minted by the scope that binds the owner, never by the caller.
  */
  readonly sequence: number
}
/**
The snapshot fields a producer supplies. The owner and sequence are bound
by the producer's scope (`scopeLimits`), or supplied explicitly to the one
owned constructor below; an observation without an owner cannot exist.
Money arrives as exact decimal strings or legacy numbers, normalized once
by the constructor.
*/
export type OwnedLimitInput = Omit<
  UsageLimitSnapshot,
  'v' | 'id' | 'at' | 'day' | 'timezoneOffsetMins' | 'client' | 'type' | 'account'
> & {
  readonly account?:
    | {
        readonly usedUsd?: number | UsdAmount | undefined
        readonly limitUsd?: number | UsdAmount | undefined
        readonly remainingUsd?: number | UsdAmount | undefined
        readonly period: string
      }
    | undefined
}
/** The owner a live producer publishes under, read fresh for every observation. */
export interface UsageScopeOwner {
  readonly accountId: string
  readonly generation: string
}
/** Where a live producer reads its current owner: undefined publishes nothing. */
export type UsageScopeReader = () => UsageScopeOwner | undefined
export interface UsageLimitScope extends UsageScopeOwner {
  readonly backend: UsageLimitSnapshot['backend']
}
/**
A live producer's scope-bound entry: the owner is already bound, so bare
snapshot fields suffice. Only `scopeLimits` mints these; the raw `limit`
below still demands its owner, so the compiler finds unbound producers.
It stays a full recording (notes, reads, re-scopes keep working), with
only the limit entry narrowed.
*/
export type ScopedUsageRecording = Pick<
  UsageRecording,
  'note' | 'today' | 'flush' | 'ownedLimits' | 'scopeLimits'
> & {
  readonly limit: (input: OwnedLimitInput, isForced?: boolean) => void
}
export interface UsageRecording {
  readonly ownedLimits?: () => readonly OwnedUsageLimitSnapshot[]
  readonly scopeLimits?: (scope: UsageLimitScope) => ScopedUsageRecording

  note(usage: Partial<Usage> | undefined, context: RecordedCall): void
  /**
  The one owned constructor: every limit observation enters here with its
  owner and sequence, so the compiler finds any producer that does not
  supply them. Corrupt owners and sequences are refused with a warning,
  never recorded ownerless.
  */
  limit(
    context: OwnedLimitInput & {
      readonly owner: EstimateAccountOwner
      readonly sequence: number
    },
    isForced?: boolean,
  ): void
  today(): Promise<readonly UsageRecord[]>
  flush(): Promise<void>
}

export interface UsageRecordingOptions {
  readonly client: string | (() => string)
  readonly now: () => number
  readonly newId: () => string
  readonly isEnabled: () => boolean
  readonly writer: (onWriteError: () => void) => Promise<UsageWriter>
  readonly log: CoreLogger
}

/** The producer stream key: one ordering per owner and source. */
function streamKey(snapshot: OwnedLimitInput, owner: EstimateAccountOwner): string {
  return `${snapshot.provider}/${owner.id}/${owner.generation}/${snapshot.source}`
}
/** Money is exact decimal strings from here on; legacy numbers normalize once. */
function canonicalAccount(account: OwnedLimitInput['account']): UsageLimitSnapshot['account'] {
  if (account === undefined) return undefined
  return {
    period: account.period,
    ...(account.usedUsd !== undefined && { usedUsd: legacyUsdSchema.parse(account.usedUsd) }),
    ...(account.limitUsd !== undefined && {
      limitUsd: legacyUsdSchema.parse(account.limitUsd),
    }),
    ...(account.remainingUsd !== undefined && {
      remainingUsd: legacyUsdSchema.parse(account.remainingUsd),
    }),
  }
}
/** Lazy writes never join the dispatch path; shutdown and reads may flush. */
export function createUsageRecording(options: UsageRecordingOptions): UsageRecording {
  let writer: Promise<UsageWriter> | undefined
  let pending = Promise.resolve()
  let hasLogged = false
  const lastHeaders = new Map<string, string>()
  const ownedLimits = new Map<string, OwnedUsageLimitSnapshot>()
  /**
  The producer stream order per owner and source, shared by every scope so
  a re-scoped producer keeps counting up: an older reply never overwrites
  a newer observation of the same owner and source, in either arrival
  order. `observedAt` orders across streams; this breaks ties within one.
  */
  const sequences = new Map<string, number>()
  const nextSequence = (key: string): number => {
    const sequence = (sequences.get(key) ?? -1) + 1
    sequences.set(key, sequence)
    return sequence
  }
  const client = () => (typeof options.client === 'function' ? options.client() : options.client)
  const report = () => {
    if (hasLogged) return
    hasLogged = true
    options.log.warn('Usage history could not be recorded')
  }
  const getWriter = () => (writer ??= options.writer(report))
  const queue = (write: (journal: UsageWriter) => void) => {
    if (!options.isEnabled()) return
    const prior = pending
    pending = (async () => {
      try {
        await prior
        if (options.isEnabled()) {
          const journal = await getWriter()
          if (options.isEnabled()) write(journal)
        }
      } catch {
        // A failed journal write is reported once and dropped: the queue
        // stays alive for the next note.
        report()
      }
    })()
  }
  const recording: UsageRecording = {
    ownedLimits: () => Array.from(ownedLimits.values(), (row) => structuredClone(row)),
    scopeLimits: (scope) => {
      const captured = { ...scope }
      return {
        ...recording,
        limit: (
          context: OwnedLimitInput & {
            readonly owner?: EstimateAccountOwner
            readonly sequence?: number
          },
          isForced = false,
        ) => {
          // The scope binds the owner; a caller-supplied owner never wins.
          // The sequence is minted here, in the producer's stream, to order
          // same-instant observations; `observedAt` still decides
          // newer-than, so a late older reply never displaces a newer row.
          const owner: EstimateAccountOwner = {
            kind: 'account',
            id: captured.accountId,
            generation: captured.generation,
            providerId: context.provider === 'museCode' ? 'meta' : context.provider,
          }
          const key = streamKey(context, owner)
          recording.limit(
            { ...context, owner, sequence: nextSequence(key) },
            isForced || !ownedLimits.has(key),
          )
        },
      }
    },
    note(usage, context) {
      const at = options.now()
      const id = options.newId()
      queue((journal) => {
        journal.noteUsage(usage, { ...context, at, id, client: client() })
      })
    },
    limit(context, isForced = false) {
      // The one owned constructor. A corrupt owner or sequence is refused
      // with a warning: an observation without an owner cannot exist, so it
      // is never recorded ownerless.
      if (
        !estimateAccountOwnerSchema.safeParse(context.owner).success ||
        !Number.isSafeInteger(context.sequence) ||
        context.sequence < 0
      ) {
        options.log.warn('Usage limit observation had no usable owner; ignored')
        return
      }
      const key = streamKey(context, context.owner)
      const previous = ownedLimits.get(key)
      if (
        previous !== undefined &&
        (context.observedAt < previous.snapshot.observedAt ||
          (context.observedAt === previous.snapshot.observedAt &&
            context.sequence <= previous.sequence))
      ) {
        // An older reply never overwrites a newer observation of the same
        // owner and source, in either arrival order: `observedAt` orders the
        // observations, `sequence` breaks ties from one producer stream. A
        // superseded reply is not journalled either, so a reload cannot
        // resurrect it as history.
        return
      }
      if (context.source === 'headers') {
        const encoded = JSON.stringify(context.raw)
        if (!isForced && lastHeaders.get(context.provider) === encoded) return
        lastHeaders.set(context.provider, encoded)
      }
      let account: UsageLimitSnapshot['account']
      try {
        account = canonicalAccount(context.account)
      } catch {
        options.log.warn('Usage limit observation had no usable amount; ignored')
        return
      }
      const at = options.now()
      // Only snapshot fields enter the stored entry: the owner and sequence
      // travel beside it in the owned row, never inside the strict journal
      // shape.
      const entry: UsageLimitSnapshot = {
        backend: context.backend,
        provider: context.provider,
        source: context.source,
        observedAt: context.observedAt,
        windows: context.windows,
        ...(context.raw !== undefined && { raw: context.raw }),
        // The meter's plan names the spend (F22) and the credential digest
        // selects the stored key's slots: both travel in the stored entry.
        ...(context.plan !== undefined && { plan: context.plan }),
        ...(context.credentialId !== undefined && { credentialId: context.credentialId }),
        ...(context.observationId !== undefined && { observationId: context.observationId }),
        account,
        v: USAGE_JOURNAL_VERSION,
        type: 'limit',
        id: options.newId(),
        at,
        day: localUsageDay(at),
        timezoneOffsetMins: new Date(at).getTimezoneOffset(),
        client: client(),
      }
      ownedLimits.set(key, {
        snapshot: structuredClone(entry),
        owner: context.owner,
        sequence: context.sequence,
      })
      queue((journal) => {
        journal.append(entry)
      })
    },
    async today() {
      await pending
      try {
        const journal = await getWriter()
        await journal.flush()
        const { records } = await journal.read()
        const day = localUsageDay(options.now())
        return records.filter((record) => record.day === day)
      } catch (error) {
        // The read failed after the report: fixed words carry the failure.
        report()
        throw new Error('Usage history unavailable', { cause: error })
      }
    },
    async flush() {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          (async () => {
            await pending
            if (writer !== undefined) {
              try {
                const journal = await writer
                await journal.flush()
              } catch {
                // A failed flush is reported once and dropped: shutdown
                // still settles instead of hanging on the journal.
                report()
              }
            }
          })(),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              report()
              resolve()
            }, MODEL_API_CLOSE_SETTLE_MS)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    },
  }
  return recording
}

/**
The live owner a usage surface reads for. Rows owned by anyone else are
history, never the current limit.
*/
export interface CurrentLimitReader {
  readonly accountId: string
  readonly generation: string
  /**
  When defined, only this provider's rows are current (the estimator's
  per-provider read). The usage page omits it and reads every provider of
  the current account and generation.
  */
  readonly providerId?: string | undefined
}
/**
Every consumer takes only owned observations: the live feed for the
current owner, as bare snapshots for the existing usage channel. Ownerless
history is migrated once, here: a provider/source with no live row from
the current owner reads as one explicit unknown row, newer than the stale
rows, so the cards show unknown and never another account's limit as
current. The marker is presentation-only and is never journalled.
*/
export function currentOwnedLimitSnapshots(
  rows: readonly OwnedUsageLimitSnapshot[],
  current: CurrentLimitReader,
  now: { readonly at: number; readonly newId: () => string; readonly client: string },
): UsageLimitSnapshot[] {
  const isCurrent = (row: OwnedUsageLimitSnapshot): boolean =>
    row.owner.id === current.accountId &&
    row.owner.generation === current.generation &&
    (current.providerId === undefined || row.owner.providerId === current.providerId)
  const output: UsageLimitSnapshot[] = []
  const staleNewest = new Map<string, { at: number; backend: UsageLimitSnapshot['backend'] }>()
  for (const row of rows) {
    if (isCurrent(row)) output.push(structuredClone(row.snapshot))
    else {
      const key = `${row.snapshot.provider}/${row.snapshot.source}`
      const known = staleNewest.get(key)
      if (known === undefined || row.snapshot.observedAt > known.at)
        staleNewest.set(key, { at: row.snapshot.observedAt, backend: row.snapshot.backend })
    }
  }
  const currentNewest = new Map<string, number>()
  for (const snapshot of output) {
    const key = `${snapshot.provider}/${snapshot.source}`
    currentNewest.set(key, Math.max(currentNewest.get(key) ?? -Infinity, snapshot.observedAt))
  }
  staleNewest.forEach((stale, key) => {
    if ((currentNewest.get(key) ?? -Infinity) >= stale.at) return
    const slash = key.indexOf('/')
    const at = Math.max(now.at, stale.at + 1)
    output.push({
      v: USAGE_JOURNAL_VERSION,
      type: 'limit',
      id: now.newId(),
      at,
      day: localUsageDay(at),
      timezoneOffsetMins: new Date(at).getTimezoneOffset(),
      client: now.client,
      backend: stale.backend,
      provider: key.slice(0, slash),
      source: key.slice(slash + 1) as UsageLimitSnapshot['source'],
      observedAt: at,
      windows: [],
    })
  })
  return output
}

/** Bundles ship together; the factory is validated before it is invoked. */
export interface UsageWriterBundle {
  createUsageWriter(options: {
    readonly dataFolder: string
    readonly writerId: string
    readonly isEnabled: () => boolean
    readonly now: () => number
    readonly onWriteError: () => void
    /** Reported once when the settings file is invalid and history pauses (EXECPROV E). */
    readonly onInvalidSettings?: () => void
  }): Promise<UsageWriter>
}
export function isUsageWriterBundle(value: unknown): value is UsageWriterBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createUsageWriter' in value &&
    typeof value.createUsageWriter === 'function'
  )
}

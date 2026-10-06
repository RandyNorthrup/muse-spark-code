// R's injected seam to J's journal. No filesystem or provider requests here.
import type { Usage } from '../backends/modelapi/schemas'
import type { ModelPricing } from '../providers/priceCard'
import type { CoreLogger } from '../logging'
import type { UsageJournalEntry, UsageRecord, UsageLimitSnapshot } from '../../shared/usageJournal'
import { MODEL_API_CLOSE_SETTLE_MS, USAGE_JOURNAL_VERSION } from '../../shared/constants'

export type RecordedCall = Omit<
  UsageRecord,
  'v' | 'id' | 'type' | 'at' | 'day' | 'timezoneOffsetMins' | 'client' | 'tokens' | 'cost'
> & {
  readonly pricing?: ModelPricing | undefined
  readonly providerCostUsd?: number | undefined
  readonly uncertain?: boolean | undefined
  readonly retainedLiabilityUsd?: number | undefined
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

export interface UsageRecording {
  note(usage: Partial<Usage> | undefined, context: RecordedCall): void
  limit(
    context: Omit<
      UsageLimitSnapshot,
      'v' | 'id' | 'at' | 'day' | 'timezoneOffsetMins' | 'client' | 'type'
    >,
    isForced?: boolean,
  ): void
  today(): Promise<readonly UsageRecord[]>
  flush(): Promise<void>
}

export interface UsageRecordingOptions {
  readonly client: string
  readonly now: () => number
  readonly newId: () => string
  readonly isEnabled: () => boolean
  readonly writer: (onWriteError: () => void) => Promise<UsageWriter>
  readonly log: CoreLogger
}

export function localUsageDay(at: number): string {
  const date = new Date(at)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/** Lazy writes never join the dispatch path; shutdown and reads may flush. */
export function createUsageRecording(options: UsageRecordingOptions): UsageRecording {
  let writer: Promise<UsageWriter> | undefined
  let pending = Promise.resolve()
  let hasLogged = false
  const lastHeaders = new Map<string, string>()
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
        report()
      }
    })()
  }
  return {
    note(usage, context) {
      const at = options.now()
      const id = options.newId()
      queue((journal) => {
        journal.noteUsage(usage, { ...context, at, id, client: options.client })
      })
    },
    limit(context, isForced = false) {
      if (!options.isEnabled()) return
      if (context.source === 'headers') {
        const encoded = JSON.stringify(context.raw)
        if (!isForced && lastHeaders.get(context.provider) === encoded) return
        lastHeaders.set(context.provider, encoded)
      }
      const at = options.now()
      const entry: UsageLimitSnapshot = {
        ...context,
        v: USAGE_JOURNAL_VERSION,
        type: 'limit',
        id: options.newId(),
        at,
        day: localUsageDay(at),
        timezoneOffsetMins: new Date(at).getTimezoneOffset(),
        client: options.client,
      }
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
      } catch {
        report()
        throw new Error('Usage history unavailable')
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
}

/** Bundles ship together; the factory is validated before it is invoked. */
export interface UsageWriterBundle {
  createUsageWriter(options: {
    readonly dataFolder: string
    readonly writerId: string
    readonly isEnabled: () => boolean
    readonly now: () => number
    readonly onWriteError: () => void
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

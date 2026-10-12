// M107 J/M102 binding: one durable resource journal per machine, recorded by
// every long-lived governor (the editor's window host, the ACP agent) and
// read by every history surface (usage page, `resources history`,
// `usage resources`, ACP `/usage resources`).
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { aggregateResources } from '../../core/usage/aggregate'
import { ResourceJournal } from '../../core/usage/resourceJournal'
import { ResourceRecords, type ResourceRecordWorkSource } from '../../core/usage/resourceRecords'
import { RESOURCE_JOURNAL_LIVE_MS, USAGE_SETTINGS_FILE } from '../../shared/constants'
import type { ResourceHistory } from '../../shared/resourceHistory'
import type { ResourceEvent, ResourceStatus } from '../../shared/resources'
import { NodeUsageFs } from '../usage/nodeUsageFs'
import { readUsageHistorySettings } from '../usage/usageSettingsFile'
import { readResourceReset, writeResourceReset } from '../usage/resourceResetFile'
import type { ResourceHistoryPort } from './port'

export interface ResourceHistoryBinding {
  /** The machine's private agent data folder; the journal lives in its usage folder. */
  readonly dataFolder: string
  /** The host's own usage-history consent (setting or flag); the shared usage file also applies. */
  readonly isEnabled: () => boolean
  /** Daily rows are kept for these days; defaults to the shared usage-history file's days. */
  readonly historyDays?: () => number
}

export interface ResourceHistoryReader extends ResourceHistoryPort {
  /** Every stored entry, for Delete history's confirmation count. */
  count(): Promise<number>
  /**
   * Delete history: holding the journal write lock, write the reset boundary and
   * run `removeUsage` (the usage journal's reset), so no write lands in between.
   */
  deleteHistory(removeUsage: () => Promise<void>): Promise<void>
}

interface JournalOptions {
  readonly historyDays?: (() => number) | undefined
  readonly onDropped?: () => void
  readonly onRetentionError?: (() => void) | undefined
}

function journal(dataFolder: string, isEnabled: () => boolean, options: JournalOptions = {}) {
  return new ResourceJournal(new NodeUsageFs(dataFolder), {
    writerId: randomUUID(),
    now: Date.now,
    isEnabled,
    // An unreadable usage-history choice throws, so retention removes nothing.
    historyDays: options.historyDays ?? (() => readUsageHistorySettings(dataFolder).days),
    resetAtMs: () => readResourceReset(dataFolder),
    ...(options.onDropped !== undefined && { onDropped: options.onDropped }),
    ...(options.onRetentionError !== undefined && { onRetentionError: options.onRetentionError }),
  })
}

function port(store: ResourceJournal, dataFolder: string): ResourceHistoryReader {
  return {
    count: () => store.count(),
    deleteHistory: (removeUsage) =>
      store.deleteWith(async () => {
        await writeResourceReset(dataFolder, Date.now())
        await removeUsage()
      }),
    async read(): Promise<ResourceHistory> {
      // A retention failure is reported and retried; it never hides history.
      await store.retainReported()
      const read = await store.read()
      const history = aggregateResources(read.records, read.sources)
      return read.days.length === 0 ? history : { ...history, days: [...read.days] }
    },
  }
}

/** Read-only: surfaces that show history never record. */
export function resourceHistoryReader(
  dataFolder: string,
  historyDays?: () => number,
  onRetentionError?: () => void,
): ResourceHistoryReader {
  return port(
    journal(dataFolder, () => false, { historyDays, onRetentionError }),
    dataFolder,
  )
}

export interface ResourceHistoryRecorder {
  readonly history: ResourceHistoryPort
  /** Call with each governor sample; a sample arriving while one is written is skipped. */
  sample(status: ResourceStatus): void
  event(event: ResourceEvent): void
  flush(): Promise<void>
}

/**
 * Feeds the governor's own samples and events into the journal. Nothing here
 * is awaited by admission: a slow or failing disk delays only history, and a
 * failure is reported once, never replaced by invented readings.
 */
export function resourceHistoryRecorder(
  binding: ResourceHistoryBinding,
  work: ResourceRecordWorkSource,
  onError: () => void,
): ResourceHistoryRecorder {
  let hasReported = false
  const report = () => {
    if (hasReported) return
    hasReported = true
    onError()
  }
  // One corrupt choice is announced once until it changes, in every window
  // and after a restart: the announcement is keyed to the damaged file's own
  // content and size, recorded durably beside the journal's state.
  const settingsFile = path.join(binding.dataFolder, USAGE_SETTINGS_FILE)
  const reportedChoiceFile = `${settingsFile}.reported`
  const fingerprintChoice = (): string | undefined => {
    try {
      const raw = readFileSync(settingsFile)
      return `${String(raw.length)}:${createHash('sha256').update(raw).digest('hex')}`
    } catch (error: unknown) {
      // A choice that cannot even be fingerprinted is announced, never deduped.
      if (!(error instanceof Error)) throw error
      return undefined
    }
  }
  const readReportedChoice = (): string | undefined => {
    try {
      const marker: unknown = JSON.parse(readFileSync(reportedChoiceFile, 'utf8'))
      return typeof marker === 'object' &&
        marker !== null &&
        'identity' in marker &&
        typeof marker.identity === 'string'
        ? marker.identity
        : undefined
    } catch (error: unknown) {
      // A missing or damaged marker announces, never hides.
      if (!(error instanceof Error)) throw error
      return undefined
    }
  }
  const writeReportedChoice = (identity: string): void => {
    try {
      writeFileSync(reportedChoiceFile, JSON.stringify({ identity }))
    } catch (error: unknown) {
      // Best effort: an unwritten marker only repeats the announcement.
      if (!(error instanceof Error)) throw error
    }
  }
  const reportedChoices = new Set<string>()
  const reportChoice = (): void => {
    const identity = fingerprintChoice()
    if (identity !== undefined) {
      if (reportedChoices.has(identity)) return
      reportedChoices.add(identity)
      if (readReportedChoice() === identity) return
      writeReportedChoice(identity)
    }
    onError()
  }
  const isConsented = () => {
    if (!binding.isEnabled()) return false
    try {
      return readUsageHistorySettings(binding.dataFolder).enabled
    } catch (error: unknown) {
      // A missing choice is the default; an unreadable one is not consent,
      // and is announced once per damaged file rather than mistaken for a
      // refusal. Anything that is not an error keeps its kind.
      if (!(error instanceof Error)) throw error
      reportChoice()
      return false
    }
  }
  const store = journal(binding.dataFolder, isConsented, {
    historyDays: binding.historyDays,
    onDropped: report,
    onRetentionError: onError,
  })
  let records = new ResourceRecords(store, work)
  let boundary = readResourceReset(binding.dataFolder)
  let liveAt = -Infinity
  let isSampling = false
  /**
   * Consent and Delete history are checked when a reading is collected
   * (RVM107W2 P2): while history is off, or once a delete has happened, the
   * collector and everything it holds are dropped, so nothing from an off or
   * deleted period can be written later.
   */
  const isAdmitted = (): boolean => {
    const reset = readResourceReset(binding.dataFolder)
    const isOn = isConsented()
    if (!isOn || reset !== boundary) {
      records = new ResourceRecords(store, work)
      boundary = reset
      liveAt = -Infinity
    }
    return isOn
  }
  // Async bodies turn the collector's synchronous validation refusals into reports too.
  const sampleOnce = async (status: ResourceStatus) => {
    try {
      await records.sample(status)
      // Publish the open minute so far for every surface, at most every 15 seconds.
      const current = records.current()
      const now = Date.now()
      if (current !== undefined && now - liveAt >= RESOURCE_JOURNAL_LIVE_MS) {
        liveAt = now
        await store.writeLive(current)
      }
    } catch (error: unknown) {
      // A failed sample is reported once, never replaced by an invented
      // reading. Anything that is not an error keeps its kind.
      if (!(error instanceof Error)) throw error
      report()
    } finally {
      isSampling = false
    }
  }
  const eventOnce = async (event: ResourceEvent) => {
    try {
      await records.event(event)
    } catch (error: unknown) {
      // A failed event is reported once and dropped. Anything that is not
      // an error keeps its kind.
      if (!(error instanceof Error)) throw error
      report()
    }
  }
  return {
    history: port(store, binding.dataFolder),
    sample(status) {
      if (isSampling || !isAdmitted()) return
      isSampling = true
      void sampleOnce(status).catch(() => {
        // The pump owns this reading: a foreign failure has no consumer, so
        // the tail records it once through report() and drops it, and the
        // pump continues with the next reading.
        report()
      })
    },
    event(event) {
      if (!isAdmitted()) return
      void eventOnce(event).catch(() => {
        // As above: a foreign event failure is recorded once and dropped.
        report()
      })
    },
    flush: async () => {
      // A delete or consent change since the last reading drops what is held.
      isAdmitted()
      await records.flush()
    },
  }
}

// M107 J/M102 binding: one durable resource journal per machine, recorded by
// every long-lived governor (the editor's window host, the ACP agent) and
// read by every history surface (usage page, `resources history`,
// `usage resources`, ACP `/usage resources`).
import { randomUUID } from 'node:crypto'
import { aggregateResources } from '../../core/usage/aggregate'
import { ResourceJournal } from '../../core/usage/resourceJournal'
import { ResourceRecords, type ResourceRecordWorkSource } from '../../core/usage/resourceRecords'
import { RESOURCE_JOURNAL_LIVE_MS } from '../../shared/constants'
import type { ResourceHistory } from '../../shared/resourceHistory'
import type { ResourceEvent, ResourceStatus } from '../../shared/resources'
import { NodeUsageFs } from '../usage/nodeUsageFs'
import { readUsageHistorySettings } from '../usage/usageSettingsFile'
import { readResourceReset } from '../usage/resourceResetFile'
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
}

function journal(
  dataFolder: string,
  isEnabled: () => boolean,
  historyDays?: () => number,
  onDropped?: () => void,
) {
  return new ResourceJournal(new NodeUsageFs(dataFolder), {
    writerId: randomUUID(),
    now: Date.now,
    isEnabled,
    // An unreadable usage-history choice throws, so retention removes nothing.
    historyDays: historyDays ?? (() => readUsageHistorySettings(dataFolder).days),
    resetAtMs: () => readResourceReset(dataFolder),
    ...(onDropped !== undefined && { onDropped }),
  })
}

function port(store: ResourceJournal): ResourceHistoryReader {
  return {
    count: () => store.count(),
    async read(): Promise<ResourceHistory> {
      try {
        await store.retain()
      } catch {
        // Removal of expired days retries on the next read or append.
      }
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
): ResourceHistoryReader {
  return port(journal(dataFolder, () => false, historyDays))
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
  const isConsented = () => {
    if (!binding.isEnabled()) return false
    try {
      return readUsageHistorySettings(binding.dataFolder).enabled
    } catch {
      // An unreadable choice is not consent.
      return false
    }
  }
  const store = journal(binding.dataFolder, isConsented, binding.historyDays, report)
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
    } catch {
      report()
    } finally {
      isSampling = false
    }
  }
  const eventOnce = async (event: ResourceEvent) => {
    try {
      await records.event(event)
    } catch {
      report()
    }
  }
  return {
    history: port(store),
    sample(status) {
      if (isSampling || !isAdmitted()) return
      isSampling = true
      void sampleOnce(status)
    },
    event(event) {
      if (!isAdmitted()) return
      void eventOnce(event)
    },
    flush: async () => {
      // A delete or consent change since the last reading drops what is held.
      isAdmitted()
      await records.flush()
    },
  }
}

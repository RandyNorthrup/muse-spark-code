// M107 J/M102 binding: one durable resource journal per machine, recorded by
// every long-lived governor (the editor's window host, the ACP agent) and
// read by every history surface (usage page, `resources history`,
// `usage resources`, ACP `/usage resources`).
import { randomUUID } from 'node:crypto'
import { aggregateResources } from '../../core/usage/aggregate'
import { ResourceJournal } from '../../core/usage/resourceJournal'
import { ResourceRecords, type ResourceRecordWorkSource } from '../../core/usage/resourceRecords'
import type { ResourceHistory } from '../../shared/resourceHistory'
import type { ResourceEvent, ResourceStatus } from '../../shared/resources'
import { NodeUsageFs } from '../usage/nodeUsageFs'
import { readUsageHistorySettings } from '../usage/usageSettingsFile'
import type { ResourceHistoryPort } from './port'

export interface ResourceHistoryBinding {
  /** The machine's private agent data folder; the journal lives in its usage folder. */
  readonly dataFolder: string
  /** The host's own usage-history consent (setting or flag); the shared usage file also applies. */
  readonly isEnabled: () => boolean
}

function journal(dataFolder: string, isEnabled: () => boolean, onDropped?: () => void) {
  return new ResourceJournal(new NodeUsageFs(dataFolder), {
    writerId: randomUUID(),
    now: Date.now,
    isEnabled,
    ...(onDropped !== undefined && { onDropped }),
  })
}

function port(store: ResourceJournal): ResourceHistoryPort {
  return {
    async read(): Promise<ResourceHistory> {
      try {
        await store.retain()
      } catch {
        // Removal of expired days retries on the next read or append.
      }
      const read = await store.read()
      return aggregateResources(read.records, read.sources)
    },
  }
}

/** Read-only: surfaces that show history never record. */
export function resourceHistoryReader(dataFolder: string): ResourceHistoryPort {
  return port(journal(dataFolder, () => false))
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
  const store = journal(
    binding.dataFolder,
    () => {
      if (!binding.isEnabled()) return false
      try {
        return readUsageHistorySettings(binding.dataFolder).enabled
      } catch {
        // An unreadable choice is not consent.
        return false
      }
    },
    report,
  )
  const records = new ResourceRecords(store, work)
  let isSampling = false
  // Async bodies turn the collector's synchronous validation refusals into reports too.
  const sampleOnce = async (status: ResourceStatus) => {
    try {
      await records.sample(status)
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
      if (isSampling) return
      isSampling = true
      void sampleOnce(status)
    },
    event(event) {
      void eventOnce(event)
    },
    flush: () => records.flush(),
  }
}

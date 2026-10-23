// M107 J/M102 binding: one durable resource journal per machine, recorded by
// every long-lived governor (the editor's window host, the ACP agent) and
// read by every history surface (usage page, `resources history`,
// `usage resources`, ACP `/usage resources`).
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { aggregateResources } from '../../core/usage/aggregate'
import { ResourceJournal } from '../../core/usage/resourceJournal'
import { ResourceRecords, type ResourceRecordWorkSource } from '../../core/usage/resourceRecords'
import { RESOURCE_JOURNAL_LIVE_MS, USAGE_SETTINGS_FILE, UI_TEXT } from '../../shared/constants'
import { DamageNoter, fileDamageMarkers } from '../damageNotice'
import type { ResourceHistory } from '../../shared/resourceHistory'
import type { ResourceEvent, ResourceStatus } from '../../shared/resources'
import { NodeUsageFs } from '../usage/nodeUsageFs'
import { readUsageHistorySettings } from '../usage/usageSettingsFile'
import { readResourceReset, writeResourceReset } from '../usage/resourceResetFile'
import type { ResourceHistoryPort } from './port'

/** What the person is told about a damaged usage-history choice. */
export interface DamagedChoiceNotice {
  /** `unreadable` when the file cannot be read, `invalid` when it is not a choice. */
  readonly damage: 'unreadable' | 'invalid'
  /** What is damaged, what the product does because of it, and what to do. */
  readonly text: string
}

export interface ResourceHistoryBinding {
  /** The machine's private agent data folder; the journal lives in its usage folder. */
  readonly dataFolder: string
  /** The host's own usage-history consent (setting or flag); the shared usage file also applies. */
  readonly isEnabled: () => boolean
  /** Daily rows are kept for these days; defaults to the shared usage-history file's days. */
  readonly historyDays?: () => number | null
  /**
  A damaged choice, announced once per distinct damage with what the
  person is told. The recorder still calls `onError` for the log.
  */
  readonly onDamagedChoice?: (notice: DamagedChoiceNotice) => void
}

export interface ResourceHistoryReader extends ResourceHistoryPort {
  /** Every stored entry, for Delete history's confirmation count. */
  count(): Promise<number>
  /**
  Delete history: holding the journal write lock, write the reset boundary and
  run `removeUsage` (the usage journal's reset), so no write lands in between.
  */
  deleteHistory(removeUsage: () => Promise<void>): Promise<void>
}

interface JournalOptions {
  readonly historyDays?: (() => number | null) | undefined
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
  historyDays?: () => number | null,
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
Feeds the governor's own samples and events into the journal. Nothing here
is awaited by admission: a slow or failing disk delays only history, and a
failure is reported once, never replaced by invented readings.
*/
export function resourceHistoryRecorder(
  binding: ResourceHistoryBinding,
  work: ResourceRecordWorkSource,
  onError: (failure?: unknown) => void,
): ResourceHistoryRecorder {
  let hasReported = false
  // The pump's tails forward their rejection here instead of dropping it:
  // the first failure reaches the host's error channel with its value, and
  // later ones stay silent. Both channels record fixed words, never the
  // raw value.
  const report = (failure?: unknown) => {
    if (hasReported) return
    hasReported = true
    onError(failure)
  }
  // One damaged choice is announced once per distinct damage, in every
  // window and after a restart (Part 2.1): the rule lives in one place, the
  // DamageNoter, shared with the quote and schedule consent notices.
  const settingsFile = path.join(binding.dataFolder, USAGE_SETTINGS_FILE)
  const fingerprintChoiceContent = (): string => {
    try {
      const raw = readFileSync(settingsFile)
      return `${String(raw.length)}:${createHash('sha256').update(raw).digest('hex')}`
    } catch {
      return 'unknown'
    }
  }
  const choiceDamageIdentity = (error: Error): string => {
    // The reader wraps every failure as invalidUsageSettings with the real
    // failure as its cause: a filesystem code reads unreadable, malformed
    // text or a wrong shape reads invalid.
    const cause: unknown = 'cause' in error ? error.cause : undefined
    const code =
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      typeof cause.code === 'string'
        ? cause.code
        : undefined
    return code !== undefined && !(cause instanceof SyntaxError)
      ? `unreadable:${code}`
      : `invalid:${fingerprintChoiceContent()}`
  }
  const choiceNoter = new DamageNoter(fileDamageMarkers(settingsFile), (identity) => {
    const damage = identity.startsWith('unreadable:') ? 'unreadable' : 'invalid'
    binding.onDamagedChoice?.({
      damage,
      text:
        damage === 'unreadable'
          ? UI_TEXT.resourceHistoryChoiceUnreadable
          : UI_TEXT.resourceHistoryChoiceInvalid,
    })
    onError()
  })
  const isConsented = () => {
    if (!binding.isEnabled()) return false
    try {
      const isEnabled = readUsageHistorySettings(binding.dataFolder).enabled
      // A healthy read clears the marker, so a recurrence after a repair
      // announces again (P2-6).
      choiceNoter.noteHealthy()
      return isEnabled
    } catch (error: unknown) {
      // A missing choice is the default (answered inside the reader); an
      // unreadable or invalid one is not consent, and is announced once per
      // distinct damage rather than mistaken for a refusal or reported on
      // every sample. Anything that is not an error keeps its kind.
      // read-state: cert TBL-12. `false` here is "no consent without a
      // readable choice", announced once per damage above, never "refused".
      if (!(error instanceof Error)) throw error
      choiceNoter.noteDamaged(choiceDamageIdentity(error))
      return false
    }
  }
  const store = journal(binding.dataFolder, isConsented, {
    historyDays: binding.historyDays,
    onDropped: report,
    onRetentionError: () => {
      onError(new Error('resource history retention failed'))
    },
  })
  let records = new ResourceRecords(store, work)
  let boundary = readResourceReset(binding.dataFolder)
  let liveAt = -Infinity
  let isSampling = false
  /**
  Consent and Delete history are checked when a reading is collected
  (RVM107W2 P2): while history is off, or once a delete has happened, the
  collector and everything it holds are dropped, so nothing from an off or
  deleted period can be written later.
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
      void sampleOnce(status).catch((error: unknown) => {
        // The pump owns this reading: the rejection has no other consumer,
        // so the tail forwards it to the recorder's error channel instead
        // of dropping it, and the pump continues with the next reading.
        report(error)
      })
    },
    event(event) {
      if (!isAdmitted()) return
      void eventOnce(event).catch((error: unknown) => {
        // As above: a foreign event failure reaches the error channel with
        // its value instead of being dropped after a prose comment.
        report(error)
      })
    },
    flush: async () => {
      // A delete or consent change since the last reading drops what is held.
      isAdmitted()
      await records.flush()
    },
  }
}

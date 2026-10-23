// Bound playbook and schedules report inputs (M113 lane C-M113-4,
// PLAN.md D93.4). Every engine construction (VS Code, ACP, CLI) builds
// these from the same durable sources: M116's playbook journal and M115's
// schedule store with its fire record. Ships in
// dist/playbookSchedulesInputs.js, beside the session/usage inputs chunk:
// the journal replay and the schedule store machinery would overflow that
// chunk's 100 KiB budget, and no budget is raised to fit them. The hosts
// pass only identifiers and directories, so activation carries no new
// import.
import {
  FilePlaybookJournal,
  PlaybookHistoryLostError,
  validatedRecords,
} from '../../core/orchestration/playbook/journal'
import { PLAYBOOK_PANEL_TEAM } from '../../shared/constants'
import {
  comparePlaybookReportItems,
  playbookOrderReportNote,
  type PlaybookRecord,
  replayPlaybookSettings,
} from '../../shared/playbook'
import { UI_TEXT } from '../../shared/l10n/text'
import type { PlaybookReportOrderer } from '../../core/reporting/collect/playbookOrder'
import type { ScheduleFsPort } from '../../core/schedules/journal'
import { createScheduleStore } from '../../core/schedules/store'
import { LocalSourceError } from '../../core/reporting/sources/local'
import type { PlaybookReportReader } from '../../core/reporting/sources/playbook'
import type { SchedulesReportReader } from '../../core/reporting/sources/schedules'
import type { SourceReadContext } from '../../core/reporting/sources/types'
import { createNodeScheduleFs, type ScheduleQueueFailure } from '../schedules/nodeScheduleFs'

/**
The reporting `playbook` source from M116's journal: the same file the
orchestrator replays, read-only. A lost journal (the marker without its
lines) is a failure with its reason, never an empty success; a workspace
with no journal yet reads empty, never an error.
*/
export function createPlaybookReportReader(input: {
  readonly agentDataFolder: string
  readonly workspaceRoot: string
}): PlaybookReportReader {
  return {
    read: (context: SourceReadContext) => {
      let records: readonly unknown[]
      try {
        records = new FilePlaybookJournal(input.agentDataFolder, input.workspaceRoot).read()
      } catch (error) {
        const isReadFailure =
          error instanceof PlaybookHistoryLostError || (error instanceof Error && 'code' in error)
        return Promise.reject(new LocalSourceError(isReadFailure ? 'failed' : 'invalid'))
      }
      return Promise.resolve({ records, observedAt: context.asOf })
    },
  }
}

/**
`validatedRecords`, but a validation failure — which quotes record
content — answers unavailability instead of throwing it outward. Any
other failure (a defect above the records) is rethrown as it is.
*/
function validRecordsOrUnavailable(
  raw: readonly unknown[],
): { ok: true; records: PlaybookRecord[] } | { ok: false } {
  try {
    return { ok: true, records: validatedRecords(raw) }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === '$ZodError') return { ok: false }
    throw error
  }
}

/**
D214: the report ordering over the same journal the reader reads, for the
person's panel team. Every call replays the journal fresh (like the policy's
refresh), gates on the replayed loudFailures switch, and sorts through the
one shared ordering; nothing is stored, so reads never contend. A lost
journal throws lost; anything else unreadable throws unavailable.
*/
export function createPlaybookReportOrder(input: {
  readonly agentDataFolder: string
  readonly workspaceRoot: string
}): PlaybookReportOrderer {
  const journal = new FilePlaybookJournal(input.agentDataFolder, input.workspaceRoot)
  const readRecords = () => {
    // The journal's own failures travel as they are (lost stays lost).
    const raw = journal.read()
    const parsed = validRecordsOrUnavailable(raw)
    if (!parsed.ok) throw new Error(UI_TEXT.playbookUnavailable)
    return parsed.records
  }
  return {
    orderReport: (items) => {
      const records = readRecords()
      const settings = replayPlaybookSettings(records, PLAYBOOK_PANEL_TEAM)
      const ordered = [...items]
      if (settings.rules.loudFailures.enabled)
        ordered.sort((a, b) => comparePlaybookReportItems(a, b))
      return {
        items: structuredClone(ordered),
        note: playbookOrderReportNote(settings, Date.now()),
      }
    },
    getRecord: () => structuredClone(readRecords()),
  }
}

/**
The reporting `schedules` source from M115's store and fire record: the
workspace's schedules with their triggers and grants, and the settled
fires with outcomes and cost. Until delivery is registered (CM1151) no v2
fire exists; the fires read empty and the report shows that truthfully.
*/
/**
Store-content failures the reader maps to `invalid`, like the playbook
reader maps malformed journals: damaged JSON, a workspace or identity
mismatch, a broken revision chain, a fencing-token regression (another
writer's older delta superseding the lease owner's: corrupt journal data,
never a generic read failure) and every zod parse rejection. Genuine I/O
failures stay `failed`. A corrupt store is never an empty success and
never a generic read failure with the store's reason discarded.
*/
const SCHEDULE_CONTENT_FAILURES = new Set([
  'scheduleStoredJsonInvalid',
  'scheduleWorkspaceMismatch',
  'scheduleOutcomeIdentityMissing',
  'scheduleFireIdentityMismatch',
  'scheduleIndexRevisionMismatch',
  'scheduleIndexDeltaInvalid',
  'scheduleJournalLimitExceeded',
  'scheduleJournalFencingRegression',
])

/** Immutable identity is invalid once; ownership races alone may heal. */
export const SCHEDULE_QUEUE_FAILURES = {
  scheduleLeaseBusy: 'busy',
  scheduleQueueOwnershipLost: 'retry',
  scheduleQueueLeaseInvalid: 'invalid',
  scheduleLeaseHeartbeatFailed: 'failed',
  scheduleStoragePathRefused: 'failed',
  scheduleStorageLinkRefused: 'failed',
} satisfies Record<ScheduleQueueFailure, 'busy' | 'retry' | 'invalid' | 'failed'>

function scheduleFailure(error: unknown): 'busy' | 'retry' | 'invalid' | 'failed' {
  if (error instanceof Error) {
    for (const [word, verdict] of Object.entries(SCHEDULE_QUEUE_FAILURES))
      if (error.message === word) return verdict
    if (error.message === 'scheduleJournalOwnershipLost') return 'retry'
    if (SCHEDULE_CONTENT_FAILURES.has(error.message) || error.name === '$ZodError') return 'invalid'
  }
  return 'failed'
}

export function createSchedulesReportReader(input: {
  readonly storeRoot: string
  readonly workspaceKey: string
}): SchedulesReportReader {
  return {
    read: async (context: SourceReadContext) => {
      // A cancelled source read stops, never abandons: the caller's signal
      // (the person's cancel) travels through the store to the lock
      // acquisition, which checks it on every turn and before every write
      // and performs no read, write or publish after it fires. No deadline
      // of ours ends the wait for a held lease (D121/D208): the read takes
      // the lease once its holder releases it or the lease expires.
      const { signal } = context
      const raw = createNodeScheduleFs(input.storeRoot)
      const fs: ScheduleFsPort = {
        read: (file) => raw.read(file),
        names: (directory) => raw.names(directory),
        publish: (file, content, guard) => raw.publish(file, content, guard),
        replace: (file, content, guard) => raw.replace(file, content, guard),
        remove: (file, canRetryTransient) => raw.remove(file, canRetryTransient),
        lock: (key, work) => raw.lock(key, work, { signal }),
      }
      const store = createScheduleStore(fs)
      // No attempt count of ours (D121): the snapshot loop re-reads until a
      // list/fires/list triple agrees, another writer's churn settling, or
      // the person's cancel stops the read.
      for (;;) {
        signal.throwIfAborted()
        try {
          const schedules = await store.list(input.workspaceKey)
          const fires = await store.fires(input.workspaceKey)
          const confirmed = await store.list(input.workspaceKey)
          // Every settings/admission mutation advances the per-schedule
          // revision; ids cannot be reused. Equal ordered revision sets on
          // both sides of the locked history read describe one snapshot.
          const revisions = (rows: typeof schedules) =>
            JSON.stringify(rows.map(({ id, revision }) => [id, revision]))
          if (revisions(schedules) !== revisions(confirmed)) continue
          return { schedules: [...confirmed], fires: [...fires], observedAt: context.asOf }
        } catch (error) {
          const failure = scheduleFailure(error)
          if (failure === 'retry') continue
          throw new LocalSourceError(failure)
        }
      }
    },
  }
}

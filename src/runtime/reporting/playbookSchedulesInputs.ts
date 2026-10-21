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
} from '../../core/orchestration/playbook/journal'
import {
  REPORT_SOURCE_TIMEOUT_MS,
  SCHEDULE_FS_RETRY_ATTEMPTS,
  SCHEDULE_LEASE_POLL_MS,
} from '../../shared/constants'
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
      // A cancelled or timed-out source read stops, never abandons: the
      // signal and this read's deadline travel through the store to the lock
      // acquisition, which checks them on every turn and before every write
      // and performs no read, write or publish after either fires. The window
      // always starts at read start: fixture and refresh stamps stay out of
      // it, so a late refresh still gets its full wait. Less one poll turn
      // of settle budget, so this verdict precedes the source's own timeout
      // and the race reports busy, never cancelled.
      const deadlineMs = Date.now() + REPORT_SOURCE_TIMEOUT_MS - SCHEDULE_LEASE_POLL_MS
      const { signal } = context
      const raw = createNodeScheduleFs(input.storeRoot)
      const fs: ScheduleFsPort = {
        read: (file) => raw.read(file),
        names: (directory) => raw.names(directory),
        publish: (file, content, guard) => raw.publish(file, content, guard),
        replace: (file, content, guard) => raw.replace(file, content, guard),
        remove: (file, canRetryTransient) => raw.remove(file, canRetryTransient),
        lock: (key, work) => raw.lock(key, work, { signal, deadlineMs }),
      }
      const store = createScheduleStore(fs)
      for (let attempt = 0; attempt < SCHEDULE_FS_RETRY_ATTEMPTS; attempt += 1) {
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
      throw new LocalSourceError('busy')
    },
  }
}

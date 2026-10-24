// Bound playbook, schedules and issues report inputs (M113 lane C-M113-4,
// PLAN.md D93.4). Every engine construction (VS Code, ACP, CLI) builds
// these from the same durable sources: M116's playbook journal, M115's
// schedule store with its fire record, and M115w's watchdog records. Ships in
// dist/playbookSchedulesInputs.js, beside the session/usage inputs chunk:
// the journal replay and the schedule store machinery would overflow that
// chunk's 100 KiB budget, and no budget is raised to fit them. The hosts
// pass only identifiers and directories, so activation carries no new
// import.
import {
  FilePlaybookJournal,
  PlaybookHistoryLostError,
} from '../../core/orchestration/playbook/journal'
import { SCHEDULE_FS_RETRY_ATTEMPTS } from '../../shared/constants'
import type { ScheduleFsPort } from '../../core/schedules/journal'
import { createScheduleStore } from '../../core/schedules/store'
import { readWatchdogRepositories } from '../../core/watchdog/storeRead'
import { isParseFailure, LocalSourceError } from '../../core/reporting/sources/local'
import type { IssuesReportReader } from '../../core/reporting/sources/issues'
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

/**
The reporting `issues` source from M115w's watchdog records: the same
files the watchdog writes, read-only. No watched repository reads empty,
never an error; damaged JSON or a record the schema refuses is `invalid`,
and a real I/O failure is `failed`.
*/
export function createIssuesReportReader(input: {
  readonly agentDataFolder: string
}): IssuesReportReader {
  return {
    read: async (context: SourceReadContext) => {
      try {
        const repositories = await readWatchdogRepositories(
          createNodeScheduleFs(input.agentDataFolder),
        )
        return { repositories, observedAt: context.asOf }
      } catch (error: unknown) {
        // Damaged JSON or a record the schema refuses is invalid data. A
        // read failure surfaces as it is: the source records it as failed.
        if (!isParseFailure(error)) throw error
        throw new LocalSourceError('invalid')
      }
    },
  }
}

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
import { createScheduleStore } from '../../core/schedules/store'
import { LocalSourceError } from '../../core/reporting/sources/local'
import type { PlaybookReportReader } from '../../core/reporting/sources/playbook'
import type { SchedulesReportReader } from '../../core/reporting/sources/schedules'
import type { SourceReadContext } from '../../core/reporting/sources/types'
import { createNodeScheduleFs } from '../schedules/nodeScheduleFs'

/**
 * The reporting `playbook` source from M116's journal: the same file the
 * orchestrator replays, read-only. A lost journal (the marker without its
 * lines) is a failure with its reason, never an empty success; a workspace
 * with no journal yet reads empty, never an error.
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
 * The reporting `schedules` source from M115's store and fire record: the
 * workspace's schedules with their triggers and grants, and the settled
 * fires with outcomes and cost. Until delivery is registered (CM1151) no v2
 * fire exists; the fires read empty and the report shows that truthfully.
 */
export function createSchedulesReportReader(input: {
  readonly storeRoot: string
  readonly workspaceKey: string
}): SchedulesReportReader {
  return {
    read: async (context: SourceReadContext) => {
      const store = createScheduleStore(createNodeScheduleFs(input.storeRoot))
      try {
        const schedules = await store.list(input.workspaceKey)
        const fires = await store.fires(input.workspaceKey)
        return {
          schedules: [...schedules],
          fires: [...fires],
          observedAt: context.asOf,
        }
      } catch {
        throw new LocalSourceError('failed')
      }
    },
  }
}

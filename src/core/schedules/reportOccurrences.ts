import { SCHEDULE_FENCE_SEGMENT_CHARS } from '../../shared/constants'
import type { ReportOccurrencePort } from '../reporting/destinations/types'
import { reportOccurrenceRecordSchema } from '../reporting/destinations/types'
import { parseScheduleStoredJson, type ScheduleFsPort } from './journal'
import { scheduleStorageHash } from './store'

function occurrenceFile(scheduleId: string, occurrence: string): string {
  const schedule = scheduleStorageHash(scheduleId)
  const hash = scheduleStorageHash(occurrence)
  return `reports/${schedule}/${hash.slice(0, SCHEDULE_FENCE_SEGMENT_CHARS)}/${hash}.json`
}

/**
M115's occurrence claim/store for M113 Q's runner: one record per
schedule and occurrence, every access under the store's cross-process
lock. The runner persists the frozen payload before any destination
dispatch; retries re-read it and never recollect facts.
*/
export function createReportOccurrencePort(fs: ScheduleFsPort): ReportOccurrencePort {
  return {
    exclusive<T>(scheduleId: string, occurrence: string, work: () => Promise<T>): Promise<T> {
      return fs.lock(occurrenceFile(scheduleId, occurrence), work)
    },
    async read(scheduleId: string, occurrence: string) {
      const raw = await fs.read(occurrenceFile(scheduleId, occurrence))
      return raw === undefined
        ? null
        : reportOccurrenceRecordSchema.parse(parseScheduleStoredJson(raw))
    },
    async write(scheduleId: string, occurrence: string, record) {
      await fs.replace(
        occurrenceFile(scheduleId, occurrence),
        JSON.stringify(reportOccurrenceRecordSchema.parse(record)),
      )
    },
  }
}

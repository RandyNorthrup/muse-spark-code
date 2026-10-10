// Lazy entry for the session and usage report inputs (M113 C-M113-2).
// Loaded as dist/reportInputs.js on the first session or usage report, so the
// usage journal machinery never rides the reporting engine's own budget.
export {
  createSessionReportReader,
  createUsageReportReader,
  readStoredReportSession,
  readUsageReportJournal,
  type SessionHistoryInput,
} from './reportInputs'

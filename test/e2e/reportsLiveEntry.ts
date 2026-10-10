// Test-only live binding for the session and usage report kinds; never shipped.
// Unlike reportsEntry.ts it keeps main.ts's own services, so the CLI cases
// below run the same engine construction as production (C-M113-2).
export { createRuntimeReports } from '../../src/runtime/reporting/reportsEntry'

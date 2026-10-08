import { createLocalReportSources, type LocalReportSourceDeps } from '../../core/reporting/sources'

/** The host passes its filesystem, Git, session and registry ports on first report. */
export function createHostReportSources(deps: LocalReportSourceDeps) {
  return createLocalReportSources(deps)
}

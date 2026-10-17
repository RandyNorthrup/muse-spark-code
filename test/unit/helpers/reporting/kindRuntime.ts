import path from 'node:path'
import { EN } from '../../../../src/shared/l10n/en'
import { createReportingServices } from '../../../../src/runtime/reporting/engine'

export const REPORT_AS_OF = '2026-10-06T12:00:00+00:00'

/** Real engine services over a fixture workspace (English table, no history). */
export function reportingServicesFor(workspace: string) {
  return createReportingServices({
    workspaceRoot: workspace,
    storageRoot: path.join(workspace, 'reports'),
    l10n: { table: EN, locale: 'en' },
    generatorVersion: 'test',
    keepHistory: false,
    enabledAgents: [],
  })
}

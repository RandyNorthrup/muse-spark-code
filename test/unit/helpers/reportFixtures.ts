// What the report suites share: the allowlisted support facts the real
// builder accepts, a data source that answers them, and editor operations
// that all succeed. The suites override one member to make one thing fail.

import type { ReportDataSource } from '../../../src/host/conversation/reportProblemHandler'
import type { ReportEditorIo } from '../../../src/host/support/reportProblem'

/** Allowlisted support facts the real builder accepts. */
export const REPORT_FACTS = {
  extensionVersion: '0.19.0',
  nodeVersion: '24.21.0',
  platform: 'linux',
  backend: 'modelApi',
  sandbox: 'off',
  cliFound: false,
  cliSignIn: false,
  hasStoredApiKey: false,
  hasEnvironmentApiKey: false,
  settingNames: [],
} as const

/** A source with valid facts, an empty journal and no scrub context. */
export function validReportSource(overrides?: Partial<ReportDataSource>): ReportDataSource {
  return {
    readFacts: () => Promise.resolve(REPORT_FACTS),
    readJournal: () => Promise.resolve({ entries: [], recordingUnavailable: false }),
    readScrub: () => ({ workspaceRoots: [], homeDir: '', extraLiterals: [] }),
    nowMs: () => Date.now(),
    canUseVscodeReporter: () => Promise.resolve(true),
    ...overrides,
  }
}

/** Editor operations that all succeed. */
export function workingReportIo(overrides?: Partial<ReportEditorIo>): ReportEditorIo {
  return {
    writeClipboard: () => Promise.resolve(undefined),
    openExternal: () => Promise.resolve(true),
    saveText: () => Promise.resolve(true),
    openIssueReporter: () => Promise.resolve(undefined),
    ...overrides,
  }
}

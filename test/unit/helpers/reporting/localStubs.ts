// Shared stubs for report-source tests: files and git the source under
// test never touches reject loudly, so a stray access fails the case
// instead of hanging it.
import {
  createLocalReportSources,
  type LocalReportSourceDeps,
} from '../../../../src/core/reporting/sources'

export function stubLocalDeps(
  overrides: Partial<LocalReportSourceDeps> = {},
): LocalReportSourceDeps {
  return {
    files: {
      read: () => Promise.reject(new Error('unused file read')),
      list: () => Promise.reject(new Error('unused file list')),
    },
    git: { run: () => Promise.resolve({ stdout: '', code: 1 }) },
    scrub: (text) => text,
    roots: [],
    enabledAgents: [],
    agentFiles: [],
    ...overrides,
  }
}

export function stubLocalSources(overrides: Partial<LocalReportSourceDeps> = {}) {
  return createLocalReportSources(stubLocalDeps(overrides))
}

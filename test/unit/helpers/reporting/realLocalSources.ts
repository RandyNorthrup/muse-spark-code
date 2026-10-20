// Real local-report-source dependencies for tests: the production
// confined file reader and git probe rooted at a real temp directory,
// with the production scrubber. Nothing here answers in place of the
// product: files and git are the code the reports ship, so a stray access
// fails the case loudly instead of hanging it. A test that needs a failing
// read removes or chmods a real file.
import {
  createLocalReportSources,
  type LocalReportSourceDeps,
} from '../../../../src/core/reporting/sources'
import { reportScrubber } from '../../../../src/core/reporting/render/redaction'
import { reportFileIo, reportGitIo } from '../../../../src/runtime/reporting/sources'

export function realLocalSources(
  root: string,
  overrides: Partial<LocalReportSourceDeps> = {},
): ReturnType<typeof createLocalReportSources> {
  return createLocalReportSources({
    files: reportFileIo(root, process.platform),
    git: reportGitIo(root, process.platform, process.env),
    scrub: reportScrubber({ workspaceRoot: root }),
    roots: [root],
    enabledAgents: [],
    agentFiles: [],
    ...overrides,
  })
}

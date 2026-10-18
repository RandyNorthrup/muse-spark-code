// The report-only message handler (M93): every failure reaches the dialog
// in fixed words and the record by kind, through the real builder and the
// real export paths.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createReportProblemHandler,
  type ReportDataSource,
  type ReportProblemHandlerDeps,
  type ReportProblemMessage,
} from '../../src/host/conversation/reportProblemHandler'
import type { ReportEditorIo } from '../../src/host/support/reportProblem'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { captureLog } from './helpers/captureLog'

const MISSING = path.join('temp', 'report-problem-never-written.json')

/** Allowlisted support facts the real builder accepts. */
const FACTS = {
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

interface Captured {
  readonly posted: HostToWebviewMessage[]
  readonly notices: string[]
  readonly logLines: string[]
}

/** A source with valid facts, an empty journal and no scrub context. */
function validSource(overrides?: Partial<ReportDataSource>): ReportDataSource {
  return {
    readFacts: () => Promise.resolve(FACTS),
    readJournal: () => Promise.resolve({ entries: [], recordingUnavailable: false }),
    readScrub: () => ({ workspaceRoots: [], homeDir: '', extraLiterals: [] }),
    nowMs: () => Date.now(),
    canUseVscodeReporter: () => Promise.resolve(true),
    ...overrides,
  }
}

/** Editor operations that all succeed. */
function workingIo(overrides?: Partial<ReportEditorIo>): ReportEditorIo {
  return {
    writeClipboard: () => Promise.resolve(undefined),
    openExternal: () => Promise.resolve(true),
    saveText: () => Promise.resolve(true),
    openIssueReporter: () => Promise.resolve(undefined),
    ...overrides,
  }
}

function makeDeps(overrides?: Partial<ReportProblemHandlerDeps>): {
  deps: ReportProblemHandlerDeps
  captured: Captured
} {
  const posted: HostToWebviewMessage[] = []
  const notices: string[] = []
  const { logger, lines: logLines } = captureLog()
  const deps: ReportProblemHandlerDeps = {
    post: (message) => {
      posted.push(message)
    },
    noticeError: (text) => {
      notices.push(text)
    },
    log: logger,
    source: validSource(),
    io: workingIo(),
    onReportWebviewError: () => undefined,
    ...overrides,
  }
  return { deps, captured: { posted, notices, logLines } }
}

/** Opens with overrides, expecting the dialog told and nothing posted. */
async function refusedOpen(overrides?: Partial<ReportProblemHandlerDeps>): Promise<Captured> {
  const { deps, captured } = makeDeps(overrides)
  const { handle } = createReportProblemHandler(deps)
  await handle({ type: 'openReport' })
  expect(captured.posted).toEqual([])
  expect(captured.notices).toEqual([UI_TEXT.actionFailed])
  return captured
}

/** Opens with overrides and answers the posted draft's seal for export. */
async function openForExport(overrides?: Partial<ReportProblemHandlerDeps>): Promise<{
  handle: (message: ReportProblemMessage) => Promise<void>
  hash: string
  captured: Captured
}> {
  const { deps, captured } = makeDeps(overrides)
  const { handle } = createReportProblemHandler(deps)
  await handle({ type: 'openReport' })
  const draft = captured.posted[0]
  expect(draft?.type).toBe('reportDraft')
  if (draft?.type !== 'reportDraft') throw new Error('the open posted no draft')
  return { handle, hash: draft.hash, captured }
}

describe('createReportProblemHandler', () => {
  it('opens a draft built from real validated facts', async () => {
    const { deps, captured } = makeDeps()
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    expect(captured.posted).toHaveLength(1)
    const draft = captured.posted[0]
    expect(draft?.type).toBe('reportDraft')
    expect(captured.notices).toEqual([])
  })

  it('tells the dialog and records the kind when the snapshot fails', async () => {
    const captured = await refusedOpen({
      source: validSource({
        // A real refusal: the journal read fails with a genuine ENOENT.
        readJournal: async () => {
          await readFile(MISSING, 'utf8')
          return { entries: [], recordingUnavailable: false }
        },
      }),
    })
    expect(captured.logLines.some((line) => line.includes('problem report snapshot failed'))).toBe(
      true,
    )
  })

  it('tells the dialog and records the kind when the builder refuses the facts', async () => {
    const captured = await refusedOpen({
      source: validSource({
        // Off-allowlist facts: the real builder refuses with ReportBuildError.
        readFacts: () => Promise.resolve({}),
      }),
    })
    expect(captured.logLines.some((line) => line.includes('problem report rebuild failed'))).toBe(
      true,
    )
    expect(captured.logLines.some((line) => line.includes('ReportBuildError'))).toBe(true)
  })

  it('answers a refused reporter open in fixed words and records it', async () => {
    const { handle, hash, captured } = await openForExport({
      io: workingIo({
        // A real refusal: the reporter open fails with a genuine ENOENT.
        openIssueReporter: async () => {
          await readFile(MISSING, 'utf8')
        },
      }),
    })
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash })
    const answer = captured.posted[1]
    expect(answer).toMatchObject({ type: 'reportExported', ok: false, reason: 'reporterFailed' })
    expect(
      captured.logLines.some((line) => line.includes('Report export (vscodeReporter) failed')),
    ).toBe(true)
  })

  it('tells the dialog and records the kind when the export scrub fails', async () => {
    // The open scrubs the title and the text; the export scrubs them again.
    // The scrub holds for the open's two calls, then fails for real with a
    // genuine ENOENT, reaching the export's own failure path.
    let scrubs = 0
    const { handle, hash, captured } = await openForExport({
      vaultScrub: {
        scrub: async (text: string) => {
          scrubs += 1
          if (scrubs > 2) {
            await readFile(MISSING, 'utf8')
          }
          return text
        },
      },
    })
    await handle({ type: 'exportReport', via: 'copy', hash })
    expect(captured.posted).toHaveLength(1)
    expect(captured.notices).toEqual([UI_TEXT.actionFailed])
    expect(captured.logLines.some((line) => line.includes('problem report scrub failed'))).toBe(
      true,
    )
  })
})

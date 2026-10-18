// The report-only message handler (M93): every failure reaches the dialog
// in fixed words and the record by kind, through the real builder and the
// real export paths.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createReportProblemHandler,
  type ReportProblemHandlerDeps,
} from '../../src/host/conversation/reportProblemHandler'
import { createLogger } from '../../src/host/logger'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'

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

function makeDeps(overrides?: Partial<ReportProblemHandlerDeps>): {
  deps: ReportProblemHandlerDeps
  captured: Captured
} {
  const posted: HostToWebviewMessage[] = []
  const notices: string[] = []
  const logLines: string[] = []
  const deps: ReportProblemHandlerDeps = {
    post: (message) => {
      posted.push(message)
    },
    noticeError: (text) => {
      notices.push(text)
    },
    log: createLogger({
      trace: (message) => {
        logLines.push(`trace ${message}`)
      },
      info: (message) => {
        logLines.push(`info ${message}`)
      },
      warn: (message) => {
        logLines.push(`warn ${message}`)
      },
      error: (message) => {
        logLines.push(`error ${message}`)
      },
    }),
    source: {
      readFacts: () => Promise.resolve(FACTS),
      readJournal: () => Promise.resolve({ entries: [], recordingUnavailable: false }),
      readScrub: () => ({ workspaceRoots: [], homeDir: '', extraLiterals: [] }),
      nowMs: () => Date.now(),
      canUseVscodeReporter: () => Promise.resolve(true),
    },
    io: {
      writeClipboard: () => Promise.resolve(undefined),
      openExternal: () => Promise.resolve(true),
      saveText: () => Promise.resolve(true),
      openIssueReporter: () => Promise.resolve(undefined),
    },
    onReportWebviewError: () => undefined,
    ...overrides,
  }
  return { deps, captured: { posted, notices, logLines } }
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
    const { deps, captured } = makeDeps({
      source: {
        readFacts: () => Promise.resolve(FACTS),
        // A real refusal: the journal read fails with a genuine ENOENT.
        readJournal: async () => {
          await readFile(MISSING, 'utf8')
          return { entries: [], recordingUnavailable: false }
        },
        readScrub: () => ({ workspaceRoots: [], homeDir: '', extraLiterals: [] }),
        nowMs: () => Date.now(),
        canUseVscodeReporter: () => Promise.resolve(true),
      },
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    expect(captured.posted).toEqual([])
    expect(captured.notices).toEqual([UI_TEXT.actionFailed])
    expect(captured.logLines.some((line) => line.includes('problem report snapshot failed'))).toBe(
      true,
    )
  })

  it('tells the dialog and records the kind when the builder refuses the facts', async () => {
    const { deps, captured } = makeDeps({
      // Off-allowlist facts: the real builder refuses with ReportBuildError.
      source: {
        readFacts: () => Promise.resolve({}),
        readJournal: () => Promise.resolve({ entries: [], recordingUnavailable: false }),
        readScrub: () => ({ workspaceRoots: [], homeDir: '', extraLiterals: [] }),
        nowMs: () => Date.now(),
        canUseVscodeReporter: () => Promise.resolve(true),
      },
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    expect(captured.posted).toEqual([])
    expect(captured.notices).toEqual([UI_TEXT.actionFailed])
    expect(captured.logLines.some((line) => line.includes('problem report rebuild failed'))).toBe(
      true,
    )
    expect(captured.logLines.some((line) => line.includes('ReportBuildError'))).toBe(true)
  })

  it('answers a refused reporter open in fixed words and records it', async () => {
    const { deps, captured } = makeDeps({
      io: {
        writeClipboard: () => Promise.resolve(undefined),
        openExternal: () => Promise.resolve(true),
        saveText: () => Promise.resolve(true),
        // A real refusal: the reporter open fails with a genuine ENOENT.
        openIssueReporter: async () => {
          await readFile(MISSING, 'utf8')
        },
      },
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    const draft = captured.posted[0]
    expect(draft?.type).toBe('reportDraft')
    if (draft?.type !== 'reportDraft') return
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash: draft.hash })
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
    const { deps, captured } = makeDeps({
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
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    const draft = captured.posted[0]
    expect(draft?.type).toBe('reportDraft')
    if (draft?.type !== 'reportDraft') return
    await handle({ type: 'exportReport', via: 'copy', hash: draft.hash })
    expect(captured.posted).toHaveLength(1)
    expect(captured.notices).toEqual([UI_TEXT.actionFailed])
    expect(captured.logLines.some((line) => line.includes('problem report scrub failed'))).toBe(
      true,
    )
  })
})
